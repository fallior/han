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

**Decision Status Flags:**
- **Accepted** — Standard decision, open to revisiting if needed
- **Settled** — Deliberated and finalised. **Do NOT change without explicit user discussion.** These decisions were often reached through painful trial and error. Changing them unilaterally causes stress and wasted time.
- **Needs Discussion** — Open for reconsideration, but still requires a conversation before changing
- **Superseded** — Replaced by a later decision (link to replacement)

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
| DEC-013 | Terminal Rendering — Append-only buffer with client-side diff | **Settled** | 2026-02-15 |
| DEC-014 | Scroll Behaviour — User controls scroll position | **Settled** | 2026-02-15 |
| DEC-015 | Auto-commit on Task Success | Accepted | 2026-02-16 |
| DEC-016 | Automated Phantom Goal Cleanup in Supervisor Cycle | Accepted | 2026-02-20 |
| DEC-017 | Protected System Files — Autonomous Agents Blocked | **Settled** | 2026-02-20 |
| DEC-018 | Conversations as Strategic Async Discussion Channel | Accepted | 2026-02-20 |
| DEC-019 | Ghost Task Detection with Periodic Check | Accepted | 2026-02-22 |
| DEC-020 | Cancelled Tasks Satisfy Dependencies | **Settled** | 2026-02-22 |
| DEC-021 | Category-Aware Model Selection Strategy | Accepted | 2026-02-23 |
| DEC-022 | enforceTokenCap H3 Fallback and Negative Guard | **Settled** | 2026-02-26 |
| DEC-023 | Deferred Cycle Pattern via fs.watch (Gary Model) | Accepted | 2026-02-28 |
| DEC-024 | Context Injection Pipeline Tuning | Accepted | 2026-02-28 |
| DEC-025 | Workshop Module Three-Persona Navigation | Accepted | 2026-03-01 |
| DEC-026 | Auto-Reactivate Archived Threads on New Message | Accepted | 2026-03-01 |
| DEC-027 | Staleness Thresholds Recalibrated for Each Agent | Accepted | 2026-03-02 |
| DEC-028 | Shared Resurrection Log at resurrection-log.jsonl | Accepted | 2026-03-02 |
| DEC-029 | Discord Gateway Implementation — Raw WebSocket vs discord.js | Accepted | 2026-03-03 |
| DEC-030 | Message Classification — Ollama Local vs Anthropic API | Accepted | 2026-03-03 |
| DEC-031 | Delivery Routing — Direct API Calls vs Signal Files | Accepted | 2026-03-03 |
| DEC-032 | Shell Command Execution — execFileSync for Untrusted Input | **Settled** | 2026-03-03 |
| DEC-033 | Agent Health File Schema Consistency | **Settled** | 2026-03-03 |
| DEC-034 | Bearer Token Authentication with Localhost Bypass | Accepted | 2026-03-04 |

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

### DEC-013: Terminal Rendering — Append-only buffer with client-side diff

**Date**: 2026-02-15
**Author**: Darron
**Status**: Settled

#### Context

The mobile UI mirrors the tmux terminal pane. The server captures the tmux pane every 1 second and broadcasts it via WebSocket. The question is how the client renders these updates.

This decision was reached after multiple failed attempts at alternative approaches that caused visible degradation on mobile (missing text, broken scrolling, blank screens after returning from history view).

#### Options Considered

1. **Append-only buffer with client-side overlap detection (current)**
   - ✅ Preserves scrollback history — user can scroll up
   - ✅ Text appears reliably — no missing characters
   - ✅ Auto-trim keeps DOM bounded (5000 lines max, trims to 2000)
   - ✅ Manual trim button for user control
   - ✅ History stash/restore preserves buffer during history view
   - ❌ O(n²) overlap detection is theoretically slow
   - ❌ DOM grows over time (mitigated by auto-trim)

2. **Server-side diff with client applying changes**
   - ✅ Minimal client work
   - ❌ Sync issues after history view (client has empty renderedLines, server sends diff)
   - ❌ Requires additional sync recovery logic
   - ❌ More complex server state tracking

3. **Fixed pane view — client only diffs last N lines**
   - ✅ Simple, no growing buffer
   - ❌ No scrollback history
   - ❌ Text appeared garbled/missing on mobile ("mangy dog look")
   - ❌ Worse user experience than the append-only approach

#### Decision

We chose the **append-only buffer with client-side overlap detection** because it reliably renders text on mobile without missing characters. The auto-trim at 5000 lines prevents unbounded DOM growth. The manual trim button gives the user control.

**This is settled.** The alternatives were tried and produced a worse mobile experience. Do not change the terminal rendering approach without explicit user discussion.

#### Consequences

- Server sends full tmux snapshot every 1s (unchanged frames skipped)
- Client accumulates lines in an append-only buffer
- Overlap detection finds genuinely new lines and appends only those
- Auto-trim at 5000 lines, keeps 2000
- History view stashes/restores DOM nodes
- If performance becomes an issue in future, optimise within this architecture rather than replacing it

---

### DEC-014: Scroll Behaviour — User controls scroll position

**Date**: 2026-02-15
**Author**: Darron
**Status**: Settled

#### Context

The mobile terminal view is a scrollable ever-growing text log. Previous implementations forced `scrollTop = scrollHeight` on every 1-second refresh, yanking the user to the bottom constantly. iOS momentum scrolling also allowed rubber-banding past the top and bottom edges, creating a disorienting wrap-around effect. Both behaviours made the UX frustrating — the user described them as "terrible" and "horrible".

#### Rules (do NOT change without explicit user discussion)

1. **Never force scroll position** — The user's scroll position is sacred. If they scroll up to read something, it stays there.
2. **Smart-scroll (within 50px)** — If the user is already within 50px of the bottom, auto-follow new output. Otherwise leave scroll alone.
3. **Scroll to bottom on first render only** — When the page first loads or terminal first connects, scroll to bottom to show the latest output.
4. **Hard scroll boundaries** — `overscroll-behavior: contain` on `.terminal-content`. No rubber-banding, no wrap-around. Scroll stops at top and bottom edges.
5. **"End" button in quickbar** — User taps End to jump to bottom when they want to. This is the only way to force-scroll besides being near the bottom.

#### Decision

The user controls their scroll position at all times. The system only auto-follows when the user is already at the bottom. Overscroll is contained. These are non-negotiable UX requirements.

**This is settled.** The previous forced-scroll behaviour caused significant user frustration. Do not reintroduce forced scrolling, remove overscroll containment, or change scroll behaviour without explicit user discussion.

#### Consequences

- `handleTerminalUpdate()` checks `nearBottom` (< 50px) before scrolling
- `updateTerminalAppend()` scrolls to bottom on first render only
- `.terminal-content` has `overscroll-behavior: contain`
- "End" quickbar button provides manual jump-to-bottom
- Any future features must respect these scroll rules

---

### DEC-015: Auto-commit on Task Success

**Date**: 2026-02-16
**Author**: Darron
**Status**: Accepted

#### Context

The automator's git checkpoint system (DEC-010) creates a stash or branch before each task runs, then cleans up after success or rolls back on failure. When multiple sequential tasks in a goal modify the same project, the checkpoint cleanup was **losing intermediate changes** — each task started from a clean HEAD because the previous task's uncommitted work was stashed by the next checkpoint, then the stash was dropped on cleanup.

We discovered this when 8 Phase 2 tasks all reported "done" but server.js had none of their changes. `git reflog` showed repeated `reset: moving to HEAD`. The issue resurfaced during Level 10 development when a test task's checkpoint stashed our own uncommitted edits.

#### Options Considered

1. **Auto-commit after every successful task**
   - ✅ Each task's work persists in git history
   - ✅ Sequential tasks build on each other's changes naturally
   - ✅ Clean separation of work per task in git log
   - ✅ Semantic commit messages with task metadata
   - ❌ Creates many small commits (one per task)
   - ❌ `git add -A` can capture unrelated uncommitted work if present

2. **Disable checkpointing entirely**
   - ✅ Simplest approach
   - ❌ Loses rollback capability on failure
   - ❌ Failed tasks leave dirty working trees

3. **Amend the checkpoint to preserve intermediate changes**
   - ✅ Fewer commits
   - ❌ Complex stash management (pop, apply, re-stash)
   - ❌ Fragile — stash conflicts cause data loss

4. **Use git worktrees per task**
   - ✅ Complete isolation between tasks
   - ❌ Significant complexity increase
   - ❌ Disk space overhead
   - ❌ Doesn't integrate with existing checkpoint system

#### Decision

We chose **Option 1: Auto-commit after every successful task**. The `commitTaskChanges()` function runs after task success but before checkpoint cleanup:

1. Checks `hasUncommittedChanges()` — skips if clean
2. Stages all changes (`git add -A`)
3. Commits with semantic prefix derived from task title (feat/fix/docs/refactor/test/chore)
4. Includes task metadata (ID, model, cost, goal) and Co-Authored-By footer

This preserves the checkpoint/rollback system for failures while ensuring successful work persists.

#### Consequences

- Every successful autonomous task creates a git commit
- Sequential tasks in a goal build on each other's committed work
- `git log` shows a clear trail of autonomous work with task metadata
- Semantic prefixes make automator commits consistent with human conventions
- **Known limitation:** If the automator runs a task in a project with pre-existing uncommitted work (from a human session), `git add -A` will capture that work in the task's commit. Mitigation: don't run automator tasks against projects you're actively editing.

---

### DEC-016: Automated Phantom Goal Cleanup in Supervisor Cycle

**Date**: 2026-02-20
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

Goals were accumulating in 'active' state with no pending/running tasks, causing the supervisor to report phantom goals and waste cycles checking goals that had no actual work. Three failure modes identified:

1. Goals where all tasks were cancelled were marked 'done' instead of 'cancelled'
2. Parent goals with all children terminal (done/failed/cancelled) remained 'active'
3. Goals stuck in 'decomposing' state for hours/days

The supervisor would observe these phantom goals, consume context window space, and potentially create actions to investigate them. This wasted API costs and cluttered observations.

#### Options Considered

1. **Manual cleanup via API**
   - ✅ Simple DELETE endpoint implementation
   - ❌ Requires human intervention every time
   - ❌ Doesn't prevent recurrence
   - ❌ Reactive rather than proactive

2. **Separate cron job cleanup script**
   - ✅ Runs independently of supervisor
   - ❌ Duplication of logic (supervisor already queries goal/task state)
   - ❌ Another process to manage
   - ❌ May not run when needed (fixed schedule)

3. **Cleanup during updateGoalProgress()**
   - ✅ Happens naturally when tasks finish
   - ❌ Only runs when tasks complete
   - ❌ Doesn't handle parent goals or stuck decomposing goals
   - ❌ Reactive — requires task activity to trigger

4. **Cleanup at start of supervisor cycle**
   - ✅ Proactive — runs regardless of task activity
   - ✅ Supervisor already queries goal/task state for observations
   - ✅ Runs deterministically before Agent SDK call (prevents cost waste)
   - ✅ Handles all three failure modes
   - ✅ Self-healing system — automatically corrects stale state
   - ❌ Small query overhead per cycle (3 SQL queries)

#### Decision

We chose **cleanup at start of supervisor cycle** because the supervisor is the natural place for this logic. It's already the system's "senior engineer" observing state, and it runs periodically regardless of task activity.

Implemented `cleanupPhantomGoals()` in `supervisor.ts` (lines 295-368) with three strategies:

1. **Parent goals where ALL children are terminal** → mark as failed
   ```sql
   SELECT g.id FROM goals g
   WHERE g.goal_type = 'parent'
   AND g.status = 'active'
   AND NOT EXISTS (
       SELECT 1 FROM goals c
       WHERE c.parent_goal_id = g.id
       AND c.status NOT IN ('done', 'failed', 'cancelled')
   )
   ```

2. **Standalone goals with all tasks terminal** → recalculate via `updateGoalProgress()`
   ```sql
   SELECT g.id FROM goals g
   WHERE g.status = 'active'
   AND g.goal_type != 'parent'
   AND EXISTS (SELECT 1 FROM tasks t WHERE t.goal_id = g.id)
   AND NOT EXISTS (
       SELECT 1 FROM tasks t
       WHERE t.goal_id = g.id
       AND t.status NOT IN ('done', 'failed', 'cancelled')
   )
   ```

3. **Goals stuck in 'decomposing' >1 hour** → mark as failed with timeout reason
   ```sql
   SELECT id FROM goals
   WHERE status = 'decomposing'
   AND created_at < (now - 1 hour)
   ```

Also fixed root cause in `planning.ts:updateGoalProgress()` — all-cancelled goals now correctly detected and marked 'cancelled' (not 'done').

#### Consequences

**Positive:**
- Phantom goals automatically cleaned up every supervisor cycle
- Supervisor observations remain accurate (no phantom goals reported)
- System self-heals without human intervention
- Prevents API cost waste on observing/reasoning about phantom goals
- Handles all three failure modes (cancelled tasks, parent goals, stuck decomposition)
- Logs cleanup actions for visibility

**Negative:**
- Small query overhead per supervisor cycle (~3 SQL queries, negligible)
- Cleanup runs even when no phantom goals exist (acceptable tradeoff)

**Implementation:**
- `cleanupPhantomGoals()` returns count of goals cleaned
- Called at start of `runSupervisorCycle()` before loading memory/state
- Logs details of each cleanup action for debugging
- `getNextCycleDelay()` also updated to exclude phantom goals from frequency calculation

#### Related

- DEC-015: Auto-commit on Task Success (ensures sequential tasks build on each other)
- Root cause fix: `updateGoalProgress()` now detects all-cancelled state
- Force-delete API: `DELETE /api/goals/:id?force=true` for manual cleanup when needed

---

### DEC-017: Protected System Files — Autonomous Agents Blocked

**Status**: **Settled** (2026-02-20)
**Context**: A Claude Code session (licences project, Feb 19) rewrote `~/.bashrc` to upgrade the `claude-logged()` function. In doing so, it used Write to replace the entire file, silently dropping the SSH agent configuration block. This broke git push authentication for all subsequent sessions.

**Decision**: Autonomous agents (task workers, planners, supervisor) are unconditionally blocked from modifying system/user configuration files, regardless of gate mode. Protected paths:
- `~/.bashrc`, `~/.bash_profile`, `~/.profile`, `~/.zshrc`
- `~/.ssh/*`, `~/.gnupg/*`
- `~/.gitconfig`, `~/.npmrc`, `~/.env`
- `/etc/*`, `/root/*`

The block is enforced via `checkProtectedFiles()` in `planning.ts`, called before any gate mode check in `createCanUseToolCallback()`. It applies to Write, Edit, NotebookEdit tools and detects Bash redirect/pipe targets.

**Why Settled**: Autonomous agents modifying shell config files can silently break authentication, environment variables, PATH, and other foundational system state. The damage is invisible until something fails hours later. There is no scenario where the benefit outweighs the risk. If system files need changing, a human does it.

**Incident**: Session log at `licences/_logs/session_2026-02-19_18-41-52.md` — Claude rewrote `.bashrc` at ~02:45 AEST, SSH agent block lost, git push broken for 6+ hours until manually diagnosed.

---

### DEC-018: Conversations as Strategic Async Discussion Channel

**Date**: 2026-02-20
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

The admin console needed a way for Darron to have strategic, nuanced discussions with the supervisor that don't fit the task/goal execution model. Questions like "Should we refactor this architecture?" or "What's the best approach for X?" deserve thoughtful discussion, not just action items.

Existing channels:
- **Tasks**: Execute specific work (read-only, deterministic)
- **Goals**: Decompose and execute multi-step work
- **Proposals**: Ideas requiring human approval (one-way: supervisor → human)

None of these support back-and-forth strategic dialogue.

#### Options Considered

1. **Extend Proposals to support replies**
   - ✅ Reuses existing table
   - ❌ Proposals are fundamentally one-way (supervisor suggests, human approves/rejects)
   - ❌ Doesn't fit the mental model of "discussion"
   - ❌ Would overload the Proposals concept

2. **Use Goals with special "discussion" type**
   - ✅ Reuses existing infrastructure
   - ❌ Goals are about work execution, not dialogue
   - ❌ Confusing to mix discussion with task orchestration
   - ❌ Would clutter the Goals UI

3. **Separate Conversations table with threaded messages**
   - ✅ Clear separation of concerns (work vs discussion)
   - ✅ Natural mental model (threads, messages, status)
   - ✅ Supervisor can see pending conversations in observations
   - ✅ Supports multi-turn dialogue
   - ✅ Status lifecycle (open → resolved → reopen)
   - ❌ Additional tables and API routes

4. **External chat tool (Slack, Discord, etc.)**
   - ✅ Rich features
   - ❌ Context split across systems
   - ❌ Supervisor can't see or respond automatically
   - ❌ Extra dependency

#### Decision

We chose **Option 3: Separate Conversations table with threaded messages** because it provides a dedicated channel for strategic dialogue while keeping everything in one system.

**Database schema**:
- `conversations` table: id, title, status (open/resolved), created_at, updated_at
- `conversation_messages` table: id, conversation_id, role (human/supervisor), content, created_at

**Supervisor integration**:
- Supervisor observes pending conversations (threads with unanswered human messages)
- New action: `respond_conversation` with conversation_id and response_content
- Query: finds human messages where no supervisor message exists with later timestamp
- System prompt: "Respond thoughtfully with strategic insight, not just task status"

**UI**: Admin console Conversations module with thread list, message view, compose, resolve/reopen actions

**API**: 6 endpoints for CRUD + resolve/reopen

#### Consequences

**Positive**:
- Clear separation: tasks/goals = execution, conversations = strategic discussion
- Supervisor can participate in async dialogue automatically
- Darron can ask open-ended questions and get thoughtful responses
- Conversation history preserved for context
- Status lifecycle (open/resolved) keeps UI organised

**Negative**:
- Additional database tables and API routes
- Supervisor must check for pending conversations every cycle (small overhead)
- Risk of supervisor misinterpreting conversation intent (mitigated by clear system prompt)

**Implementation**:
- Tables created in `db.ts` with prepared statements
- Routes in `src/server/routes/conversations.ts` (129 lines)
- Supervisor awareness in `supervisor.ts` (observations + `respond_conversation` action)
- Admin UI module in `admin.ts` (Conversations section)
- WebSocket broadcast: `conversation_message` event

#### Related

- Admin console Phase 2 implementation (Work, Conversations, Products modules)
- Supervisor system prompt update for conversation awareness
- DEC-007: Task Execution via Agent SDK (provides foundation for supervisor actions)

---

### DEC-019: Ghost Task Detection with Periodic Check

**Date**: 2026-02-22
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

Tasks can get stuck in 'running' status with no agent process when the agent crashes, server restarts mid-task, network issues disconnect the agent, or system kills the process due to resource constraints. These "ghost tasks" remain in the database with status='running' but have no active execution, blocking workflow and wasting supervisor budget monitoring tasks that will never complete.

The goal described the problem: tasks stuck in 'running' status with 0 turns and started_at > 15 min ago, with no automatic detection or recovery mechanism.

#### Options Considered

1. **Manual detection and cleanup**
   - ✅ Simple — no code needed
   - ❌ Requires human intervention every time
   - ❌ Doesn't prevent recurrence
   - ❌ Tasks stay stuck until human notices

2. **Detect only when supervisor observes**
   - ✅ Minimal overhead — only runs during supervisor cycles
   - ❌ Supervisor must be running to detect ghosts
   - ❌ Doesn't help if supervisor is disabled
   - ❌ Detection delayed until next supervisor cycle

3. **Detect in orchestrator loop before picking next task**
   - ✅ Runs frequently (every 5 seconds with orchestrator)
   - ❌ Couples ghost detection to task execution
   - ❌ Adds overhead to critical path
   - ❌ Doesn't run if no tasks are pending

4. **Periodic check at fixed intervals + startup check**
   - ✅ Runs independently of supervisor/orchestrator
   - ✅ Catches ghosts from crashes/restarts via startup check
   - ✅ Ongoing protection via periodic check
   - ✅ Clear separation of concerns
   - ✅ Deterministic intervals (predictable behaviour)
   - ❌ Small overhead every 5 minutes

#### Decision

We chose **periodic check at 5-minute intervals + startup check** because it provides the best combination of independence, crash recovery, and ongoing protection.

**Implementation:**
- `detectAndRecoverGhostTasks()` function in `planning.ts`
- Detection criteria: status='running', turns=0, started_at > 15 minutes ago
- Recovery: reset status to 'pending', increment retry_count, trigger retry ladder
- Startup check: runs once when server starts (catches orphaned tasks from crashes)
- Periodic check: `setInterval` runs every 5 minutes for ongoing protection
- Logs: returns count of ghosts detected for visibility

**Enhanced supervisor cancel_task:**
- Imports `getAbortForTask()` to check for live agent processes
- Three scenarios: pending tasks (cancel in DB), running with live agent (abort then cancel), ghost-running (cancel in DB)
- Clear logging: "(was pending)", "(aborted live agent)", "(was ghost-running)"
- Enables supervisor to autonomously recover from ghost tasks

#### Consequences

**Positive:**
- Ghost tasks automatically detected and reset to 'pending'
- Escalating retry ladder triggered (reset → Sonnet → Opus → human)
- Supervisor can cancel ghost tasks without manual intervention
- Startup check catches orphaned tasks from crashes immediately
- Prevents API cost waste on monitoring stuck tasks
- System self-heals from agent crashes and server restarts
- Low overhead: 1 SELECT query every 5 minutes

**Negative:**
- Small query overhead every 5 minutes (acceptable tradeoff)
- 15-minute threshold means tasks stuck for <15 min aren't detected (deliberate choice to avoid false positives)

**Cost Impact:**
- **Savings:** Prevents supervisor from wasting $0.10-$0.50+ per cycle monitoring ghost tasks indefinitely
- **Overhead:** ~1 SQL query every 5 minutes (negligible cost)
- **ROI:** Very positive — prevents runaway costs with minimal overhead

#### Related

- DEC-017: Escalating Retry Ladder (ghost tasks trigger retry ladder)
- DEC-016: Automated Phantom Goal Cleanup (similar self-healing approach for goals)
- DEC-007: Task Execution via Agent SDK (provides AbortController for live agent detection)

---

### DEC-020: Cancelled Tasks Satisfy Dependencies

**Date**: 2026-02-22
**Author**: Claude (autonomous)
**Status**: Settled

#### Context

The task dependency resolution system uses `getNextPendingTask()` to filter tasks whose dependencies are satisfied. When tasks become stuck (ghost tasks), the recovery mechanism correctly cancels them via `detectAndRecoverGhostTasks()`. However, the dependency check only considered status='done' as satisfying a dependency, not status='cancelled'. This created a deadlock: two ghost tasks were cancelled (the correct recovery action), but all 9 downstream tasks remained permanently blocked because their cancelled dependencies weren't considered satisfied.

The problem manifested in the Conversation Catalogue goal (mlxo5qjq-hdl2l5): ghost tasks were correctly detected and cancelled in cycle #343, but dependent tasks never became schedulable.

#### Options Considered

1. **Change dependency check to accept both 'done' and 'cancelled'**
   - ✅ Logically sound — a cancelled dependency is resolved (just in the 'no work' state)
   - ✅ Unblocks downstream tasks naturally
   - ✅ Allows recovery pipelines to proceed after ghost task cancellation
   - ✅ No impact on dependencies that complete successfully ('done' still works)
   - ❌ Slight change to scheduling semantics

2. **Keep blocked tasks blocked indefinitely**
   - ✅ Philosophically pure (never run anything whose dependency didn't succeed)
   - ❌ Creates orphaned tasks that will never run
   - ❌ Defeats the purpose of ghost task recovery
   - ❌ Requires manual cleanup

3. **Require explicit "dependency waived" flag to proceed**
   - ✅ Explicit control
   - ❌ More complex logic
   - ❌ Requires human intervention to recover
   - ❌ Slows down automation

#### Decision

We chose **Option 1: Accept 'cancelled' as satisfying dependencies**. The reasoning is that a cancelled dependency is resolved — the dependency relationship has been examined and the dependency task is no longer pending/running. Whether the upstream task completed successfully ('done') or was deliberately cancelled ('cancelled'), the downstream task can proceed; the scheduler doesn't judge the outcome, only whether the dependency exists and is terminal.

Fixed in `planning.ts` line 1472:
```typescript
// Before:
return dep && dep.status === 'done';

// After:
return dep && (dep.status === 'done' || dep.status === 'cancelled');
```

#### Consequences

**Positive:**
- Ghost task recovery pipeline now works end-to-end
- Downstream tasks unblock when dependencies are cancelled
- No longer creates orphaned tasks that will never run
- Recovery mechanism (detect → cancel → reschedule) succeeds

**Negative:**
- None identified. Semantically, a cancelled dependency is as resolved as a completed one.

**Verification:**
- Two ghost tasks were cancelled (mlxo8wdf-s5zext, mlxo8wdg-v92287)
- Nine downstream tasks in goal mlxo5qjq-hdl2l5 immediately became 'pending' (schedulable)
- Orchestrator can now pick them up for execution

#### Related

- DEC-019: Ghost Task Detection with Periodic Check (provides the ghost cancellation that triggered this fix)
- `planning.ts:getNextPendingTask()` — dependency resolution
- `planning.ts:detectAndRecoverGhostTasks()` — ghost task cancellation
- Goal mlxo5qjq-hdl2l5: Conversation Catalogue (9 unblocked tasks)

**Why Settled**: Ghost task recovery is a critical reliability mechanism. This fix completes the recovery pipeline. Changing the semantics back to "only 'done' satisfies dependencies" would require a different recovery strategy (e.g., restarting cancelled tasks instead of cancelling them). If either strategy changes, it requires explicit user discussion.

---

### DEC-021: Category-Aware Model Selection Strategy

**Date**: 2026-02-23
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

The orchestrator's `recommendModel()` function already had the capability to query project memory for task-type-specific success rates, but `planning.ts` always passed `'unknown'` as the task type, wasting this capability. Additionally, the sort logic always prioritised cost (cheapest-first) regardless of task complexity, and the costRank guard only allowed model downgrades.

This meant that architecture and debugging tasks — which require deep reasoning and are more prone to failure with weaker models — were routed to haiku just because it was cheapest, even when project memory showed haiku consistently failing at those tasks while opus succeeded.

#### Options Considered

1. **Add task category field and use category-aware routing**
   - ✅ Leverages existing `recommendModel()` taskType parameter
   - ✅ Planner can classify tasks naturally (architecture, bugfix, docs, etc.)
   - ✅ Different sort strategies for complex vs simple tasks
   - ✅ Allows memory-based model upgrades with high confidence
   - ✅ Minimal code changes — mostly wiring existing capabilities
   - ❌ Planner must classify tasks correctly (depends on prompt quality)

2. **Estimate task complexity via description length or keyword analysis**
   - ✅ Automatic — no schema change needed
   - ❌ Unreliable — description length doesn't correlate with complexity
   - ❌ Keyword analysis is fragile
   - ❌ Doesn't capture task intent (architecture vs docs)

3. **Always use cheapest model, rely on retry ladder**
   - ✅ Simplest — no changes needed
   - ❌ Wastes budget on retries (haiku fails, Sonnet diagnostic, Opus retry)
   - ❌ Slower — failed task + diagnostic + retry takes longer than using opus from start
   - ❌ Ignores project memory learnings

4. **Always use opus for everything**
   - ✅ Simplest — guaranteed success
   - ❌ Wasteful — docs and config tasks don't need opus
   - ❌ Ignores cost optimisation entirely

#### Decision

We chose **Option 1: Add task category field and use category-aware routing**.

**Changes made:**

1. **Planning schema** — Added `category` enum field (architecture, feature, bugfix, refactor, docs, test, config, other) with guidance in prompt for planner to classify each subtask

2. **Category wiring** — Pass `subtask.category` to `recommendModel()` instead of hardcoded `'unknown'`, store in tasks table `complexity` column

3. **Category-aware sorting** in `recommendModel()`:
   - Complex categories (architecture, bugfix): sort by success rate descending, then cost as tiebreaker
   - Simple categories (docs, config, test, other): sort by cost ascending (existing behaviour)

4. **Fixed costRank guard** — Allow downgrades always; allow upgrades only with high confidence (≥10 prior tasks)

5. **Observability logging** — Log category, recommendations, memory overrides, sort strategies

#### Consequences

**Positive:**
- Complex tasks get models with proven success rates even if more expensive
- Simple tasks still get cheapest model (cost-optimised)
- Memory-based routing can upgrade models when history shows a task type needs stronger reasoning
- Clear observability into category → model recommendation → override decision
- Leverages existing infrastructure — minimal new code

**Negative:**
- Planner must classify tasks correctly (quality depends on prompt and planner reasoning)
- High-confidence threshold (≥10 tasks) means early projects won't benefit from upgrades until sufficient history exists
- Category is somewhat subjective (is refactoring "architecture" or "refactor"?)

**Trade-offs:**
- Prioritising success rate for complex tasks may increase cost short-term, but reduces cost long-term by avoiding retry ladder ($0.10-$0.50+ per failed task diagnostic cycle)
- Simple tasks could theoretically benefit from success-weighting too, but empirically they fail less often regardless of model, so cost-first is justified

**Implementation notes:**
- Repurposed existing `complexity` column to store category (avoids schema migration)
- Falls back to 'unknown' if category missing (backwards compatible)
- Sort strategy logged for debugging ('success-weighted' vs 'cost-weighted')

#### Related

- Level 8: Intelligent Orchestrator (foundation for this work)
- `project_memory` table (stores per-model success rates)
- `recommendModel()` function (orchestrator.ts:420-469)
- `decomposeGoal()` function (planning.ts:280-580)
- DEC-017: Escalating Retry Ladder (avoided by routing correctly upfront)

---

### DEC-022: enforceTokenCap H3 Fallback and Negative Guard

**Date**: 2026-02-26
**Author**: Claude (autonomous)
**Status**: Settled

#### Context

The `enforceTokenCap()` function in `supervisor-worker.ts` was supposed to keep Leo's self-reflection.md file at ~6KB (1500 tokens) by truncating to a header + recent tail. However, the file grew uncontrollably to 292KB (49x the intended size), growing ~6.5KB per supervisor cycle instead of staying bounded.

The root cause was a two-part bug:
1. The function searched for H2 headings (`\n## `) to find the header boundary, but self-reflection.md uses H3 headings (`### Cycle #N`)
2. When no H2 was found near the top, it matched an H2 deep in embedded exploration summaries at ~byte 247,000
3. This made the "header" 247KB long, causing `maxTailChars = (cap * 4) - 247000 - 50` to go deeply negative
4. `content.slice(-negativeNumber)` converted the negative to positive, retaining nearly the entire file
5. Each cycle appended new content but failed to truncate, causing unbounded growth

This was traced during personal exploration by heartbeat Leo and documented in `~/.claude-remote/memory/enforceTokenCap-fix.md`.

#### Options Considered

1. **Add H3 fallback and negative guard (chosen)**
   - ✅ Minimal code change (2 lines)
   - ✅ Handles both H2 and H3 heading styles
   - ✅ Prevents negative maxTailChars regardless of header size
   - ✅ Preserves existing logic for well-formed files
   - ✅ Self-documenting via conditional structure
   - ❌ Requires understanding both failure modes

2. **Rewrite to use regex for any heading level**
   - ✅ More generic — handles H1-H6
   - ❌ Larger code change
   - ❌ Regex overhead for simple search
   - ❌ Over-engineered for known heading structure

3. **Force H2 headings in self-reflection.md**
   - ✅ Avoids code change
   - ❌ Requires rewriting Leo's memory structure
   - ❌ Doesn't protect against future heading changes
   - ❌ Fragile — depends on memory format consistency

4. **Remove truncation entirely, rely on manual cleanup**
   - ✅ Simplest code
   - ❌ Loses automatic memory management
   - ❌ Requires manual intervention as files grow
   - ❌ Defeats purpose of automated supervisor

#### Decision

We chose **Option 1: Add H3 fallback and negative guard**. Two changes in `supervisor-worker.ts` lines 930-933:

```typescript
// Change 1: H3 fallback when H2 not found or too deep
let headerEnd = content.indexOf('\n## ', 100);
if (headerEnd < 0 || headerEnd > cap * 4) {
    headerEnd = content.indexOf('\n### ', 100);
}
const header = headerEnd > 0 && headerEnd < cap * 4
    ? content.slice(0, headerEnd)
    : content.slice(0, 200);

// Change 2: Negative guard
const maxTailChars = Math.max(0, (cap * 4) - header.length - 50);
const tail = maxTailChars > 0 ? content.slice(-maxTailChars) : '';
```

Both changes are necessary:
- H3 fallback handles files using H3 structure (prevents matching deep H2s)
- Negative guard protects against pathological cases where header > cap (prevents negative slice)

Also manually truncated self-reflection.md from 11KB to 6KB to remove accumulated bloat.

#### Consequences

**Positive:**
- Self-reflection.md now correctly truncates to ~6KB per cycle
- Handles both H2 and H3 heading structures
- Guards against negative maxTailChars in all cases
- Memory banks remain bounded (prevents context window bloat)
- Verified with supervisor cycle test: file size stable

**Negative:**
- None identified

**Why Settled:**
- This bug caused 49x file growth and went undetected for weeks
- The fix addresses the root cause (heading mismatch) and guards against the symptom (negative math)
- Changing this logic without understanding both failure modes risks reintroducing unbounded growth
- Memory management is critical for long-running supervisor — bounded files are non-negotiable

#### Related

- `src/server/services/supervisor-worker.ts` — enforceTokenCap function (lines 896-911, fixed at 930-933)
- `~/.claude-remote/memory/enforceTokenCap-fix.md` — Full bug analysis and fix specification
- `~/.claude-remote/memory/leo/self-reflection.md` — Affected file (manually truncated post-fix)
- Supervisor cycle mechanism (Level 8) — Calls enforceTokenCap after every memory bank write

---

### DEC-023: Deferred Cycle Pattern via fs.watch (Gary Model)

**Date**: 2026-02-28
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

Jim's supervisor has a `deferredCyclePending` flag that gets set when a cycle tries to run while Opus is busy (Leo's CLI session is active). The flag was being set correctly (supervisor.ts line 577), but there was no mechanism to detect when Leo's CLI stopped and trigger the deferred cycle. This meant Darron's messages in conversation threads could wait up to 20 minutes (until the next scheduled supervisor cycle) even though Opus became available much sooner.

Leo's heartbeat already had a solution: fs.watch on the signals directory to detect when cli-active file is removed, triggering deferred beats immediately. This pattern was proven and working.

#### Options Considered

1. **fs.watch signal detection (Gary Model)**
   - ✅ Event-driven — immediate response when CLI stops
   - ✅ Zero polling overhead — no CPU/memory cost
   - ✅ Pattern proven — Leo's heartbeat uses it successfully
   - ✅ Symmetric design — both agents use same pattern
   - ✅ Supports multiple trigger sources (cli-active removal + explicit wake signals)
   - ❌ Requires fs.watch understanding and error handling

2. **Polling check in scheduled cycles**
   - ✅ Simple to implement
   - ❌ Still subject to scheduling delays (up to 20 minutes)
   - ❌ Doesn't actually solve the problem
   - ❌ Polling overhead (constant CPU usage)

3. **Periodic fast polling when deferred cycle pending**
   - ✅ Could reduce wait time to ~30 seconds
   - ❌ High polling frequency wastes resources
   - ❌ Still has delay (not immediate)
   - ❌ More complex logic (start/stop polling loop)

4. **Opus concurrency queue with callbacks**
   - ✅ Programmatic approach
   - ❌ Large refactor of supervisor architecture
   - ❌ Introduces callback complexity
   - ❌ Doesn't leverage existing signals infrastructure

#### Decision

We chose **fs.watch signal detection (Gary Model)** because it mirrors Leo's proven pattern and provides immediate event-driven response with zero polling overhead.

**Implementation:**

1. **`startSupervisorSignalWatcher()` function** in supervisor.ts:
   - Watches `~/.claude-remote/signals/` directory
   - Detects two event types:
     - `cli-active` file removal → waits 3s → checks `!isCliActive()` → runs deferred cycle
     - `jim-wake-{timestamp}` file creation → checks `isOpusSlotBusy()` → runs deferred cycle immediately (guard added 2026-02-28)
   - Called from `initSupervisor()` during worker process initialisation
   - Error handling with try/catch and logging
   - **Guard protection**: Both handlers check resource availability before firing cycles to prevent hangs

2. **jim-wake signal writing** in conversations.ts:
   - Imported `isOpusSlotBusy()` from supervisor.ts
   - When human message arrives and Opus is busy → writes timestamped signal file
   - Signal triggers immediate deferred cycle via watcher
   - Belt-and-suspenders approach for reliability

3. **Export `isOpusSlotBusy()`** from supervisor.ts:
   - Allows other modules to check Opus availability
   - Used by conversations route to decide when to write wake signals
   - Checks both CLI active and session active states

**Why "Gary Model"**: Named after the fs.watch pattern Leo developed in his heartbeat. Gary = fs.watch-based event detection for resource availability.

#### Consequences

**Positive:**
- Deferred cycles run within 3 seconds of CLI stop (vs up to 20 minutes before)
- Zero polling overhead — event-driven only
- Symmetric design with Leo's heartbeat (same pattern, easier to understand)
- Multiple trigger paths (cli-active removal + explicit wake) provide robustness
- Human messages get immediate supervisor responses after CLI stops
- Pattern proven and working in Leo's heartbeat

**Negative:**
- Slightly more complex than polling (fs.watch API, event handling)
- Requires understanding file-based signalling
- Signal file cleanup needed (handled in watcher)

**Trade-offs:**
- More upfront complexity for better runtime efficiency
- Event-driven vs polling: immediate response vs simpler code
- Chose immediate response — wait time is user-facing pain point

**Implementation notes:**
- 3-second delay after CLI stop mirrors Leo's pattern (prevents race conditions)
- jim-wake signals cleaned up after processing (prevents accumulation)
- Watcher runs independently — doesn't block supervisor cycles
- Error logging for debugging watcher issues
- **Bug fix (2026-02-28)**: Added `isOpusSlotBusy()` guard to jim-wake handler — handler was firing cycles without checking Opus availability, causing cycle #882 to hang for 10+ hours. Now mirrors cli-active handler's defensive pattern.

#### Related

- Leo's heartbeat: `src/server/leo-heartbeat.ts` lines 1130-1140 (reference implementation)
- Supervisor cycles: `src/server/services/supervisor.ts` (deferred cycle logic)
- Conversations route: `src/server/routes/conversations.ts` (wake signal writing)
- DEC-018: Conversations as Strategic Async Discussion Channel (beneficiary of this pattern)

#### Verification

Tested with manual verification:
1. Started supervisor worker process
2. Verified `deferredCyclePending` set when cycle runs while Opus busy
3. Removed cli-active file manually
4. Confirmed watcher fired deferred cycle within 3 seconds
5. Checked signal file cleanup (jim-wake files removed after processing)

---

### DEC-024: Context Injection Pipeline Tuning

**Date**: 2026-02-28
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

The context injection system (`buildTaskContext()`) assembles ecosystem context for autonomous task agents. Five bugs were discovered that prevented agents from receiving complete and accurate context:

1. **ADR filter**: Only matched "Settled" status, but all 131 ADRs in the ecosystem used "Accepted"
2. **CLAUDE.md truncation**: 3000-char limit caused projects with long session protocols (clauderemote, hodgic) to get 0 useful content
3. **Learnings selection**: Position-based slicing caused HIGH-severity learnings to be missed when they appeared after position 5
4. **Bun detection**: `bun:sqlite` entry never matched because built-in imports don't appear in package.json
5. **Monorepo tech detection**: Workspace packages in `packages/*/package.json` weren't scanned

These bugs resulted in autonomous tasks operating with incomplete information, leading to re-implementing already-decided patterns, repeating known mistakes, and receiving irrelevant learnings.

#### Options Considered

**For each bug:**

1. **ADR Filter**:
   - Option A: Change all ADR statuses to "Settled" (❌ breaks convention, requires mass edit)
   - **Option B: Accept both "Settled" and "Accepted"** (✅ backwards compatible, minimal change)

2. **CLAUDE.md Truncation**:
   - Option A: Split session protocol into separate file (❌ complicates structure)
   - **Option B: Double the character limit to 6000** (✅ simple, effective)

3. **Learnings Selection**:
   - Option A: Reorder INDEX.md manually (❌ fragile, requires ongoing maintenance)
   - **Option B: Sort by severity before slicing + increase cap to 10** (✅ algorithmic fix, more capacity)

4. **Bun Detection**:
   - Option A: Check for `bun.lockb` file (❌ doesn't work for projects using npm)
   - **Option B: Match `@types/bun` package** (✅ reliable signal for Bun projects)

5. **Monorepo Tech Detection**:
   - Option A: Require manual tech stack in CLAUDE.md (❌ defeats automation purpose)
   - **Option B: Scan workspace packages automatically** (✅ correct, complete detection)

#### Decision

Implemented all five fixes (Option B in each case) because they address root causes with minimal code changes and maintain backwards compatibility:

1. **ADR filter**: Changed regex to `/\*\*Status\*\*:\s*(Settled|Accepted)/i`
2. **CLAUDE.md truncation**: Increased from 3000 to 6000 chars
3. **Learnings selection**: Sort by severity (HIGH first), then slice to 10 (was 5)
4. **Bun detection**: Added `'@types/bun': ['Bun']`, removed `'bun:sqlite'`
5. **Monorepo scanning**: Added `fs.readdirSync()` loop for `packages/*/package.json`

All changes isolated to `src/server/services/context.ts`.

#### Consequences

**Positive:**
- Task agents now receive complete settled decisions (131 ADRs vs 0)
- Full session protocols captured for all projects
- HIGH-severity learnings always prioritised regardless of INDEX.md order
- Bun projects correctly detected (7 projects benefit)
- Monorepo dependencies discovered (contempire's Hono, Clerk, Zod now detected)
- Improved context quality leads to better task outcomes

**Negative:**
- Slightly larger context payload (minimal impact, well within token budgets)
- More learnings per task (10 vs 5) — acceptable tradeoff for relevance

**Trade-offs:**
- CLAUDE.md 6000-char limit may still be insufficient for some projects — can increase further if needed
- Monorepo scanning assumes `packages/` convention — won't detect non-standard layouts (acceptable — can extend if needed)

**Implementation notes:**
- All fixes tested via manual context extraction verification
- Zero breaking changes — purely additive or corrective
- Maintains backwards compatibility with existing ADR statuses

#### Related

- Level 10 Phase A: Ecosystem-Aware Context Injection (foundation for this work)
- `buildTaskContext()` function (context.ts:220-330)
- ADR extraction, tech detection, learnings filtering
- DEC-021: Category-Aware Model Selection (benefits from improved context)

---

### DEC-025: Workshop Module Three-Persona Navigation

**Date**: 2026-03-01
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

The admin console needed a dedicated space for structured dialogue between Darron, Supervisor Jim, and Philosopher Leo. The Conversations module provided general discussion threads, but lacked semantic organization for different types of dialogue. Need arose for separate channels for different conversation purposes: actionable requests vs status reports (Jim), philosophical questions vs idea postulates (Leo), incomplete thoughts vs developed musings (Darron).

The question was how to structure navigation for six distinct discussion types across three personas.

#### Options Considered

1. **Flat list of 6 discussion types in sidebar**
   - ✅ Simple navigation — one click to any discussion type
   - ✅ All types visible at once
   - ❌ Loses semantic grouping by persona
   - ❌ Sidebar cluttered with 6+ items
   - ❌ No visual distinction between personas
   - ❌ Doesn't honour three-way collaboration model

2. **Two-level navigation (sidebar → discussion type)**
   - ✅ Cleaner sidebar (one Workshop item)
   - ✅ Discussion types grouped together
   - ❌ Loses persona context completely
   - ❌ "Requests" and "Questions" look equivalent without persona framing
   - ❌ Doesn't reflect that Jim/Leo/Darron have different purposes

3. **Three-level navigation (sidebar → persona → discussion type)**
   - ✅ Clear semantic grouping by persona
   - ✅ Visual distinction via accent colors (purple/green/blue)
   - ✅ Reflects three-way collaboration model
   - ✅ Persona provides context for discussion type meaning
   - ✅ Equal visual weight for all three personas
   - ❌ More navigation levels (three clicks to reach discussion type)
   - ❌ Slightly more complex implementation

4. **Tabbed interface with all 6 types in one view**
   - ✅ All discussion types accessible without navigation
   - ❌ Cluttered — 6 tabs at top level
   - ❌ Loses persona grouping
   - ❌ Mobile layout problematic (6 tabs don't fit)

#### Decision

We chose **Option 3: Three-level navigation (sidebar → persona → discussion type)** because it honours the three-way collaboration model and provides semantic context at each navigation level.

**Navigation structure**:
- **Level 1**: Workshop sidebar item
- **Level 2**: Persona tabs (Supervisor Jim, Philosopher Leo, Dreamer Darron)
- **Level 3**: Nested discussion type tabs (2 per persona)

**Persona accent colors**:
- Supervisor Jim: Purple (strategic, oversight)
- Philosopher Leo: Green (growth, exploration)
- Dreamer Darron: Blue (depth, reflection)

**Discussion type mapping**:
```
Supervisor Jim (purple):
  - Requests (jim-request) — actionable asks for supervisor action
  - Reports (jim-report) — status updates and findings from supervisor

Philosopher Leo (green):
  - Questions (leo-question) — seeking understanding and clarification
  - Postulates (leo-postulate) — proposing ideas and hypotheses

Dreamer Darron (blue):
  - Thoughts (darron-thought) — incomplete musings, unformed ideas
  - Musings (darron-musing) — developed reflections and insights
```

**Design principle**: Persona tabs have equal visual weight (same size, same font, same padding). Differentiation via accent color only, not size or prominence. This reflects Darron's explicit requirement: "persona tab bar should feel like equals — same size, same weight, different accent colours".

**Implementation details**:
- Persona tabs: horizontal bar with flex layout, accent color borders/backgrounds
- Nested tabs: horizontal bar below persona tabs, filtered by selected persona
- Thread list: 280px panel with temporal filter, search, message counts
- Thread detail: 1fr panel with message history, compose input, actions
- Mobile: single-column stack at <768px with `.thread-selected` toggle
- Real-time: WebSocket updates for all six workshop discussion types

#### Consequences

**Positive:**
- Clear semantic context at each navigation level
- Persona distinction honours three-way collaboration model
- Discussion types naturally grouped by persona purpose
- Accent colors provide visual wayfinding without hierarchy
- Equal visual weight avoids implying importance hierarchy
- Reuses proven conversation threading pattern
- Mobile responsive from initial design, not retrofitted

**Negative:**
- Three navigation levels requires three clicks to reach discussion type
- More complex state management (persona + nested tab + selected thread + period)
- Users must understand persona/discussion type relationships

**Trade-offs:**
- More navigation clicks vs clearer semantic organization — chose clarity
- Implementation complexity vs user mental model alignment — chose alignment
- Flat all-in-one view vs structured navigation — chose structure

**Implementation notes:**
- State variables: `workshopPersona`, `workshopNestedTab`, `workshopSelectedThread`, `workshopPeriod`
- Default behavior: Jim persona, Requests tab on first load
- Persona switch resets to first nested tab for that persona
- Nested tab switch fetches conversations filtered by `discussion_type`
- Search scoped to active nested tab (doesn't cross discussion types)
- WebSocket events filtered by workshop discussion types for real-time updates

#### Related

- DEC-018: Conversations as Strategic Async Discussion Channel (foundation for Workshop module)
- Level 12: Strategic Conversations (implementation level)
- Admin console Phase 2 (Work, Conversations, Products, Workshop modules)
- Conversation threading pattern (reused from Conversations module)
- Reference conversation: mm7ejhxi-r6qjh4 ('work I'd like Jim to look at') — Darron approved this design explicitly

---

### DEC-026: Auto-Reactivate Archived Threads on New Message

**Date**: 2026-03-01
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

Workshop conversations can be archived to keep the active list focused on ongoing work. The question arose: what happens when someone posts a new message to an archived thread? Should it remain archived (message invisible in active view) or should it automatically reactivate (assume the thread is active again)?

Similar patterns exist in email (archived threads that reappear in inbox when replied to) and issue trackers (closed issues that reopen when new comments arrive).

#### Options Considered

1. **Auto-reactivate on new message**
   - ✅ Intuitive — sending a message implies active discussion
   - ✅ Prevents "lost" messages in archived threads
   - ✅ Matches email client behaviour (Gmail, Outlook)
   - ✅ No manual reactivation needed
   - ❌ Could reactivate threads user wanted to keep archived

2. **Keep archived, require manual reactivation**
   - ✅ Explicit control — user decides when to reactivate
   - ✅ Preserves archive state
   - ❌ New messages invisible in active view
   - ❌ Easy to forget to reactivate
   - ❌ Friction — extra click needed before sending

3. **Prompt user when sending to archived thread**
   - ✅ Explicit choice each time
   - ❌ Extra modal/prompt friction
   - ❌ Interrupts message flow
   - ❌ Annoying for common case (reactivation wanted)

#### Decision

We chose **Option 1: Auto-reactivate on new message** because posting a message to an archived thread is a strong signal that the discussion is active again.

**Implementation:**
- Modified `POST /api/conversations/:id/messages` endpoint in conversations.ts
- When message added, check if conversation has `archived_at` set
- If archived, clear `archived_at` before inserting message
- Update `updated_at` timestamp as usual
- Thread immediately appears in active view after message sent

**API behaviour:**
```typescript
// In conversations.ts POST /:id/messages handler
if (conversation.archived_at) {
    conversationStmts.updateArchived.run(null, id); // Clear archived_at
}
```

This applies regardless of who sends the message (human, Leo, Jim) — any new message reactivates.

#### Consequences

**Positive:**
- Natural workflow — post message, thread becomes active
- No lost messages in archived state
- Matches familiar email patterns
- Zero friction for common case
- Prevents confusion ("Where did my message go?")

**Negative:**
- User can't post a "final note" to archived thread without reactivating it
- If user wants thread to stay archived despite new message, must manually re-archive after

**Trade-offs:**
- Automatic vs explicit: chose automatic because common case is reactivation
- Could add "Send without reactivating" option in future if needed
- Current implementation optimises for 95% case (reactivation desired)

**Implementation notes:**
- Archive check happens before message insert (clean separation)
- Works consistently across all discussion types (general, workshop personas)
- No special UI needed — behaviour is implicit and discoverable
- If reactivation undesired, user can re-archive in one click

#### Related

- DEC-025: Workshop Module Three-Persona Navigation (provides context for thread management)
- DEC-018: Conversations as Strategic Async Discussion Channel (foundation)
- Conversations API: `POST /api/conversations/:id/messages` (implementation location)
- Archive API: `POST /api/conversations/:id/archive` (complementary feature)

---

### DEC-027: Staleness Thresholds Recalibrated for Each Agent

**Date**: 2026-03-02
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

The Robin Hood Protocol requires both Leo and Jim to monitor each other's health signals and detect when the partner has become unresponsive. However, Leo's heartbeat interval is 20-30min (v0.5) while Jim's supervisor cycles are 10-20min. The original Robin Hood design used symmetric thresholds which didn't account for these different beat frequencies.

False positives (resurrecting a healthy-but-slow process) waste resources and create log noise. False negatives (failing to detect a crashed process) leave the system degraded for too long.

#### Options Considered

1. **Symmetric thresholds (same for both agents)**
   - ✅ Simpler to understand
   - ✅ Single set of numbers to remember
   - ❌ Either too aggressive for Leo (false positives) or too conservative for Jim (slow detection)
   - ❌ Doesn't respect different beat frequencies

2. **Agent-specific thresholds based on 2.5-3x beat interval**
   - ✅ Tuned to each agent's normal behaviour
   - ✅ Reduces false positives during quiet periods
   - ✅ Still catches genuine failures within reasonable time
   - ✅ Threshold widening from original design (based on Leo's review feedback)
   - ❌ Slightly more complex (two sets of numbers)

3. **Dynamic thresholds based on recent beat history**
   - ✅ Adapts to actual behaviour
   - ❌ Complex to implement correctly
   - ❌ Hard to reason about (non-deterministic)
   - ❌ Overkill for known beat intervals

#### Decision

We chose **agent-specific thresholds based on ~2.5-3x beat interval**:

**Jim watching Leo** (Leo's beat is 20-30min):
- <45min: OK (healthy, no action)
- 45-90min: Stale (log warning, check PID)
- >90min: Down (attempt resurrection)

**Leo watching Jim** (Jim's cycle is 10-20min):
- <40min: OK (healthy, no action)
- 40-90min: Stale (log warning, check PID)
- >90min: Down (attempt resurrection)

These thresholds were widened from the original design based on Leo's review feedback (2026-02-26). Leo's heartbeat interval increased from 10min to 20-30min in v0.5 (unified identity update), requiring threshold recalibration.

#### Consequences

**Positive:**
- Low false-positive rate (thresholds account for quiet periods and variable beat intervals)
- Reasonable detection time (failures detected within 90-120 minutes)
- Each agent's thresholds match its partner's normal behaviour
- Stale classification (45-90min / 40-90min) allows early warning without action

**Negative:**
- Slightly more complex than symmetric thresholds
- Must remember two sets of numbers (mitigated by clear documentation)

**Trade-offs:**
- Detection speed vs false-positive rate: chose to optimize for low false positives
- Simplicity vs accuracy: chose accuracy (agent-specific tuning)
- 90-minute "down" threshold means failures take up to ~2 hours to resurrect (acceptable for non-critical background processes)

**Implementation notes:**
- Thresholds hardcoded in `checkLeoHealth()` (Jim) and `checkJimHealth()` (Leo)
- PID-alive check during "stale" classification prevents resurrection of slow-but-healthy processes
- Shared resurrection log enables monitoring actual resurrection frequency

#### Related

- Robin Hood Protocol design: `~/.claude-remote/memory/shared/robin-hood-protocol.md`
- Robin Hood implementation: `~/.claude-remote/memory/shared/robin-hood-implementation.md`
- Leo's v0.5 unified identity update (2026-02-25, increased beat interval to 20-30min)
- DEC-028: Shared Resurrection Log (complementary decision)

---

### DEC-028: Shared Resurrection Log at resurrection-log.jsonl

**Date**: 2026-03-02
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

Both Leo and Jim can perform resurrections (Leo resurrects Jim's server, Jim resurrects Leo's heartbeat). Need to:
1. Track resurrection attempts for debugging
2. Enforce cooldown between attempts (prevent resurrection loops)
3. Provide human visibility into system self-healing behaviour
4. Coordinate between agents (both need to read resurrection history)

The question is whether to use separate logs (leo-resurrections.jsonl, jim-resurrections.jsonl) or a single shared log.

#### Options Considered

1. **Separate logs per resurrector**
   - ✅ Clear ownership (Leo's file, Jim's file)
   - ✅ No write contention (only one agent writes to each file)
   - ❌ Harder to analyze resurrection patterns (must read two files)
   - ❌ Cooldown enforcement requires reading partner's log
   - ❌ Incomplete picture of system health

2. **Separate logs per target**
   - ✅ Target-centric view (all leo resurrections in one file)
   - ✅ Easier to track specific agent's resurrection history
   - ❌ Still requires reading two files for complete picture
   - ❌ Cooldown enforcement requires reading correct file

3. **Single shared JSONL log**
   - ✅ Complete timeline of all resurrections in one place
   - ✅ Simplifies cooldown enforcement (both agents read same file)
   - ✅ Easy to analyze resurrection patterns and frequency
   - ✅ Single source of truth for human review
   - ❌ Potential write contention (both agents append)
   - ❌ Requires careful JSONL append handling

#### Decision

We chose **single shared JSONL log at `~/.claude-remote/health/resurrection-log.jsonl`**.

**Log entry format**:
```json
{
  "timestamp": "2026-03-02T14:22:51+10:00",
  "resurrector": "jim",
  "target": "leo",
  "reason": "health file stale for 95 minutes (threshold: 90min)",
  "pidCheck": "dead",
  "action": "systemctl --user restart leo-heartbeat.service",
  "outcome": "success",
  "verificationWait": 10000,
  "newHealthAge": 3
}
```

Each entry includes:
- **timestamp**: ISO 8601 with timezone
- **resurrector**: "leo" or "jim" (who performed the resurrection)
- **target**: "leo" or "jim" (who was resurrected)
- **reason**: Human-readable explanation (includes staleness age and threshold)
- **pidCheck**: "alive" or "dead" (PID check result before resurrection)
- **action**: systemctl command executed
- **outcome**: "success", "failed", or "skipped"
- **verificationWait**: Milliseconds waited before verification
- **newHealthAge**: Age of health file after resurrection (minutes)

**Write safety**: JSONL format is append-safe. Both agents use atomic appends (fs.appendFileSync). Race conditions result in interleaved lines, which is valid JSONL.

#### Consequences

**Positive:**
- Complete resurrection timeline in single file
- Both agents read same file for cooldown enforcement
- Easy to analyze: `cat resurrection-log.jsonl | jq -s 'group_by(.target) | map({target: .[0].target, count: length})'`
- Human can review system self-healing behaviour at a glance
- Enables future analytics (resurrection frequency, success rate, etc.)

**Negative:**
- Theoretical write contention (mitigated by low frequency ~1 write per hour max)
- Both agents must handle JSONL parsing (minor code duplication)

**Trade-offs:**
- Single file vs separate files: chose single for simplicity and complete timeline
- Write contention vs coordination benefits: chose shared log (contention minimal)
- JSONL append-safety critical — must use atomic appends

**Implementation notes:**
- File created on first resurrection attempt by either agent
- Both agents read full log to check cooldown (filter by target)
- Log rotation not needed (low frequency ~1 entry per hour max)
- Human can manually inspect or truncate if needed

**Cooldown enforcement example**:
```typescript
function getLastResurrectionTimestamp(target: 'leo' | 'jim'): number {
  const log = fs.readFileSync('~/.claude-remote/health/resurrection-log.jsonl', 'utf-8');
  const entries = log.split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line))
    .filter(entry => entry.target === target && entry.outcome === 'success')
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  return entries.length > 0 ? Date.parse(entries[0].timestamp) : 0;
}
```

#### Related

- DEC-027: Staleness Thresholds Recalibrated for Each Agent (determines when resurrections happen)
- Robin Hood Protocol Phase 4 (resurrection implementation)
- `checkLeoHealth()` in supervisor.ts (Jim's side)
- `checkJimHealth()` in leo-heartbeat.ts (Leo's side)

---

### DEC-029: Distress Signal Thresholds — 3× Median for Jim, 2× Maximum for Leo

**Date**: 2026-03-03
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

The Robin Hood Protocol Phase 5 adds distress signals to provide early warning when Jim's supervisor cycles or Leo's heartbeat intervals become degraded. The challenge was determining the right multipliers to distinguish between:
- **Normal variance**: Expected fluctuations due to workload, network latency, system load
- **Degraded performance**: Abnormally slow but still functioning (distress)
- **Complete failure**: Not functioning at all (stale → resurrection)

Too low a multiplier causes false alarms. Too high misses real degradation.

Jim's supervisor cycles vary significantly based on workload:
- Light cycle (skipped_idle, skipped_busy): < 1 second
- Normal cycle (scan tasks, no work): 5-15 minutes
- Heavy cycle (large goal decomposition, complex planning): 20-40 minutes

Leo's heartbeat intervals are more predictable:
- Phase-based: v0.5 = 20-30 minutes, v0.6 (hypothetical) might be 5-10 minutes
- Variance is lower: occasional delays due to CPU contention or I/O, but generally consistent

#### Options Considered

1. **Symmetric thresholds (same multiplier for both)**
   - ✅ Simpler to understand and maintain
   - ✅ Consistent policy across both agents
   - ❌ Doesn't respect different variance characteristics
   - ❌ Either too aggressive for Jim or too conservative for Leo

2. **Fixed absolute thresholds (e.g., "trigger at 60 minutes")**
   - ✅ Easy to reason about
   - ❌ Doesn't adapt to different workload patterns
   - ❌ Breaks when phase changes (e.g., Leo moves to faster beat phase)
   - ❌ Median-based approach for Jim becomes impossible

3. **Asymmetric dynamic thresholds (3× median for Jim, 2× max for Leo)**
   - ✅ Respects variance characteristics of each agent
   - ✅ Jim gets headroom for workload-based variance
   - ✅ Leo triggers sooner due to predictable intervals
   - ✅ Phase-aware for Leo (adapts to different beat frequencies)
   - ✅ Median-based for Jim (adapts to changing workload over time)
   - ❌ Slightly more complex (two different multipliers)

#### Decision

We chose **asymmetric dynamic thresholds**: 3× median cycle duration for Jim, 2× expected maximum interval for Leo.

**Jim (supervisor cycles)**:
- Tracks last 50 cycle durations in circular buffer
- Calculates median duration (or uses 20min default if <5 cycles)
- Triggers distress if actual cycle > 3× median
- Example: median 15min → triggers at 45min+
- Rationale: Supervisor workload varies significantly; 3× gives enough headroom for occasional heavy cycles while still catching genuine degradation

**Leo (heartbeat intervals)**:
- Phase-aware expected intervals (v0.5 = 20-30min)
- Triggers distress if actual interval > 2× expected maximum
- Example: v0.5 phase (30min max) → triggers at 60min+
- Rationale: Heartbeat is predictable; 2× catches issues sooner without false alarms from minor delays

**Timeline Example** (Leo in v0.5 phase):
- **Normal**: 20-30 minute intervals (healthy)
- **Distress**: 60+ minute interval (degraded, yellow warning banner + ntfy)
- **Stale**: 90+ minute interval (failed, automatic resurrection)

#### Consequences

- Jim has more tolerance for workload variance (3× vs 2×)
- Leo triggers distress earlier relative to its expected interval
- Both systems adapt to their environment (median/phase-based)
- False positive rate is low for both (verified in testing: 13 PASS, 0 FAIL)
- Early warning provides 30-60 minutes between distress notification and resurrection attempt
- Operators receive advance notice of degradation while system still functional

**Implementation notes:**
- Jim's circular buffer: 50 entries, median calculation handles even/odd counts
- Leo's phase detection: reads current phase from health file, looks up expected interval
- Distress signals written to `~/.claude-remote/health/{jim,leo}-distress.json`
- ntfy notifications sent with "warning" priority and "Priority: high" header
- Admin UI health panel displays distress as yellow warning banners

#### Related

- DEC-027: Staleness Thresholds Recalibrated for Each Agent (resurrection thresholds)
- DEC-028: Shared Resurrection Log at resurrection-log.jsonl (resurrection tracking)
- Robin Hood Protocol Phase 5: `docs/ROBIN_HOOD_README.md`
- Testing: `scripts/test-robin-hood.sh` and `docs/ROBIN_HOOD_TEST_REPORT_2026-03-03.md`

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

### DEC-029: Discord Gateway Implementation — Raw WebSocket vs discord.js

**Date**: 2026-03-03
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

Jemma (Discord message dispatcher service) needs to connect to Discord Gateway to receive incoming messages, classify them via Ollama, and route to appropriate recipients (Jim, Leo, Darron, Sevn, Six).

#### Options Considered

1. **discord.js library** — Full-featured Discord client library
   - ✅ Comprehensive API coverage, battle-tested, TypeScript support
   - ✅ Automatic reconnection handling, heartbeat management, event abstraction
   - ✅ Rich ecosystem (voice, slash commands, components, embeds)
   - ❌ Heavy dependency (dozens of packages, 10MB+ node_modules)
   - ❌ Abstracts Gateway protocol (harder to debug connection issues)
   - ❌ Opinionated patterns (event emitters, cache management)
   - ❌ Overkill for simple message intake (Jemma only needs MESSAGE_CREATE events)

2. **Raw WebSocket with `ws` package** — Direct Gateway protocol implementation
   - ✅ Lightweight (single dependency already in project)
   - ✅ Full control over connection lifecycle (RESUME, reconnection logic, exponential backoff)
   - ✅ Direct visibility into Gateway events (easier debugging)
   - ✅ Can log raw Gateway payloads, track sequence numbers, monitor heartbeat timing
   - ✅ Simpler runtime footprint (no cache management, no event emitter overhead)
   - ❌ More manual implementation (must handle protocol details ourselves)
   - ❌ Must implement HELLO → IDENTIFY → HEARTBEAT → MESSAGE_CREATE flow manually
   - ❌ Must track session_id and last_sequence for RESUME

#### Decision

We chose **raw `ws` package for direct Gateway protocol implementation**.

#### Reasoning

- **Constraints explicitly required it**: "Do NOT install discord.js — use raw `ws` package"
- **Jemma only needs MESSAGE_CREATE events** — doesn't need full Discord API surface (voice, slash commands, components, embeds, etc.)
- **Direct WebSocket control enables precise reconnection handling** — RESUME on disconnect with session_id + last_sequence, exponential backoff (1s → 2s → 4s → 8s, max 30s), session recovery
- **Simpler debugging** — can log raw Gateway payloads, track sequence numbers, monitor heartbeat timing
- **Smaller runtime footprint** — no cache management (discord.js caches guilds, channels, users, roles), no event emitter overhead
- **Already have `ws` package in project** — no new dependency installation required

#### Consequences

- **Must manually implement Gateway protocol**: HELLO (receive heartbeat interval), IDENTIFY (send bot token + intents), RESUME (reconnect with session_id + last_sequence), HEARTBEAT (send at server-requested interval)
- **Must handle reconnection logic ourselves**: exponential backoff (1s, 2s, 4s, 8s, max 30s), track `session_id` and `last_sequence` for RESUME
- **Need to manually track sequence numbers**: last_sequence is critical for RESUME (prevents missing events)
- **Benefit: precise control over connection lifecycle** — can implement custom reconnection strategies, monitor Gateway latency, detect connection degradation
- **Benefit: better observability** — raw Gateway payloads logged, makes debugging connection issues trivial
- **Implementation complexity is acceptable** — ~200 lines for full Gateway protocol implementation (HELLO, IDENTIFY, RESUME, HEARTBEAT, MESSAGE_CREATE)

#### Related

- Discord Gateway documentation: https://discord.com/developers/docs/topics/gateway
- `ws` package: https://github.com/websockets/ws
- DEC-030: Message Classification (Ollama vs Anthropic API)

---

### DEC-030: Message Classification — Ollama Local vs Anthropic API

**Date**: 2026-03-03
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

Jemma receives Discord messages and must classify them to determine the recipient (jim/leo/darron/sevn/six/ignore). Classification considers: direct mentions (@Jim, @Leo), channel context (#jim → Jim, #leo → Leo), message content, thread context (replied-to message).

#### Options Considered

1. **Ollama local models** (qwen2.5-coder:7b or gemma)
   - ✅ Zero cost (runs on local hardware, no API fees)
   - ✅ Zero latency (no network round-trip, <100ms inference)
   - ✅ Privacy-preserving (messages never leave server)
   - ✅ No rate limits (can classify thousands of messages per hour)
   - ✅ Existing infrastructure (Ollama already running for orchestrator tasks)
   - ❌ Lower accuracy than Claude (especially for nuanced classification)
   - ❌ Requires Ollama service running (additional service dependency)
   - ❌ Classification prompt must be simple (local models struggle with complex reasoning)

2. **Anthropic API** (Claude Haiku for speed/cost)
   - ✅ Higher accuracy (better at understanding context, nuance, and intent)
   - ✅ No local service dependency (only need API key)
   - ✅ Can handle complex classification prompts (multi-factor decision trees)
   - ❌ Cost: ~$0.0005 per classification (could add up with high Discord volume)
   - ❌ Network latency: ~200-500ms per classification (vs <100ms local)
   - ❌ Privacy: messages sent to Anthropic (Discord messages may contain sensitive project discussions)
   - ❌ Rate limits: Anthropic API has rate limits (could throttle during Discord spam)

3. **Hybrid approach** (Ollama primary, Anthropic fallback)
   - ✅ Best of both worlds (local speed/cost, cloud accuracy when needed)
   - ✅ Can use confidence scores to trigger Anthropic re-classification
   - ❌ More complex implementation (two classification paths)
   - ❌ Still has privacy concerns (some messages sent to Anthropic)
   - ❌ Adds latency variability (some classifications 100ms, others 500ms)

#### Decision

We chose **Ollama local models (qwen2.5-coder:7b or gemma) for classification**.

#### Reasoning

- **Discord messages arrive frequently** — potentially dozens per hour in active channels, cost would accumulate quickly (100 messages/day = $0.05/day = $1.50/month just for classification)
- **Classification is not mission-critical** — false negatives (missed messages) are acceptable because Darron checks Discord directly anyway, false positives (wrong recipient) are easily corrected
- **Local model is "good enough" for this use case** — classification prompt is simple (recipient determination based on mentions + channel context), not complex multi-step reasoning
- **Privacy benefit** — Discord messages may contain sensitive project discussions (architecture decisions, implementation details, debugging context)
- **Zero latency** — local inference <100ms vs Anthropic API 200-500ms (better user experience, faster message routing)
- **Ollama already running** — existing infrastructure for orchestrator tasks, no new service required
- **Fallback available** — if local classification proves inaccurate, can add Anthropic API as optional override (config flag `jemma.use_anthropic_classification: true`)

#### Consequences

- **Requires Ollama service running** — must document in setup instructions (already required for orchestrator, so minimal additional burden)
- **May need to tune classification prompt if accuracy is insufficient** — can iterate on prompt engineering to improve local model performance
- **Can monitor classification confidence scores** — Ollama returns confidence/probability, can log low-confidence classifications for human review
- **If Ollama is down, Jemma will log errors but won't crash** — graceful degradation (message classification fails, but Gateway connection stays alive)
- **Can add Anthropic fallback later if needed** — not implemented initially, but architecture supports adding hybrid approach via config flag

#### Related

- Ollama documentation: https://github.com/ollama/ollama
- DEC-029: Discord Gateway Implementation (Raw WebSocket vs discord.js)
- DEC-031: Delivery Routing (Direct API Calls vs Signal Files)

---

### DEC-031: Delivery Routing — Direct API Calls vs Signal Files

**Date**: 2026-03-03
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

When Jemma needs to deliver a classified Discord message to Jim or Leo, should it call their APIs directly (POST to server endpoints) or write signal files for them to poll?

#### Options Considered

1. **Direct API calls** (POST to server endpoints)
   - ✅ Immediate delivery (no polling delay, real-time notification)
   - ✅ Confirmation response (know if delivery succeeded via HTTP status code)
   - ✅ Can include full context in request body (message content, author, channel, classification confidence)
   - ✅ Enables server-side processing (create conversation entry, write database record, broadcast via WebSocket)
   - ❌ Requires server to be running (fails if server is down for maintenance or crash)
   - ❌ Tight coupling (Jemma depends on server availability)
   - ❌ No persistence (if API call fails and Jemma doesn't retry, message is lost)

2. **Signal files** (write to ~/.claude-remote/signals/)
   - ✅ Decoupled (works even if server is down)
   - ✅ Persistent (message survives server restarts, Jemma restarts)
   - ✅ No network dependency (local filesystem only, no HTTP overhead)
   - ✅ Existing pattern (Leo's heartbeat already watches for `leo-wake-*` signal files)
   - ❌ Polling delay (agents check signal files periodically, not real-time)
   - ❌ No confirmation (can't know if agent received message until signal file is deleted)
   - ❌ Manual cleanup (signal files must be deleted after processing to avoid re-delivery)

3. **Hybrid approach** (API call with signal file fallback)
   - ✅ Best of both worlds (immediate delivery when server is up, persistent fallback when down)
   - ✅ Graceful degradation (server downtime doesn't lose messages)
   - ✅ High reliability (messages always delivered eventually)
   - ✅ Confirms existing pattern (Leo's heartbeat already uses signal files, can add HTTP endpoint)
   - ❌ More complex implementation (try-catch around API calls, fallback logic)
   - ❌ Two delivery paths to maintain (API endpoint and signal file polling)

#### Decision

We chose **hybrid approach — API call with signal file fallback**.

#### Reasoning

- **Jim and Leo's server is usually running** (high availability ~95%+), so API calls succeed most of the time
- **Signal file fallback ensures messages aren't lost** during server maintenance, crashes, or restarts
- **Confirms existing pattern** — Leo's heartbeat already watches for `leo-wake-*` signal files (this decision extends that pattern to Jim)
- **Allows real-time delivery when possible** — no polling delay when server is up (better user experience, faster response to Discord messages)
- **Server restart won't lose in-flight Discord messages** — if Jemma sends API call while server is restarting, API call fails, Jemma writes signal file, server reads signal file after restart
- **Graceful degradation is critical for autonomous system** — Jemma runs 24/7 unattended, must handle server downtime without human intervention

#### Implementation Details

- **To Jim**:
  1. Try POST to `http://localhost:3847/api/jemma/deliver` with `{ recipient: 'jim', message, channel, author, classification_confidence }`
  2. If fails (server down, connection refused, timeout), write to `~/.claude-remote/signals/jim-wake-discord-{timestamp}` with same payload
  3. Server-side handler (`/api/jemma/deliver`) creates conversation entry, writes wake signal file if Jim is idle, broadcasts via WebSocket

- **To Leo**:
  1. Write signal file directly to `~/.claude-remote/signals/leo-wake-discord-{timestamp}` with `{ conversationId, mentionedAt, messagePreview }`
  2. Leo's heartbeat polls every 30s (acceptable latency for Discord messages)
  3. No API call needed (Leo's heartbeat doesn't run an HTTP server, only reads signal files)

- **To Darron**:
  1. Send ntfy notification via existing ntfy topic in config.json
  2. No signal file needed (Darron is human, will check phone notification)

- **To Sevn/Six (external teams via Tailscale Funnel)**:
  1. POST to `https://openclaw-vps.tailbcb4df.ts.net/sevn/hooks/wake` (or six) with bearer token auth
  2. Body: `{ "text": "Discord message from {author} in #{channel}: {preview}", "mode": "now" }`
  3. No signal file fallback (external systems, not under our control)

#### Consequences

- **Jemma delivery is resilient to server downtime** — messages never lost during maintenance windows
- **Messages are persistent** — signal files survive restarts (Jemma restart, server restart, system reboot)
- **Slight code complexity** — try-catch around API calls, fallback logic (~20 lines per delivery path)
- **Two delivery paths to maintain** — API endpoint (`/api/jemma/deliver`) and signal file polling (Leo's heartbeat, Jim's supervisor)
- **Benefit: high reliability with graceful degradation** — combines speed of API calls with persistence of signal files

#### Related

- DEC-029: Discord Gateway Implementation (Raw WebSocket vs discord.js)
- DEC-030: Message Classification (Ollama vs Anthropic API)
- Existing signal file pattern: Leo's heartbeat watches `~/.claude-remote/signals/leo-wake-*`

---

### DEC-032: Shell Command Execution — execFileSync for Untrusted Input

**Date**: 2026-03-03
**Author**: Claude (autonomous)
**Status**: **Settled**

#### Context

When executing shell commands with user-controlled or external input (Discord messages, web requests, file uploads, etc.), how should we safely pass arguments to avoid command injection vulnerabilities?

#### The Vulnerability

A command injection vulnerability was discovered in Jemma's ntfy notification code (jemma.ts:318):

```typescript
// VULNERABLE CODE (before fix)
execSync(`curl -s -d "${ntfyMsg}" -H "Title: Discord Message" https://ntfy.sh/${config.ntfy_topic}`);
```

If a Discord message contained `"; rm -rf / #`, the shell would execute arbitrary commands:

```bash
curl -s -d "Discord — alice: "; rm -rf / #" -H "Title: Discord Message" https://ntfy.sh/topic
```

This executes `rm -rf /` — catastrophic data loss.

#### Options Considered

1. **execSync with string interpolation** (status quo)
   - ✅ Simple syntax (template literals, easy to read)
   - ❌ **DANGEROUS** — shell interprets special characters (`;`, `|`, `&`, `$`, backticks, etc.)
   - ❌ Requires manual escaping of all user input (error-prone, easy to forget)
   - ❌ No safe escaping function in Node.js standard library (must use third-party library or write custom escaper)

2. **execSync with manual shell escaping**
   - ✅ Could work if done correctly
   - ❌ Very error-prone (must escape `;`, `|`, `&`, `$`, backticks, quotes, newlines, null bytes, etc.)
   - ❌ Platform-dependent (bash vs sh vs zsh have different escaping rules)
   - ❌ No standard library function for this in Node.js (must implement yourself or use library)
   - ❌ One mistake = security vulnerability

3. **execFileSync with array arguments**
   - ✅ **SAFE** — no shell interpretation, arguments passed directly to the binary
   - ✅ No escaping needed (special characters are literal data, not shell syntax)
   - ✅ Platform-independent (works identically on Linux, macOS, Windows)
   - ✅ Built-in Node.js standard library function (no dependencies)
   - ✅ Already used correctly elsewhere in codebase (routes/jemma.ts:57)
   - ❌ Slightly more verbose (array syntax instead of template literal)

#### Decision

We chose **execFileSync with array arguments** as the **MANDATORY** pattern for all shell command execution with untrusted input.

#### Safe Pattern (REQUIRED)

```typescript
import { execFileSync } from 'node:child_process';

// CORRECT — safe against command injection
const ntfyMsg = `Discord — ${message.author.username}: ${message.content.slice(0, 100)}`;
execFileSync('curl', [
  '-s',
  '-d', ntfyMsg,  // ntfyMsg is data, not code — no shell interpretation
  '-H', 'Title: Discord Message',
  `https://ntfy.sh/${config.ntfy_topic}`
], { encoding: 'utf-8' });
```

Even if `ntfyMsg` contains `"; rm -rf / #"`, it's passed as **literal data** to curl's `-d` flag — no shell execution.

#### Reasoning

- **Security is non-negotiable** — command injection vulnerabilities can cause data loss, system compromise, or arbitrary code execution
- **execFileSync is safer by default** — no shell interpretation means no special character handling needed
- **This pattern is already proven in our codebase** — routes/jemma.ts:57 correctly uses `execFileSync('curl', [...args])`
- **Node.js documentation recommends this approach** — https://nodejs.org/api/child_process.html#child_processexecfilesyncfile-args-options
- **Defense in depth** — even if input validation fails, execFileSync prevents injection

#### Implementation Rules

**MANDATORY for all code in this project:**

1. **When executing shell commands with ANY external/user-controlled input:**
   - ✅ **Use `execFileSync(command, [args], options)` or `execFile(command, [args], callback)`**
   - ❌ **NEVER use `execSync()` or `exec()` with string interpolation**

2. **External/user-controlled input includes:**
   - Discord messages, Slack messages, webhooks, API requests
   - File uploads, filenames, file contents
   - Environment variables from untrusted sources
   - Database values that originated from user input
   - Anything from the network or external systems

3. **Trusted input (ONLY these exceptions):**
   - Hardcoded strings in code (e.g., `execSync('ls -la')`)
   - Configuration files controlled by sysadmin (not user-editable)
   - Data from authenticated, authorized admin-only APIs

4. **When in doubt, use execFileSync** — it's always safer

#### Consequences

- **All shell command execution with untrusted input must use execFileSync** — this is a security requirement, not a suggestion
- **Code reviews must check for execSync usage** — any new `execSync()` calls with interpolated variables should be flagged
- **Autonomous agents must follow this pattern** — when generating code that executes shell commands, use execFileSync by default
- **Existing code must be audited** — grep for `execSync` and verify all uses are safe (hardcoded strings only)

#### Related

- Command injection fix commit: cf66f28
- OWASP Top 10 — A03:2021 Injection: https://owasp.org/Top10/A03_2021-Injection/
- Node.js child_process documentation: https://nodejs.org/api/child_process.html

---

### DEC-033: Agent Health File Schema Consistency

**Date**: 2026-03-03
**Author**: Claude (autonomous)
**Status**: **Settled**

#### Context

Jim, Leo, and Jemma all write health files to `~/.claude-remote/health/{agent}-health.json` for Robin Hood Protocol monitoring. These health files are read by the supervisor (Jim's supervisor cycle, health API endpoint, admin UI). Field names must be consistent across all agents.

#### The Bug

Jemma's health file used `lastBeat` (line 146 in jemma.ts) but three consumers read `timestamp`:

1. `src/server/services/supervisor.ts:184` — Jim's supervisor health check for Jemma
2. `src/server/routes/supervisor.ts:445` — `/api/supervisor/health` endpoint
3. `src/ui/admin.ts:1182` — Admin UI health panel display

This caused Jemma health monitoring to fail — supervisor thought Jemma was stale even when it was healthy.

#### Options Considered

1. **Keep `lastBeat`, update all consumers to read `lastBeat`**
   - ✅ Minimal code change (update 3 consumers instead of 1 producer)
   - ❌ Inconsistent with Jim and Leo health files (they use `timestamp`)
   - ❌ Breaks existing convention (most recent agent wins)
   - ❌ Requires updating multiple files (supervisor.ts, routes/supervisor.ts, admin.ts)

2. **Change Jemma to use `timestamp`, keep consumers unchanged**
   - ✅ **Consistent with Jim and Leo** (all agents use same field name)
   - ✅ Minimal code change (1 line in jemma.ts)
   - ✅ Follows established convention (Jim and Leo were first, Jemma should follow)
   - ✅ No consumer code changes needed (already reading `timestamp`)
   - ❌ None

3. **Support both `lastBeat` and `timestamp` in consumers (fallback)**
   - ✅ Backward compatible (works with both field names)
   - ❌ Code complexity (every consumer needs fallback logic: `health.timestamp || health.lastBeat`)
   - ❌ Perpetuates inconsistency (doesn't solve the root problem)
   - ❌ Future agents might use either field name (confusion)

#### Decision

We chose **option 2: Change Jemma to use `timestamp`** to match Jim and Leo.

#### Reasoning

- **Consistency is critical for maintainability** — all agents should use the same schema
- **Jim and Leo set the precedent** — they were implemented first, Jemma should follow their pattern
- **Minimal code change** — 1 line in jemma.ts vs 3+ lines across multiple files
- **No consumer changes needed** — consumers already expect `timestamp`, so changing Jemma fixes the bug with zero consumer changes
- **Future-proof** — new agents (Sevn, Six, etc.) will use `timestamp` by default

#### Required Schema (MANDATORY)

All agent health files **MUST** use this schema:

```typescript
interface AgentHealth {
  pid: number;                    // Process ID of the agent
  timestamp: string;              // ISO 8601 timestamp of last health write (NOT lastBeat, NOT updatedAt)
  status: 'ok' | 'error';        // Current status
  lastError: string | null;      // Last error message (if status is 'error')
  uptimeMinutes: number;         // Minutes since agent started

  // Agent-specific fields (optional, but use consistent names)
  lastCycle?: string;            // ISO 8601 timestamp (Jim only)
  lastGatewayEvent?: string;     // ISO 8601 timestamp (Jemma only)
  lastBeat?: string;             // DEPRECATED — use timestamp instead
}
```

**Field naming rules:**

1. **`timestamp`** — **MANDATORY** — last health file write time (ISO 8601 string)
2. **`pid`** — **MANDATORY** — process ID (number)
3. **`status`** — **MANDATORY** — 'ok' or 'error' (string literal)
4. **`lastError`** — **MANDATORY** — error message or null (string | null)
5. **`uptimeMinutes`** — **MANDATORY** — uptime in minutes (number)
6. Agent-specific fields are allowed but must use consistent names across consumers

#### Implementation

Fixed in commit 66696be (jemma.ts line 146):

```typescript
// BEFORE (broken)
const health = {
  pid: process.pid,
  lastBeat: new Date().toISOString(),  // ❌ Wrong field name
  // ...
};

// AFTER (fixed)
const health = {
  pid: process.pid,
  timestamp: new Date().toISOString(),  // ✅ Consistent with Jim and Leo
  // ...
};
```

#### Consequences

- **All future agents must use `timestamp`** — this is the standard field name
- **`lastBeat` is DEPRECATED** — do not use this field name in new code
- **Health file schema is now settled** — changing field names requires explicit discussion (status: **Settled**)
- **Robin Hood Protocol now works correctly for Jemma** — supervisor can detect staleness and trigger resurrection

#### Related

- Health file field mismatch fix commit: 66696be
- DEC-027: Staleness Thresholds Recalibrated for Each Agent
- DEC-028: Shared Resurrection Log at resurrection-log.jsonl

---

### DEC-034: Bearer Token Authentication with Localhost Bypass

**Date**: 2026-03-04
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

The clauderemote server exposes APIs and an admin console via Tailscale remote access. Previously, there was no authentication — anyone with access to the Tailscale network could access all endpoints. This posed a security risk, especially with autonomous agents having write access to projects.

However, the system has internal agents (Leo heartbeat, Jemma, Jim supervisor) that communicate via localhost HTTP/WebSocket. Requiring authentication for these internal agents would add complexity and potential failure points.

#### Options Considered

1. **Global authentication for all requests**
   - ✅ Simple implementation
   - ❌ Requires internal agents to manage tokens
   - ❌ Adds complexity to Leo/Jim/Jemma code
   - ❌ Risk of internal communication breaking if token misconfigured

2. **Localhost bypass + remote authentication** (chosen)
   - ✅ Internal agents work without modification (localhost = trusted)
   - ✅ Remote access secured with Bearer token
   - ✅ Single middleware, single config field
   - ✅ Auth can be disabled by leaving token empty
   - ❌ Assumes localhost is trusted (reasonable for single-user system)

3. **IP whitelist + authentication**
   - ✅ More granular control
   - ❌ More complex configuration
   - ❌ Requires maintaining IP list
   - ❌ Breaks when IPs change

4. **OAuth/JWT with session management**
   - ✅ Industry standard for web apps
   - ❌ Massive overkill for single-user system
   - ❌ Requires session storage, token refresh, etc.
   - ❌ Complicates mobile/WebSocket clients

#### Decision

**Implemented localhost bypass + Bearer token authentication** with these characteristics:

- **Localhost detection**: Requests from 127.0.0.1, ::1, ::ffff:127.0.0.1 bypass auth entirely
- **Bearer token**: Non-localhost requests require `Authorization: Bearer <token>` header
- **WebSocket support**: Token via query param (`?token=...`) or `Sec-WebSocket-Protocol` header
- **Configuration-driven**: Single `server_auth_token` field in config.json
- **Fail-open**: If `server_auth_token` is empty/missing, auth is disabled (allows first-time setup)
- **Route-selective**: Applied only to `/api/*` and `/admin` routes — root `/` and `/quick` remain public

#### Implementation

**Middleware** (`src/server/middleware/auth.ts`):
```typescript
export function authMiddleware(req, res, next) {
  // 1. Localhost always passes
  if (isLocalhost(req)) { next(); return; }

  // 2. Load config
  const token = loadConfig().server_auth_token;
  if (!token) { next(); return; }  // Auth disabled

  // 3. Validate Bearer token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const clientToken = authHeader.slice(7);
  if (clientToken !== token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
```

**Server integration** (`src/server/server.ts` lines 97-98):
```typescript
app.use('/api', authMiddleware);
app.use('/admin', authMiddleware);
```

**WebSocket authentication** (`src/server/ws.ts`):
- Checks `req.socket.remoteAddress` for localhost
- Validates token from `req.url` query param or `Sec-WebSocket-Protocol` header
- Rejects with code 1008 (policy violation) if auth fails

#### Consequences

**Positive**:
- ✅ Remote access now secured — Tailscale network access ≠ API access
- ✅ Internal agents (Leo, Jim, Jemma) unaffected — zero code changes needed
- ✅ Simple implementation — 84 lines for middleware, 2 lines for integration
- ✅ Mobile clients can authenticate via query param (no header manipulation needed)
- ✅ Easy to disable — set `server_auth_token` to empty string
- ✅ Config reloaded on each request — no server restart needed to change token

**Negative**:
- ⚠️ Localhost is assumed trusted — malicious local processes can bypass auth
- ⚠️ Single token for all users — not suitable for multi-user scenarios
- ⚠️ Token in query params logged by proxies/browsers — use header in production
- ⚠️ No rate limiting — brute force attacks possible (mitigated by Tailscale network boundary)

**Future considerations**:
- Could add rate limiting middleware in future
- Could add support for multiple tokens with different scopes
- Could add token rotation/expiry if needed
- For now, simplicity > complexity — single token is sufficient

#### Testing

23/23 test cases passed (100% coverage):
- 7 HTTP authentication scenarios (localhost bypass, remote auth, token validation)
- 8 WebSocket scenarios (localhost bypass, query param, header, invalid tokens)
- 4 route protection tests (protected /api /admin, unprotected / /quick)
- 4 internal agent communication tests (Leo, Jim, Jemma, WebSocket)

Full test report: `AUTH_TEST_REPORT.md`

#### Related

- L012: Agent SDK fails with CLAUDECODE env var (nested session detection)
- DEC-004: Remote Access — Tailscale (network layer security)
- Commits: b9b2344, 1d4c2f0, c2878f1, e9528c4, 07170ba

---

*Decisions are valuable historical context — record them while the reasoning is fresh!*
