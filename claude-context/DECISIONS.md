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
     - `cli-active` file removal → waits 3s → runs deferred cycle
     - `jim-wake-{timestamp}` file creation → runs deferred cycle immediately
   - Called from `initSupervisor()` during worker process initialisation
   - Error handling with try/catch and logging

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
