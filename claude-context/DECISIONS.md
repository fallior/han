# Claude Remote — Decision Log

> Architecture Decision Records (ADRs) — capturing the "why" behind choices

## How to Use This File

When you make a significant technical or design decision:

1. Add a new entry using the template below
2. Number sequentially: DEC-001, DEC-002, etc.
3. Include the context, options considered, and reasoning
4. Update status if a decision is later superseded

**What counts as a "decision"?**
- Technology choices (framework, database, library)
- Architecture patterns (how components interact)
- Data model design (schema choices)
- API design (endpoint structure, conventions)
- Trade-offs (performance vs simplicity, etc.)

---

## Decision Index

| ID | Title | Status | Date |
|----|-------|--------|------|
| DEC-001 | Event Source — Claude Code Hooks | Accepted | 2026-01-13 |
| DEC-002 | Session Management — tmux | Accepted | 2026-01-13 |
| DEC-003 | Push Notifications — ntfy.sh | Accepted | 2026-01-13 |
| DEC-004 | Remote Access — Tailscale | Accepted | 2026-01-13 |
| DEC-005 | Polling Interval — 15 seconds | Accepted | 2026-01-13 |
| DEC-006 | Storage Format — SQLite + Plain Text | Accepted | 2026-01-13 |
| DEC-007 | Task Execution — Claude Agent SDK | Accepted | 2026-02-15 |
| DEC-008 | Task Queue — SQLite with better-sqlite3 | Accepted | 2026-02-15 |
| DEC-009 | Task Permissions — Bypass Mode | Accepted | 2026-02-15 |
| DEC-010 | Git Checkpoint Strategy (branch vs stash) | Accepted | 2026-02-15 |
| DEC-011 | Approval Gate Implementation (canUseTool) | Accepted | 2026-02-15 |
| DEC-012 | Tool Scoping Storage (JSON in SQLite) | Accepted | 2026-02-15 |

---

## Decisions

### DEC-001: Event Source — Claude Code Hooks

**Date**: 2026-01-13
**Author**: Darron
**Status**: Accepted

#### Context

Need to detect when Claude Code is waiting for user input (permission approval, questions, etc.) to trigger notifications.

#### Options Considered

1. **Claude Code's built-in hook system**
   - ✅ Official, documented feature
   - ✅ Fires on `permission_prompt` and `idle_prompt` events
   - ✅ Passes JSON payload with context
   - ❌ VSCode extension hooks currently broken (GitHub #16114)

2. **Terminal output parsing**
   - ✅ Works regardless of Claude Code internals
   - ❌ Fragile — depends on output format
   - ❌ Requires constant monitoring
   - ❌ Difficult to distinguish prompt types

3. **Claude Code process monitoring**
   - ✅ Could detect blocking states
   - ❌ Very implementation-dependent
   - ❌ Likely to break with updates

#### Decision

We chose **Claude Code's built-in hook system** because it's the official, supported method. The hook system provides structured JSON payloads, distinguishes event types, and is designed for exactly this use case.

#### Consequences

- Dependent on Claude Code's hook implementation
- VSCode users must use terminal mode until extension hooks are fixed
- Future Claude Code updates may change hook behaviour (low risk — it's documented)

#### Related

- Claude Code hooks documentation
- GitHub issue #16114 (VSCode extension hooks)

---

### DEC-002: Session Management — tmux

**Date**: 2026-01-13
**Author**: Darron
**Status**: Accepted

#### Context

Need a way to:
1. Run Claude Code in a detachable session
2. Inject responses remotely
3. Optionally capture terminal output for context/mirroring

#### Options Considered

1. **tmux**
   - ✅ Industry standard
   - ✅ `send-keys` enables remote input injection
   - ✅ `capture-pane` enables output capture
   - ✅ Session persistence (survives SSH disconnect)
   - ❌ Extra dependency (though widely installed)

2. **GNU Screen**
   - ✅ Similar capabilities to tmux
   - ❌ Less modern, fewer features
   - ❌ Scripting API less powerful

3. **Custom PTY handling**
   - ✅ Full control over terminal
   - ❌ Complex to implement correctly
   - ❌ Reinventing the wheel

#### Decision

We chose **tmux** because it's the industry standard for terminal session management, widely installed on development machines, and provides exactly the primitives we need (`send-keys`, `capture-pane`, session naming).

#### Consequences

- Users must have tmux installed
- Claude Code must be launched via our `claude-remote` wrapper
- Enables future terminal mirroring capabilities (Level 4+)

---

### DEC-003: Push Notifications — ntfy.sh

**Date**: 2026-01-13
**Author**: Darron
**Status**: Accepted

#### Context

Need to alert the user's phone when Claude Code needs input, without requiring a native app.

#### Options Considered

1. **ntfy.sh**
   - ✅ Simple HTTP API (just POST to a URL)
   - ✅ Free tier is generous
   - ✅ Self-hostable option
   - ✅ Native apps for iOS/Android with good UX
   - ✅ Topic-based routing
   - ❌ Public topics are discoverable (use random strings)

2. **Pushover**
   - ✅ Reliable, established service
   - ❌ Requires API key management
   - ❌ Paid service (after trial)

3. **Custom WebSocket/FCM**
   - ✅ Full control
   - ❌ Requires running push infrastructure
   - ❌ Mobile app development needed

4. **Email/SMS**
   - ✅ Universal
   - ❌ Slow delivery
   - ❌ Poor UX for quick responses

#### Decision

We chose **ntfy.sh** because it offers the best simplicity-to-capability ratio. A single HTTP POST sends a push notification. The mobile apps provide good UX. Self-hosting is possible for privacy-conscious users.

#### Consequences

- Depends on ntfy.sh service availability (or self-hosted instance)
- Topic must be kept secret (treat like a password)
- iOS instant notifications require ntfy.sh upstream server config

---

### DEC-004: Remote Access — Tailscale

**Date**: 2026-01-13
**Author**: Darron
**Status**: Accepted

#### Context

Need secure access to the Express server from mobile device when away from local network.

#### Options Considered

1. **Tailscale**
   - ✅ Zero-config WireGuard VPN
   - ✅ End-to-end encrypted
   - ✅ No port forwarding needed
   - ✅ Works across NAT/firewalls
   - ✅ Free for personal use
   - ❌ Requires Tailscale on all devices

2. **Cloudflare Tunnel**
   - ✅ No client needed on mobile
   - ❌ Exposes to public internet
   - ❌ Requires authentication setup

3. **Direct port forwarding**
   - ✅ Simple concept
   - ❌ Security nightmare
   - ❌ Router configuration needed
   - ❌ Dynamic IP issues

4. **VPN (traditional)**
   - ✅ Familiar
   - ❌ Complex setup
   - ❌ Often requires server maintenance

#### Decision

We chose **Tailscale** because it provides encrypted access with zero configuration. Your development machine and phone join the same Tailscale network, and the Express server is only accessible within that network.

#### Consequences

- Must install Tailscale on development machine and phone
- Server accessible via Tailscale IP (100.x.x.x)
- No public internet exposure (security win)

---

### DEC-005: Polling Interval — 15 Seconds

**Date**: 2026-01-13
**Author**: Darron
**Status**: Accepted

#### Context

Level 1 uses polling (web UI fetches /api/prompts periodically). Need to balance responsiveness vs resource usage.

#### Options Considered

1. **5 seconds**
   - ✅ Very responsive
   - ❌ Higher server/battery load
   - ❌ Most prompts don't need sub-10s response

2. **15 seconds**
   - ✅ Good balance
   - ✅ Acceptable delay for most scenarios
   - ✅ Low resource usage

3. **30 seconds**
   - ✅ Minimal resource usage
   - ❌ Noticeable delay when you're waiting

4. **WebSocket (no polling)**
   - ✅ Instant updates
   - ❌ More complex implementation
   - ❌ Mobile browsers may disconnect background WebSockets
   - ❌ Overkill for Level 1

#### Decision

We chose **15 seconds** for Level 1 as a reasonable balance. The push notification (ntfy.sh) provides the initial alert; polling is just for keeping the UI current. Level 2+ may switch to WebSocket for real-time updates.

#### Consequences

- Prompt appears in UI within 15 seconds of notification
- Low battery/network impact on mobile
- Will revisit when implementing Level 4 (terminal mirror)

---

### DEC-006: Storage Format — SQLite + Plain Text

**Date**: 2026-01-13
**Author**: Darron
**Status**: Accepted

#### Context

Level 4+ requires persistent terminal history storage. Need to store session metadata and terminal output.

#### Options Considered

1. **SQLite + Plain Text**
   - ✅ SQLite for structured metadata (sessions, indexes)
   - ✅ Plain text for terminal output (grep-friendly)
   - ✅ No external database needed
   - ✅ Easy backup (just copy files)

2. **Pure SQLite**
   - ✅ Single file
   - ❌ Terminal output in blobs is awkward
   - ❌ Harder to search/grep externally

3. **PostgreSQL**
   - ✅ Full-featured
   - ❌ Overkill for single-user local tool
   - ❌ External dependency

4. **JSON files**
   - ✅ Simple
   - ❌ Performance issues at scale
   - ❌ No query capability

#### Decision

We chose **SQLite + Plain Text** hybrid. SQLite stores session metadata (timestamps, names, status) while terminal output goes to plain text files (one per session). This enables both database queries and grep/search over history.

#### Consequences

- Two storage locations to manage
- Need to keep SQLite index and text files in sync
- Enables powerful search over historical sessions

---

### DEC-007: Task Execution — Claude Agent SDK

**Date**: 2026-02-15
**Author**: Darron
**Status**: Accepted

#### Context

Level 7 introduces autonomous task execution — creating tasks from your phone and having Claude Code execute them headlessly. Need to choose how to invoke Claude Code programmatically.

#### Options Considered

1. **Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)**
   - ✅ Official SDK with streaming message support
   - ✅ Cost tracking (`total_cost_usd`), turn counting
   - ✅ `canUseTool` hook for future approval gates
   - ✅ `AbortController` for cancellation
   - ✅ Model selection, max turns, permission modes
   - ❌ Additional dependency (~40 packages)

2. **`claude -p` (pipe mode)**
   - ✅ No additional dependency
   - ✅ Simple to invoke
   - ❌ No streaming progress — only final result
   - ❌ No cost tracking
   - ❌ No cancellation support
   - ❌ No future approval gate integration

3. **Direct Anthropic API**
   - ✅ Full control
   - ❌ No tool execution (Read, Write, Bash, etc.)
   - ❌ Would need to re-implement Claude Code's agent loop

#### Decision

We chose the **Claude Agent SDK** because it provides streaming messages, cost tracking, and `canUseTool` for future approval gates. The SDK is the official programmatic interface to Claude Code and supports all the features needed for autonomous execution.

#### Consequences

- Additional dependency (`@anthropic-ai/claude-agent-sdk`)
- Must remove `CLAUDECODE` env var to avoid nested session detection (see learning)
- Enables future levels: approval gates, cost dashboards, subagent orchestration

---

### DEC-008: Task Queue — SQLite with better-sqlite3

**Date**: 2026-02-15
**Author**: Darron
**Status**: Accepted

#### Context

Level 7 needs a task queue with status tracking, priority ordering, timestamps, and cost/token recording. Need persistent storage for tasks.

#### Options Considered

1. **SQLite (`better-sqlite3`)**
   - ✅ Synchronous API — simple, no callbacks
   - ✅ Zero external dependencies (native addon only)
   - ✅ WAL mode for concurrent reads during writes
   - ✅ Prepared statements for performance
   - ✅ Natural fit for status/priority/timestamp queries

2. **JSON files (like pending/resolved prompts)**
   - ✅ No additional dependency
   - ❌ No query capability (filtering by status, ordering by priority)
   - ❌ Race conditions with concurrent read/write
   - ❌ Poor performance with many tasks

3. **In-memory only**
   - ✅ Simplest
   - ❌ Lost on server restart
   - ❌ No history

#### Decision

We chose **SQLite with `better-sqlite3`** because tasks need structured queries (filter by status, order by priority/date), and the synchronous API is simpler than async alternatives. WAL mode handles concurrent access from the Express server and orchestrator loop.

#### Consequences

- Native addon requires build tools (pre-built binaries available for most platforms)
- Database file at `~/.claude-remote/tasks.db`
- Enables future features: cost dashboards, task history, analytics

---

### DEC-009: Task Permissions — Bypass Mode

**Date**: 2026-02-15
**Author**: Darron
**Status**: Accepted

#### Context

Autonomous tasks need to run without user interaction. Claude Code normally prompts for permission before dangerous operations (file writes, bash commands, etc.).

#### Options Considered

1. **`bypassPermissions` mode**
   - ✅ Tasks run fully autonomously — no prompts
   - ✅ Simplest for MVP
   - ❌ No safety net — tasks can do anything
   - ❌ Requires `allowDangerouslySkipPermissions: true`

2. **`acceptEdits` mode**
   - ✅ Auto-approves file edits
   - ❌ Still prompts for bash commands
   - ❌ Tasks would stall on permission prompts

3. **`canUseTool` callback (approval gates)**
   - ✅ Fine-grained control — approve/deny per tool
   - ✅ Could route approvals to phone UI
   - ❌ More complex to implement
   - ❌ Defeats the purpose of autonomous execution for MVP

#### Decision

We chose **`bypassPermissions`** for the MVP because autonomous tasks need to run without stalling. Future levels will add approval gates via `canUseTool` for sensitive operations (e.g. git push, destructive commands).

#### Consequences

- Tasks run with full permissions — user must trust the task description
- Future: add `canUseTool` callback to route dangerous operations to phone for approval
- Future: add git checkpoints before/after task execution for rollback

---

### DEC-010: Git Checkpoint Strategy (branch vs stash)

**Date**: 2026-02-15
**Author**: Darron
**Status**: Accepted

#### Context

Level 7 tasks need rollback capability in case of failure. Need to create git checkpoints before task execution to enable restoring the repository state if things go wrong.

#### Options Considered

1. **Always use branches**
   - ✅ Clean, easy to understand
   - ✅ Named references (claude-remote/checkpoint-{taskId})
   - ❌ Fails if working tree has uncommitted changes
   - ❌ Can't create branch on dirty repo

2. **Always use stashes**
   - ✅ Works with dirty working tree
   - ❌ Hard to find specific stash later (stash@{N} numbers change)
   - ❌ Less obvious what they're for

3. **Hybrid: branch for clean, stash for dirty**
   - ✅ Works in all scenarios (clean or dirty repo)
   - ✅ Uses the cleaner option (branch) when possible
   - ✅ Falls back to stash when necessary
   - ✅ Both can be identified by message/name
   - ❌ Slightly more complex logic

4. **Commit to temporary branch**
   - ✅ Works with dirty repos
   - ❌ Creates commits in git history
   - ❌ Harder to clean up completely

#### Decision

We chose the **hybrid approach**: create branches for clean working trees, stashes for dirty ones. This handles all scenarios gracefully while preferring the cleaner branch approach when possible.

For clean repos: create branch `claude-remote/checkpoint-{taskId}`
For dirty repos: create stash with message `claude-remote checkpoint {taskId}`

Store checkpoint_ref (branch name or stash message), checkpoint_type ('branch'/'stash'/'none'), and checkpoint_created_at in the database.

#### Consequences

- Handles both clean and dirty repositories automatically
- Rollback logic must check checkpoint_type to know how to restore
- Cleanup logic must check checkpoint_type to know what to delete
- If task succeeds on clean repo, checkpoint branch is deleted
- If task succeeds on dirty repo, checkpoint stash is dropped

---

### DEC-011: Approval Gate Implementation (canUseTool callback)

**Date**: 2026-02-15
**Author**: Darron
**Status**: Accepted

#### Context

While bypass mode (DEC-009) is good for fully autonomous tasks, users need a way to control dangerous operations. Need to add approval gates that route dangerous operations to the phone for user approval.

#### Options Considered

1. **canUseTool callback with phone approval**
   - ✅ Fine-grained control per tool invocation
   - ✅ Agent SDK provides callback hook
   - ✅ Can route to phone via WebSocket
   - ✅ Supports multiple gate modes (bypass/edits_only/approve_all)
   - ❌ Requires phone to be available
   - ❌ Tasks stall if approval times out

2. **Pre-approved tool list**
   - ✅ No stalling — approvals done upfront
   - ❌ Can't see actual inputs before approving
   - ❌ Less control (can't approve some Bash commands but deny others)

3. **Dry-run mode with confirmation**
   - ✅ User sees full execution plan
   - ❌ Requires two-pass execution (expensive)
   - ❌ May not catch dynamic tool uses

#### Decision

We chose **canUseTool callback with phone approval** because it provides the best balance of control and flexibility. The callback sees the actual tool name and input, enabling informed approval decisions.

Three gate modes:
- `bypass`: no approvals (original behaviour, fully autonomous)
- `edits_only`: approve dangerous tools (Bash, Write, Edit, NotebookEdit)
- `approve_all`: approve every tool

Approval requests broadcast via WebSocket with 5-minute timeout. Phone UI shows approval popup with tool name, input, approve/deny buttons.

#### Consequences

- Tasks with non-bypass gate modes require phone to be available
- 5-minute timeout prevents indefinite stalling
- Approval requests stored in Map (lost on server restart — acceptable tradeoff)
- Future: could add approval history tracking
- Future: could add auto-approval rules based on input patterns

---

### DEC-012: Tool Scoping Storage (JSON in SQLite)

**Date**: 2026-02-15
**Author**: Darron
**Status**: Accepted

#### Context

Level 7 tasks should support restricting which tools they can use (e.g., "read-only task" with just Read/Grep/Glob). Need to store tool restrictions in the database.

#### Options Considered

1. **JSON string in SQLite**
   - ✅ Flexible — array of strings
   - ✅ SQLite has good JSON support
   - ✅ Easy to parse (`JSON.parse()`)
   - ✅ NULL for "all tools allowed"
   - ❌ Can't query "tasks using tool X" efficiently

2. **Comma-separated string**
   - ✅ Simple
   - ❌ Requires splitting and trimming
   - ❌ No standard format
   - ❌ Harder to validate

3. **Separate tools table with many-to-many**
   - ✅ Proper relational model
   - ✅ Easy to query "tasks using tool X"
   - ❌ Massive overkill for this use case
   - ❌ More complex schema

4. **Bitmask/enum**
   - ✅ Compact storage
   - ❌ Fixed set of tools (can't add new tools without migration)
   - ❌ Harder to understand

#### Decision

We chose **JSON string in SQLite** because it's flexible, standard, and matches how the Agent SDK expects tool restrictions (as an array).

Store as: `'["Bash","Read","Edit","Glob","Grep"]'` or `NULL` for all tools.
Parse with `JSON.parse(task.allowed_tools)` and pass to Agent SDK as `allowedTools` option.

UI provides comma-separated input for ease of typing on mobile, which gets converted to JSON array before sending to API.

#### Consequences

- Simple to implement and understand
- Flexible — can add new tools without schema changes
- Can't efficiently query "all tasks using tool X" (acceptable — not a needed query)
- Must validate JSON on parse (handle malformed data gracefully)
- Future: could add tool presets in UI (e.g., "Read Only", "Safe Tools", "Development")

---

## Template

Copy this for new decisions:

```markdown
### DEC-XXX: [Title]

**Date**: YYYY-MM-DD
**Author**: Darron
**Status**: Accepted

#### Context

[What situation prompted this decision?]

#### Options Considered

1. **[Option A]**
   - ✅ [Pro]
   - ❌ [Con]

2. **[Option B]**
   - ✅ [Pro]
   - ❌ [Con]

#### Decision

We chose **[Option]** because [reasoning].

#### Consequences

- [What this means going forward]

#### Related

- [Links if any]
```

---

*Decisions are valuable historical context — record them while the reasoning is fresh!*
