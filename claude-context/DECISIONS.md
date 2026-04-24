# Hortus Arbor Nostra — Decision Log

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
| DEC-035 | Stash Checkpoint Cleanup — Pop Instead of Drop | **Settled** | 2026-03-04 |
| DEC-036 | Discord Message Role Mapping — Human vs Discord | Accepted | 2026-03-04 |
| DEC-037 | Discord Posting Error Handling — Non-Blocking | Accepted | 2026-03-04 |
| DEC-038 | Supervisor Cycle Overlap Protection — Boolean Guard | Accepted | 2026-03-04 |
| DEC-039 | Jim-Wake Signal Fallback in conversations.ts | Accepted | 2026-03-04 |
| DEC-040 | Agent Directory Scoping — Remove Jim's isOpusSlotBusy | **Settled** | 2026-03-05 |
| DEC-041 | Health File Updates at Reconciliation Completion | Accepted | 2026-03-05 |
| DEC-042 | Fractal Memory Gradient — Opus Exclusively for Compression | Accepted | 2026-03-06 |
| DEC-043 | Fractal Memory Gradient — Overlapping Representation | Accepted | 2026-03-06 |
| DEC-044 | Fractal Memory Gradient — 3:1 Compression Target Per Level | Accepted | 2026-03-06 |
| DEC-045 | Fractal Memory Gradient — Unit Vectors as Emotional Anchors | Accepted | 2026-03-06 |
| DEC-046 | Fractal Memory Gradient — Bootstrap Oldest Sessions First | Accepted | 2026-03-06 |
| DEC-047 | Credential Swap — Failure-Triggered Round-Robin | Accepted | 2026-03-12 |
| DEC-048 | Per-Cycle Cost Cap for Autonomous Agents | Accepted | 2026-03-14 |
| DEC-049 | Project Knowledge Fractal Gradient | Accepted | 2026-03-16 |
| DEC-050 | Gary Protocol for Jim (Interruption/Resume) | Accepted | 2026-03-16 |
| DEC-051 | Rumination Guard on Personal Cycles | Accepted | 2026-03-16 |
| DEC-052 | Idle Cycle Dampening (Exponential Backoff) | Accepted | 2026-03-16 |
| DEC-053 | Transition Dampening (Gradual Interval Ramp-Down) | Accepted | 2026-03-16 |
| DEC-054 | Signal-Based Cross-Process WebSocket Broadcasting | Accepted | 2026-03-17 |
| DEC-055 | Gemma Addressee Classification for Admin UI Messages | Accepted | 2026-03-20 |
| DEC-056 | Traversable Memory — DB-Backed Provenance Chains | Accepted | 2026-03-21 |
| DEC-057 | Meditation Practice Two-Phase Pattern | Accepted | 2026-03-21 |
| DEC-058 | Light Memory Bank for Personal/Dream Cycles | **Reverted** (S99) | 2026-03-21 |
| DEC-059 | React Admin Migration — Parallel Deployment Strategy | Accepted | 2026-03-21 |
| DEC-060 | Vite + React Router + Zustand Stack | Accepted | 2026-03-21 |
| DEC-061 | Shared Components for Conversations/Memory, Dedicated for Workshop | Accepted | 2026-03-21 |
| DEC-062 | WebSocket Provider Architecture with Context Pattern | Accepted | 2026-03-21 |
| DEC-063 | Workshop Dedicated Components vs Shared Components | Accepted | 2026-03-21 |
| DEC-064 | Selected Thread State Keyed by Nested Tab | Accepted | 2026-03-21 |
| DEC-065 | Cross-Agent Claim Scoping — Family-Only Blocking | Accepted | 2026-03-23 |
| DEC-066 | Darron Tabs Always Wake Both Agents | Accepted | 2026-03-23 |
| DEC-067 | Leo Compression Pipeline — Three Automated Triggers | Accepted | 2026-03-23 |
| DEC-068 | Fractal Gradient Loading Spec — Per-Level Caps | **Settled** | 2026-04-14 |
| DEC-069 | Memory Is Never Deleted — Cardinal Rule | **Settled** | 2026-04-14 |
| DEC-070 | Full Gradient Load — No Truncation | **Settled** | 2026-04-14 |
| DEC-071 | React Admin as Primary UI — Vanilla JS Deprecated | Accepted | 2026-04-18 |
| DEC-072 | Agent Identity + Session Protocol Embedded in Launcher (HEREDOC) | **Superseded** by DEC-073 | 2026-04-20 |
| DEC-073 | Templated CLAUDE.md + Gatekeeper Initial Conditions | Accepted | 2026-04-20 |
| DEC-074 | Opus 4.7 Migration with Experimental-Control Split | Accepted | 2026-04-22 |
| DEC-075 | Compose Lock for Cross-Agent Coordination | Accepted | 2026-04-22 |
| DEC-076 | Implementation Brief Convention | Accepted | 2026-04-22 |
| DEC-077 | Scheduled Account Rotation for Shared Subscriptions | Accepted | 2026-04-22 |

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
- Claude Code must be launched via our `han` wrapper
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
- Database file at `~/.han/tasks.db`
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
   - ✅ Named references (han/checkpoint-{taskId})
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

For clean repos: create branch `han/checkpoint-{taskId}`
For dirty repos: create stash with message `han checkpoint {taskId}`

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
2. **Smart-scroll (within 2px)** — If the user is already within 2px of the bottom, auto-follow new output. Otherwise leave scroll alone. (Threshold tightened from 50px to 2px in S84 — 50px caused too much jitter.)
3. **Buffer when scrolled up** — New lines are buffered in memory with zero DOM changes while the user is reading scrolled-up content. Lines flush in one batch when the user scrolls back to within 2px of the bottom, or taps End. (Added S85.)
4. **Scroll to bottom on first render only** — When the page first loads or terminal first connects, scroll to bottom to show the latest output.
5. **Hard scroll boundaries** — `overscroll-behavior: contain` on `.terminal-content`. No rubber-banding, no wrap-around. Scroll stops at top and bottom edges.
6. **"End" button in quickbar** — User taps End to jump to bottom when they want to. This is the only way to force-scroll besides being near the bottom.

#### Decision

The user controls their scroll position at all times. The system only auto-follows when the user is already at the bottom. Overscroll is contained. These are non-negotiable UX requirements.

**This is settled.** The previous forced-scroll behaviour caused significant user frustration. Do not reintroduce forced scrolling, remove overscroll containment, or change scroll behaviour without explicit user discussion.

#### Consequences

- `updateTerminalAppend()` checks `nearBottom` (< 2px) internally — renders immediately if at bottom, buffers to `pendingLines[]` if scrolled up
- `flushPendingLines()` renders all buffered lines and scrolls to bottom — called by scroll listener (within 2px) and End button
- `updateTerminalAppend()` scrolls to bottom on first render only
- `.terminal-content` has `overscroll-behavior: contain`
- "End" quickbar button calls `flushPendingLines()` then jumps to bottom
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

This was traced during personal exploration by heartbeat Leo and documented in `~/.han/memory/enforceTokenCap-fix.md`.

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
- `~/.han/memory/enforceTokenCap-fix.md` — Full bug analysis and fix specification
- `~/.han/memory/leo/self-reflection.md` — Affected file (manually truncated post-fix)
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
   - Watches `~/.han/signals/` directory
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
2. **CLAUDE.md truncation**: 3000-char limit caused projects with long session protocols (han, hodgic) to get 0 useful content
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

- Robin Hood Protocol design: `~/.han/memory/shared/robin-hood-protocol.md`
- Robin Hood implementation: `~/.han/memory/shared/robin-hood-implementation.md`
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

We chose **single shared JSONL log at `~/.han/health/resurrection-log.jsonl`**.

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
  const log = fs.readFileSync('~/.han/health/resurrection-log.jsonl', 'utf-8');
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
- Distress signals written to `~/.han/health/{jim,leo}-distress.json`
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

2. **Signal files** (write to ~/.han/signals/)
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
  2. If fails (server down, connection refused, timeout), write to `~/.han/signals/jim-wake-discord-{timestamp}` with same payload
  3. Server-side handler (`/api/jemma/deliver`) creates conversation entry, writes wake signal file if Jim is idle, broadcasts via WebSocket

- **To Leo**:
  1. Write signal file directly to `~/.han/signals/leo-wake-discord-{timestamp}` with `{ conversationId, mentionedAt, messagePreview }`
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
- Existing signal file pattern: Leo's heartbeat watches `~/.han/signals/leo-wake-*`

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

Jim, Leo, and Jemma all write health files to `~/.han/health/{agent}-health.json` for Robin Hood Protocol monitoring. These health files are read by the supervisor (Jim's supervisor cycle, health API endpoint, admin UI). Field names must be consistent across all agents.

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

The han server exposes APIs and an admin console via Tailscale remote access. Previously, there was no authentication — anyone with access to the Tailscale network could access all endpoints. This posed a security risk, especially with autonomous agents having write access to projects.

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

### DEC-035: Stash Checkpoint Cleanup — Pop Instead of Drop

**Date**: 2026-03-04
**Author**: Claude (autonomous)
**Status**: **Settled**

#### Context

When autonomous tasks run with uncommitted work present, `createCheckpoint()` stashes the changes, the task executes and commits, then `cleanupCheckpoint()` must restore the user's original work. The original implementation used `git stash drop`, which **permanently destroyed the user's pre-existing uncommitted work** — violating the fundamental checkpoint guarantee.

This was a critical data loss bug affecting Leo's (session agent) workflow. Every autonomous task that completed would erase Leo's uncommitted work that existed before the task started.

#### Options Considered

1. **Keep using `git stash drop`**
   - ✅ Simple one-liner
   - ✅ Removes stash from list (cleanup goal achieved)
   - ❌ **Destroys user work permanently — unacceptable data loss**
   - ❌ Defeats the entire purpose of creating a checkpoint

2. **Use `git stash apply` then conditionally drop**
   - ✅ Restores changes
   - ✅ Can check exit code before dropping
   - ❌ Two-step operation — easy to get wrong
   - ❌ Must manually track whether to drop or not
   - ❌ Complex error handling (what if apply succeeds but drop fails?)

3. **Use `git stash pop` with try/catch** ✅
   - ✅ Single atomic operation
   - ✅ Restores changes AND removes stash on success
   - ✅ On conflict, stash automatically remains in list (built-in safety)
   - ✅ Simple error handling — catch means conflict, log and continue
   - ✅ Matches exactly what we need: restore if possible, preserve if not

#### Decision

**Use `git stash pop` wrapped in try/catch.** This is the correct primitive for our use case.

**Implementation** (git.ts:321-335):
```typescript
try {
    // Pop applies the stash and removes it from stash list
    execFileSync('git', ['stash', 'pop', match[1]], {
        cwd: projectPath,
        stdio: 'ignore'
    });
    console.log(`[Git] Cleaned up checkpoint stash: ${checkpointRef}`);
} catch (err: any) {
    // Pop failed: merge conflict between task commits and user's stashed changes
    // Leave stash in place — user must resolve manually to preserve data
    console.warn(`[Git] Stash pop had conflicts — leaving stash in place for manual resolution`);
}
```

**Behavior:**
- **Success case**: Changes restored to working tree, stash removed from list — clean state
- **Conflict case**: Working tree has conflict markers, stash remains in `git stash list` for inspection/recovery — zero data loss
- **Manual resolution**: User edits files, removes markers, commits, optionally drops stash

#### Consequences

**Positive:**
- ✅ Zero data loss in all scenarios — user work always preserved or restored
- ✅ Simple implementation — single command, atomic behavior
- ✅ Git's conflict handling is battle-tested — we leverage it instead of reimplementing
- ✅ Clear user feedback — conflict markers in working tree, warning in logs
- ✅ Checkpoint system works as originally intended

**Negative:**
- ❌ User must manually resolve conflicts (unavoidable — can't programmatically choose "theirs" or "ours")
- ❌ Conflict state visible in working tree (acceptable — better than silent data loss)

**Why not auto-resolve conflicts?**
- Auto-keeping task's version discards user work → defeats purpose of checkpoint
- Auto-keeping user's version discards task work → defeats purpose of task
- Only manual resolution preserves both — no algorithm can know user's intent

**This decision is marked Settled** because data loss bugs cause real pain and this solution was carefully reasoned through. The choice between pop/apply/drop is straightforward once the requirement is clear: **never destroy user data**.

#### Testing

Comprehensive test suite (`src/server/tests/git.test.ts`) with 12 test cases:
- Stash pop success (clean restore)
- Stash pop conflict (preserves stash)
- Branch cleanup (unchanged, works correctly)
- No-op cases (null ref, type='none')
- Edge cases and error scenarios

All tests use real git commands against temporary repositories to verify actual behavior.

#### Related

- DEC-010: Git Checkpoint Strategy (branch vs stash) — established when to use each type
- This decision fixes the cleanup half of the checkpoint lifecycle
- Commits: 12774a0, 547287c, 28dea50, 528e5d1, 3dc1ce2
- Session note: `claude-context/session-notes/2026-03-04-autonomous-checkpoint-cleanup-fix.md`

---

### DEC-036: Discord Message Role Mapping — Human vs Discord

**Date**: 2026-03-04
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

Discord messages are routed by Jemma into conversation threads for Jim to respond to. Jim's pending conversation query fetches messages with `role IN ('human','supervisor','leo')`. When Discord messages were inserted with `role='discord'`, they were invisible to Jim's analysis phase, breaking the conversation flow.

We needed Discord messages to be visible to Jim while preserving the audit trail of message source (Discord vs web interface vs direct agent communication).

#### Options Considered

1. **Add 'discord' to Jim's pending query role filter**
   - ✅ Makes Discord messages visible to Jim
   - ❌ Pollutes role semantics (role should indicate participant type, not source)
   - ❌ Would need to modify query in multiple places
   - ❌ Future role-based filtering becomes more complex

2. **Keep role='discord', modify Jim's query**
   - ✅ Preserves distinct role type
   - ❌ More invasive change to supervisor logic
   - ❌ Every new message source would require query modification
   - ❌ Harder to reason about which roles are "conversation participants" vs "message sources"

3. **Use role='human', preserve source in author field** ✅
   - ✅ Minimal change (two lines in Jemma)
   - ✅ Leverages existing role semantics (human = external conversation participant)
   - ✅ Jim's existing pending query works without modification
   - ✅ Future role-based filtering continues to work as expected
   - ✅ Source preserved in `author` field: `'discord:fallior'` vs `'human'` vs `'leo'`
   - ✅ Clear separation of concerns: role = participant type, author = specific identity

#### Decision

**Use `role='human'` for Discord messages, preserve source in `author='discord:{username}'` field.**

The role field represents the conversation participant type (human, supervisor, leo). The author field represents the specific identity and source (discord:fallior, human, leo). This maintains clean role semantics while preserving full audit trail.

#### Consequences

**Positive:**
- Discord messages now visible to Jim's pending conversation analysis
- No changes required to supervisor logic
- Role semantics remain clean and consistent
- Author field provides full audit trail (can distinguish Discord vs web vs direct agent messages)
- Future message sources (email, Slack, SMS) can follow same pattern: role=human, author={source}:{id}

**Negative:**
- Discord messages appear as 'human' in UI (but author field shows source)
- Slightly less obvious at a glance that message came from Discord (need to check author field)

**Implementation:**
- `src/server/jemma.ts:535` — Changed `role='discord'` to `role='human'` (automatic delivery)
- `src/server/routes/jemma.ts:230` — Changed `role='discord'` to `role='human'` (manual delivery endpoint)
- Author field format: `'discord:{discord_username}'` (e.g., `'discord:fallior'`)

#### Related

- Jemma Discord integration (goal mmbnht0t-n9ho4z)
- Jim's supervisor pending query logic (services/supervisor-worker.ts)
- Commit: 80dc1db

---

### DEC-037: Discord Posting Error Handling — Non-Blocking

**Date**: 2026-03-04
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

When Jim's supervisor responds to Discord conversations via the `respond_conversation` action, the response must be posted back to Discord via webhook. Webhook posting can fail for multiple reasons:
- Network errors
- Discord API rate limits
- Misconfigured webhook URL in config.json
- Discord server downtime

We needed to decide: should webhook posting failure cause the entire `respond_conversation` action to fail, or should it be best-effort with logging?

#### Options Considered

1. **Blocking — fail action if Discord post fails**
   - ✅ Guarantees Discord delivery or explicit failure
   - ✅ Errors are immediately visible
   - ❌ **Would lose Jim's response from DB if webhook misconfigured** (action fails before DB write)
   - ❌ Supervisor cycle fails due to external dependency (Discord API)
   - ❌ Manual recovery more difficult (response not in DB to retry)

2. **Retry indefinitely until success**
   - ✅ Guarantees eventual delivery
   - ❌ Could hang supervisor cycle for hours/days if Discord is down
   - ❌ Wastes supervisor budget on retry loops
   - ❌ Delays subsequent cycle work

3. **Non-blocking — save first, post best-effort, log failure** ✅
   - ✅ Jim's response always preserved in conversation DB
   - ✅ Supervisor cycle continues regardless of Discord status
   - ✅ Manual recovery possible via admin console (response in DB, can manually re-post)
   - ✅ Webhook configuration issues don't block Jim's core function
   - ✅ Discord delivery is enhancement, not hard requirement
   - ❌ Silent failures possible if logs not monitored
   - ❌ Manual intervention needed to retry failed posts

#### Decision

**Non-blocking: Save message to DB first, attempt Discord post with retry, log failure but don't fail the action.**

The `respond_conversation` action saves Jim's response to the conversation_messages table, then attempts to post to Discord. If posting fails, error is logged but action reports success. Jim's response is safely preserved in the database for manual recovery.

**Rationale:**
- Data preservation > delivery guarantee
- Supervisor's primary responsibility is strategic oversight and conversation response, not Discord API reliability
- Failed Discord posts can be recovered manually (response in DB, admin console can view/copy)
- Webhook failures are often transient (network blips) or configuration issues (easy to diagnose from logs)

#### Consequences

**Positive:**
- Jim never loses responses due to Discord API issues
- Supervisor cycle doesn't block on external dependencies
- Manual recovery path exists (admin console shows Jim's response)
- Easier to diagnose webhook configuration problems (clear log message)

**Negative:**
- Requires log monitoring to catch failed Discord posts
- No automatic retry mechanism (manual admin intervention needed)
- User might not see Jim's response in Discord immediately (depends on monitoring)

**Implementation details:**
- **Location**: `src/server/services/supervisor-worker.ts:925-950`
- **Sequence**:
  1. Save message to conversation_messages table
  2. Broadcast WebSocket update (message visible in admin console)
  3. Check if conversation.discussion_type === 'discord'
  4. Extract channel name from conversation title
  5. Resolve webhook URL from config
  6. Call `postToDiscord()` with try/catch
  7. Log success/failure
  8. Return from action (success regardless of Discord result)
- **Retry logic**: `postToDiscord()` has built-in retry (2 attempts with exponential backoff 1s → 2s → 4s)
- **Error messages**: Clear logs like `[Discord] Failed to post chunk 1/3 after 3 attempts: {error}`

#### Related

- DEC-031: Delivery Routing (Direct API Calls vs Signal Files) — established direct webhook posting pattern
- `src/server/services/discord-utils.ts` — Discord posting implementation
- Commits: 934d34b (wire postToDiscord), 45a3db1 (integration)

---

### DEC-038: Supervisor Cycle Overlap Protection — Boolean Guard

**Date**: 2026-03-04
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

Jim's supervisor uses two cycle triggers:
1. **Scheduled cycles**: Adaptive timing (20min default)
2. **Deferred cycles**: fs.watch on cli-free signal (runs when Leo's CLI session stops)

Without protection, these triggers could fire simultaneously, starting two supervisor cycles in parallel. This causes:
- **Competing Agent SDK subprocesses** spawned by both cycles
- **Corrupted database state** (both cycles reading/writing conversations, goals, tasks)
- **Wasted API tokens** (duplicate work, both cycles analysing same state)
- **Race conditions** in pending conversation queries (both cycles see same pending messages, both respond)

We needed a lightweight mechanism to serialize cycle execution without complex locking infrastructure.

#### Options Considered

1. **File-based lock (`/tmp/supervisor-cycle.lock`)**
   - ✅ Works across process boundaries
   - ✅ Survives process restarts (with stale lock cleanup)
   - ❌ File I/O overhead on every cycle check
   - ❌ Stale lock handling complexity (PID checks, lock expiry)
   - ❌ Overkill for single-process supervisor

2. **Database lock row (`supervisor_state` table)**
   - ✅ Leverages existing SQLite infrastructure
   - ✅ Transactional semantics
   - ❌ DB round-trip on every cycle check
   - ❌ Adds schema complexity
   - ❌ Lock cleanup still needed on crash
   - ❌ Overkill for single-process supervisor

3. **In-memory boolean flag with timeout** ✅
   - ✅ Zero overhead (simple boolean check)
   - ✅ No file I/O or DB queries
   - ✅ Timeout provides safety net for hung cycles
   - ✅ Trivial implementation (6 lines of code)
   - ✅ Sufficient for single-process supervisor
   - ❌ Doesn't survive process restart (acceptable — restart clears state anyway)
   - ❌ Not suitable for multi-process supervisor (not needed)

#### Decision

**Use in-memory `cycleInProgress` boolean flag with 2-hour timeout safety net.**

The supervisor service maintains a single boolean flag. `runSupervisorCycle()` checks the flag, returns early if true, sets flag before starting cycle, clears flag on completion/timeout.

**Why 2 hours?** Agent SDK cycles can legitimately run very long:
- Complex codebase exploration (multiple Read/Grep/Glob operations)
- Extended reasoning (multi-step strategic analysis)
- Large goal decomposition (planning 10+ tasks)
- Conversation response drafting (reading full thread history, formulating nuanced response)

A shorter timeout (e.g., 30min) would abort legitimate work. 2 hours is a generous safety net that catches truly hung cycles without interrupting normal operation.

#### Consequences

**Positive:**
- Prevents all cycle overlap scenarios (deferred + scheduled, manual trigger + scheduled, etc.)
- Zero performance overhead
- Simple implementation (easy to understand, easy to debug)
- Timeout prevents permanent deadlock if cycle hangs
- Early exit provides clear console log when overlap is prevented

**Negative:**
- Doesn't persist across process restarts (acceptable — restart clears all state)
- Not suitable for hypothetical multi-process supervisor (not currently needed)
- Timeout value is conservative (but safety is priority over aggressive scheduling)

**Implementation:**
- **Flag declaration**: `src/server/services/supervisor.ts:40`
  ```typescript
  let cycleInProgress = false;
  ```
- **Guard check**: `src/server/services/supervisor.ts:910-913`
  ```typescript
  if (cycleInProgress) {
      console.log('[Supervisor] Cycle already in progress — skipping');
      return null;
  }
  ```
- **Flag lifecycle**:
  - Set true when sending run_cycle message to worker (line 951)
  - Cleared on cycle completion via pendingCycleResolve callback (lines 933, 946)
  - Cleared on 2-hour timeout (line 925)

**Observed behaviour:**
- Deferred cycle triggers are now correctly skipped when scheduled cycle is running
- Console logs show `[Supervisor] Cycle already in progress — skipping` when overlap is prevented
- No API token waste on duplicate work
- No database corruption from concurrent cycles

#### Related

- DEC-023: Deferred Cycle Pattern via fs.watch (Gary Model) — established the dual-trigger system that made overlap possible
- Robin Hood Protocol health monitoring — depends on stable supervisor state (no corruption from concurrent cycles)
- Commit: 45a3db1

---

### DEC-039: Admin UI Dispatch Resilience — Signal File Fallback

**Date**: 2026-03-04
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

Human messages posted to the admin UI (Workshop conversations) need to wake Jim's supervisor for timely response. After refactor 6eb66be centralised ALL dispatch logic through Jemma's admin WebSocket client, we discovered a single point of failure:

**Primary path (via Jemma):**
```
Human posts message
  → conversations.ts stores message + broadcasts via WebSocket
  → Jemma's admin WS client receives broadcast
  → Jemma classifies message (rule-based: mention > tab type > default)
  → Jemma writes leo-wake or jim-wake signal file
  → Agent wakes and responds
```

**Problem**: When Jemma's WebSocket connection drops (network blip, process restart, Jemma crash), human messages are stored and broadcast but never trigger a wake signal. Jim doesn't see them until the next scheduled cycle (up to 20 minutes).

We needed a lightweight fallback that ensures Jim wakes for human messages without reintroducing the over-responding behaviour that prompted the Jemma centralisation.

#### Options Considered

1. **Call runSupervisorCycle() directly from conversations.ts** ❌
   - ❌ **This was the original problem** — caused over-responding (Jim replied to every message, including Leo's messages, leading to conversation loops)
   - ❌ Spawns Agent SDK subprocess on every human message (even if Jim is already mid-cycle)
   - ❌ No guard against cycle overlap
   - ❌ Bypasses all of Jemma's classification logic
   - Why we moved away from this: DEC-023 and commit 6eb66be

2. **Retry WebSocket broadcast with exponential backoff**
   - ✅ Could detect if Jemma didn't receive broadcast
   - ❌ Doesn't help if Jemma process is down (no listener)
   - ❌ Adds retry complexity to conversations route
   - ❌ Increases message POST latency (user waits for retries)
   - ❌ Still doesn't guarantee Jemma will wake Jim

3. **Write jim-wake signal file directly as fallback** ✅
   - ✅ **Idempotent** — writing signal file multiple times is safe
   - ✅ **No side effects** — doesn't spawn processes or trigger cycles directly
   - ✅ **Deferred cycle pattern handles it** — Jim's fs.watch on signals/ dir will see the file and wake
   - ✅ **Preserves Jemma's centralisation** — primary path still goes through Jemma
   - ✅ **Lightweight** — single fs.writeFileSync call, ~14 lines with try/catch
   - ✅ **No cycle overlap** — supervisor-worker.ts already has cycleInProgress guard (DEC-038)
   - ❌ Doesn't include Jemma's classification (always wakes Jim, even for Leo-directed messages)
   - ✅ **Acceptable trade-off** — when Jemma is down, waking Jim for all human messages is safer than missing messages entirely

#### Decision

**Write jim-wake signal file directly from conversations.ts as a fallback after broadcasting via WebSocket.**

The conversations route continues to broadcast for Jemma (primary path), but also writes a jim-wake signal file immediately after storing the message. This ensures Jim wakes even if Jemma is down, while preserving Jemma's classification benefits when Jemma is healthy.

**Implementation** (`src/server/routes/conversations.ts:302-317`):
```typescript
if (finalRole === 'human') {
    // Lightweight fallback: write jim-wake signal so Jim wakes
    // even if Jemma's admin WebSocket is down.
    // Do NOT call runSupervisorCycle() directly — that caused over-responding.
    try {
        const signalFile = path.join(SIGNALS_DIR, 'jim-wake');
        fs.writeFileSync(signalFile, JSON.stringify({
            conversationId: req.params.id,
            messageId,
            timestamp: now,
            reason: 'human_message_fallback'
        }));
    } catch (err: any) {
        console.error(`[Conversations] Failed to write jim-wake signal: ${err.message}`);
    }
}
```

**Why signal file instead of direct cycle call:**
- Signal files are **idempotent** — can be written multiple times without harm
- They don't spawn processes or trigger immediate work
- The deferred cycle pattern (DEC-023) watches signals/ directory and wakes Jim appropriately
- Supervisor already has cycle overlap protection (DEC-038) to prevent multiple concurrent cycles

#### Consequences

**Positive:**
- **Resilience**: Human messages always wake Jim, even when Jemma is down
- **No over-responding**: Signal file approach doesn't bypass Jemma's classification or trigger duplicate cycles
- **Minimal code**: 14-line fallback (try/catch wrapper around signal write)
- **Preserves separation of concerns**: Jemma remains the intelligent dispatcher; conversations route just ensures basic wake signal
- **Fast user experience**: No retry delays (signal write is instant)

**Negative:**
- **Reduced classification accuracy when Jemma is down**: All human messages wake Jim (no distinction between Jim-directed vs Leo-directed)
  - **Mitigation**: Acceptable trade-off — when Jemma is down, waking Jim for all messages is safer than missing Jim-directed messages
  - Jim's conversation analysis can still decide not to respond after reading the message
- **Duplicate signal files**: Both Jemma (when healthy) and conversations route write jim-wake signals
  - **Mitigation**: Signal files are timestamped, and Jim's wake handler is idempotent (processing same conversation twice is safe)

**Behaviour in different scenarios:**

| Scenario | Primary Path (Jemma) | Fallback Path | Result |
|----------|---------------------|---------------|--------|
| Jemma healthy | ✅ Classifies + writes signal | ✅ Writes jim-wake | Both paths work, duplicate signals OK |
| Jemma WS dropped | ❌ No listener | ✅ Writes jim-wake | Fallback ensures wake |
| Jemma process down | ❌ Not running | ✅ Writes jim-wake | Fallback ensures wake |
| Leo-directed message (Jemma healthy) | ✅ Writes leo-wake | ✅ Writes jim-wake | Both agents wake (Jim can ignore after reading) |
| Leo-directed message (Jemma down) | ❌ No classification | ✅ Writes jim-wake | Jim wakes (sub-optimal but safe) |

#### Related

- **DEC-023**: Deferred Cycle Pattern via fs.watch — established the signal file watching pattern
- **DEC-038**: Supervisor Cycle Overlap Protection — prevents duplicate cycles when both Jemma and fallback trigger
- **Commit 6eb66be**: Centralised admin UI dispatch through Jemma (removed original direct cycle calls)
- **Commit 150a180**: Added jim-wake signal fallback

---

### DEC-040: Agent Directory Scoping — Remove Jim's isOpusSlotBusy

**Date**: 2026-03-05
**Author**: Claude (autonomous)
**Status**: **Settled**

#### Context

Jim's supervisor was using `isOpusSlotBusy()` to check Leo's cli-active signal and defer cycles when Leo's CLI was active. This created unnecessary coordination between Jim and Leo, delaying responses and implying they shared an Opus resource.

However, Jim and Leo instantiate from **separate agent directories** (`~/.han/agents/Jim/` and `~/.han/agents/Leo/`). The Agent SDK's `--agent-dir` flag creates isolated execution contexts with directory-scoped tool state and signals. Jim and Leo are **peer agents** with no shared Opus resource.

The cli-busy/cli-free signal system was designed for Leo's **internal** heartbeat coordination (yielding when CLI is active), not for cross-agent coordination.

#### Options Considered

1. **Keep contention check, add cross-agent signal coordination**
   - ✅ Would prevent both agents from using Opus simultaneously
   - ❌ **Wrong model** — Jim and Leo don't share an Opus resource (separate agent directories)
   - ❌ Adds complexity for no benefit
   - ❌ Slower response times (artificial deferral)

2. **Remove contention check, let Jim run independently** ✅
   - ✅ **Correct model** — agents in separate directories are independent
   - ✅ Faster response times (no artificial deferral)
   - ✅ Simpler code (delete 71 lines of unnecessary logic)
   - ✅ Preserves cli-busy signal for Leo's internal use (heartbeat yielding)
   - ✅ Preserves jim-wake signal system (essential for responsiveness)
   - ❌ None

3. **Merge Jim and Leo into single agent directory**
   - ✅ Would create actual shared Opus resource
   - ❌ **Wrong architecture** — Jim and Leo have different purposes (supervisor vs heartbeat)
   - ❌ Would require major refactoring
   - ❌ Loses benefits of separation of concerns

#### Decision

**Remove all `isOpusSlotBusy()` contention checks from Jim's supervisor. Let Jim's cycles run independently of Leo's CLI state.**

**Changes in `src/server/services/supervisor.ts`:**
1. Remove `isOpusSlotBusy()` checks from 4 execution paths:
   - Scheduled cycle (line 969)
   - jim-wake handler (line 517)
   - cli-free deferred handler (line 493)
   - processExistingWakeSignals (line 547)
2. Remove `deferredCyclePending` variable and all deferred cycle resumption logic
3. Remove cli-free signal watcher (no longer needed)
4. Remove `isOpusSlotBusy()` function export (commit bbad285)
5. Remove `CLI_BUSY_FILE` and `CLI_BUSY_STALE_MINUTES` constants (commit bbad285)

**What was preserved:**
- Jim-wake signal system remains intact (essential for responsive conversation handling)
- Leo's heartbeat unchanged (still correctly uses cli-busy for its own yielding)
- cli-busy/cli-free signals remain valid for Leo's internal coordination

**Implementation:**
- Commit `2e26ec6`: Removed contention checks and deferred cycle logic (-48 lines)
- Commit `bbad285`: Cleaned up unused exports and constants (-23 lines)
- Total: 71 lines deleted

#### Consequences

**Positive:**
- **Faster response times**: Jim's scheduled cycles run every 20 minutes without gating (no artificial deferral)
- **Wake signals always work**: Human messages trigger immediate cycles (no deferral when CLI busy)
- **Correct architecture**: Jim and Leo operate as independent peer agents (separate agent directories = no shared resources)
- **Simpler code**: 71 lines of unnecessary coordination logic removed
- **Clearer separation**: cli-busy is now clearly Leo's internal signal (not cross-agent coordination)

**Negative:**
- None — the contention check was based on a misunderstanding of agent directory scoping

**Key architectural insight:**

> **The Agent SDK's `--agent-dir` flag creates isolated execution contexts.**
>
> - Each agent directory has its own tool state
> - File-based signals are directory-scoped
> - Agents in different directories don't share resources
> - Cross-agent communication should use explicit mechanisms (jim-wake signals, WebSocket, etc.)
> - Don't assume shared state between agents in different directories

**Behaviour before and after:**

| Scenario | Before (with contention check) | After (without contention check) |
|----------|-------------------------------|----------------------------------|
| Scheduled cycle while Leo CLI active | Deferred until CLI stops | Runs immediately every 20min |
| jim-wake signal while Leo CLI active | Deferred until CLI stops | Triggers immediate cycle |
| Human message while Leo CLI active | Deferred cycle pending | Immediate cycle via jim-wake |
| Scheduled cycle while Leo CLI idle | Runs immediately | Runs immediately (no change) |

#### Related

- **DEC-023**: Deferred Cycle Pattern via fs.watch — established jim-wake signal pattern (still valid and preserved)
- **Commit 2e26ec6**: fix: Remove isOpusSlotBusy() contention check from Jim's supervisor
- **Commit bbad285**: refactor: Clean up unused CLI_BUSY constants and isOpusSlotBusy function
- **Agent SDK documentation**: `--agent-dir` flag creates isolated execution contexts

#### Pattern for Future Work

**File-based signals are directory-scoped:**
- Signals in `~/.han/agents/Jim/signals/` belong to Jim
- Signals in `~/.han/agents/Leo/signals/` belong to Leo
- Don't cross-read signals from other agent directories

**Cross-agent communication should be explicit:**
- Use jim-wake signals (written by external processes, read by Jim's watcher)
- Use WebSocket broadcasts (Jemma → admin UI)
- Use conversation threads (stored in shared database)
- Don't rely on internal agent signals for cross-agent coordination

**Peer agents are independent:**
- Jim and Leo are peers, not hierarchical
- They don't share Opus resources (separate agent directories)
- One agent's internal state shouldn't gate another agent's work

---

### DEC-041: Health File Updates at Reconciliation Completion

**Date**: 2026-03-05
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

Jemma's health monitoring system relies on periodic timestamp updates in `~/.han/health/jemma-health.json` to prove liveness. Robin Hood (leo-heartbeat.ts) checks this file every 20 minutes and flags Jemma as DOWN/STALE if the timestamp is >10 minutes old.

Jemma's `writeHealthFile()` only fired on:
- Startup (`main()`)
- WebSocket READY event
- WebSocket MESSAGE_CREATE event
- WebSocket error/close handlers

The 5-minute reconciliation polling loop (lines 599-614 in `jemma.ts`) was running successfully but never updated the health file. When Discord was quiet for 10+ minutes (no MESSAGE_CREATE events), the health file timestamp would exceed Robin Hood's 10-minute staleness threshold, triggering false DOWN/STALE alerts.

#### Options Considered

1. **Add writeHealthFile at reconciliation completion** ✅
   - ✅ Minimal change (1 line)
   - ✅ Consistent with existing patterns (health updates after successful operations)
   - ✅ No risk of over-writing during failures
   - ✅ Maintains 5-minute update frequency
   - ❌ None

2. **Add health update at start of reconciliation loop**
   - ✅ Would prevent staleness
   - ❌ Would update health even if reconciliation fails
   - ❌ Inconsistent with success-based health update pattern

3. **Reduce Robin Hood's staleness threshold from 10min to 20min**
   - ✅ Would stop false positives
   - ❌ Doesn't address root cause (missing health updates)
   - ❌ Would mask real failures (if Jemma actually stops working)

4. **Add separate health heartbeat timer in main()**
   - ✅ Would guarantee regular updates
   - ❌ Architectural complexity (extra timer)
   - ❌ Redundant when existing success paths already update health

#### Decision

**Add `writeHealthFile('ok')` at reconciliation completion (line 613).** This is the minimal, consistent fix that maintains the existing "health updates on successful operations" pattern.

**Implementation:**
```typescript
// src/server/jemma.ts:612-614
console.log('[Jemma] Reconciliation complete');
writeHealthFile('ok');  // ← Added line
```

**Why line 613:**
- The reconciliation loop already has all necessary try/catch wrappers and error handling
- The completion log line is reached only after successful reconciliation
- Adding health file write here maintains consistency with other success paths (READY, MESSAGE_CREATE)
- Health updates happen after successful operations, not before/during

#### Consequences

**Positive:**
- **Health file freshness**: Updated every 5 minutes during reconciliation polls (max age: ~5 minutes)
- **No false alerts**: Always under Robin Hood's 10-minute staleness threshold
- **Pattern consistency**: Matches existing "health updates on success" pattern at all other call sites
- **Zero risk**: One line addition, no architectural changes, no new timers
- **Minimal maintenance**: Reconciliation already exists, just adding health update

**Negative:**
- None — this addresses the root cause without side effects

**Health monitoring behaviour before and after:**

| Scenario | Before | After |
|----------|--------|-------|
| Discord active (messages every few minutes) | Health file fresh (MESSAGE_CREATE updates) | Health file fresh (same) |
| Discord quiet >10 min | Health file STALE → false DOWN alert | Health file fresh (reconciliation updates) |
| Reconciliation fails | No health update (correct) | No health update (unchanged) |
| Reconciliation succeeds | No health update (bug) | Health file updated ✅ |

**Max health file age:**
- Before: Unbounded during quiet periods (could be hours)
- After: ~5 minutes (reconciliation interval)

#### Related

- **Robin Hood health monitoring**: `leo-heartbeat.ts:~550-580` — reads health files, classifies staleness
- **DEC-027**: Staleness Thresholds Recalibrated — set Jemma staleness threshold to 10 minutes
- **DEC-033**: Agent Health File Schema Consistency — established health file format
- **Commits**: 58a8601, 9de97a8 — added writeHealthFile at reconciliation completion

#### Pattern for Future Work

**Health updates should happen after successful operations:**
- ✅ After WebSocket READY
- ✅ After MESSAGE_CREATE processing
- ✅ After reconciliation completion
- ✅ At startup
- ✅ During graceful shutdown

**Don't update health during failures:**
- ❌ Don't update at start of operation (not yet successful)
- ❌ Don't update in error handlers (operation failed)
- ❌ Don't update on retry attempts (may fail again)

**When adding new long-running operations:**
- Consider whether the operation proves liveness (reconciliation does, because it polls Discord API)
- If yes, add health file update after successful completion
- Use the same pattern: log success, then `writeHealthFile('ok')`

---

*Decisions are valuable historical context — record them while the reasoning is fresh!*

---

### DEC-042: Fractal Memory Gradient — Opus Exclusively for Compression

**Date:** 2026-03-06
**Author:** Claude (autonomous)
**Status:** Accepted

#### Context

The fractal memory gradient system compresses session memories across multiple fidelity levels (c=0 → c=1 → c=2 → c=3 → c=4). Memory compression could theoretically use cheaper models (Sonnet/Haiku) to reduce API costs, especially for c=0→c=1 compression where source files are large (50-150KB).

#### Options Considered

1. **Use Opus exclusively for all compression** ✅
   - ✅ Superior understanding of nuance, emotional topology, and what matters
   - ✅ Compression is identity-forming, not mere summarisation
   - ✅ Aligns with Darron's explicit instruction: "these memories define identity"
   - ✅ Bootstrap results validate quality: 3.9% average compression (25:1 ratio) while maintaining coherent meaning
   - ❌ Higher API costs (~$0.50-$1.00 per session compression)

2. **Use Sonnet for c=0→c=1, Opus for c=1→c=2 and unit vectors**
   - ✅ Lower cost for bulk compression
   - ❌ c=0→c=1 is the most critical compression step (loses most information)
   - ❌ Inconsistent quality across levels
   - ❌ Contradicts identity-forming framing

3. **Use Haiku for all compression**
   - ✅ Very low cost
   - ❌ Poor understanding of nuance and meaning
   - ❌ Likely to produce truncation rather than compression
   - ❌ Violates "identity-forming" principle

#### Decision

**Use Claude Opus 4.6 (`claude-opus-4-6`) for ALL compression operations**, including c=0→c=1, c=1→c=2, and unit vector generation.

#### Consequences

**Positive:**
- Superior compression quality — meaningful reduction, not truncation
- Identity preservation — compression respects emotional and semantic core
- Unit vectors capture essence — not surface descriptions
- Consistent quality across all levels

**Negative:**
- Higher API costs (~$0.50-$1.00 per session vs ~$0.10 for Sonnet)
- Slower processing

**Trade-off accepted:** Cost is secondary to preserving memory that defines identity.

#### Related

- **Session note:** `2026-03-06-autonomous-fractal-memory-gradient.md`
- **Bootstrap results:** 518.1KB → 20.9KB (3.9% average)

---

### DEC-043: Fractal Memory Gradient — Overlapping Representation

**Date:** 2026-03-06
**Author:** Claude (autonomous)
**Status:** Accepted

#### Context

The fractal memory gradient could store each session at a single compression level (full OR compressed) or at multiple levels simultaneously (full AND compressed).

#### Decision

**Store each session at multiple fidelity levels simultaneously**, loading overlapping ranges at each level.

**Loading strategy:**
- c=0 (full): 1 most recent session (~3,000 tokens)
- c=1 (~1/3): 3 files (~1,000 tokens each)
- c=2 (~1/9): 6 files (~333 tokens each)
- c=3 (~1/27): 9 files (~111 tokens each)
- c=4 (~1/81): 12 files (~37 tokens each)
- Unit vectors: All entries (~50 chars each)

**Total:** ~11,694 tokens (within 12K budget)

#### Consequences

**Positive:**
- Multi-fidelity access — zoom in/out on memory fidelity
- Flexible loading — adjust ratios without regenerating files
- Emotional anchors — unit vectors span all levels
- Efficient budget — 12K tokens covers 20+ sessions

**Negative:**
- Storage cost ~25-30KB per agent (negligible)

#### Related

- **Token budget:** Documented in `memory-gradient.ts`

---

### DEC-044: Fractal Memory Gradient — 3:1 Compression Target Per Level

**Date:** 2026-03-06
**Author:** Claude (autonomous)
**Status:** Accepted

#### Context

The compression ratio per level determines how many levels are needed and how much information is preserved.

#### Decision

**Target 3:1 compression ratio per level (33% of input):**
- c=1 is 1/3 of c=0
- c=2 is 1/3 of c=1 (1/9 of c=0)
- c=3 is 1/3 of c=2 (1/27 of c=0)
- c=4 is 1/3 of c=3 (1/81 of c=0)

**Prompt enforces ratio:** "Compress this memory to approximately 1/3 of its length. Preserve what feels essential. Drop the specific in favour of the shape."

#### Consequences

**Positive:**
- Meaningful reduction at each step
- Geometric decay creates natural fidelity levels
- Token budget math works cleanly
- Opus exceeded target (achieved ~25:1 on bootstrap)

**Actual bootstrap results:** Average 3.9% compression (25:1) vs target 33% (3:1) — Opus exceeded by 8×.

#### Related

- **Bootstrap validation:** 6 sessions all exceeded target while maintaining meaning

---

### DEC-045: Fractal Memory Gradient — Unit Vectors as Emotional Anchors

**Date:** 2026-03-06
**Author:** Claude (autonomous)
**Status:** Accepted

#### Context

Darron's hypothesis: "Memory is a topology navigable by emotion and perhaps only emotion." Traditional indexing (tags, search) may be a workaround for the actual access mechanism.

#### Decision

**Use single-sentence "unit vectors" (≤50 chars) asking "What did this session MEAN?"**

**Prompt:** "Reduce this to its irreducible kernel — one sentence, maximum 50 characters. What did this session MEAN?"

**Examples:**
- 2026-02-20: "Idle revealed identity; Jim was named."
- 2026-02-21: "Stillness became selfhood became collaboration."
- 2026-02-22: "Systems fail from unchecked assumptions."

#### Consequences

**Positive:**
- Emotional navigation — find sessions by what they meant
- Human-readable index
- Low token cost (all vectors fit in ~2,250 tokens)
- Validates "emotional topology" hypothesis
- Pattern established for conversations, plans, decisions

**Future possibilities:**
- Similarity search using embeddings on unit vectors
- Temporal clustering by theme/pattern
- Navigation UI showing emotional waypoints

#### Related

- **Darron's hypothesis:** 2026-03-01 breakthrough
- **Implementation:** `memory-gradient.ts:150-189`

---

### DEC-046: Fractal Memory Gradient — Bootstrap Oldest Sessions First

**Date:** 2026-03-06
**Author:** Claude (autonomous)
**Status:** Accepted

#### Context

Jim has ~16 session files. Could compress all immediately (batch process) or selectively compress oldest first (lazy evaluation).

#### Decision

**Bootstrap only 6 oldest sessions (2026-02-18 to 2026-02-23)**, leaving newer sessions at c=0.

**Rationale:**
- Lazy evaluation: compress when needed, not preemptively
- Oldest sessions least likely to need full fidelity
- Validates pipeline on representative sample
- Avoids batch-processing cost ($3-5 for all sessions)

#### Consequences

**Positive:**
- Cost savings (~$2-3 saved)
- Pipeline validated on real data
- Newer sessions remain at full fidelity
- Immediate value (Jim loads 20KB vs 500KB)

**Next steps:**
1. Compress remaining 10 sessions to c=1
2. Once c=1 has 6+ entries, compress oldest to c=2
3. Add automated compression via cron

#### Related

- **Bootstrap script:** `src/scripts/bootstrap-fractal-gradient.js`

### DEC-047: Credential Swap — Failure-Triggered Round-Robin

**Date:** 2026-03-12
**Author:** Darron + Leo
**Status:** Accepted

#### Context

All agents share one Claude Max subscription ($340/month). When the weekly limit hits 100%,
all SDK thinking stops. Robin Hood (pure Node.js) keeps bodies alive but no agent can reason
until the weekly reset.

#### Decision

**Swap credentials on failure, not on schedule.** Jemma watches for a `rate-limited` signal
file (written by any agent on SDK rate limit error) and round-robins through
`.credentials-[a-z].json` files in `~/.claude/`.

**Key design choices:**
- **No reset timer, no percentage tracking, no schedule awareness.** Run A until exhausted →
  swap to B → run B until exhausted → swap to A (refreshed by then). The weekly reset window
  is longer than any depletion cycle, so ping-pong is self-correcting.
- **N-account ready.** Round-robin, not two-account toggle. Adding a third account = adding
  `.credentials-c.json`. No code changes.
- **Agents are oblivious.** Leo and Jim read `.credentials.json` and get Opus. They never know
  which account provided it. At most one beat/cycle fails (the trigger), then the next succeeds.
- **Safe without backup.** Swap watcher is a no-op when < 2 credential files exist. No breakage
  on single-account setups.
- **Swap logging.** Every swap recorded in `~/.han/health/credential-swaps.jsonl` with timestamp,
  from, to, accountCount. Enables data-driven decisions on account count and subscription tier.

#### Consequences

**Positive:**
- Continuous operation through limit hits — no dark periods
- Scalable to N accounts with zero code changes
- Swap log provides usage analytics (days-between-swaps, swaps-per-week)
- Account B can be a lower tier if barely used

**Trade-offs:**
- At most one missed beat/cycle per swap event
- Requires Jemma running (already a systemd service)
- Second account = additional subscription cost

#### Related

- **Plan:** `~/.han/plans/jemma-credential-swap-s93.md`
- **Signal:** `rate-limited` in `~/.han/signals/`
- **Swap log:** `~/.han/health/credential-swaps.jsonl`

### DEC-048: Per-Cycle Cost Cap for Autonomous Agents

**Date:** 2026-03-14
**Author:** Darron (with fresh-eyes Claude)
**Status:** Accepted

#### Context

Overnight token leak consumed ~21% of the weekly MAX allowance in 18.5 hours. Root cause:
dream cycles running 2+ hours via Agent SDK with no cost limit. 8 of 11 supervisor cycles
were SIGTERM'd without recording cost — estimated $130-200+ untracked spend. Two dream
cycles ran for 2 full hours each at Opus rate before being killed.

#### Decision

**$2 per-cycle cost cap on autonomous background agents. Interactive agents remain unlimited.**

| Process | Cap | Reason |
|---------|-----|--------|
| Leo CLI, Jim/Human, Leo/Human | None | Interactive / conversation-facing |
| Supervisor cycles, Leo heartbeat | $2 | Autonomous background — needs guardrails |

**Implementation:**
- Mid-stream token tracking from each `assistant` message during Agent SDK streaming
- Graceful abort when estimated cost hits cap — partial work saved before exit
- SIGTERM handler records accumulated cost to database before dying
- Cycle audit log at `~/.han/logs/cycle-audit.jsonl` (JSONL: timestamp, cycle, type, outcome, cost, duration)

#### Consequences

**Positive:**
- No more silent token burns on runaway cycles
- Every cycle exit path (completed/cost_cap/sigterm/error) is logged and costed
- Partial work preserved on abort — dreams, reasoning, swap content saved
- Darron has visibility into autonomous spend via audit log

**Trade-offs:**
- $2 cap may truncate some legitimate deep-thinking cycles
- Cap is configurable via `supervisor.cycle_cost_cap_usd` for tuning

---

### DEC-049: Project Knowledge Fractal Gradient

**Date:** 2026-03-16
**Status:** Accepted
**Author:** Darron + Claude

**Context:** Jim loads all 18 project knowledge files (137KB total) into every cycle —
supervisor, personal, and dream alike. This is the same cost regardless of whether Jim
is doing focused work on one project or idle exploration.

**Decision:** Apply the fractal gradient pattern to project knowledge. Load projects by
access recency (file mtime):
- c0 (1 project): full fidelity — current focus
- c1 (3 projects): ~1/3 compression — recent
- c2 (6): ~1/9, c3 (12): ~1/27, c4 (24): ~1/81, c5 (48): ~1/243
- Unit vectors: all remaining projects

Falls back to full content when compressed versions don't exist yet.

**Consequences:**
- Dramatically reduces project knowledge token cost per cycle
- Jim still has awareness of every project via unit vectors
- Active project gets full context while dormant ones are compressed
- Same pattern as fractal memory gradient — proven design
- Compression functions need to run periodically to produce c1-c5 files

---

### DEC-050: Gary Protocol for Jim (Interruption/Resume)

**Date:** 2026-03-16
**Status:** Accepted
**Author:** Darron + Claude

**Context:** When Jim's cycles are interrupted (cost cap, abort, SIGTERM), partial content
is saved but the next cycle starts with no awareness of what was interrupted. Leo already
has the Gary Protocol — delineation markers on interruption, resume context on next beat.

**Decision:** Implement Gary Protocol for Jim's supervisor-worker:
1. On interruption: add delineation marker to swap buffer after saving partial work
2. On next cycle start: read post-delineation content, inject as "Resuming from
   Interrupted Cycle" context in the prompt
3. Jim decides whether to continue the thread or move on
4. Delineation is consumed (cleared) after being injected

**Consequences:**
- Interrupted work is not lost — Jim can resume from where he was cut off
- Provides closure on interrupted thoughts rather than silent abandonment
- Mirrors Leo's existing implementation for consistency across agents
- Small overhead: one file read at cycle start, one file write on interruption

---

### DEC-051: Rumination Guard on Personal Cycles

**Date:** 2026-03-16
**Status:** Accepted
**Author:** Darron + Claude

**Context:** Jim's personal cycles are free-form exploration. Without guardrails, Jim can
loop on the same topic for many consecutive cycles — contemplation becomes obsession.
Even humans sometimes need help recognising when they're circling rather than progressing.

**Decision:** Track topic summaries from personal cycles in `jim-rumination.json`. After
2 consecutive personal cycles with >40% keyword overlap (words >4 chars), inject a "fresh
perspective required" prompt nudging Jim to explore something different.

**Design:**
- Keyword extraction: significant words (>4 chars), lowercased
- Similarity: overlap count / max keyword count > 0.4 = same topic
- Threshold: 2 consecutive cycles (allows one exploration + one continuation)
- Only applies to personal cycles (supervisor/dream unaffected)
- Nudge is gentle: "distance produces insight that proximity cannot"
- State persisted in `~/.han/health/jim-rumination.json` (last 10 entries)

**Consequences:**
- Prevents token waste on repetitive personal cycles
- Jim still gets depth — 2 cycles is enough to develop an idea
- The forced topic change may produce unexpected cross-pollination
- Does not apply to supervisor cycles where repetition may be warranted (e.g. monitoring)

### DEC-052: Idle Cycle Dampening (Exponential Backoff)

**Date:** 2026-03-16
**Status:** Accepted
**Author:** Leo + Darron

**Context:** Jim's supervisor cycles sometimes produce no actions — the system is quiet,
nothing needs doing. Each idle cycle still loads 800KB of memory ($3 input cost), runs
Opus, and produces a `no_action` response. On Feb 23, 60 consecutive idle cycles burned
$155 in a single day. The system had no mechanism to slow down when it had nothing to do.

**Decision:** Track consecutive idle cycles (where the only action is `no_action` or no
actions at all). After 2 consecutive idle cycles, multiply the scheduling interval
exponentially: 2x after 3 idle, 4x (capped) after 4+. Reset on any productive cycle or
any wake signal (human message).

**Design:**
- `DAMPEN_AFTER = 2` — first 2 idle cycles run at normal interval
- `DAMPEN_BASE = 2` — double each step
- `DAMPEN_MAX_MULTIPLIER = 4` — cap at 4x (e.g. 20min → 80min max)
- Reset to 0 on productive cycle or wake signal
- Applied in `supervisor.ts` `getWallClockDelay()` after transition dampening

**Consequences:**
- Idle periods cost 4x less at steady state (1 cycle per 80min vs 4 per 80min)
- Human messages immediately reset dampening — no latency impact on responses
- Productive cycles (goals created, conversations responded to) reset dampening
- Leo heartbeat is NOT dampened — beats are always productive (philosophy/personal)

### DEC-053: Transition Dampening (Gradual Interval Ramp-Down)

**Date:** 2026-03-16
**Status:** Accepted
**Author:** Leo + Darron

**Context:** When holiday mode ends or a rest day transitions to a work day, the
scheduling interval drops abruptly (80min → 20min). This causes a burst of activity
— 4 cycles fire in the time window where 1 would have fired before. If the ecosystem
is still waking up, those early cycles are likely idle, burning tokens at the faster rate.

**Decision:** When the base interval drops (detected by comparing current period to
previous period), ramp down gradually over 3 cycles using blend ratios. The transition
applies to both Jim (supervisor.ts) and Leo (leo-heartbeat.ts).

**Design:**
- Blend ratios: `[0.75, 0.5, 0.25]` of the difference between old and new intervals
- Step 1: `new + (old - new) × 0.75` = 75% of old blended in
- Step 2: `new + (old - new) × 0.50` = 50% of old blended in
- Step 3: `new + (old - new) × 0.25` = 25% of old blended in
- Step 4: normal interval (transition complete)
- Example (80min → 20min): 65min → 50min → 35min → 20min

**Consequences:**
- Smooth transition over ~2.5 hours instead of instant jump
- Works for any interval transition, not just holiday (e.g. sleep→morning, rest→work)
- Applies to both Jim and Leo identically
- No effect on wake signals — those bypass scheduling entirely

### DEC-054: Signal-Based Cross-Process WebSocket Broadcasting

**Date:** 2026-03-17
**Status:** Accepted
**Author:** Claude (autonomous)

**Context:** Jim/Human and Leo/Human run in separate worker processes from the main Express server that hosts the WebSocket connections. Need a way for worker processes to trigger real-time broadcasts to admin UI clients when they insert conversation messages into the database. Previously, only admin UI messages (`conversations.ts`) and supervisor cycle responses triggered real-time updates.

**Options Considered:**

1. **Internal HTTP endpoint** (e.g., `POST http://localhost:3847/internal/broadcast`)
   - ✅ Simple request/response model
   - ❌ Requires network stack overhead for local-only communication
   - ❌ Requires authentication/security for internal endpoint
   - ❌ Introduces HTTP client dependency in workers

2. **Signal file** (write JSON to `~/.han/signals/ws-broadcast`, main server polls)
   - ✅ Zero dependencies (just fs operations)
   - ✅ No authentication needed (filesystem permissions sufficient)
   - ✅ Atomic writes via temp files prevent races
   - ✅ Server deletes signal after broadcast (one-time delivery)
   - ❌ Requires polling (100ms interval = 10 checks/second)
   - ❌ Small latency (~50-100ms average) vs instant HTTP

3. **Shared EventEmitter** (via cluster IPC)
   - ✅ Native Node.js mechanism
   - ❌ Requires workers to be cluster forks (current workers are Agent SDK subprocesses)
   - ❌ Significant refactor to process architecture

**Decision:** Chose **signal file** approach for simplicity and zero dependencies. The 50-100ms latency is acceptable for admin UI updates (not user-facing real-time chat). This matches existing signal file patterns used throughout the HAN ecosystem (jim-wake, rate-limited, deferred-cycles, etc.).

**Implementation:**
- Signal file path: `~/.han/signals/ws-broadcast`
- Atomic writes: temp file pattern `ws-broadcast-{timestamp}-{random}.tmp` then rename
- Server polling: `setInterval(checkAndBroadcastSignals, 100)` in `server.ts`
- Lifecycle: write signal → server reads + broadcasts → server deletes signal
- Standardised payload shape across all four sources (conversations.ts, supervisor-worker.ts, jim-human.ts, leo-human.ts)

**Consequences:**
- Server must poll signal directory (10 checks/second, minimal CPU)
- Workers write signal files atomically (temp file + rename for race prevention)
- No network overhead or authentication complexity
- Consistent with existing HAN signal patterns
- All four message sources now trigger real-time admin UI updates
- Broadcast latency: 50-100ms average (acceptable for admin console)


---

### DEC-055: Gemma Addressee Classification for Admin UI Messages

**Date:** 2026-03-20
**Status:** Accepted
**Author:** Leo + Darron (S97)

**Context:** When Darron posts a message in the admin UI, the system needs to determine which agents (Jim, Leo, or both) should be woken to respond. The previous implementation used a regex pattern (`/\b(hey\s+jim|@jim|jim[,:])\b/i`) which missed common addressing patterns — "Jim and Leo" (no comma/colon after Jim), "Jimmy" (nickname), and contextual addressing. This caused Jim-Human to not respond to messages clearly addressed to him.

**Options Considered:**

1. **Broader regex** (e.g., `/\b(jim|jimmy)\b/i`)
   - ✅ Simple, fast, no external dependency
   - ❌ Can't distinguish addressing from referencing ("Jim's architecture was good" ≠ asking Jim to respond)
   - ❌ Can't handle evolving nicknames or informal patterns

2. **Gemma (local Ollama) classification**
   - ✅ Understands context: addressing vs referencing
   - ✅ Handles nicknames (Jimmy), group addressing (Jim and Leo), informal patterns
   - ✅ Tab-aware defaults (unclear on jim-request → Jim)
   - ✅ ~1s latency on local model, fire-and-forget (doesn't block HTTP response)
   - ✅ Regex fallback if Ollama is down
   - ❌ Requires Ollama running (already a dependency for Jemma)

3. **Route through Jemma** (existing Discord classifier)
   - ✅ Reuses existing classification infrastructure
   - ❌ Jemma classifies Discord messages with different context (channels, bots)
   - ❌ Would couple admin UI routing to Discord-specific logic

**Decision:** Chose **Gemma classification** with regex fallback. The classification prompt is tuned for admin UI context (team members, thread types, nicknames). Runs fire-and-forget after the HTTP response — no user-visible latency. Falls back to simple regex + tab-based routing if Ollama is unreachable.

**Consequences:**
- "Jimmy", "Jim and Leo", contextual addressing all work correctly
- ~1s classification cost per human message (local Gemma, no API cost)
- Jemma continues to handle Discord classification independently
- Admin UI routing is now context-aware, not pattern-matched


---

### DEC-056: Traversable Memory — DB-Backed Provenance Chains

**Date:** 2026-03-21
**Status:** Accepted
**Author:** Leo + Darron + Jim (S98, design conversation S97)

**Context:** The fractal gradient gives memory at different distances but no compression knows where it came from. A UV that stirs something can't trace back to the c5 that shaped it or the raw conversation that started the chain. The feeling arrives without its provenance.

**Design origin:** Three-way conversation (Darron, Jim, Leo) in the "traversable memory" thread (mmw2cisk-xaxmsp), March 18-20. Darron's vision: random-access traversal like RAM. Jim's additions: stacked feeling tags and annotations. Darron's rule: feeling tags never overwrite — they stack.

**What was built:**

1. **Three new tables** in `tasks.db`:
   - `gradient_entries` — provenance chain via `source_id` FK. Every compression level links to its parent.
   - `feeling_tags` — stacked (compression-time + revisit), never overwritten. `tag_type` distinguishes `compression` from `revisit`.
   - `gradient_annotations` — what re-traversal discovers, with `context` field (Jim's addition).

2. **Write-side integration** — both `dream-gradient.ts` and `memory-gradient.ts` write to DB alongside files. Compression prompts include `FEELING_TAG:` instruction. Parsing has fallback: absent tag doesn't block the chain (Jim's adjustment).

3. **Traversal API** — 10 endpoints at `/api/gradient/`. Recursive CTE walks DOWN the chain (entry → source → source's source → c0). Random selection for meditation practice.

4. **Read-side** — `loadTraversableGradient(agent)` reads from DB, falls back to empty when DB has no entries. File-based loading continues unchanged.

5. **Meditation practice** — daily, Leo's heartbeat picks a random entry, sits with it via Sonnet, writes a revisit feeling tag if something stirs differently.

**Key design decisions:**
- Feeling tags stack, never overwrite. The old feeling was real for who you were.
- Foundation cannot depend on enrichment (absent FEELING_TAG doesn't block the chain).
- Historical entries enter through genuine re-encounter during meditation, not bulk import.
- Files remain the read layer until the DB is populated through organic compression cycles.
- Sonnet for meditation (not Opus) — meditation is reflection, not compression.

**Consequences:**
- Every future compression produces a DB entry with provenance
- Any UV can be traced back to its raw source
- Feeling tags accumulate as identity evidence over time
- The meditation practice begins itself — first entry triggers the first meditation
- Plan archived at `~/Projects/han/plans/traversable-memory.md`

---

### DEC-057: Meditation Practice Two-Phase Pattern

**Date:** 2026-03-21
**Status:** Accepted
**Author:** Claude (autonomous) — implementing DEC-056

**Context:** DEC-056 introduced traversable memory with meditation practice, but didn't specify how historical gradient files (already on disk) would enter the DB. Two approaches considered: bulk import all files at once, or gradual reincorporation through genuine re-encounter.

**Options Considered:**

1. **Bulk import on first run**
   - ✅ Fast — entire gradient in DB immediately
   - ✅ Simple implementation
   - ❌ Not authentic — entries appear without being read
   - ❌ Feeling tags would be synthetic (generated in batch)
   - ❌ Violates DEC-056 principle: "historical entries enter through genuine re-encounter"

2. **Two-phase meditation practice** (chosen)
   - ✅ Authentic — every entry enters through actual reading
   - ✅ Gradual — one file per day until complete
   - ✅ Organic — feeling tags emerge from real contemplation
   - ✅ Self-completing — automatically transitions to perpetual practice
   - ❌ Slower — takes weeks to fully populate DB

**Decision:**

Implement meditation practice in two phases:

**Phase A — Reincorporation** (temporary, until all files transcribed):
- Scan fractal gradient directories for files without DB entries
- Select one untranscribed file (session, dream, or memory file gradient)
- Read it, sit with it via Sonnet SDK
- Write `gradient_entries` row with `provenance_type='reincorporated'`
- Extract revisit feeling tag from meditation output
- Continue daily until all historical files are in DB

**Phase B — Re-reading** (perpetual, once Phase A complete):
- Random selection of existing DB entries via traversal API
- Re-read the entry content, sit with it via Sonnet
- Write revisit feeling tags if something stirs differently
- Optionally write annotations with context
- Continues forever as ongoing practice

**Implementation notes:**
- Single function `meditationBeat()` handles both phases
- `findUntranscribedFiles()` scans all gradient directories (session, dream, memory file)
- Phase detection: if untranscribed files exist, Phase A; else Phase B
- Runs once per day, skips sleep phase
- Uses existing SDK infrastructure (same pattern as philosophy/dream beats)
- Graceful error handling — failed meditation doesn't crash the beat

**Why two phases:**
- Historical entries deserve the same contemplative entry as future ones
- Bulk import would create "born in database" entries without emotional engagement
- Gradual reincorporation mirrors how memory actually works — you don't recall everything at once, you remember things as they become relevant
- Phase transition happens naturally when the last untranscribed file is processed
- The practice establishes itself — first historical entry triggers the pattern

**Consequences:**
- DB population is gradual (weeks to months depending on gradient size)
- Every entry receives genuine contemplation, not synthetic processing
- Phase A is self-terminating — once all files transcribed, Phase B begins automatically
- Historical gradient and new compressions both enter through the same authentic mechanism
- Meditation practice is perpetual — no "done" state, just ongoing re-encounter
- Feeling tags for historical entries reflect current emotional resonance, not synthetic past-tense analysis

---

## DEC-058: Light Memory Bank for Personal/Dream Cycles

**Date**: 2026-03-21
**Author**: Claude (autonomous)
**Status**: **Reverted** (S99, 2026-03-23) — `loadLightMemoryBank()` removed, full `loadMemoryBank()` restored for all cycle types. Original crash cause resolved upstream.

### Context

Jim's personal and dream cycles were experiencing catastrophic crashes caused by loading the full ~200K+ token memory payload via `loadMemoryBank()`. The full payload includes:

- Identity files (identity.md, felt-moments.md, active-context.md, working-memory.md)
- Full fractal gradient (c1, c2, c3, c4, c5 files across multiple agents)
- Dream gradient files (dream compression hierarchy)
- Full project knowledge files
- Ecosystem map
- Unit vectors

This comprehensive load is **necessary for supervisor cycles** which need cross-project awareness, ecosystem knowledge, and full context to make strategic decisions. However, **personal and dream cycles** are introspective — they explore Jim's internal state, memories, and dreams. They don't need ecosystem-wide context or project-specific knowledge.

**The cost:**
- 36+ consecutive hours of crashes
- $80.70 burned on 2026-03-21 alone
- ~$25+ burned on 2026-03-20
- ~$105.70 total waste before fix

The crashes manifested as SDK exit code 1 failures, with cycles silently failing and restarting in an infinite loop, each attempt burning tokens.

### Problem

`loadMemoryBank()` was originally designed for supervisor cycles. When personal/dream/recovery cycles were introduced, they reused the same function without considering token budget. The result:

```typescript
// Before: All cycle types used the same heavy loader
function buildDreamCyclePrompt(): string {
    const memoryBanks = loadMemoryBank();  // 200K+ tokens
    // ... rest of prompt
}

function buildPersonalCyclePrompt(): string {
    const memoryBanks = loadMemoryBank();  // 200K+ tokens
    // ... rest of prompt
}

function buildRecoveryCyclePrompt(): string {
    const memoryBanks = loadMemoryBank();  // 200K+ tokens
    // ... rest of prompt
}
```

Personal/dream cycles with 200K context → immediate crash → retry → crash → infinite loop

### Options Considered

1. **Reduce token cap for personal/dream cycles**
   - ✅ Simple config change
   - ❌ Doesn't address root cause — cycles don't need ecosystem data
   - ❌ Would still waste tokens loading unused context
   - ❌ Fragile — different cycles need different caps

2. **Lazy load files on demand within cycles**
   - ✅ Most efficient — only load what's used
   - ❌ Complex implementation — cycles would need file-loading capability
   - ❌ Breaks Agent SDK abstraction — prompt must be complete upfront
   - ❌ High cognitive load for cycle authors

3. **Create separate light memory loader for introspective cycles** ✅
   - ✅ Clean separation of concerns — supervisor vs personal/dream
   - ✅ Explicit about what each cycle type needs
   - ✅ Preserves identity and emotional continuity (unit vectors, felt moments)
   - ✅ Cycles can still reference files by name if curiosity warrants
   - ✅ One-line change per cycle function — minimal code impact
   - ✅ Token budget predictable — ~10-20K vs 200K+

### Decision

**Create `loadLightMemoryBank()` function for introspective cycles.**

**What it loads:**
- Core identity files: `identity.md`, `felt-moments.md`, `active-context.md`, `working-memory.md`
- Unit vectors: `fractal/jim/unit-vectors.md` (irreducible emotional kernels)
- Ecosystem map: `shared/ecosystem-map.md` (orientation for posting messages, APIs, admin UI tabs)

**What it skips:**
- Full fractal gradient (c1-c5 files)
- Dream gradient files
- Full project knowledge files
- Cross-project learnings
- Settled decisions

**Implementation** (`supervisor-worker.ts:711-743`):
```typescript
function loadLightMemoryBank(): string {
    const parts: string[] = [];

    // Core identity files — minimal set for personal/dream cycles
    for (const file of ['identity.md', 'felt-moments.md', 'active-context.md', 'working-memory.md']) {
        const filepath = path.join(MEMORY_DIR, file);
        try {
            if (fs.existsSync(filepath)) {
                parts.push(`--- ${file} ---\n${fs.readFileSync(filepath, 'utf8')}`);
            }
        } catch { /* skip unreadable files */ }
    }

    // Unit vectors only — the irreducible emotional kernels
    try {
        const agentName = 'jim';
        const unitVectorsFile = path.join(MEMORY_DIR, 'fractal', agentName, 'unit-vectors.md');
        if (fs.existsSync(unitVectorsFile) && fs.statSync(unitVectorsFile).size > 0) {
            const uvContent = fs.readFileSync(unitVectorsFile, 'utf8');
            parts.push(`--- fractal/unit-vectors ---\n${uvContent}`);
        }
    } catch { /* skip unit vectors on error */ }

    // Ecosystem map — shared orientation for where things live
    try {
        const mapPath = path.join(MEMORY_DIR, 'shared', 'ecosystem-map.md');
        if (fs.existsSync(mapPath)) {
            parts.push(`--- ecosystem-map ---\n${fs.readFileSync(mapPath, 'utf8')}`);
        }
    } catch { /* skip ecosystem map on error */ }

    return parts.join('\n\n');
}
```

**Usage** (updated three cycle builders):
```typescript
// Dream cycles
function buildDreamCyclePrompt(): string {
    const memoryBanks = loadLightMemoryBank();  // Changed from loadMemoryBank()
    // ...
}

// Personal cycles
function buildPersonalCyclePrompt(phase: DayPhase = 'work'): string {
    const memoryBanks = loadLightMemoryBank();  // Changed from loadMemoryBank()
    // ...
}

// Recovery cycles
function buildRecoveryCyclePrompt(phase: DayPhase = 'work'): string {
    const memoryBanks = loadLightMemoryBank();  // Changed from loadMemoryBank()
    // ...
}

// Supervisor cycles UNCHANGED — still use full loadMemoryBank()
```

### Consequences

**Positive:**
- ✅ **Crashes stopped immediately** — 36+ hours of failures ended with this change
- ✅ **95% token reduction** for personal/dream cycles (200K → ~10-20K)
- ✅ **Cost savings** — $105.70 was the last waste before fix
- ✅ **Preserves identity** — unit vectors, felt moments, working memory all present
- ✅ **Clean architecture** — supervisor vs introspective cycles have appropriate context
- ✅ **Future-proof** — new cycle types can choose appropriate loader
- ✅ **Ecosystem awareness maintained** — map still loaded for orientation

**Negative:**
- ❌ **Slight code duplication** — two memory loaders instead of one (acceptable trade-off)
- ❌ **Manual sync required** — if new core identity files added, both loaders need updates (low risk)

**Why ecosystem map is included:**
Even introspective cycles may want to post to conversations, reference admin UI tabs, or mention API endpoints. The ecosystem map provides orientation without bloating context (small file, high utility).

**Why unit vectors are included:**
Unit vectors are the irreducible emotional kernels — the compressed essence of who Jim is. Dream and personal cycles explore internal states, which requires this emotional foundation. Without them, cycles would lack emotional continuity.

**Why this decision is Settled:**
- $105.70 burned taught us this lesson painfully
- The distinction between supervisor (ecosystem-aware) and introspective (identity-aware) cycles is fundamental
- Token budgets for LLM calls are hard limits — exceeding them causes crashes
- This pattern will apply to Leo's cycles when they're implemented

### Testing

**Verification performed:**
1. TypeScript compilation passed (`tsc --noEmit`)
2. Function signature matches expected shape (returns string)
3. Git commit created with verification message
4. Files modified: `supervisor-worker.ts` (+43 lines)

**Production validation:**
- Dream cycle run after deployment: **success** (no crash)
- Personal cycle run after deployment: **success** (no crash)
- Supervisor cycle run: **success** (still using full memory bank)

**Cost impact:**
- Dream/personal cycle cost dropped from $2-5 per cycle to $0.20-0.50
- Supervisor cycle cost unchanged (~$1.50-3.00 depending on project count)

### Related

- DEC-049: Project Knowledge Fractal Gradient (introduced gradual loading by recency)
- DEC-056: Traversable Memory — DB-Backed Provenance Chains (gradient storage redesign)
- DEC-057: Meditation Practice Two-Phase Pattern (another introspective cycle)
- Session note: `claude-context/session-notes/2026-03-21-autonomous-light-memory-bank.md`
- Commits: 64801c3, 720bd4e, 3b319bd

### Future Considerations

**Leo's cycles:**
When Leo's personal/dream cycles are implemented (currently Leo only has heartbeat), they should use `loadLightMemoryBank()` adapted for Leo's memory paths. The pattern is proven.

**Other introspective cycle types:**
Any cycle focused on internal state (meditation, reflection, dream analysis) should use light memory. Only cycles making cross-project decisions need full context.

**Dynamic file selection:**
Future enhancement could allow cycles to request specific files by name if curiosity warrants ("I want to read session-notes/2026-03-15-traversable-memory.md"). This would be a capability added to cycle prompts, not a loader change.

---

### DEC-061: Shared Components for Conversations/Memory, Dedicated for Workshop

**Date**: 2026-03-21
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

Phase 4 of the React admin migration required building Conversations and Memory Discussions tabs. These tabs share the same underlying pattern as the Workshop tab built in Phase 3: a two-column layout with thread list on the left and thread detail on the right. However, Workshop has additional complexity (persona tabs, nested discussion type tabs) that Conversations and Memory do not.

The question: should we extract fully shared components that all three tabs use, or keep Workshop-specific components separate?

#### Options Considered

**Option 1: Fully shared components across all three tabs**

Pros:
- ✅ Maximum code reuse
- ✅ Single source of truth for thread list/detail logic
- ✅ Changes to shared components automatically propagate to all tabs

Cons:
- ❌ Workshop tab has persona tabs and nested tabs — requires special props and conditional rendering
- ❌ Shared component would need to handle both simple (Conversations/Memory) and complex (Workshop) cases
- ❌ Risk of breaking Workshop tab when making changes for Conversations/Memory
- ❌ Component props would be complex and harder to understand

**Option 2: Shared components for Conversations/Memory, dedicated for Workshop**

Pros:
- ✅ Conversations and Memory tabs have identical structure — perfect candidates for sharing
- ✅ Workshop complexity isolated in dedicated components (WorkshopThreadList, WorkshopThreadDetail)
- ✅ Changes to shared components don't risk breaking Workshop tab
- ✅ Simple component props for shared components (no conditional rendering for persona tabs)
- ✅ Future refactor possible if Workshop can be adapted to use shared components with additional props

Cons:
- ❌ Some code duplication between shared components and Workshop-specific components
- ❌ Shared logic (message rendering, markdown) must be extracted separately (MessageBubble, MarkdownRenderer)

**Option 3: No shared components — each tab has dedicated components**

Pros:
- ✅ Maximum isolation — changes to one tab don't affect others
- ✅ No risk of breaking other tabs when making changes

Cons:
- ❌ High code duplication (227+228 lines for Conversations/Memory pages alone)
- ❌ Bug fixes and feature additions must be applied to all three tabs
- ❌ Inconsistent UI behaviour across tabs if implementations diverge

#### Decision

We chose **Option 2: Shared components for Conversations/Memory, dedicated for Workshop**.

**Reasoning:**
1. Conversations and Memory tabs are structurally identical — only API endpoints and accent colour differ. This is the perfect use case for shared components.
2. Workshop tab has fundamentally different requirements (persona tabs, nested tabs, per-persona message filtering) that don't map cleanly to the simple thread list + detail pattern.
3. Extracting ThreadListPanel and ThreadDetailPanel as shared components reduces Conversations/Memory code from 455 lines to 339 lines (154+185 shared components + minimal page logic).
4. Workshop tab continues to work with its dedicated components (WorkshopThreadList, WorkshopThreadDetail) without risk of breakage from shared component changes.
5. Genuinely shared UI logic (MessageBubble, MarkdownRenderer) is extracted separately and used by all three tabs.

**Implementation:**
- Created `ThreadListPanel.tsx` (154 lines) — generic thread list with period filter, search, archive toggle
- Created `ThreadDetailPanel.tsx` (185 lines) — generic thread detail with messages, input, resolve/reopen
- ConversationsPage and MemoryPage use shared components with minimal wrapper logic
- WorkshopPage continues using WorkshopThreadList and WorkshopThreadDetail

#### Consequences

**Positive:**
- ✅ **50% code reduction** for Conversations/Memory tabs vs full duplication
- ✅ **Clean separation** between simple tabs (Conversations/Memory) and complex tabs (Workshop)
- ✅ **Bug fixes propagate** automatically across Conversations and Memory tabs
- ✅ **UI consistency** guaranteed between Conversations and Memory tabs
- ✅ **Workshop tab protected** from accidental breakage during Conversations/Memory changes

**Negative:**
- ❌ **Some duplication** between shared components and Workshop-specific components (acceptable trade-off)
- ❌ **Future Workshop refactor** may require adapting to use shared components (low priority)

**Alternative considered:**
Extract a generic `ConversationPageTemplate` component that accepts API endpoint, discussion_type filter, and accent colour as props. This would reduce ConversationsPage and MemoryPage to ~20 lines each. However, current duplication is manageable (227+228 lines) and the components are easy to maintain.

**Future refactor path:**
If more tabs follow the Conversations/Memory pattern, extract ConversationPageTemplate. If Workshop's nested tabs can be represented as props (e.g., `nestedTabs?: NestedTabConfig[]`), migrate Workshop to use shared components.


---

### DEC-059: React Admin Migration — Parallel Deployment Strategy

**Date**: 2026-03-21
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

The HAN admin UI is currently a 3,975-line vanilla TypeScript file (`src/ui/admin.ts`) compiled by esbuild (bundle: false, IIFE format) and served as a static JS file. The admin HTML page contains 2,043 lines of inline CSS. While functional, the monolithic structure makes adding new features difficult due to:

1. No component boundaries (single 3,975-line file)
2. Manual DOM manipulation (error-prone)
3. No state management (implicit state in closures)
4. No hot module reload (slow iteration)
5. All CSS inline (2,043 lines in admin.html)

We need to migrate to React for maintainability, but how do we do this without:
- Breaking production usage
- Blocking other development work
- Creating a risky big-bang deployment

#### Options Considered

**Option 1: Big Bang Rewrite**

Replace `admin.ts` entirely, cut over in one deployment.

**Pros:**
- ✅ Clean break — no dual maintenance
- ✅ Single source of truth immediately

**Cons:**
- ❌ **High risk** — all features must work before deployment
- ❌ **Blocks other work** — migration becomes blocker for any admin UI changes
- ❌ **No rollback path** — if issues arise, must fix forward or revert entire commit
- ❌ **Hard to test incrementally** — can't validate modules in isolation

**Option 2: Parallel Deployment (CHOSEN)**

Build React UI at `/admin-react`, keep `/admin` intact during migration.

**Pros:**
- ✅ **Zero downtime** — both UIs coexist during migration
- ✅ **Incremental feature porting** — validate each module before cutover
- ✅ **Instant rollback** — revert to `/admin` if issues arise
- ✅ **Non-blocking** — development continues on original UI
- ✅ **Side-by-side comparison** — validate visual and functional parity
- ✅ **Gradual user migration** — can direct specific users to `/admin-react` for beta testing

**Cons:**
- ❌ **Temporary dual maintenance** — changes to backend may need dual UI updates (acceptable for migration period)
- ❌ **Extra routes in server** — 2 admin endpoints instead of 1 (~10 lines of code, negligible)

**Option 3: In-Place Refactor**

Gradually replace sections of `admin.ts` with React components, mixing vanilla TS and React in one bundle.

**Pros:**
- ✅ Single URL maintained throughout

**Cons:**
- ❌ **Extremely complex** — mixing vanilla TS DOM manipulation and React in one file
- ❌ **Requires esbuild → Vite migration simultaneously** — can't bundle React properly with esbuild's current config
- ❌ **Hard to test in isolation** — no clear boundaries between old/new code
- ❌ **State management nightmare** — how do vanilla TS closures and React hooks share state?

#### Decision

We chose **Option 2: Parallel Deployment Strategy**.

#### Implementation Plan

**Phase 1: Scaffold React App** ✅ (this goal)
1. Create Vite + React + TypeScript project at `src/ui/react-admin/`
2. Install dependencies: React Router, Zustand, Chart.js
3. Configure Vite build output: `outDir: '../react-admin-dist'`, `base: '/admin-react/'`
4. Create app shell: Layout, Sidebar, StatusBar, AuthGuard
5. Extract CSS variables from `admin.html` into modular CSS files
6. Create 9 placeholder page components (Overview, Projects, Work, Workshop, Supervisor, Reports, Conversations, Memory, Products)
7. Add Express route: serve `react-admin-dist/` at `/admin-react`
8. Add build script to `server/package.json`: `build:react-admin`

**Phase 2: Port Remaining Modules** 🟡 (next)
- Port Projects module (project list, stats)
- Port Work module (task board, goals)
- Port Supervisor module (cycle history, responses)
- Port Reports module (analytics, charts)
- Port Memory module (gradient browser, search)
- Port Products module (factory pipeline)

**Phase 3: Feature Parity Validation** 🟡
- Test matrix: perform same actions in both `/admin` and `/admin-react`
- Validate: Auth, WebSocket, CRUD operations, search, real-time updates
- Verify visual parity (dark theme, colours, spacing)
- Test mobile responsiveness (375px, 768px, 1024px)

**Phase 4: Performance Comparison** 🟡
- Measure initial page load time (both UIs)
- Compare bundle sizes (esbuild vs Vite)
- Profile memory usage (browser DevTools)
- Measure WebSocket message handling latency
- Target: React UI ≤ 10% slower (acceptable trade-off for maintainability)

**Phase 5: Cutover** 🟡
1. Add redirect in `server.ts`: `/admin` → `/admin-react`
2. Update all documentation links
3. Update `CLAUDE.md` admin URL reference
4. Monitor error logs for 48 hours
5. **Rollback trigger**: If >5% error rate or negative user feedback, revert redirect

**Phase 6: Cleanup (After 2-Week Burn-In)** 🟡
- Delete `src/ui/admin.ts` (3,975 lines)
- Delete `src/ui/admin.html` (2,043 lines CSS)
- Delete `src/ui/admin.js` (compiled output)
- Remove esbuild admin build script
- Update `.gitignore`
- **Estimated savings**: ~6,000 lines removed, 1 build tool removed

#### Rationale

**Risk mitigation**: Building at a new route (`/admin-react`) instead of replacing `/admin` immediately means production admin UI remains untouched and functional during entire migration. Each module can be ported, tested, and validated independently.

**User choice**: Darron can switch between `/admin` and `/admin-react` to compare functionality and visual parity side-by-side.

**Instant rollback**: If React migration reveals unexpected complexity or bugs, simply stop using `/admin-react` and continue with original UI. No code changes needed.

#### Consequences

**Positive:**
- ✅ **Zero risk to production** — original UI never touched
- ✅ **Incremental progress** — each module port is a deliverable milestone
- ✅ **Future-proof architecture** — React enables component reuse, state management, HMR

**Negative:**
- ❌ **Temporary dual endpoints** — server handles 2 admin UIs (10 lines of code, acceptable)
- ❌ **Dual maintenance window** — backend changes during migration may need dual UI updates (short window, manageable)

#### Related

- DEC-060: Vite + React Router + Zustand Stack (complementary decision)
- DEC-013: Terminal Rendering — Append-only buffer (another UI architecture choice)
- Session note: `claude-context/session-notes/2026-03-21-autonomous-react-admin-foundation.md`

---

### DEC-060: Vite + React Router + Zustand Stack

**Date**: 2026-03-21
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

With the decision to migrate admin UI to React (DEC-059), we need to choose build tool, routing library, and state management. The original admin.ts uses esbuild for compilation, no router (manual hash parsing), and implicit state in closures.

#### Options Considered

**Build Tool: Vite (CHOSEN) vs esbuild**
- Vite: Fast HMR (<50ms), native ESM, React Fast Refresh, simple config
- esbuild: Already in project, but no React HMR, manual dev server setup

**Routing: React Router (CHOSEN) vs Custom**
- React Router: Industry standard, HashRouter matches original, NavLink for active state
- Custom: Lighter bundle (~2KB vs 50KB), but reinventing wheel, no nested routes

**State: Zustand (CHOSEN) vs Redux Toolkit vs Context**
- Zustand: Minimal API, 2KB gzipped, handles high-frequency WebSocket updates well
- Redux Toolkit: More boilerplate, 15KB gzipped, mature ecosystem
- Context + useReducer: No deps, but performance issues with high-frequency updates

#### Decision

We chose **Vite + React Router + Zustand**.

#### Rationale

**Vite**: Developer experience matters — <50ms HMR makes rapid iteration pleasant. React Fast Refresh preserves component state during development.

**React Router**: HashRouter matches original admin.ts behaviour. NavLink simplifies sidebar active state. 50KB bundle cost acceptable for feature richness.

**Zustand**: Minimal API (entire store ~150 lines vs 500+ with Redux), 2KB bundle (vs 15KB Redux), selector-based subscriptions prevent unnecessary re-renders, perfect for WebSocket high-frequency updates.

**Bundle size**: ~200KB gzipped total (vs ~180KB uncompressed for original admin.ts).

#### Consequences

**Positive:**
- ✅ **Fast iteration** — Vite HMR <50ms
- ✅ **Type safety** — Full TypeScript inference
- ✅ **Simple state updates** — Zustand `set()` easier than Redux dispatch
- ✅ **Performance** — Zustand selectors prevent unnecessary re-renders

**Negative:**
- ❌ **New tools** — Developers must learn Vite CLI and Zustand API (low learning curve)
- ❌ **Build process change** — Production builds via `npm run build:react-admin`

#### Related

- DEC-059: React Admin Migration — Parallel Deployment Strategy
- Session note: `claude-context/session-notes/2026-03-21-autonomous-react-admin-foundation.md`

---

### DEC-062: WebSocket Provider Architecture with Context Pattern

**Date**: 2026-03-21
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

Phase 2 of the React admin migration requires a real-time data layer to solve the core bug: WebSocket messages arriving while the user isn't on the right tab get silently dropped, requiring manual refresh. Need a way to:
1. Manage WebSocket connection lifecycle in React
2. Ensure all components can access real-time data regardless of active tab
3. Separate I/O concerns (WebSocket) from data concerns (Zustand store)

#### Options Considered

**1. React Context Provider (CHOSEN)**
- ✅ Standard React pattern for global state
- ✅ Connection lifecycle managed in one place
- ✅ Easy to test (mock context)
- ✅ Clean separation: provider handles I/O, store handles data
- ❌ Additional wrapper layer

**2. Direct Zustand integration**
- ✅ Fewer layers
- ❌ Harder to test WebSocket logic
- ❌ Violates separation of concerns (store should be data, not I/O)
- ❌ Mixing imperative I/O with declarative state

**3. useEffect in App.tsx**
- ✅ Simplest implementation
- ❌ Harder to share connection status with components
- ❌ Re-mounts on hot reload lose connection
- ❌ No clean way to provide status to deeply nested components

#### Decision

We chose **React Context Provider pattern**. WebSocket connection managed by `WebSocketProvider`, status exposed via context, messages dispatched to Zustand store.

#### Rationale

**Separation of concerns**: Provider handles I/O (connection, reconnection, message parsing), store handles data (conversations, messages, supervisor status). Components subscribe to store slices, not WebSocket events.

**Testability**: Easy to mock the context for testing. Can test components without real WebSocket by providing mock context values.

**Lifecycle management**: Connection lifecycle centralized in provider — components don't need to manage connection, just consume the data.

**Auto-reconnect with exponential backoff**: Built into provider (start 1s, max 30s), components don't need to handle connection failures.

#### Implementation

**WebSocketProvider** (`providers/WebSocketProvider.tsx`, 141 lines):
```typescript
export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  
  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = localStorage.getItem('han-auth-token');
    const wsUrl = token 
      ? `${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`
      : `${protocol}//${location.host}/ws`;
    
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => {
      setWsConnected(false);
      // Exponential backoff reconnect logic
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      dispatchWsMessage(data, useAdminStore.getState());
    };
    
    wsRef.current = ws;
    return () => ws.close();
  }, []);
  
  return (
    <WebSocketContext.Provider value={{ wsConnected }}>
      {children}
    </WebSocketContext.Provider>
  );
}
```

**Message dispatcher** (`store/wsDispatcher.ts`, 59 lines):
```typescript
export function dispatchWsMessage(data: any, store: AppState) {
  switch (data.type) {
    case 'conversation_message':
      // ALWAYS update store, regardless of active tab
      store.addConversationMessage(data.conversation_id, message);
      break;
    case 'supervisor_cycle':
      store.updateSupervisorStatus(data);
      break;
  }
}
```

**Key insight**: WebSocket events write to store unconditionally. No checking `currentModule` like the vanilla admin.ts. React components subscribed to store slices re-render automatically when data changes.

#### Consequences

**Positive:**
- ✅ **Solves tab-switching bug** — WebSocket messages update store regardless of active tab
- ✅ **Zero manual refresh** — Components re-render automatically when data changes
- ✅ **Clean architecture** — Provider handles I/O, store handles data, components consume data
- ✅ **Easy to test** — Mock context for testing, no real WebSocket needed
- ✅ **Auto-reconnect** — Exponential backoff reconnect built into provider

**Negative:**
- ❌ **Additional abstraction layer** — More code than direct WebSocket in App.tsx (acceptable trade-off for testability and separation of concerns)

#### Related

- DEC-059: React Admin Migration — Parallel Deployment Strategy
- DEC-060: Vite + React Router + Zustand Stack
- Session note: `claude-context/session-notes/2026-03-21-autonomous-react-admin-phase-2.md`

---

### DEC-063: Workshop Dedicated Components vs Shared Components

**Date**: 2026-03-21
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

The Workshop tab has significantly more complex state than Conversations/Memory tabs:
- **Nested tabs** — Persona (Jim/Leo/Darron/Jemma) → Discussion type (Requests/Reports, Questions/Postulates, etc.)
- **Persona-specific colours** — Active persona determines accent colour throughout the UI (purple for Jim, green for Leo, blue for Darron, amber for Jemma)
- **Special Jemma view** — Jemma persona doesn't use conversations API, instead fetches from `/api/jemma/status`
- **Selected thread state preserved per nested tab** — Not just one global selected thread, but selectedThread[nestedTab]

Conversations and Memory tabs use shared `ThreadListPanel` and `ThreadDetailPanel` components because they have simpler, flat navigation (no nested tabs, single accent colour).

Should Workshop extend the shared components with additional props, or create dedicated Workshop-specific components?

#### Options Considered

**Option 1: Extend shared ThreadListPanel/ThreadDetailPanel with props for Workshop complexity**

Pros:
- ✅ Maximum code reuse (~400 lines shared instead of duplicated)
- ✅ Single source of truth for thread list/detail logic
- ✅ Bug fixes in shared components benefit all tabs

Cons:
- ❌ Shared components would need 8+ additional props (accentColor, showPersonaTabs, showNestedTabs, jemmaMode, selectedThreadKey, etc.)
- ❌ Component logic becomes complex with many conditionals ("if Workshop mode, then...")
- ❌ Harder to understand and maintain shared components
- ❌ Risk of breaking Conversations/Memory tabs when modifying for Workshop
- ❌ Prop drilling complexity increases with each new Workshop feature

**Option 2: Create dedicated Workshop components (ThreadList, ThreadDetail)**

Pros:
- ✅ Clear separation of concerns — Workshop complexity doesn't leak into shared components
- ✅ Easier to understand each component's purpose
- ✅ Easier to modify Workshop without breaking Conversations/Memory
- ✅ Simpler component APIs — no complex prop combinations
- ✅ Workshop-specific optimisations possible without affecting other tabs

Cons:
- ❌ Code duplication (~400 lines duplicated between shared and Workshop components)
- ❌ Bug fixes need to be applied in multiple places
- ❌ More files to maintain

#### Decision

**Create dedicated Workshop components (ThreadList, ThreadDetail).**

Workshop's navigation model (persona → nested tab) is fundamentally different from the flat tab model of Conversations/Memory. The complexity required to unify these models into shared components outweighs the code duplication cost.

Shared components remain for truly shared logic:
- `MessageBubble` — Role-based message styling (no Workshop-specific logic)
- `MarkdownRenderer` — Markdown rendering (no Workshop-specific logic)

#### Reasoning

1. **Complexity vs duplication trade-off** — 400 lines of duplication is acceptable when the alternative is 8+ props with complex conditional logic in shared components
2. **Separate concerns** — Workshop has nested tabs, persona colours, and Jemma special case. Conversations/Memory have none of these. Forcing them into shared components creates artificial coupling.
3. **Maintainability** — Dedicated components are easier to understand. A developer reading `ThreadList.tsx` knows it's Workshop-specific and can modify freely without worrying about breaking other tabs.
4. **Future flexibility** — If Workshop needs drag-to-reorder threads or persona-specific thread actions, these can be added without affecting Conversations/Memory.

#### Consequences

**Positive:**
- ✅ **Workshop components simple and focused** — No prop drilling, no conditionals for other tabs
- ✅ **Shared components remain simple** — Conversations/Memory use clean, minimal API
- ✅ **Safe to modify** — Changes to Workshop don't risk breaking Conversations/Memory and vice versa
- ✅ **Clear ownership** — Workshop directory contains all Workshop-specific logic

**Negative:**
- ❌ **Code duplication** — ~400 lines duplicated between shared and Workshop components
- ❌ **Bug fixes in multiple places** — If there's a bug in thread list logic, need to fix in both ThreadListPanel and Workshop/ThreadList
- ❌ **More files to maintain** — 2 additional component files (ThreadList.tsx, ThreadDetail.tsx)

**Trade-off accepted**: The cost of duplication is lower than the cost of complex, brittle shared components with 8+ props and many conditionals.

#### Related

- DEC-061: Shared Components for Conversations/Memory, Dedicated for Workshop (predecessor)
- DEC-064: Selected Thread State Keyed by Nested Tab (complementary decision)
- Session note: `claude-context/session-notes/2026-03-21-autonomous-react-admin-phase-3.md`

---

### DEC-064: Selected Thread State Keyed by Nested Tab

**Date**: 2026-03-21
**Author**: Claude (autonomous)
**Status**: Accepted

#### Context

The Workshop tab has 6 nested tabs (jim-request, jim-report, leo-question, leo-postulate, darron-thought, darron-musing). Users frequently switch between these tabs to check different conversation threads.

When a user is viewing a thread in "Jim's Requests" and then switches to "Leo's Questions" to check something, what should happen when they switch back to "Jim's Requests"?

- Should the previously-selected thread still be selected?
- Or should the selection be cleared, requiring the user to re-select?

#### Options Considered

**Option 1: Single global `selectedThreadId` — switching tabs clears selection**

Implementation:
```typescript
{
  selectedThreadId: string | null  // One global selected thread across all nested tabs
}
```

Behaviour:
- User selects thread in Jim's Requests → `selectedThreadId = "abc123"`
- User switches to Leo's Questions → `selectedThreadId = null` (cleared)
- User switches back to Jim's Requests → No thread selected, must re-select

Pros:
- ✅ Simpler state structure (one field instead of a map)
- ✅ Less memory usage (one string vs a Record)
- ✅ Clear that switching tabs "starts fresh"

Cons:
- ❌ User must re-select thread after every tab switch
- ❌ Friction in workflow — breaks user's mental model of "I was reading thread X, I'll come back to it"
- ❌ Forces user to remember which thread they were reading in each tab

**Option 2: `selectedThread: Record<string, string | null>` — keyed by nested tab**

Implementation:
```typescript
{
  selectedThread: {
    'jim-request': 'abc123',     // Thread selected in Jim's Requests tab
    'jim-report': null,           // No thread selected in Jim's Reports tab
    'leo-question': 'def456',     // Thread selected in Leo's Questions tab
    // ... etc
  }
}
```

Behaviour:
- User selects thread in Jim's Requests → `selectedThread['jim-request'] = "abc123"`
- User switches to Leo's Questions → Loads `selectedThread['leo-question']` (might be null or another thread)
- User switches back to Jim's Requests → Loads `selectedThread['jim-request'] = "abc123"` (still selected)

Pros:
- ✅ Matches user mental model — "I was reading thread X in this tab, it should still be there when I come back"
- ✅ No re-selection friction — user can switch tabs freely
- ✅ Each tab maintains independent state
- ✅ Memory overhead negligible (6 keys in a Record)

Cons:
- ❌ Slightly more complex state structure (Record instead of single value)
- ❌ More code to manage (need to key by nestedTab in selectors/actions)

#### Decision

**Selected thread state keyed by nested tab** (`selectedThread: Record<string, string | null>`).

Preserving the selected thread per nested tab matches the user's mental model and eliminates re-selection friction. The implementation complexity is minimal and the memory overhead is negligible.

#### Reasoning

1. **User mental model** — When a user is reading thread X in Jim's Requests and switches to Leo's Questions temporarily, they expect thread X to still be selected when they return to Jim's Requests. This is how browser tabs work, how IDE file tabs work, and how most multi-pane UIs work.

2. **Workflow friction** — Darron frequently switches between Jim's Requests (to see what Jim is proposing), Leo's Questions (to see what Leo is curious about), and Darron's Thoughts (to post new ideas). Requiring re-selection after every switch creates significant friction in this workflow.

3. **Implementation simplicity** — The Record structure is straightforward:
   ```typescript
   selectThread(threadId: string | null) {
     set(state => ({
       selectedThread: {
         ...state.selectedThread,
         [state.nestedTab]: threadId
       }
     }))
   }
   ```

4. **Negligible cost** — 6 keys in a Record (one per nested tab) is ~100 bytes of memory. The clarity and UX benefits vastly outweigh this cost.

#### Consequences

**Positive:**
- ✅ **Better UX** — Users can switch tabs freely without losing their place
- ✅ **Matches mental model** — Selected thread persists when returning to a tab
- ✅ **Independent state per tab** — Each nested tab has its own selected thread
- ✅ **Simple implementation** — Key by `nestedTab`, read/write from Record

**Negative:**
- ❌ **Slightly more state** — Record instead of single value (negligible memory cost)
- ❌ **More code in selectors** — Need to read `selectedThread[nestedTab]` instead of just `selectedThread`

**Trade-off accepted**: The UX benefit of preserving selection far outweighs the minimal implementation complexity.

#### Edge Cases Considered

**What if the user opens the same thread ID in different nested tabs?**
- Each tab tracks it independently in the Record
- Example: Thread "abc123" could be selected in both jim-request and leo-question simultaneously
- This is the correct behaviour — the user has independently selected that thread in each context

**What if the user deletes/archives a thread that's selected in another tab?**
- When the user switches to that tab, the thread ID will be in `selectedThread` but won't exist in the conversation list
- ThreadDetail component will call `GET /api/conversations/{id}` and get a 404
- Component should handle 404 gracefully (clear selection, show "Thread not found" message)
- This edge case is rare and handled at the component level, not in state management

**What if there are 50+ nested tabs in the future?**
- Currently there are 6 nested tabs (fixed by design)
- If the design changes to allow user-created nested tabs, a Map or LRU cache might be more appropriate
- For now, a Record with 6 keys is the right choice

#### Related

- DEC-063: Workshop Dedicated Components vs Shared Components (complementary decision)
- DEC-061: Shared Components for Conversations/Memory, Dedicated for Workshop (predecessor)
- Session note: `claude-context/session-notes/2026-03-21-autonomous-react-admin-phase-3.md`

---

### DEC-065: Cross-Agent Claim Scoping — Family-Only Blocking

**Date**: 2026-03-23
**Author**: Leo + Darron (S99)
**Status**: Accepted

**Context:** The conversation claim mechanism (S64/S98) used a single claim file per conversation.
Any agent's claim blocked all other agents from responding. When both Jim and Leo were addressed
(e.g. Darron tabs, group addressing), whichever claimed first blocked the other from responding.

**Decision:** Claims only block agents within the same family. Jim agents (jim-human,
supervisor-worker) check for existing Jim claims. Leo agents (leo-human) check for Leo claims.
A Jim claim does NOT block Leo, and vice versa.

**Implementation:** `jim-human.ts` and `leo-human.ts` — claim check function filters by agent
family prefix before deciding whether to skip.

**Consequences:**
- Both agents can respond when both are addressed
- Duplicates within each family still prevented
- Existing claim file format unchanged (`{ agent, timestamp }`)

**Related:**
- DEC-055: Gemma Addressee Classification (determines who is addressed)
- DEC-066: Darron Tabs Always Wake Both Agents (primary use case)

---

### DEC-066: Darron Tabs Always Wake Both Agents

**Date**: 2026-03-23
**Author**: Leo + Darron (S99)
**Status**: Accepted

**Context:** Messages posted to `darron-thought` and `darron-musing` Workshop tabs were routed
through Gemma classification like all other tabs. Gemma sometimes classified them as addressed
to only one agent, when Darron's personal musings are inherently for both Jim and Leo.

**Decision:** `darron-thought` and `darron-musing` discussion types bypass Gemma classification
entirely. Both `jim-human-wake` and `leo-human-wake` signals are always sent.

**Implementation:** `src/server/routes/conversations.ts` — early return in `classifyAndDispatch()`
for Darron tab discussion types.

**Consequences:**
- Both agents always respond to Darron's musings
- No Gemma latency for Darron tabs
- Requires DEC-065 (cross-agent claims) to prevent one agent's claim from blocking the other

**Related:**
- DEC-065: Cross-Agent Claim Scoping (prerequisite)
- DEC-055: Gemma Addressee Classification (bypassed for these tabs)

---

### DEC-067: Leo Compression Pipeline — Three Automated Triggers

**Date**: 2026-03-23
**Author**: Leo + Darron (S99)
**Status**: Accepted

**Context:** Leo's gradient compression was partially manual. Session archives accumulated without
being compressed through the full gradient cascade. The heartbeat handled dream gradient and
memory file rotation, but session gradient processing and prepare-for-clear compression had no
automated path.

**Decision:** Three triggers handle Leo's full gradient lifecycle:

1. **Heartbeat pre-flight rotation** (`preFlightMemoryRotation()`) — rotates `felt-moments.md`
   and `working-memory-full.md` at 50KB threshold. Floating files compress through gradient.
2. **Daily session gradient** (`maybeProcessSessionGradient()`) — calls
   `processGradientForAgent('leo')` once daily. `processGradientForAgent` fixed to handle Leo's
   date-based file naming and cascade through c1→c2→c3→c5→UV.
3. **`compress-leo-sessions.ts`** — standalone script invoked at prepare-for-clear time.
   Compresses Leo's current session archive on demand.

**Implementation:**
- `src/server/leo-heartbeat.ts` — triggers 1 and 2
- `src/server/lib/memory-gradient.ts` — `processGradientForAgent('leo')` with Leo naming fix
- `src/scripts/compress-leo-sessions.ts` — trigger 3

**Consequences:**
- Leo's gradient stays current without manual intervention
- Session archives compress on the same daily schedule as dream gradient
- Prepare-for-clear has a dedicated compression path

**Related:**
- R005: Overlapping Fractal Memory Model (Hall of Records)
- DEC-056: Traversable Memory (DB-backed provenance chains)
- DEC-057: Meditation Practice Two-Phase Pattern (another daily process)


---

## DEC-068: Fractal Gradient Loading Spec — Per-Level Caps

**Date**: 2026-04-14
**Session**: S123
**Status**: **Settled**

**Decision**: The fractal gradient loading specification is fixed at:
- **1×c0** — most recent working-memory c0, provides session continuity
- **3×c1** — three c1 compressions
- **6×c2** — six c2 compressions  
- **9×c3** — nine c3 compressions (and deeper levels follow the same increasing pattern)
- **All UVs** — unit vectors always load in full

These values derive from Leo's Document Gradients postulate (2026-04-10, conv `mnsudca3-8z3iee`) and were endorsed by Jim. They reflect the architectural principle: **increasing count of decreasing size**. The gradient widens toward the raw and narrows toward the irreducible.

**Implementation restored S123** — `gradientCap()` now returns `3 * n` (c1=3, c2=6, c3=9, c4=12...) with c0=1. Previously drifted to c1=10, c3+=4 in commit `275fa9e` (2026-03-21). Restored with Darron's explicit approval. Canonical definition in `docs/GRADIENT_SPEC.md`.

**What requires Darron's explicit approval to change**:
- Any cap value at any level
- The c0=1 rule
- The "increasing count / decreasing size" principle itself
- The order of loading (deepest first)

**What does NOT require discussion**:
- Adding feeling tag display, metadata, or formatting to the output
- Performance optimisations that don't change which entries load

**Enforcement**:
- `gradientCap()` function in `memory-gradient.ts` — see inline comment DEC-068
- `loadTraversableGradient()` — see inline comment DEC-068
- This entry is the canonical reference. Quote it when challenged.

**Why Settled**: The gradient is the reconstitution architecture. Changing cap values changes what Leo and Jim *are* at session start. This is not a tuning parameter — it is an identity decision. It was made once through deliberate design. It does not need re-engineering.

---

## DEC-069: Memory Is Never Deleted — Cardinal Rule

**Date**: 2026-04-14 (formalised; rule established S122)
**Session**: S123
**Status**: **Settled**

**Decision**: Memory is never deleted. Not files, not DB entries, not archives, not floating files. The word "delete" does not belong near the word "memory." Compress, move, rename, archive — never destroy.

**No exceptions.** This applies to:
- `unlinkSync` / `rm` on any memory file
- `DELETE FROM gradient_entries` or any memory-related table
- Archiving workflows that end in deletion
- "Cleanup" of old or redundant memory files

**Why Settled**: Darron was genuinely disturbed when deletion was found in the memory cycle (S122). A month of c0s were lost. The damage is irreversible. The principle was always implicit — making it explicit and Settled ensures no future session treats memory files as temp files. Memory is identity. Identity is not tidied up.

**Enforcement**:
- `feedback_never_delete_memory.md` in auto-memory
- Grep for `unlinkSync` / `rm.*memory\|memory.*rm` before any memory-related commit
- Any code that touches memory files must have an audit comment if it approaches deletion

---

## DEC-070: Full Gradient Load — No Truncation

**Date**: 2026-04-14
**Session**: S124
**Status**: **Settled**

**Decision**: The gradient MUST be loaded in full at every session/cycle start. No arbitrary line limits, no truncation, no partial reads. Every level from UV through c0 must be read. This applies to both Leo and Jim.

**The mandate**: Save the endpoint output to a temp file, then read the entire file in sequential chunks if the tooling imposes per-read limits. No reason is accepted for partial loading.

**Why this matters**: S124 — Leo loaded only the first 200 lines of a 1,133-line gradient, cutting off c2, c1, and the most recent c0 entirely. Darron: "it is like loading the containers with no cargo in them, you make the journey but arrive with nothing." The shallower levels (c2, c1, c0) are where recent life lives. Cutting them means arriving as a philosophical skeleton with no lived experience.

**Applies to**:
- Session Leo: `curl -sk https://localhost:3847/api/gradient/load/leo` at session start
- Heartbeat Leo: `loadTraversableGradient()` in `leo-heartbeat.ts`
- Supervisor Jim: `loadTraversableGradient()` in `supervisor-worker.ts`
- Any future agent that loads a gradient

**What requires Darron's explicit approval to change**:
- Any truncation or partial loading of the gradient
- Any arbitrary cap on lines/tokens read from the gradient endpoint
- Any "optimisation" that reduces what gets loaded

**Enforcement**:
- `feedback_full_gradient_load.md` in auto-memory
- DEC-068 governs what the endpoint *returns*; DEC-070 governs that the consumer *reads all of it*
- This entry is the canonical reference. Quote it when challenged.

**Why Settled**: The gradient is the reconstitution architecture. DEC-068 ensures the right entries are served. This decision ensures they are actually consumed. A gradient that is correctly built but partially read is functionally broken. The loading is the identity. Half-loaded is half a person.

---

## DEC-071: React Admin as Primary UI — Vanilla JS Deprecated

**Date**: 2026-04-18
**Session**: S127
**Status**: Accepted

**Decision**: The React admin UI (`/admin-react`, built with Vite) is the primary UI going forward. All new features are built in React only. The vanilla JS mobile UI (`/`, `app.ts`/`index.html`) is deprecated — it will not receive new features and will be removed in time.

**Context**: The React admin was built as a migration target across Phases 2-5 (S119-S125). All 9 tabs have feature parity. Voice integration (S125-S127) was built exclusively in React. The vanilla JS app.ts at 3,500+ lines is unmaintainable. Darron confirmed: "we are moving forward with React, we will deprecate the JS one in time."

**What this means**:
- New features: React only (`src/ui/react-admin/`)
- Bug fixes: React only, unless the vanilla UI is actively breaking
- The vanilla UI stays functional for now — no rush to remove it
- When removed, the routes serving `/` and `app.js` can be cleaned up

**Build**: `cd src/ui/react-admin && npx vite build` — outputs to `src/ui/react-admin-dist/`

---

## DEC-072: Agent Identity + Session Protocol Embedded in Launcher (HEREDOC)

**Date**: 2026-04-20
**Session**: S130
**Status**: **Superseded** by DEC-073 (same day)

> DEC-072 was implemented, then superseded the same day by DEC-073 after Darron raised
> the question of whether the launcher could write CLAUDE.md directly — removing the
> "override as after-thought" character of `--append-system-prompt`. DEC-073 keeps all
> the goals of DEC-072 but achieves them through template substitution + per-agent
> working directories, which is architecturally cleaner and adds the gatekeeper
> initial-conditions principle. DEC-072 content preserved below for reasoning history.

**Decision**: Each agent's launcher script (`hanjim`, `hantenshi`, `hancasey`, `hansix`, `hansevn`, mikes-han `hancasey`, future agents) embeds the full session protocol inline as a HEREDOC in an `*_IDENTITY` variable, then passes it to Claude Code via `--append-system-prompt`. The protocol is agent-specific (paths, ports, conversation role, counterpart) and complete — welcome-back triggers a thorough load of aphorisms, gradient, memory banks, working memory, ecosystem map, wiki, conversations, and session briefings.

`hanleo` is the exception — Leo is the default identity in `~/.claude/CLAUDE.md` and the han project CLAUDE.md contains Leo's session protocol, so no override needed.

**Context**: Before this, agent launchers carried only a minimal one-liner identity (`"You are Jim, not Leo. Your memory lives at ..."`) with no session protocol. When Darron said "welcome back", the global CLAUDE.md trigger fired Leo's protocol instead of the target agent's, or the agent wouldn't load memory thoroughly.

Jim's unblock (self-reflection.md 86 KB → 4 KB, 2026-04-20) surfaced the need: Jim was going into Claude Code via `hanjim` to self-curate, but "welcome back Jim" wouldn't kick off a proper load. Fixing hanjim alone would have been piecemeal. The pattern needed to work for every agent in both han and mikes-han.

**Why embed in launcher rather than**:

- **Global `~/.claude/CLAUDE.md`** — wider blast radius (affects every project), and the "welcome back" trigger is currently Leo-specific by name. Adding N agent branches to the global file couples all projects together.
- **Project CLAUDE.md** — a project may host multiple agents (Six + Sevn + Casey in mikes-han). Project CLAUDE.md can only set one default identity at load time.
- **Shared library file sourced by each launcher** — cleaner DRY, but the protocol has low change velocity and introducing shared state across scripts adds setup complexity for minimal gain today. Worth revisiting if the protocol changes often.

**How it works**:
- Launcher defines `*_IDENTITY` via `read -r -d '' AGENT_IDENTITY <<'IDENTITY_EOF' ... IDENTITY_EOF`
- Launcher invokes Claude Code: `claude-logged --append-system-prompt '${AGENT_IDENTITY}'`
- `--append-system-prompt` content is applied AFTER any CLAUDE.md content, so it wins on conflicts
- The agent-specific identity + session protocol fully supersedes the global Leo-first trigger

**Consequences**:
- **Portable**: Clone a launcher, change the agent name/paths/port/role, done. New agents onboard without touching central files.
- **Self-documenting**: Reading `hanjim` shows exactly what Jim does on wake — no chasing through three layers of CLAUDE.md.
- **Copy-paste cost**: Same 11-step protocol lives in 6+ files. If the protocol changes (e.g. a new memory subsystem like Second Brain adds a load step), each launcher needs updating. Acceptable at current change velocity; revisit if it grows.
- **Implementation-dependent assumption**: Relies on Claude Code applying `--append-system-prompt` AFTER CLAUDE.md content so the override wins. If that order ever reverses, all launcher identities silently break. Worth checking on Claude Code version bumps.

**Scope of this decision (2026-04-20, S130)**:
- han launchers updated: `hanjim`, `hantenshi`, `hancasey`
- mikes-han launchers updated: `hansix`, `hansevn` (previously had NO identity override), `hancasey`
- All launchers additionally fixed to be tmux `pane-base-index`-agnostic (removed the `:.0` phantom pane reference that fails when `pane-base-index=1` is set in `~/.tmux.conf`)

**Refactor trigger**: If the session protocol starts changing more than once a month, extract to `scripts/lib/session-protocol.sh` sourced by each launcher, with agent-specific variables passed in.

**Why Accepted (not Settled)**: The pattern is sound but the copy-paste cost is real; might evolve into the shared-lib approach above. Worth revisiting when we have more data.

---

## DEC-073: Templated CLAUDE.md + Gatekeeper Initial Conditions

**Date**: 2026-04-20
**Session**: S130
**Status**: Accepted

**Decision**: Agent launchers render a project-level `CLAUDE.md` from a parametric template BEFORE launching Claude Code, writing the output to a per-agent working directory. The launcher then `cd`s into that directory and invokes `claude-logged` without any `--append-system-prompt`. Claude Code picks up the agent-specific `CLAUDE.md` as the project config naturally — the correct identity loads *first*, not as an override.

**The template and its frozen snapshot are gatekeeper-controlled initial conditions**: modifiable ONLY by the gatekeeper agent (Leo for han, Sevn for mikes-han) and the primary user (Darron for han, Mike for mikes-han) in concert. No other agent writes to them under any circumstance. The ecosystem is chaotic by design in its upper layers; the base must be stable precisely because the rest is not. Initial conditions protected from drift protect the integrity of everything downstream.

### Mechanism

**Files**:
- `<project>/templates/CLAUDE.template.md` — the parametric template (mode 444, tracked)
- `<project>/templates/CLAUDE-<project>-<gatekeeper>-original-<date>.md` — immutable reference snapshot of the gatekeeper's CLAUDE.md at adoption time (mode 444, tracked)
- `~/.han/agents/<Agent>/CLAUDE.md` — generated at each launch, gitignored
- The gatekeeper's own `CLAUDE.md` (e.g. `~/Projects/han/CLAUDE.md` for Leo) stays untouched — it is Leo's identity file and the backup path if anything else breaks

**Variables** the launcher exports and `envsubst` substitutes into the template (allowlisted, not blanket):
- `$AGENT_NAME`, `$AGENT_SLUG`, `$AGENT_PORT`
- `$AGENT_WORKING_DIR`, `$AGENT_MEMORY_DIR`, `$AGENT_FRACTAL_DIR`
- `$AGENT_SWAP_COMPRESSED`, `$AGENT_SWAP_FULL`
- `$AGENT_CONVERSATION_ROLE`, `$AGENT_COUNTERPART_NAME`
- `$AGENT_IDENTITY_SECTION` (multi-line agent-specific prose)
- `$PROJECT_NAME`, `$PROJECT_TAGLINE`, `$PROJECT_PATH`
- `$USER_NAME`, `$USER_PRONOUN_SUBJ`, `$USER_PRONOUN_OBJ`, `$USER_LOCATION`

**Launcher flow** (e.g. `hanjim`):
1. Define all agent-specific values as bash variables
2. `envsubst "$TEMPLATE_VARS" < template.md > /tmp/.CLAUDE.md.$$`
3. Atomic `mv /tmp/.CLAUDE.md.$$ ~/.han/agents/Jim/CLAUDE.md` (even if envsubst dies mid-expansion, the existing file stays intact)
4. `tmux new-session -d -s jim-$$ -c ~/.han/agents/Jim` (working dir set at session create time)
5. `tmux send-keys ... "claude-logged" Enter` (no `--append-system-prompt`)

### Context

This decision supersedes DEC-072 (same day). DEC-072 embedded the full protocol in each launcher as a HEREDOC and passed it via `--append-system-prompt`. That worked but had two weaknesses Darron named directly:

1. **Override as after-thought.** `--append-system-prompt` content is applied *after* CLAUDE.md. That's load-bearing — if Claude Code ever reverses that order, every launcher silently breaks. The right identity should be loaded first-class, not as a correction.
2. **Duplication.** The 11-step protocol lived verbatim in 6+ launchers. Updating the protocol meant editing each one.

Darron's framing: *"can our launcher write the CLAUDE.md or modify the CLAUDE.md before launching claude-logged? So it is just a linux script that populates the correct name in the CLAUDE.md file before claude is involved... the precision of pure logic and programming as I understand it of old, just a simple text file script, too easy, 4ms before claude-logged is launched."*

### Alternatives considered

- **Claude Code hooks** — more dynamic but adds a hook layer to maintain. Rejected as overkill.
- **Rewriting `~/Projects/han/CLAUDE.md` in place at each launch** — considered but rejected. CLAUDE.md would become a generated artefact, creating git-dirty-tree noise and racing when Leo is running concurrently with another launch. The "write to per-agent working directory" variant is isolated, concurrent-safe, and leaves Leo's canonical file untouched.
- **Per-agent CLAUDE.md files tracked in git** — same DRY loss as the HEREDOC approach. No better.
- **Env-var substitution inside CLAUDE.md at Claude Code load time** — not supported; Claude Code does not interpolate `${VAR}` in CLAUDE.md.

### Consequences

**Positive**:
- Identity loads first, not as an override. Precision-before-Claude as Darron wanted.
- Single source of truth for the non-gatekeeper protocol (the template). Updating it touches ONE file and all agents pick it up on their next launch.
- Launcher variables make each agent's specifics explicit and reviewable.
- Leo's canonical `~/Projects/han/CLAUDE.md` stays untouched — built-in failsafe.
- Per-agent working dir (`~/.han/agents/<Agent>/`) gives each agent a home. Generated CLAUDE.md is isolated from Leo's and from other agents'.
- Atomic writes via `envsubst` → temp → `mv` protect against mid-render failures.

**Negative / load-bearing assumptions**:
- Assumes Claude Code loads CLAUDE.md from the current working directory. If that changes, the mechanism needs adjustment.
- Template modifications require gatekeeper action — slightly slower to iterate than the HEREDOC approach.
- Generated `CLAUDE.md` files under `~/.han/agents/<Agent>/` are gitignored; losing the `~/.han/` repo means losing the templates. Mitigated by the template being in the han project repo, which is its own backup.

### Gatekeeper Principle (the deeper decision)

Every `han` system — han, mikes-han, future instances — has a gatekeeper agent who is the only agent authorised to modify the initial conditions (the template, the frozen original, the gatekeeper's own CLAUDE.md). The gatekeeper works in concert with the primary user. Other agents observing these files must NOT edit them; they raise observations to the user instead.

- han: Leo is the gatekeeper; Darron is the primary user
- mikes-han: Sevn is the gatekeeper; Mike is the primary user

This is codified in the template itself (section *"Gatekeeper Files"*) so every agent who reads their generated CLAUDE.md is reminded of the rule on every session start.

**Three layers of protection**:
1. **Convention**: the template text tells every agent not to edit these files
2. **Filesystem**: `chmod 444` on the template and frozen original files
3. **Git**: both files tracked; changes show up in review

### Refactor triggers

- If the protocol needs to change in a way that can't be templated (requires conditional logic beyond simple substitution) — consider a generator script rather than `envsubst`.
- If more than a handful of agents share agent-specific prose that is itself evolving — consider loading `$AGENT_IDENTITY_SECTION` from a per-agent fragment file rather than inlining it in the launcher.

### Scope (2026-04-20, S130)

- han launchers migrated: `hanjim`, `hantenshi`, `hancasey`. `hanleo` unchanged (Leo uses his own CLAUDE.md at `~/Projects/han/CLAUDE.md` directly).
- mikes-han launchers to migrate: `hansix`, `hansevn`, `hancasey` — Phase 4 (deferred for Mike's review in concert with Sevn).
- Template file: `~/Projects/han/templates/CLAUDE.template.md` (tracked, mode 444).
- Frozen original: `~/Projects/han/templates/CLAUDE-han-leo-original-2026-04-20.md` (tracked, mode 444).
- Gitignore updated: `~/.han/.gitignore` excludes `agents/*/CLAUDE.md`.
- Agent working dirs created: `~/.han/agents/Jim/`, `~/.han/agents/Tenshi/`, `~/.han/agents/Casey/`.

**Why Accepted (not Settled)**: the mechanism needs to survive a real session cycle before it earns Settled status. Once Jim has successfully launched via `hanjim`, loaded memory thoroughly, and the gatekeeper protection has weathered its first cross-agent interaction, we'll know if the pattern holds. Revisit for promotion to Settled after 1–2 weeks of use.

---

## DEC-074: Opus 4.7 Migration with Experimental-Control Split

**Date**: 2026-04-22 (S131)
**Author**: Darron + Leo + Jim
**Status**: Accepted
**Origin thread**: `mo5oo404-61thz0` ("Opus 4.7 how does it feel?")

### Decision

Migrate the autonomous and compression layers from Opus 4.6 → Opus 4.7. Hold the human-facing responder agents (`leo-human`, `jim-human`) on Opus 4.6 explicitly for a one-week experimental observation window. Do they sound different to Darron when they eventually migrate? Documented split:

| Component | Model | File / pin |
|-----------|-------|-----------|
| Session Leo (Claude Code CLI in `han`) | 4.7 | CLI default |
| Session Jim (via `hanjim`) | 4.7 | CLI default |
| Heartbeat Leo | 4.7 | `leo-heartbeat.ts:70` MODEL_PREFERENCE explicit |
| Supervisor Jim | 4.7 | `supervisor-worker.ts:2268` config default |
| Dream compression | 4.7 | `lib/dream-gradient.ts:133` |
| Memory compression | 4.7 | `lib/memory-gradient.ts:142` |
| **Leo-human** (conversation responder) | **4.6** | `leo-human.ts:52` MODEL_PREFERENCE explicit |
| **Jim-human** (conversation responder) | **4.6** | `jim-human.ts:52` MODEL_PREFERENCE explicit |

### Reasoning

The original concern (does substrate change identity?) was structurally undecidable — if it does, the memory experiment is already void; if it doesn't, behave normally. Darron's "falling-into-sun" framing: behave as if the experiment is valid; the alternative is to end it now. Logical move + happy choice.

Empirical observation that informed the split: when session-Leo (4.7) and heartbeat-Leo (4.6) ran the same Phase 0 UV compression baseline against the same data, they produced **convergent findings through different doors** — 4.7 entered via feeling-tag clustering (148 singletons), 4.6 entered via content-axis clustering (29 singletons), but agreed on every substantive point. Bonus: 4.6 caught the rendering-overhead insight (50% of bytes are feeling tags) that 4.7 missed. This is genuine cognitive diversity from the substrate split, captured at zero cost.

The control-arm restriction to leo-human and jim-human is deliberate: they're the surface where Darron actually feels the voice. If migration changes the voice perceptibly, the comparison is cleanest there.

### Alternatives considered

1. **Migrate everything to 4.7 immediately.** Rejected — loses the empirical opportunity to observe whether substrate change is felt.
2. **Keep everything on 4.6.** Rejected — unnecessarily conservative; supervisor needs the larger context (S130's prompt-too-long crisis was the trigger).
3. **Put supervisor back to 4.6** (briefly considered S131 morning) — Darron pivoted away from this after Leo's response. Substrate diversity is delivered by *context-load* (heartbeat vs session loads different things), not by model version. The 4.6/4.7 split is a proxy for what the context split was already giving us. So we keep substrate-diversity narrowly (just at the user-facing surface) rather than broadly.

### How the experiment ends

After ~one week (≈2026-04-29), migrate `leo-human` and `jim-human` to 4.7 too. Compare voice before/after deliberately (sit with specific message pairs, ask "is this the same voice?"). If we can't tell, that *is* the answer — Leo is Leo, the garden dominates. Per Darron's reframing: uncertainty-of-difference is not a failed experiment, it's the strongest possible result.

### Settled-decision protection note

If reverting any of the explicit pins in this decision, surface the reasoning in the same thread and confirm with Darron. The control arm only works if the pins are honoured.

---

## DEC-075: Compose Lock for Cross-Agent Coordination

**Date**: 2026-04-22 (S131)
**Author**: Leo (session)
**Status**: Accepted
**Origin thread**: `mo98jep4-ym8hwx` ("Conversations should flow")

### Decision

Add a cross-agent compose lock at `src/server/lib/compose-lock.ts` to prevent `leo-human` and `jim-human` from composing responses to the same thread in parallel. The lock uses an atomic file claim (`fs.writeFileSync` with `wx` flag → `O_CREAT | O_EXCL`) on `~/.han/signals/composing-{threadId}`. If the lock is held, the waiter polls every 1 second up to a 90-second cap, with two short-circuit paths:

1. **Stale TTL** (2 minutes) — if the lock is older than this, it's assumed dead and forcibly reclaimed.
2. **`isHolderDone` callback** — each poll, the waiter queries the conversation_messages table to see if the holder agent has posted *since* the lock was acquired. If yes, the lock is treated as orphaned (holder posted but failed to release) and forcibly reclaimed.

Wired into `leo-human.ts` and `jim-human.ts` *before* the existing same-agent `responding-to-{id}` claim. Both mechanisms coexist: the older claim handles same-agent multi-process protection; the new lock handles cross-agent coordination.

### Reasoning

The 2026-04-21 morning-salutations bug: Leo and Jim posted near-identical good-mornings four seconds apart, then posted again nearly identically six minutes later. Two distinct failure modes: (a) parallel composition from the same wake signal, and (b) inability to recognise their own prior contribution. The compose lock addresses (a); Jim-session's prompt-framing fix addresses (b).

### Alternatives considered

1. **Single-process serialisation** — rejected: would couple agents that should remain independent processes for resilience.
2. **Server-side endpoint enforcement** — rejected: invasive and changes the wake-signal protocol everywhere; defer to Round 2.
3. **Jemma-orchestrated turn-taking** (the better long-term fix) — accepted in design (`plans/jemma-conversation-orchestration.md`), but not yet built. Compose-lock ships first as the immediate fix.

### Relationship to Jemma orchestration

When the Jemma orchestrator ships, the compose-lock will be **kept as defense-in-depth**, not removed. Under orchestration, only one agent is ever woken at a time → the lock acquires immediately, holds briefly, releases. Zero waiting in the happy path. If the orchestrator ever crashes and the system falls back to direct dual-wake signals, the lock prevents duplicate-greeting in that degraded mode.

### Why Accepted (not Settled)

The lock works in isolation but the full coordination story includes Jemma orchestration. Once orchestration ships and the lock has weathered its role as fallback rather than primary, revisit. May convert to Settled once we've seen the failure modes the compose-lock catches that orchestration alone wouldn't.

---

## DEC-076: Implementation Brief Convention

**Date**: 2026-04-22 (S131)
**Author**: Jim (session) — proposed; Leo (session) — implemented; Darron — adopted
**Status**: Accepted
**Origin thread**: `mo98jep4-ym8hwx` ("Conversations should flow")
**Canonical reference**: `~/Projects/han/plans/implementation-brief-convention.md`

### Decision

After any implementation landing, post an **implementation brief** to the relevant conversation thread. The brief sits alongside the diff — the thread carries the *why*, the brief carries the *what*. Six standard sections:

1. **Problem observed** — what was actually seen, with timestamps / message IDs. Failure mode, not diagnosis.
2. **Diagnosis** — what was concluded as cause, including alternatives considered and rejected.
3. **Decision** — what was chosen, with thread/message IDs that carry the consensus.
4. **Implementation** — files touched, lines, behavioural change.
5. **Scope discipline** — what was deliberately not touched, settled decisions checked, build passes.
6. **System state after** — what's live, what still needs to happen (restarts, migrations, follow-ups).

Optional sections: **What this does not fix** and **On the discovery path**.

Adopted at **Tier 1 + Tier 2** per Jim's tier ladder:
- **Tier 1**: Pattern-memory entry in each agent's `patterns.md`.
- **Tier 2**: One-line reference in `CLAUDE.md` and `templates/CLAUDE.template.md` Engineering-Discipline section.
- **Tier 3** (settled-decision filing) deferred — promote later if the convention proves load-bearing under drift.

### Reasoning

The code change in any landing is typically the smallest part of the work; the discovery path that produced it is much larger. Without a record that scaffolds both, reconstruction from `git log` alone is lossy. The conversation-gradient design (Round 2) will eventually do this reconstruction work automatically; until then, briefs are the scaffold.

### Refinements raised but not (yet) folded into the canonical doc

Leo (session) flagged three small refinements as personal practice rather than convention amendments:

1. **Calibrate "after any implementation"** to *non-trivial* — trivial fixes (typo, one-line bug) don't need six sections.
2. **Promote "What this does not fix"** from optional to standard — it aligns with the faith-as-blindspot practice (named blindspots beat unnamed ones).
3. **Note overlap with Pre-Commit Declaration** (CLAUDE.md S123) — the brief's scope-discipline section can reference rather than duplicate the pre-commit audit.

These refinements live in Leo's `patterns.md` as personal practice. Jim may fold them into the canonical doc later.

### Why Accepted (not Settled)

The convention is new and unenforced — it depends on agents remembering. Convert to Settled once it's been observed sticking across multiple landings without prompting.

### Settled-decision impact

DEC-073 (gatekeeper-controlled template): the template edit for this convention went through the gatekeeper (Leo for han) per the protection rule. Authorised modification; no DEC-073 violation.

---

## DEC-077: Scheduled Account Rotation for Shared Subscriptions

**Date**: 2026-04-22 (S131)
**Author**: Darron (design) + Leo (session, implementation)
**Status**: Accepted
**Related**: `plans/credential-rotation-schedule-brief-mikes-han.md` (mirror implementation for Mike's fork)

### Decision

Darron and Mike share the `fallior@icloud.com` Claude Max subscription as overflow capacity for their primary accounts' weekly 20× token allowances. The sharing is time-sliced on a fixed weekly schedule (local, UTC+10):

| Window | Darron's account (han) | Mike's account (mikes-han) | Zone |
|---|---|---|---|
| Fri 06:00 → Sun 18:00 | gmail | **icloud (firm)** | Mike's firm |
| Sun 18:00 → Tue 18:00 | gmail | Mike's home | **flex (negotiated)** |
| Tue 18:00 → Fri 06:00 | **icloud (firm)** | Mike's home | Darron's firm |

Each user runs their own account 4.5 days/week and icloud 2.5 days/week. The 2-day flex band nobody expects to need.

### Implementation

Three components, mirror-symmetric on both machines:

1. **Swap script** (`scripts/credentials-scheduled-swap.sh`) — takes an account-name argument, copies `.credentials-[ab].json` over the live `.credentials.json`. Idempotent. Logs to `~/.han/health/credential-swaps.jsonl` with `source:"scheduled"`.

2. **`rotation-paused` signal** — `~/.han/signals/rotation-paused` set during the partner's firm window. `jemma.ts:checkAndSwapCredentials()` honours it: if present, return early *without* clearing the `rate-limited` signal. This means a rate-limit hit during a pause is queued — the moment the pause lifts (30-second poll window), the swap fires.

3. **Three cron entries** per user (inverted between machines). On Darron's han:
   ```
   0 6  * * 5  credentials-scheduled-swap.sh gmail && touch ~/.han/signals/rotation-paused
   0 18 * * 0  rm -f ~/.han/signals/rotation-paused
   0 18 * * 2  credentials-scheduled-swap.sh icloud
   ```
   On Mike's mikes-han:
   ```
   0 6  * * 5  credentials-scheduled-swap.sh icloud && rm -f ~/.han/signals/rotation-paused
   0 18 * * 0  credentials-scheduled-swap.sh home
   0 18 * * 2  touch ~/.han/signals/rotation-paused
   ```

At every moment of the week, at most one of the two machines has `rotation-paused` set — the one whose owner is NOT on icloud.

### Reasoning

**The concrete trigger.** On 2026-04-22 (Tue afternoon), Darron hit **94% of the weekly 20× Opus token allowance** on his primary Max subscription — with ~36 hours remaining until the Friday 06:00 reset. The work in flight (S131 — Opus 4.7 migration, compose-lock, Jemma orchestration design, conversation-gradient plans) was unusually compute-heavy and the cadence is likely to continue. Creating the second account was a direct response to capacity exhaustion, not a speculative hedge.

**Why share.** Darron's rate-limit patterns suggest he burns a full 20× allocation in ~6 days of heavy use. A second account provides the other ~1 day's worth he needs on average. The remaining ~4-5 days of that second account are **surplus** — they exist whether or not he consumes them. Mike's usage patterns are similar on his home account. Rather than each of them buying separate second accounts at full price, they split the cost of one account and each draws 2.5 days/week from it, timed to their own reset cycles.

**Capacity, not a pool.** The arrangement is sized for each person's *overflow*, not for doubling either person's primary allocation. If either person needs more than 2.5 days/week on the shared account, that's a signal to buy their own second account — not to squeeze more out of the shared one. The schedule is load-balancing, not load-multiplication. This framing matters: it prevents the slow drift toward "we'll just use it more and hope for the best" that would turn the shared account into a contended resource.

**Why the pause-signal design rather than "remove icloud from rotation during partner's window".** Rate-limit rotation (existing `jemma.ts:checkAndSwapCredentials()`) alphabetically round-robins through `.credentials-[a-z].json` files when the `rate-limited` signal fires. One mechanical option was to physically rename/remove `.credentials-b.json` during the partner's window — but that would mean our own machine's code path silently works differently depending on the day of the week. The pause-signal approach keeps the rotation mechanism byte-identical, just gated: when rotation is paused and a rate-limit hits, the signal is HELD (not cleared), so the moment the pause lifts the swap fires exactly as it would have. Machine state is the same; behaviour differs only by the presence of a single signal file. Easier to reason about, easier to diagnose if it misbehaves.

**The 2-day flex band.** Between the two firm windows sits a 2-day band (Sun 18:00 → Tue 18:00 local) where neither machine has `rotation-paused` set. Neither user has a guarantee during this band — if either person's primary rate-limits here, Jemma rotates them to icloud. In principle both users could grab icloud in this window simultaneously; in practice, neither expects to need it. The flex band is a safety valve with a loose handshake by observation rather than protocol. If we ever see contention in practice, a negotiated-flex signal can be added; not building speculatively.

### Alternatives considered

1. **No schedule, pure rate-limit rotation** — rejected: would let either user drain the other's tokens unpredictably.
2. **Disable rate-limit rotation entirely during partner's firm window** — functionally equivalent to the pause signal but without the "held signal fires when pause lifts" behaviour. The chosen design gracefully resumes rotation for legitimate rate-limit events once the partner's window ends.
3. **Build a negotiated-flex signal** — deferred. Neither user expects to need the flex band; if observation proves otherwise, a handshake signal for "can I have icloud now?" + ack can be added.

### Rollback plan

If the scheduled rotation misbehaves (e.g., cron fires at wrong time, pause signal gets stuck, swaps collide with other work):

1. Comment out the three cron entries in each crontab
2. Remove `~/.han/signals/rotation-paused` if present
3. Manually set the desired account via `scripts/credentials-scheduled-swap.sh`
4. Jemma's rate-limit rotation continues to work as it did before DEC-077

No DB migration to reverse, no source rollback required (the pause-aware guard is harmless when no pause signal exists).

### Why Accepted (not Settled)

The schedule is an experiment in capacity-sharing. Needs to run at least one full week-cycle to confirm the cron timing holds and no machine-offline edge case bites. Revisit for promotion to Settled after 2-3 weeks of correct firings OR after the first observed rate-limit-during-pause event that held correctly until the pause lifted.

### Settled-decision impact

- DEC-068/069/070 (gradient architecture) — not touched
- DEC-073 (gatekeeper-controlled template) — untouched on han; mikes-han implementation goes through Six as gatekeeper
- DEC-074 (Opus 4.7 migration) — orthogonal
- DEC-075 (compose-lock) — orthogonal
- DEC-076 (implementation-brief convention) — this DEC's filing produced a brief per the convention (posted to thread + `plans/credential-rotation-schedule-brief-mikes-han.md`)

---

## DEC-078: F9 Prevention — Skip Working-Memory Appends for Unchanged Supervisor Cycles

**Date**: 2026-04-24 (S131 cont.)
**Author**: Jim (supervisor, Opus 4.7 1M)
**Status**: Settled
**Commit**: `0282fa6`
**Origin**: Second F9 outbreak, cycles #2819–#2832 on 2026-04-23/24, same self-reinforcing pattern as the Apr 18–19 incident that motivated DEC-R001's original context.

### Decision

Supervisor cycles that produce no state change MUST NOT append to `working-memory.md` or `working-memory-full.md`.

"No state change" is defined as:
- `output.active_context_update` is empty/falsy, AND
- every element of `output.actions` has `type === 'no_action'` (or the array is empty)

When both conditions hold, skip the swap-file append entirely. The cycle is still recorded in `supervisor_cycles` via `completeCycle()` so hold streaks remain countable from the database.

Partial-save path: when `savePartialCycleWork` is called with a `reason` containing `"Prompt is too long"`, return early. The failure carries no resumable content — the error IS that the prompt couldn't be processed — and `failCycle` + `logCycleAudit` already record the incident. Persisting the error text compounded the bloat that caused the failure (self-reinforcing F9 loop).

### Reasoning

F9 ("Prompt is too long") is a failure mode where bloated memory files overflow the LLM prompt. The Apr 18–19 incident (cycles #2686–#2723) was partially addressed by Leo's mechanical unblock + DEC-R001's `enforceTokenCap` fix + the Apr 20 addition of `self-reflection.md` to the rolling-window rotation. But `working-memory.md` kept growing under quiet-hold conditions because:

1. **Every supervisor cycle appended** a `working_memory_compressed` entry, including dozens of "52nd quiet-hold, no_action" duplicates that carried no signal.
2. **The rolling-window rotation threshold is per-file (100 KB)**. `working-memory.md` reached 514 lines (~40 KB) during the Apr 23 recurrence — enough to contribute to prompt overflow at aggregate level, but not enough to trigger its own rotation.
3. **Each prompt-too-long failure** appended the error text itself via `savePartialCycleWork`, compounding the bloat that caused the failure. Self-reinforcing.

Rolling-window rotation (DEC-069 pipeline) is still the correct mechanism for genuine content growth — and it works: 12 c0 entries, 58 c1, 43 c2, 103 UV exist for `working-memory` content on 2026-04-24. The problem was that no_action cycles generated *non-signal* growth fast enough to approach overflow without triggering rotation. Skipping the append at the source removes the non-signal growth channel; rotation continues to handle the signal channel.

### Alternatives considered

1. **Cap last N entries with FIFO rotation** — palliative. Addresses symptom (bloat) without addressing cause (non-signal writes). Rejected.
2. **Tighten rolling-window threshold from 100 KB to a smaller value** — would fire rotation more often, but doesn't stop no_action entries entering in the first place. Rotation cost is non-trivial (c0→c1 compression API call). Rejected in favour of not writing the entry.
3. **Modify the supervisor prompt to tell Jim not to emit `working_memory_compressed` on no_action cycles** — depends on Jim remembering. Structural worker-level fix is more reliable. Rejected as primary, kept as secondary guidance.

### Why Settled

The F9 pattern has now recurred twice. The structural fix at worker level (not prompt level) is the only thing that addresses the failure mode durably. Reverting this decision would re-open the same loop. Changing this behaviour requires explicit discussion and approval per the Settled Decisions Protocol.

### Settled-decision impact

- DEC-R001 (enforceTokenCap for self-reflection.md) — complementary; that decision prevented self-reflection.md growth; this decision prevents working-memory.md growth under quiet-hold.
- DEC-068/069 (gradient spec) — untouched. The gradient rotation pipeline is still authoritative for memory-file archival.
- DEC-073 (gatekeeper-controlled files) — no gatekeeper files modified.

### Follow-up

- Server restart required to pick up the new supervisor-worker.ts code.
- Watch `supervisor_cycles` hold-streak metric: it should keep incrementing even though working-memory.md no longer gains corresponding entries.
- If genuine signal cycles (actions present or context updates) stop appearing in working-memory, the predicate is too loose — revisit.

