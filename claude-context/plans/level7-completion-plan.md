# Implementation Plan: Level 7 Completion

## Context

Level 7 (Autonomous Task Runner) MVP is complete with SQLite task queue, Agent SDK orchestrator, task board UI, and cost tracking. Three features remain to complete Level 7 as specified in ROADMAP.md (line 47 onwards):

1. **Git checkpoint before each task**: Create checkpoints before task execution, enable rollback on failure
2. **Configurable approval gates**: Route dangerous operations to phone for approval via WebSocket
3. **allowedTools scoping**: Restrict which tools tasks can use

These features add safety and control to autonomous task execution, addressing the "tasks can do anything" limitation noted in CURRENT_STATUS.md.

## Implementation Approach

### Feature 1: Git Checkpoint System

**Database Schema Changes:**
Add git checkpoint tracking to tasks table:
```sql
ALTER TABLE tasks ADD COLUMN checkpoint_ref TEXT;
ALTER TABLE tasks ADD COLUMN checkpoint_created_at TEXT;
ALTER TABLE tasks ADD COLUMN checkpoint_type TEXT;
```

**Implementation Steps:**

1. **Git helper functions** (add to server.js after line 177):
   - `isGitRepo(projectPath)` - Check if directory is a git repo
   - `hasUncommittedChanges(projectPath)` - Check for dirty working tree
   - `createCheckpoint(projectPath, taskId)` - Create checkpoint branch or stash
   - `rollbackCheckpoint(projectPath, checkpointRef)` - Restore to checkpoint
   - `cleanupCheckpoint(projectPath, checkpointRef)` - Remove checkpoint after success

   Use `execFileSync('git', [...], { cwd: projectPath })` pattern following existing tmux command patterns.

2. **Checkpoint strategy** (decision logic):
   - If git repo exists:
     - If clean working tree: create branch `han/checkpoint-{taskId}`
     - If dirty: create stash with message `han checkpoint {taskId}`
   - If not git repo: skip (no checkpoint)
   - Store checkpoint_ref, checkpoint_type ('branch'/'stash'/'none') in DB

3. **Integration into runNextTask()** (modify lines 1048-1141):
   ```javascript
   // After marking task as running (line 1059), before agentQuery:
   let checkpointRef = null;
   let checkpointType = 'none';

   if (isGitRepo(task.project_path)) {
       const result = createCheckpoint(task.project_path, task.id);
       checkpointRef = result.ref;
       checkpointType = result.type;
       db.prepare('UPDATE tasks SET checkpoint_ref = ?, checkpoint_type = ?, checkpoint_created_at = ? WHERE id = ?')
           .run(checkpointRef, checkpointType, new Date().toISOString(), task.id);
   }

   // ... agentQuery execution ...

   // In success handler (after line 1115):
   if (checkpointRef && checkpointType !== 'none') {
       cleanupCheckpoint(task.project_path, checkpointRef, checkpointType);
   }

   // In error/failure handler (after line 1134):
   if (checkpointRef && checkpointType !== 'none') {
       try {
           rollbackCheckpoint(task.project_path, checkpointRef, checkpointType);
           console.log(`[Task] Rolled back to checkpoint: ${checkpointRef}`);
       } catch (rollbackErr) {
           console.error(`[Task] Rollback failed:`, rollbackErr.message);
       }
   }
   ```

4. **Update prepared statements** (line 885-896):
   Add checkpoint fields to relevant queries (get, list, etc.).

### Feature 2: Configurable Approval Gates

**Database Schema Changes:**
Add gate_mode to tasks table:
```sql
ALTER TABLE tasks ADD COLUMN gate_mode TEXT DEFAULT 'bypass';
```

Modes: `'bypass'` (current behaviour), `'edits_only'` (approve Bash/dangerous), `'approve_all'` (approve everything)

**Implementation Steps:**

1. **Task creation endpoint** (modify POST /api/tasks around line 915):
   - Accept `gate_mode` in request body
   - Validate against allowed values
   - Store in database
   - Default to 'bypass' for backwards compatibility

2. **Approval queue data structure** (add after line 996):
   ```javascript
   const pendingApprovals = new Map(); // toolUseID -> { taskId, toolName, input, resolve, reject }
   ```

3. **canUseTool callback implementation** (add function around line 1045):
   ```javascript
   async function createCanUseToolCallback(taskId, gateMode) {
       return async (toolName, input, options) => {
           if (gateMode === 'bypass') {
               return { behavior: 'allow' };
           }

           const isDangerous = ['Bash', 'Write', 'Edit', 'NotebookEdit'].includes(toolName);
           const shouldGate = (gateMode === 'approve_all') ||
                             (gateMode === 'edits_only' && isDangerous);

           if (!shouldGate) {
               return { behavior: 'allow' };
           }

           // Route to phone for approval
           const approvalPromise = new Promise((resolve, reject) => {
               const approvalId = options.toolUseID;
               pendingApprovals.set(approvalId, {
                   taskId,
                   toolName,
                   input,
                   resolve,
                   reject,
                   timestamp: new Date().toISOString()
               });

               // Broadcast to phone
               broadcastApprovalRequest({
                   approvalId,
                   taskId,
                   toolName,
                   input,
                   timestamp: new Date().toISOString()
               });

               // Timeout after 5 minutes
               setTimeout(() => {
                   if (pendingApprovals.has(approvalId)) {
                       pendingApprovals.delete(approvalId);
                       reject(new Error('Approval timeout'));
                   }
               }, 5 * 60 * 1000);
           });

           try {
               const decision = await approvalPromise;
               return decision; // { behavior: 'allow' } or { behavior: 'deny', message: '...' }
           } catch (err) {
               return { behavior: 'deny', message: err.message };
           }
       };
   }
   ```

4. **Approval API endpoints** (add after line 992):
   ```javascript
   // GET /api/approvals - List pending approvals
   app.get('/api/approvals', (req, res) => {
       const approvals = Array.from(pendingApprovals.entries()).map(([id, data]) => ({
           approvalId: id,
           ...data,
           input: undefined, // Don't send full input in list
           resolve: undefined,
           reject: undefined
       }));
       res.json({ success: true, approvals });
   });

   // GET /api/approvals/:id - Get specific approval details
   app.get('/api/approvals/:id', (req, res) => {
       const approval = pendingApprovals.get(req.params.id);
       if (!approval) return res.status(404).json({ success: false, error: 'Not found' });
       res.json({
           success: true,
           approvalId: req.params.id,
           taskId: approval.taskId,
           toolName: approval.toolName,
           input: approval.input,
           timestamp: approval.timestamp
       });
   });

   // POST /api/approvals/:id/approve
   app.post('/api/approvals/:id/approve', (req, res) => {
       const approval = pendingApprovals.get(req.params.id);
       if (!approval) return res.status(404).json({ success: false, error: 'Not found' });

       pendingApprovals.delete(req.params.id);
       approval.resolve({ behavior: 'allow' });
       res.json({ success: true });
   });

   // POST /api/approvals/:id/deny
   app.post('/api/approvals/:id/deny', (req, res) => {
       const approval = pendingApprovals.get(req.params.id);
       if (!approval) return res.status(404).json({ success: false, error: 'Not found' });

       const { message } = req.body;
       pendingApprovals.delete(req.params.id);
       approval.resolve({
           behavior: 'deny',
           message: message || 'Denied by user'
       });
       res.json({ success: true });
   });
   ```

5. **WebSocket broadcast helper** (add after broadcastTaskProgress):
   ```javascript
   function broadcastApprovalRequest(approval) {
       if (wss.clients.size === 0) return;
       const message = JSON.stringify({ type: 'approval_request', ...approval });
       wss.clients.forEach((client) => {
           if (client.readyState === 1) client.send(message);
       });
   }
   ```

6. **Modify agentQuery call** (lines 1069-1080):
   ```javascript
   // Change permissionMode based on gate_mode
   const permissionMode = task.gate_mode === 'bypass' ? 'bypassPermissions' : 'default';
   const allowDangerous = task.gate_mode === 'bypass';

   const q = agentQuery({
       prompt: task.description,
       options: {
           model: task.model,
           maxTurns: task.max_turns,
           cwd: task.project_path,
           permissionMode: permissionMode,
           allowDangerouslySkipPermissions: allowDangerous,
           abortController: abort,
           env: cleanEnv,
           canUseTool: await createCanUseToolCallback(task.id, task.gate_mode)
       }
   });
   ```

7. **UI updates** (src/ui/index.html):
   - Add gate_mode dropdown to task creation form (bypass/edits_only/approve_all)
   - Add approval notification popup when approval_request WebSocket message arrives
   - Show approval prompt with tool name, input preview, approve/deny buttons
   - Call POST /api/approvals/:id/approve or /deny endpoints

### Feature 3: allowedTools Scoping

**Database Schema Changes:**
Add allowed_tools to tasks table:
```sql
ALTER TABLE tasks ADD COLUMN allowed_tools TEXT;
```

Store as JSON string: `'["Bash","Read","Edit","Glob","Grep"]'` or `null` for all tools.

**Implementation Steps:**

1. **Task creation endpoint** (modify POST /api/tasks):
   - Accept `allowed_tools` array in request body
   - Validate tool names against known tools
   - Store as JSON string in database
   - Default to `null` (all tools allowed)

2. **Modify agentQuery call** (lines 1069-1080):
   ```javascript
   const options = {
       model: task.model,
       maxTurns: task.max_turns,
       cwd: task.project_path,
       permissionMode: permissionMode,
       allowDangerouslySkipPermissions: allowDangerous,
       abortController: abort,
       env: cleanEnv,
       canUseTool: await createCanUseToolCallback(task.id, task.gate_mode)
   };

   // Add allowedTools if specified
   if (task.allowed_tools) {
       try {
           const toolsList = JSON.parse(task.allowed_tools);
           if (Array.isArray(toolsList) && toolsList.length > 0) {
               options.allowedTools = toolsList;
           }
       } catch (err) {
           console.error(`[Task] Invalid allowed_tools JSON: ${task.allowed_tools}`);
       }
   }

   const q = agentQuery({ prompt: task.description, options });
   ```

3. **UI updates** (src/ui/index.html):
   - Add multi-select checkbox list for tool selection in task creation form
   - Common presets: "All Tools", "Read Only", "Safe Tools" (Read/Glob/Grep), "Development" (Read/Write/Edit/Bash/Glob/Grep)
   - Show selected tools in task list view

## Critical Files to Modify

1. **src/server/server.js** (main implementation):
   - Lines 85-103: SQLite schema (add new columns)
   - Lines 177+: Add git helper functions
   - Lines 885-896: Update prepared statements
   - Lines 915-936: Modify POST /api/tasks (add gate_mode, allowed_tools)
   - Lines 992+: Add approval endpoints
   - Lines 1000-1043: Add approval broadcast functions
   - Lines 1045+: Add createCanUseToolCallback function
   - Lines 1048-1141: Modify runNextTask (add checkpoints, update agentQuery options)

2. **src/ui/index.html** (UI updates):
   - Task creation form: Add gate_mode dropdown, allowed_tools multi-select
   - Add approval popup component
   - WebSocket handler: Listen for 'approval_request' messages
   - Add approval UI handlers

3. **claude-context/CURRENT_STATUS.md** (documentation):
   - Mark Level 7 as complete
   - Update "Recent Changes" section
   - Update "What's Working" checklist

4. **claude-context/ARCHITECTURE.md** (documentation):
   - Add git checkpoint workflow diagram
   - Add approval gates architecture section
   - Document new API endpoints
   - Update Level 7 section

5. **claude-context/DECISIONS.md** (documentation):
   - Add DEC-010: Git Checkpoint Strategy (branch vs stash)
   - Add DEC-011: Approval Gate Implementation (canUseTool callback)
   - Add DEC-012: Tool Scoping Storage (JSON in SQLite)

## Database Migration Strategy

Since the database already exists, use ALTER TABLE statements:

```javascript
// Add after line 103 in server.js
db.exec(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checkpoint_ref TEXT`);
db.exec(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checkpoint_created_at TEXT`);
db.exec(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS checkpoint_type TEXT`);
db.exec(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS gate_mode TEXT DEFAULT 'bypass'`);
db.exec(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS allowed_tools TEXT`);
```

Note: SQLite doesn't support `IF NOT EXISTS` in ALTER TABLE. Use conditional check:

```javascript
const columns = db.pragma("table_info('tasks')").map(col => col.name);
if (!columns.includes('checkpoint_ref')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN checkpoint_ref TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN checkpoint_created_at TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN checkpoint_type TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN gate_mode TEXT DEFAULT 'bypass'`);
    db.exec(`ALTER TABLE tasks ADD COLUMN allowed_tools TEXT`);
}
```

## Verification Plan

### 1. Git Checkpoint Testing
- Create task in git repo with clean working tree → verify branch checkpoint created
- Let task fail → verify rollback restores original state
- Create task in git repo with uncommitted changes → verify stash checkpoint created
- Create task in non-git directory → verify graceful handling (no checkpoint)
- Check SQLite: verify checkpoint_ref, checkpoint_type stored correctly

### 2. Approval Gates Testing
- Create task with gate_mode='bypass' → verify runs without prompts (current behaviour)
- Create task with gate_mode='edits_only' → verify Bash commands trigger phone approval
- Create task with gate_mode='approve_all' → verify all tools trigger approval
- Test approval flow: receive WebSocket notification, approve via UI, verify task continues
- Test denial flow: deny approval, verify task fails gracefully
- Test timeout: don't respond to approval for 5+ minutes, verify task times out

### 3. allowedTools Testing
- Create task with allowed_tools=['Read', 'Grep'] → verify task can only use those tools
- Create task with allowed_tools=null → verify task can use all tools
- Create task with allowed_tools=['Read'] and description requiring Write → verify task fails or adapts
- Check task board UI: verify allowed_tools displayed correctly

### 4. Integration Testing
- Create task with all three features: git checkpoint + approval gate + tool scoping
- Verify checkpoint created before execution
- Verify approvals work with scoped tools
- Verify rollback works if approval denied
- Test from phone: create task, approve operations, verify completion

### 5. Regression Testing
- Verify existing tasks (without new fields) still work
- Verify task cancellation still works with new features
- Verify cost/token tracking unaffected
- Verify WebSocket streaming still works

## Success Criteria

✅ Git checkpoints created automatically before task execution
✅ Rollback works on task failure (git state restored)
✅ Approval gates configurable per task (bypass/edits_only/approve_all)
✅ Phone receives approval requests via WebSocket
✅ User can approve/deny operations from phone UI
✅ Tasks can be scoped to specific tools via allowed_tools
✅ All features work together without conflicts
✅ Documentation updated (CURRENT_STATUS, ARCHITECTURE, DECISIONS)
✅ Backwards compatible (existing tasks without new fields work)
✅ British English throughout

## Implementation Order

1. **Database migrations** (add columns)
2. **Git checkpoint system** (helper functions + integration)
3. **allowedTools scoping** (simpler, no UI complexity)
4. **Approval gates** (most complex, requires UI work)
5. **UI updates** (task form, approval popup)
6. **Testing** (each feature, then integration)
7. **Documentation** (CURRENT_STATUS, ARCHITECTURE, DECISIONS)
8. **Commit** (semantic commit message)

Estimated: 2-3 hours total implementation time.
