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
