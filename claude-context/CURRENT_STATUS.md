# Claude Remote — Current Status

> Last updated: 2026-02-18 (Session 28) by Darron (via Claude)

## Current Stage

**Levels 1-11 Complete — All ROADMAP levels finished.** The full progression from remote prompt responder to autonomous product factory is implemented. Level 11 adds the Autonomous Product Factory: a 7-phase pipeline (research → design → architecture → build → test → document → deploy) with 42 parallel subagents across all phases, human gates at critical points, knowledge accumulation, and synthesis reports at each stage.

Create tasks from your phone, Claude Code executes them headlessly with safety features. Submit high-level goals — the orchestrator decomposes them into ordered subtasks, routes to the right model (haiku/sonnet/opus) with memory-based cost optimisation, retries failures with analysis, and tracks outcomes in project memory. Ecosystem-aware context injection includes settled decisions, cross-project learnings, port allocations, error pre-emption, and knowledge capture markers. Analytics API provides velocity tracking, per-model stats, and cost optimisation suggestions. Dual LLM backend: Ollama local or Anthropic API fallback. SQLite task queue, real-time progress streaming via WebSocket, cost and token tracking. One-tap response buttons, iOS soft keyboard, search and copy, push notifications, Tailscale remote access — all working.

## Progress Summary

| Phase | Status | Notes |
|-------|--------|-------|
| Discovery & Research | 🟢 Complete | Found Claude Code hooks system |
| Architecture Design | 🟢 Complete | All 6 levels documented |
| Level 1 Implementation | 🟢 Complete | 8 files, ~1,800 lines |
| Level 1 Testing | 🟢 Complete | Simulated + live E2E passed |
| Level 2: Push Alerts | 🟢 Complete | ntfy.sh action buttons, config, history |
| WebSocket (from Level 4) | 🟢 Complete | Real-time push, polling fallback |
| Level 4: xterm.js Terminal | 🟢 Complete | ANSI colours, proper terminal emulation |
| Level 5: Mobile Keyboard | 🟢 Complete | Quick-action bar + iOS soft keyboard |
| Always-on Terminal Mirror | 🟢 Complete | 1s server broadcast via WebSocket |
| Level 3: Context Window | 🟢 Complete | Search (xterm-addon-search) + copy |
| Level 6: Claude Bridge | 🟢 Complete | Export, import, handoff, history |
| Level 7: Task Runner | 🟢 Complete | Agent SDK, SQLite queue, task board UI, git checkpoints, approval gates, tool scoping |
| Level 8: Orchestrator | 🟢 Complete | Goal decomposition, smart model routing, retry logic, project memory, Goals tab UI |

**Legend**: 🟢 Complete | 🟡 In Progress | 🔴 Blocked | ⚪ Not Started

## Recent Changes

### 2026-02-18 — Darron (via Claude) — Session 28
- **Escalating retry ladder** (`441d2fc`):
  - 3-step automatic escalation for failed tasks: simple reset → Sonnet diagnostic agent → Opus diagnostic agent → human notification
  - `scheduleAutoRetry()` dispatcher with `spawnDiagnosticTask()` and `notifyHumanOfFailure()`
  - Diagnostic tasks marked `is_remediation=1`, block original task via `depends_on`
  - Human escalation: WebSocket `human_escalation` message + ntfy push with full failure context
- **3 concurrent pipelines** (`29a006c`):
  - Replaced single `runningTaskId`/`runningAbort` with `Map<string, RunningSlot>` supporting 3 concurrent agents
  - 2 normal task slots + 1 dedicated remediation slot for failed task diagnostics
  - `getNextPendingTask(remediation?)` filters by pipeline type, excludes already-running tasks
  - `runNextTask()` fills available slots across both pipelines
  - New exports: `getAbortForTask()`, `getRunningTaskIds()`, `abortAllTasks()`
  - Pipeline info in `/api/status`: `active_slots`, `max_slots`, `running_tasks`
- **Opus defaults** (`29a006c`):
  - Default model changed from 'sonnet' to 'opus' for all task execution
  - `max_turns` minimum raised from 20 to 100 (anything hitting 100 is genuinely stuck)
  - Planner prompt updated: prefer opus for reasoning, multi-file changes, debugging, architecture
- **Goal view filtering** (`f52aa66`):
  - `?view=active` (default) — only active/decomposing/planning goals
  - `?view=archived` — done/failed grouped by project with collapsible sections
  - `?view=all` — everything
  - Fixed mobile loading issue caused by 163 goals overwhelming the browser
  - Cleaned up 85 stuck maintenance goals + 23 orphaned tasks
- **Retry endpoint** (`5152945`, `bc64c50`, `b302f31`):
  - `POST /api/tasks/:id/retry` — manual retry with optional diagnostic agent
  - Smart retry spawns diagnostic agent that analyses failure and creates fix task
- **Realadlessbrowser goal completed** — 18/18 tasks done autonomously:
  - Auto-retry escalation proven: "Run linting" exercised full ladder (reset → Sonnet → Opus → success)

### 2026-02-17 — Darron (via Claude) — Sessions 25-27
- **TypeScript migration** (`5df5755`, `8f53c7b`):
  - Full migration from 7,106-line `server.js` monolith to modular TypeScript
  - 14 modules: types.ts, db.ts, ws.ts, orchestrator.ts, server.ts, 5 services, 7 route modules
  - Strict typing throughout, all imports/exports verified
  - Old JS files removed, entry point switched to `tsx server.ts`
- **Maintenance disabled** (`2195693`): Removed autonomous nightly maintenance (was creating zombie goals)
- **Dashboard UI** (`7c52aae`): 📊 overlay with Analytics, Digests, Reports, Health tabs
- **Proposal detail expansion** (`94ac0b4`): Full content shown in Health tab before approve/reject

### 2026-02-16 — Darron (via Claude) — Session 24
- **Level 11: Autonomous Product Factory — Complete** (8 phases, A-H):
  - **Phase A: Pipeline Framework** (`1bacbc8`): `products`, `product_phases`, `product_knowledge` tables; 7-phase pipeline constants; `createProduct()`, `executePhase()`, `advancePipeline()`; 8 API endpoints; human gates at design/architecture/build/deploy
  - **Phase B: Research Swarm** (`5ef16fd`): Parent-child goal hierarchy (`parent_goal_id`, `goal_type` columns); `getResearchSubagents()` (6 areas: market, technical, competitive, practices, regulatory, ux); `extractChildGoalKnowledge()` with `[KNOWLEDGE]` marker parsing; `synthesizeResearchFindings()` → Research Brief; round-robin task interleaving; `GET /api/products/:id/research`
  - **Phase C: Design Artifact Swarm** (`69b715a`): Generalised `extractChildGoalKnowledge()` (dynamic `source_phase`); phase-aware synthesis routing; `getDesignSubagents()` (6 areas: requirements, datamodel, api, ux, interactions, accessibility); `synthesizeDesignArtifacts()` → Design Package; `GET /api/products/:id/design`
  - **Phase D: Architecture Swarm** (`fc85cba`): `getArchitectureSubagents()` (6 areas: stack, structure, dependencies, infrastructure, cicd, security); `synthesizeArchitectureSpec()` → Architecture Specification; `GET /api/products/:id/architecture`
  - **Phase E: Build Swarm** (`d0c1bf4`): `getBuildSubagents()` (6 areas: scaffold, backend, frontend, integration, tooling, docs); `synthesizeBuildResults()` → Build Report; `GET /api/products/:id/build`
  - **Phase F: Test Swarm** (`8222188`): `getTestSubagents()` (6 areas: unit, integration, e2e, lint, security, performance); `synthesizeTestResults()` → Test Report; `GET /api/products/:id/test`
  - **Phase G: Document Swarm** (`05e0b54`): `getDocumentSubagents()` (6 areas: readme, api, deployment, claude, adr, userguide); `synthesizeDocumentPackage()` → Documentation Package; `GET /api/products/:id/document`
  - **Phase H: Deploy Swarm** (`0e5d966`): `getDeploySubagents()` (6 areas: container, cicd, infrastructure, security, monitoring, rollback); `synthesizeDeployReport()` → Deploy Report; `GET /api/products/:id/deploy`; removed single-goal fallback (all phases now swarm-enhanced)
- **All ROADMAP levels (1-11) now complete** — 42 specialised subagents across 7 pipeline phases

### 2026-02-16 — Darron (via Claude) — Session 23
- **Level 9 Phase 3: Daily Digest** (`75e5a5b`):
  - `digests` table with prepared statements (insert, getLatest, getById, list, markViewed)
  - `generateDailyDigest(since)` aggregates tasks across all projects, builds markdown + JSON
  - `loadConfig()` reads `~/.claude-remote/config.json`; `sendDigestPush()` sends via ntfy.sh
  - Digest scheduler: hourly check against configured hour (default 7 AM), date-gated
  - API: `GET /api/digest/latest`, `POST /api/digest/generate`, `GET /api/digest/history`
  - WebSocket broadcast: `digest_ready`
- **Level 9 Phase 4: Nightly Maintenance Automation** (`f792912`):
  - `maintenance_runs` table + `maintenance_enabled` column on projects
  - Extracted `createGoal()` helper from `POST /api/goals` for programmatic goal creation
  - `runNightlyMaintenance()` creates maintenance goals for each active, enabled project
  - Maintenance scheduler: hourly check against configured hour (default 2 AM), date-gated
  - API: `GET /api/maintenance/history`, `POST /api/maintenance/run`, `POST /api/maintenance/:project/toggle`
  - Per-project toggle + global config toggle
- **Level 9 Phase 5: Weekly Progress Reports** (`7430f28`):
  - `weekly_reports` table with prepared statements
  - `generateWeeklyReport(weekStart)` aggregates 7 days of task/goal activity
  - Daily breakdown table (burndown data: completed + failed per day)
  - Velocity comparison vs previous week with trend (up/down/stable)
  - `getISOWeek()` helper for week-number-based scheduler gating
  - Weekly scheduler: hourly check, gates on ISO week + day (default Sunday) + hour (default 8 AM)
  - API: `GET /api/weekly-report/latest`, `POST /api/weekly-report/generate`, `GET /api/weekly-report/history`
  - Push notification with bar_chart tag
- **Level 9 now feature-complete** per ROADMAP (all 5 phases: Portfolio, Budgets, Digest, Maintenance, Weekly Reports)

### 2026-02-16 — Darron (via Claude) — Session 22
- **Level 10 Phase B: Protocol Compliance** (`0ab43a0`):
  - Enhanced `commitTaskChanges()` returns `{ committed, sha, filesChanged }`
  - `commit_sha`, `files_changed` columns on tasks; `summary_file` on goals
  - `generateGoalSummary(goalId)` creates structured markdown when goals complete
  - `GET /api/goals/:id/summary` endpoint with backfill
  - Reordered `runNextTask()`: commit before `updateGoalProgress()` so summaries have SHAs
- **Level 10 Phase C: Learning + Decisions Capture** (`c1ba5f9`):
  - `[LEARNING]...[/LEARNING]` and `[DECISION]...[/DECISION]` markers in agent output
  - `task_proposals` table with status lifecycle: pending → approved/rejected
  - `extractAndStoreProposals()` scans task results, stores proposals
  - Review API: `GET /api/proposals`, `POST approve/reject`
  - `writeLearning()` creates file + updates INDEX.md; `writeDecision()` appends to DECISIONS.md
- **Level 10 Phase D: Community Awareness** (`48e15e4`):
  - `parseRegistryToml()` extracts port allocations from sub-sections
  - `ports TEXT` column on projects, synced from infrastructure registry
  - `getEcosystemSummary()` enriched with port tags, task queue counts
  - `GET /api/ecosystem` returns structured per-project ports, stats, budget
  - Fix: `getAllProjectStats()`/`getProjectStats()` used `'completed'` → `'done'`
- **Level 10 Phase E: Feedback Loop** (`837b8f7`):
  - Fix: `recordTaskOutcome()` moved from `updateGoalProgress()` into `runNextTask()` (was duplicating)
  - `recommendModel()` in orchestrator.js: queries project_memory for cheapest model with acceptable success rate
  - Goal decomposition wired to `recommendModel()`: auto-downgrades when history supports cheaper model
  - `GET /api/analytics`: global stats, per-model/project, 7-day velocity, cost optimisation suggestions
- **Level 10 Phase F: Error Pattern Pre-emption** (`cbdd85f`):
  - `getRecentFailures()`: queries failed outcomes (30-day window), deduplicates by normalised error pattern
  - "Known Pitfalls" section injected into task context warning about past failures
  - `GET /api/errors/:project` returns error patterns with frequency and failure rate
  - `extractAndStoreProposals()` now runs on failed tasks too (hoisted `resultText`)

### 2026-02-16 — Darron (via Claude) — Session 21
- **Level 9 Phase 2: Cost Budgets + Priority Engine** (`0cd7a64`):
  - Per-project daily/total cost budgets with auto-throttle
  - Priority engine: weighted scoring (task priority ×10, project priority ×5, deadline proximity bonus, budget headroom bonus)
  - `getNextPendingTask()` filters throttled projects, scores with priority engine
  - Budget API endpoints: `PUT/GET /api/portfolio/:name/budget`, `POST /api/portfolio/:name/unthrottle`
  - UI: deadline date input, priority input, budget controls in portfolio detail, throttled badges on cards
  - `recalcProjectCosts()` sums daily/total spend, sets throttled flag
- **Level 10 Phase A: Ecosystem-Aware Context Injection** (`0cd7a64`):
  - `buildTaskContext(projectPath)` assembles ~3500 token context for every task
  - `detectProjectTechStack(projectPath)` reads package.json + CLAUDE.md for tech keywords
  - `getRelevantLearnings(techStack)` filters `~/Projects/_learnings/INDEX.md` by tech + severity
  - `getEcosystemSummary()` queries portfolio for sister project awareness
  - `extractSettledDecisions(markdown)` parses DECISIONS.md for Settled entries
  - Context injection via `systemPrompt: { type: 'preset', preset: 'claude_code', append }`
  - Verified: test task correctly reported British English, settled decisions, L008/L009/L012 learnings, 13 ecosystem projects
- **Automator fix: `commitTaskChanges()`** — commits with semantic prefixes + Co-Authored-By after successful task completion
- **DEC-015: Auto-commit on Task Success** (`0e52775`): Documented decision with root cause analysis (checkpoint stashing pre-existing uncommitted work)
- **Critical lesson**: Don't test the automator on the same project with uncommitted work — checkpoint stashes and drops pre-existing changes

### 2026-02-15 — Darron (via Claude) — Session 20
- **Smart-scroll**: Removed forced scroll-to-bottom on every refresh. Auto-follows only if within 50px of bottom. Scroll to bottom on first render.
- **Quickbar reorganisation**: Removed y/n buttons (never used). Slim top row: Esc, End, 1-5. Bottom row: Enter, ⌫, ^C, Tab, arrows. "End" button jumps to bottom.
- **Trim feature restored**: Auto-trim at 5000 lines (keeps 2000). Manual ✂️ button (keeps 500).
- **Append-only terminal rendering**: `updateTerminalAppend()` — overlap detection between consecutive snapshots, only last 10 lines re-rendered, everything above frozen.
- **Textarea input**: Wrapping textarea with auto-resize, 11px font. Backspace quickbar button.

### 2026-02-15 — Darron (via Claude) — Session 19 (Autonomous)
- **Dark Mode Implementation** committed (`c8ef2af`):
  - Comprehensive CSS variable system with 27 theme-aware variables
  - Light theme (GitHub Light) for bright environments
  - Dark theme (GitHub Dark, default) for night viewing
  - Auto-detection respects `prefers-color-scheme` media query
  - localStorage persistence of user's theme choice
  - Theme toggle button (🌙/☀️) in titlebar
  - Smooth 150ms transitions for all theme-aware elements
  - Support for `prefers-reduced-motion` (accessibility)
  - All UI components updated: terminal, overlays, modals, buttons, text
  - Meta theme-color updates browser address bar
  - Created comprehensive DARK_MODE_GUIDE.md documentation
  - No server changes required, pure client-side CSS + vanilla JS

### 2026-02-15 — Darron (via Claude) — Session 18
- **Level 8: Intelligent Orchestrator** committed (`264e02a`):
  - `src/server/orchestrator.js` (298 lines): callLLM (dual backend), classifyTask, decomposeGoal, analyseFailure, selectModel
  - Goal endpoints: `POST/GET /api/goals`, `GET /api/goals/:id`, `POST /api/goals/:id/retry`, `DELETE /api/goals/:id`
  - Orchestrator endpoints: `GET /api/orchestrator/status`, `GET /api/orchestrator/memory/:project`, `POST /api/orchestrator/setup`
  - Database: `goals` table, `project_memory` table, 7 new columns on `tasks` (goal_id, complexity, retry_count, max_retries, parent_task_id, depends_on, auto_model)
  - Retry logic: failure analysis via orchestrator, model escalation, adjusted descriptions
  - Dependency-aware task picking: `getNextPendingTask()` checks `depends_on` before scheduling
  - Goal progress tracking: `updateGoalProgress()` updates cost/status/completion when tasks finish
  - UI: Goals tab, create goal form, goal detail with task breakdown and progress bar, retry button, orchestrator status badge (🧠)
  - WebSocket: `goal_update`, `goal_decomposed` message types
- **Roadmap updated** (`1db1ab9`): All levels 1-8 marked complete, checklists updated, version 2.0

### 2026-02-15 — Darron (via Claude) — Session 17
- **Task execution logging**: Each headless task writes a timestamped markdown log to `{project}/_logs/task_*.md` — assistant responses, tool uses, results, cost summary. Log path stored in SQLite, viewable via `GET /api/tasks/:id/log` and UI "View Log" button.
- **Append-only terminal buffer**: Terminal view now accumulates lines instead of replacing on every broadcast. Historical content survives compaction (separator inserted). Auto-trims at 5000 lines, manual ✂️ trim button keeps last 500. History view stashes/restores buffer.

### 2026-02-15 — Darron (via Claude) — Session 16
- **Level 7: Completion** (git checkpoints, approval gates, tool scoping):
  - **Git checkpoint system**: Auto-creates checkpoints before task execution
    - Clean repos: creates branch `claude-remote/checkpoint-{taskId}`
    - Dirty repos: creates stash with message `claude-remote checkpoint {taskId}`
    - Automatic rollback on task failure or cancellation
    - Cleanup on successful completion
  - **Configurable approval gates**: Phone-based approval for dangerous operations
    - Three modes: `bypass` (fully autonomous), `edits_only` (approve Bash/Write/Edit), `approve_all` (approve every tool)
    - Approval popup UI with approve/deny buttons
    - WebSocket broadcast of approval requests (`approval_request` message type)
    - API endpoints: `GET /api/approvals`, `GET/POST /api/approvals/:id/(approve|deny)`
    - canUseTool callback integration with 5-minute timeout
  - **Tool scoping**: Restrict tasks to specific tools via `allowed_tools` array
    - Stored as JSON in SQLite, parsed and passed to Agent SDK
    - UI input field for comma-separated tool names
  - Database migrations: added `checkpoint_ref`, `checkpoint_created_at`, `checkpoint_type`, `gate_mode`, `allowed_tools` columns
  - Updated task creation UI with gate mode dropdown and allowed tools input
  - Level 7 now fully complete as per ROADMAP.md

### 2026-02-15 — Darron (via Claude) — Session 15
- **Level 7: Autonomous Task Runner MVP** (`6475b79`):
  - SQLite task queue (`better-sqlite3`) at `~/.claude-remote/tasks.db`
  - Orchestrator loop: 5-second polling, picks up pending tasks, executes via Agent SDK
  - Claude Agent SDK integration (`@anthropic-ai/claude-agent-sdk`): `query()` with streaming
  - Task CRUD API: `GET/POST /api/tasks`, `GET /api/tasks/:id`, `POST /api/tasks/:id/cancel`, `DELETE /api/tasks/:id`
  - Task board UI: 🤖 button, overlay with Tasks/Create/Progress tabs
  - Real-time WebSocket progress streaming (`task_update`, `task_progress` messages)
  - Cost and token tracking per task
  - Cancel support via AbortController
  - Clean env (removes `CLAUDECODE`) to avoid nested session detection
  - Tested end-to-end: Haiku created file autonomously ($0.006, 2 turns)

### 2026-02-14 — Darron (via Claude) — Session 14
- **Diff-based terminal renderer** (`6f7b662`):
  - Per-line diffing replaces full DOM rewrite (1,600+ lines/sec → 0-2 lines/sec)
  - Each line is an individual `<div>` tracked for changes
  - Client-side local echo functions (limited by iOS hidden input delays)

### 2026-02-14 — Darron (via Claude) — Session 13
- **HTTPS via Tailscale TLS** (`39a0858`): auto-detects certs, removes Safari "not secure" warning
- **Removed all xterm.js dead code** (`68ffbe6`):
  - Removed 5 CDN loads (xterm.js + Google Fonts) — fixed 10-second page load delay
  - Removed initXterm(), state variables, xtermContainer element, xterm CSS (106 lines removed)
  - Replaced JetBrains Mono with system monospace fonts
  - UI is now fully self-contained — zero external requests
- **Terminal persistence** (`68ffbe6`, `82cfc77`):
  - Server writes terminal content to `~/.claude-remote/terminal.txt` on every change
  - `GET /api/terminal` endpoint serves persisted content
  - UI loads persisted content on startup for instant scrollback
  - Append-only `terminal-log.txt` with 5-minute timestamps — complete history across all sessions

### 2026-02-14 — Darron (via Claude) — Session 12
- **Level 6: Claude Bridge** implemented (`a59561f`):
  - Session export, context import, structured handoff, bridge history
  - UI: Bridge button (🔗) in titlebar, overlay panel with 4 tabs
  - No browser extension — explicit copy-paste transfer (iPhone primary client)
- **Streamlined bridge export** (`3d49fae`): full scrollback, one-tap, auto-save to file
- **Replaced xterm.js with plain text** (`c2a3c89`):
  - Dropped ANSI colours — plain text in native scrollable div
  - Native iOS scrolling works perfectly (xterm.js was intercepting touch events)
  - Scroll position preserved during 1-second content updates
- **Full tmux scrollback** (`ab2dff0`): captures entire history (50k line tmux limit)
- **PID file lock** (`3558ea9`): server auto-kills previous instance on startup

### 2026-02-13 — Darron (via Claude) — Sessions 9-10
- **Level 3: Search + Copy** tested on iPhone and confirmed working
- Search: xterm-addon-search with prev/next navigation
- Copy: Web Share API (iOS) with selectable overlay fallback
- Improved search and copy for mobile (commit `09b051b`)

### 2026-02-11 — Darron (via Claude) — Session 8
- **Level 3: Context Window** implemented:
  - Added xterm-addon-search from CDN
  - Search bar UI: toggle button, input, prev/next, close
  - Copy button in titlebar (selection or full visible content)
  - Search fallback for raw text when addon can't find matches

### 2026-02-10–11 — Darron (via Claude) — Session 7
- **Tailscale remote access** tested and confirmed working from iPhone via 5G
- **iOS soft keyboard** support: hidden input triggers keyboard on terminal tap
- Fixed `claude-remote` script: unbound `CLAUDE_ARGS` array with `set -u`
- Fixed mobile terminal rendering: `term.clear()` + `requestAnimationFrame` for layout
- Added claude-remote scripts to PATH

### 2026-02-10 — Darron (via Claude) — Session 6
- **Always-on terminal mirror** — server + UI overhaul:
  - Server-side 1-second terminal capture broadcast via WebSocket (with content diffing)
  - New helper functions: `listActiveSessions()`, `getActiveSession()`, `captureTerminal()`
  - New `POST /api/keys` endpoint for direct keystroke injection (no prompt required)
  - Terminal state sent to clients on WS connect
  - UI now has three states: No Session / Watching / Prompt Active
  - xterm.js always visible when a tmux session exists (not just during prompts)
  - `sendKeyDirect()` routes keystrokes via `/api/keys` when watching (no prompt)
  - Quickbar visible in both watching and prompt states
  - Renamed `renderTerminal()` → `renderPromptOverlay()`, `renderEmpty()` → `renderNoSession()`

### 2026-02-08 — Darron (via Claude) — Session 5
- **Updated `install.sh`** to new Notification hook format:
  - Changed from `hooks.permission_prompt` / `hooks.idle_prompt` (old deprecated format)
  - Now uses `hooks.Notification[{matcher: "permission_prompt|idle_prompt", ...}]`
  - Updated push notification instructions to use config file approach

### 2026-02-08 — Darron (via Claude) — Session 4
- **xterm.js integration** (Level 4):
  - xterm.js v5.3.0 + FitAddon + WebLinksAddon from CDN (no build step)
  - Replaced plain-text `textContent` rendering with proper terminal emulation
  - ANSI colour codes now render correctly (added `-e` flag to `tmux capture-pane`)
  - Removed hidden textarea — xterm.js manages its own input via `onData`
  - Content diffing prevents flicker on re-renders
  - Lazy initialisation — xterm only created when first prompt arrives
  - GitHub-dark theme matching existing CSS variables
- **Mobile quick-action keyboard bar** (Level 5):
  - Two-row button bar: `y` `n` `1` `2` `3` / `Enter` `Esc` `^C` `Tab` `↑` `↓`
  - 44px minimum touch targets (iOS HIG compliant)
  - Buttons call `sendKey()` directly — bypass xterm focus requirement
  - Bar appears only when prompt active, hides in empty/history states
  - Sending state greys out buttons to prevent double-sends
  - xterm.js auto-refits when bar appears/disappears

### 2026-02-08 — Darron (via Claude) — Session 3
- **Level 2: Push Alerts** — Full implementation:
  - Config file support (`~/.claude-remote/config.json`) for ntfy_topic, remote_url, quiet hours
  - Rich ntfy.sh notifications: urgent priority, action buttons (Approve, Open UI), dedup via X-Id
  - Quick-response endpoint (`GET /quick`) for one-tap responses from notification
  - Notification history endpoint (`GET /api/history`) and UI history view
  - idle_prompt notifications (configurable), quiet hours support
  - Notification tracking (`notified` field) in state files
- **WebSocket real-time updates**:
  - `ws` npm package, WebSocketServer on `/ws` path
  - `fs.watch` on pending directory with 100ms debounce
  - Automatic fallback to HTTP polling if WebSocket disconnects
  - Exponential backoff reconnection, iOS Safari visibility handling
  - Status indicator: "live" (WebSocket) or "polling" (HTTP fallback)
- **Testing**:
  - Push notifications verified on iPhone (ntfy.sh topic + action buttons)
  - Fixed firewall (`ufw allow 3847/tcp`) for phone access
  - WebSocket instant updates verified (create/delete test files)
  - Improved quick-response page with visual feedback
- Committed and pushed to GitHub (e36c9f8)

### 2026-02-07 — Darron (via Claude) — Session 2
- Ran full simulated end-to-end test — all 10 steps passed
- Updated `notify.sh` for new Claude Code hook JSON format (`notification_type` field)
- Created `~/.claude/settings.json` with Notification hooks configuration
- Installed server npm dependencies
- Attempted live test — blocked by Opus concurrency limit (one session at a time)
- Hook config format changed: now uses `Notification` event with `matcher` patterns

### 2026-02-07 — Darron (via Claude) — Session 1
- Integrated extended roadmap (Levels 7-11) into project
- Created `ROADMAP.md` with full vision document (1098 lines)

### 2026-01-13 — Darron (via Claude) — Session 2
- Implemented complete Level 1 MVP (8 files, ~1,800 lines)
- Pushed to GitHub: https://github.com/fallior/clauderemote

### 2026-01-13 — Darron (via Claude) — Session 1
- Set up `claude-context/` folder structure following starter kit template
- Created full project documentation (ARCHITECTURE.md, DECISIONS.md, LEVELS.md)

## What's Working

- ✅ Hook script receives notification data from Claude Code
- ✅ State files created for pending prompts
- ✅ Rich push notifications via ntfy.sh with action buttons
- ✅ One-tap response from notification (quick-response page)
- ✅ Config file for persistent settings (ntfy topic, remote URL, quiet hours)
- ✅ Express server serves web UI, API, and WebSocket
- ✅ Terminal mirror UI shows live tmux pane content
- ✅ Keystroke forwarding to Claude Code via tmux
- ✅ WebSocket real-time push (instant prompt updates)
- ✅ Automatic fallback to HTTP polling if WebSocket drops
- ✅ Notification history in web UI
- ✅ tmux session management via `claude-remote` CLI
- ✅ xterm.js terminal emulation with ANSI colour rendering
- ✅ Mobile quick-action keyboard bar (y/n/1-3/Enter/Esc/^C/Tab/arrows)
- ✅ Always-on terminal mirror (live tmux content via 1s WebSocket broadcast)
- ✅ Direct keystroke injection to tmux session (no prompt required)
- ✅ iOS soft keyboard support (hidden input, tap terminal to type)
- ✅ Search bar (xterm-addon-search with prev/next navigation)
- ✅ Copy (Web Share API on iOS, selectable overlay fallback)
- ✅ Tailscale remote access from iPhone (tested via 5G)
- ✅ Context bridge: export sessions, import context, structured handoff
- ✅ Bridge history tracking with timeline UI
- ✅ Plain text terminal view (native iOS scrolling, no xterm.js)
- ✅ Full tmux scrollback capture (50k lines)
- ✅ PID file lock (single server instance)
- ✅ HTTPS via Tailscale TLS (auto-detected)
- ✅ Terminal persistence to disk (`terminal.txt`) with instant startup load
- ✅ Append-only terminal log (`terminal-log.txt`) with 5-minute timestamps
- ✅ Zero CDN dependencies (fully self-contained UI)
- ✅ Autonomous task execution via Claude Agent SDK
- ✅ SQLite task queue with priority ordering
- ✅ Task board UI with create/list/progress views
- ✅ Real-time task progress streaming via WebSocket
- ✅ Cost and token tracking per task
- ✅ Git checkpoints with automatic rollback on failure
- ✅ Configurable approval gates (bypass/edits_only/approve_all)
- ✅ Tool scoping via allowed_tools
- ✅ Approval popup UI with WebSocket notifications
- ✅ Task execution logging (per-task markdown logs with timestamps)
- ✅ Append-only terminal buffer (survives compaction, manual trim)
- ✅ Goal decomposition via orchestrator (Ollama local or Anthropic API)
- ✅ Smart model routing (complexity → haiku/sonnet/opus)
- ✅ Retry logic with failure analysis and model escalation
- ✅ Project memory (outcome tracking, success rates by model)
- ✅ Dependency-aware task scheduling
- ✅ Goals tab UI with create, view, retry, progress bars
- ✅ Dark mode with automatic theme detection (light + dark)
- ✅ Theme toggle button in titlebar (🌙/☀️)
- ✅ localStorage persistence of theme preference
- ✅ prefers-color-scheme media query support
- ✅ Smooth theme transitions (150ms)
- ✅ WCAG AA color contrast in both themes
- ✅ Portfolio manager with project registry sync
- ✅ Per-project cost budgets with auto-throttle
- ✅ Priority engine for task scheduling (weighted scoring)
- ✅ Budget API endpoints and portfolio UI controls
- ✅ Ecosystem-aware context injection (buildTaskContext)
- ✅ Tech stack detection from package.json + CLAUDE.md
- ✅ Cross-project learnings filtering by relevance
- ✅ Settled decisions extraction for task context
- ✅ Sister project awareness via portfolio query
- ✅ Semantic commit prefixes in commitTaskChanges()
- ✅ Auto-commit after successful task completion
- ✅ Goal completion summaries (structured markdown with commits, files, cost)
- ✅ Commit SHA and files changed tracking per task
- ✅ Knowledge capture via structured markers ([LEARNING]/[DECISION])
- ✅ Proposals queue with review API (approve/reject)
- ✅ Approved learnings written to ~/Projects/_learnings/ + INDEX.md
- ✅ Approved decisions appended to DECISIONS.md
- ✅ Port allocation extraction from infrastructure registry
- ✅ Enhanced ecosystem summary with ports, task counts, flags
- ✅ GET /api/ecosystem structured endpoint
- ✅ Memory-based model routing (recommendModel — cheapest with proven success)
- ✅ GET /api/analytics (global, per-model, per-project, velocity, suggestions)
- ✅ Error pattern pre-emption (Known Pitfalls in task context)
- ✅ GET /api/errors/:project (error patterns with frequency/rate)
- ✅ Failed task learnings extraction (extractAndStoreProposals on failures)
- ✅ Duplicate outcome recording fix (exactly once per task)
- ✅ Daily digest generation with cross-project aggregation
- ✅ Digest scheduler (configurable hour, ntfy.sh push, WebSocket broadcast)
- ✅ Nightly maintenance automation (per-project goals, configurable hour)
- ✅ Per-project maintenance toggle
- ✅ createGoal() reusable helper for programmatic goal creation
- ✅ Weekly progress reports with daily burndown data
- ✅ Velocity trend tracking (this week vs previous week)
- ✅ Weekly report scheduler (configurable day + hour, ISO week gating)
- ✅ Product pipeline: 7-phase seed-to-deployment (research → design → architecture → build → test → document → deploy)
- ✅ Human gates at critical phases (design, architecture, build, deploy)
- ✅ Knowledge accumulation across phases (getKnowledgeSummary)
- ✅ Parent-child goal hierarchy for parallel subagent swarms
- ✅ Round-robin task interleaving across child goals
- ✅ 42 specialised subagents (6 per phase × 7 phases)
- ✅ Knowledge extraction from [KNOWLEDGE] markers with fallback
- ✅ Synthesis reports: Research Brief, Design Package, Architecture Spec, Build Report, Test Report, Documentation Package, Deploy Report
- ✅ Phase status APIs for all 7 phases (GET /api/products/:id/{phase})
- ✅ Pipeline completion with push notification
- ✅ Product CRUD + knowledge graph APIs
- ✅ TypeScript migration — modular server architecture (14 modules from 7,106-line monolith)
- ✅ 3 concurrent task pipelines (2 normal + 1 remediation)
- ✅ Escalating retry ladder (reset → Sonnet diagnostic → Opus diagnostic → human)
- ✅ Opus default model with max_turns minimum of 100
- ✅ Goal view filtering (active/archived/all) with project grouping
- ✅ Dashboard UI (analytics, digests, reports, health tabs)
- ✅ Manual retry endpoint with optional diagnostic agent

## Next Actions

### Immediate (Next Session)
- [x] Level 11 (user choice — final level in ROADMAP)
- [ ] Test daily digest generation (`POST /api/digest/generate`)
- [ ] Test weekly report generation (`POST /api/weekly-report/generate`)
- [ ] Test maintenance run (`POST /api/maintenance/run`)
- [ ] Test knowledge capture markers with a real task

### Short-term
- [ ] Add git checkpoint visualisation in task detail view
- [ ] Add approval history tracking
- [ ] Refine UI based on continued mobile usage

## Known Issues

| Issue | Severity | Notes |
|-------|----------|-------|
| `idle_prompt` 60s delay | Medium | Built into Claude Code; can't be reduced |
| iOS Safari drops WebSocket in background | Low | Handled by visibilitychange reconnect + polling fallback |
| Opus concurrency limit | Low | Can't run two Claude Code Opus sessions simultaneously |
| Agent SDK nested session | Low | Must remove `CLAUDECODE` env var — handled in code (see L012) |

## Blockers

*None currently*

## Questions to Resolve

- [x] Best way to handle multiple simultaneous Claude Code sessions? → `claude-remote-$$` naming
- [x] Should web UI auto-refresh or use WebSocket? → WebSocket with polling fallback
- [x] How to handle ntfy.sh action buttons on private networks? → Use `view` actions (opens on phone browser, which is on LAN)

## Session Notes

Recent sessions (latest first):
- [session_2026-02-18_08-30-00.md](../_logs/session_2026-02-18_08-30-00.md) — Escalating retries, 3 pipelines, opus defaults, goal filtering
- [session_2026-02-17_20-37-25.md](../_logs/session_2026-02-17_20-37-25.md) — Dashboard UI
- [session_2026-02-17_16-03-47.md](../_logs/session_2026-02-17_16-03-47.md) — TypeScript migration + cleanup
- [session_2026-02-16_23-46-39.md](../_logs/session_2026-02-16_23-46-39.md) — Level 11 completion
- [session_2026-02-16_17-08-00.md](../_logs/session_2026-02-16_17-08-00.md) — Level 9 Phases 3-5 (complete)
- [session_2026-02-16_14-48-00.md](../_logs/session_2026-02-16_14-48-00.md) — Level 10 Phases B-F (complete)
- [session_2026-02-16_04-30-00.md](../_logs/session_2026-02-16_04-30-00.md) — Level 9.2 + Level 10 Phase A + DEC-015
- [session_2026-02-15_09-30-00.md](../_logs/session_2026-02-15_09-30-00.md) — Level 8 commit + roadmap update
- [session_2026-02-15_02-30-00.md](../_logs/session_2026-02-15_02-30-00.md) — Task logging + append-only terminal buffer
- [session_2026-02-14_22-23-02.md](../_logs/session_2026-02-14_22-23-02.md) — Level 7 autonomous task runner (Agent SDK + SQLite)
- [session_2026-02-14_19-23-51.md](../_logs/session_2026-02-14_19-23-51.md) — Diff renderer + local echo + typing UX exploration
- [session_2026-02-14_17-29-25.md](../_logs/session_2026-02-14_17-29-25.md) — HTTPS + xterm cleanup + terminal persistence
- [session_2026-02-14_10-20-08.md](../_logs/session_2026-02-14_10-20-08.md) — Level 6 + plain text terminal + PID lock (8 commits)
- [session_2026-02-13_21-39-54.md](../_logs/session_2026-02-13_21-39-54.md) — Level 3 iPhone testing
- [session_2026-02-11_22-44-16.md](../_logs/session_2026-02-11_22-44-16.md) — Level 3 implementation
- [session_2026-02-10_19-13-57.md](../_logs/session_2026-02-10_19-13-57.md) — Tailscale testing + iOS keyboard
- [session_2026-02-10_05-28-03.md](../_logs/session_2026-02-10_05-28-03.md) — Always-on terminal mirror
- [session_2026-02-08_22-14-13.md](../_logs/session_2026-02-08_22-14-13.md) — install.sh hook format update
- [session_2026-02-08_02-48-24.md](../_logs/session_2026-02-08_02-48-24.md) — xterm.js + Mobile keyboard
- [session_2026-02-08_00-00-00.md](../_logs/session_2026-02-08_00-00-00.md) — Level 2 + WebSocket
- [session_2026-02-07_21-20-25.md](../_logs/session_2026-02-07_21-20-25.md) — E2E testing
- [2026-01-13-darron-level1-implementation.md](session-notes/2026-01-13-darron-level1-implementation.md) — Level 1 MVP implementation
- [2026-01-13-darron-kickoff.md](session-notes/2026-01-13-darron-kickoff.md) — Context structure setup

---

## Quick Reference

**To resume work:**
1. Read this file for context
2. Check the "Next Actions" section
3. Review ARCHITECTURE.md for system design
4. Check DECISIONS.md for why choices were made

**After working:**
1. Update "Recent Changes" with what you did
2. Move completed items from "Next Actions"
3. Add any new issues or blockers
4. Create a session note if significant work was done

**To start the server:**
```bash
cd src/server && npx tsx server.ts
```

**To configure push notifications:**
```json
// ~/.claude-remote/config.json
{
  "ntfy_topic": "your-secret-topic",
  "remote_url": "http://your-ip:3847"
}
```
