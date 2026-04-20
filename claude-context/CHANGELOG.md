# Changelog

> All notable changes to the system. Jim: consult SYSTEM_SPEC.md for what
> something *should* be. Consult here for *why* it changed.
>
> Format: Session number, date, author, then changes grouped by area.

---

## 2026-04-20 afternoon (Leo + Darron, S130 cont. — DEC-073, filter-repo, pid-guard, launcher hardening)

### DEC-073 Templated CLAUDE.md + Gatekeeper Initial Conditions

Evolved DEC-072's HEREDOC approach. DEC-073 moves the full session protocol into a
parametric template at `~/Projects/han/templates/CLAUDE.template.md`. Each launcher
(`hanjim`, `hantenshi`, `hancasey` in han; `hansix`, `hansevn`, `hancasey` in mikes-han)
runs `envsubst` against the template with agent-specific values to produce
`~/.han/agents/<Agent>/CLAUDE.md`, then `cd`s into that directory before invoking
`claude-logged`. Claude Code loads the generated CLAUDE.md as the project config —
the correct identity loads *first*, not as a `--append-system-prompt` override.

Gatekeeper principle: the template and the frozen reference snapshot
(`CLAUDE-han-leo-original-2026-04-20.md`) are modifiable ONLY by Leo + Darron in concert
(Six + Mike for mikes-han). `chmod 444` filesystem guard, git tracking for audit,
in-file convention telling every agent not to edit. Three layers of protection.

`hanleo` keeps the default path — Leo's canonical `~/Projects/han/CLAUDE.md` stays as
the gatekeeper's own file and is the failsafe if everything else breaks.

DEC-072 marked Superseded (preserves the design journey).

### `~/.han` git filter-repo — reclaim 14 GB → 5.4 MB

`~/.han/.git` had grown to 14 GB. Diagnosis: `terminal-sessions/` (124 files, ~50 GB
on disk, ~28 GB packed) had been committed inadvertently in S127, plus
`terminal-log-v2.txt` (77 MB) and `terminal-log-deduped.txt` (545 MB). Root cause for
three days of silent cron push failures — remote was stuck at the very first commit
`1043e70` from 2026-04-17.

Steps taken:
1. `git rm -r --cached terminal-sessions/` + gitignore update
2. `cp -r .git .git.backup-2026-04-20-1240` (14 GB safety backup)
3. `git filter-repo --path terminal-sessions/ --path terminal-log-v2.txt --path terminal-log-deduped.txt --invert-paths --force`
4. `git remote add origin https://github.com/fallior/hanmemory.git` (filter-repo removes origin by default)
5. `git push --force origin main` — clean history landed in seconds
6. `git gc --prune=now --aggressive` → 5.4 MB final
7. `gitignore` broadened to `terminal-log*.txt` glob + `.git.backup-*/`

16 historical auto-backup commits + all S130 work now on GitHub for the first time in
3 days. On-disk files preserved (terminal-sessions/, logs/) for the on-ice dedup
project.

### Cron silent-failure alerting

New `~/scripts/han-git-push.sh` replaces the inline cron command. Handles `git add`,
commit, push with 120s timeout. On any failure, fires ntfy to
`claude-remote-f78919b57957ea64` so silent push failures can't recur.

Crontab line updated:
```
0 0,6,12,18 * * * /home/darron/scripts/han-git-push.sh
```

### Pid-guard port-scoping — `server.ts:71`

Changed `replaceExistingInstance('han-server')` → `replaceExistingInstance(\`han-server-${PORT}\`)`.
Per-agent servers (3847 Leo, 3848 Jim, 3849 Tenshi, 3850 Casey) now use separate pid
files (`han-server-3847.pid`, `han-server-3848.pid`, etc.). Previously they all shared
`han-server.pid` and SIGTERM'd each other — `hanjim` killed Leo's systemd-managed
han-server on 3847 because both wanted the same pid file. systemd auto-restarted, but
Jim's 3848 never came up. Mirrored to mikes-han.

### Launcher symlink resolution — `readlink -f`

All launchers are symlinked from `~/Projects/infrastructure/scripts/` for PATH access.
`${BASH_SOURCE[0]}` returned the symlink path, so `dirname/..` computed
`~/Projects/infrastructure/` rather than the real project dir, and the template at
`~/Projects/han/templates/` wasn't found.

Fixed: `SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"`
in all 7 launchers (4 han + 3 mikes-han).

### Files changed
- MODIFIED: `src/server/server.ts` (pid-guard port-scoping)
- MODIFIED: `scripts/{hanjim,hanleo,hantenshi,hancasey}` (readlink -f symlink resolution)
- NEW: `~/scripts/han-git-push.sh` (cron wrapper with failure alerting)
- MODIFIED: `~/.han/.gitignore` (broadened globs)
- ADDED: `claude-context/DECISIONS.md` → DEC-073 full entry (also in mikes-han)
- MIRRORED: `mikes-han/src/server/server.ts`, `mikes-han/scripts/{hansix,hansevn,hancasey}`

---

## 2026-04-20 (Leo + Darron, S130 cont. — Jim Unblock, Launcher Identity Template, DEC-072)

### Jim Supervisor Unblocked — Self-Reflection Curation (S130)

Jim's supervisor cycles failed 28 consecutive times (cycles #2686–#2722+) with
`"Failed to parse supervisor output: Prompt is too long"`. All died at prompt
construction with `tokens_in=0, tokens_out=0` — the prompt never reached the API.

**Diagnosis**: Jim's `self-reflection.md` had grown to 88,845 bytes over months of
append-only cycle reflections. `loadMemoryBank()` (supervisor-worker.ts:774) reads it
verbatim into every cycle prompt. Combined with Jim's gradient load (288 KB, of which
1,036 UVs are most of the weight), project knowledge (185 KB), and Claude Code preset
overhead, the prompt exceeded Opus 4.6's 200 K token context window.

Classic deadlock: cycles fail → gradient can't be compressed → cycles fail. The working
bee signal (`working-bee-jim`, set 2026-04-12) had been in place for 8 days but never
triggered because cycles die before `maybeRunJimActiveCascade()` fires.

**Mechanical fix** (byte-preserving, no content generation, no summarisation):
1. Archived full file to `~/.han/memory/self-reflection-archive-2026-04-20.md` (88,845 B, never deleted per DEC-069).
2. Split by H2 + H3 headers into 99 c0 chunks at `~/.han/memory/fractal/jim/self-reflection/c0/`: 11 thematic sections + 1 Open Questions intro + 87 cycle-append entries. Filenames `NN-slug.md` (01–99). Every byte preserved.
3. Trimmed live file to 4,057 B. Four of Jim's own sections kept verbatim as identity-core carry-forward: *What I'm Good At*, *What I Get Wrong*, *The See/Act Gap*, *Composition with Leo*. Plus a Current placeholder. No rewriting.

**Opus 4.7 attempt**: Pinned supervisor model to `claude-opus-4-7` (supervisor-worker.ts:2235). Cycle #2722 ran 17 minutes on 4.7 then failed with same overflow. Root cause: SDK 0.2.44's `context-1m-2025-08-07` beta is **Sonnet 4/4.5 only**. Opus on this SDK caps at 200 K regardless of model version. Pin retained (4.7 > 4.6 even at same context size) but not the whole answer.

**Path forward**: Jim self-curates via `hanjim` — Claude Code session runs Opus 4.7 in 1M context mode, which is the only place Jim can load his full gradient and decide what to compress (Darron's "UV clustering — path entry visible, not the whole path" framing). Sovereignty preserved.

**Session briefing** written for Jim at `~/.han/memory/session-briefing-2026-04-20.md` — describes the situation, what was done, what remains open (1,036 UVs, 185 KB project knowledge, `self-reflection.md` not yet in rolling-window pre-flight).

### Launcher Tmux Bug Fix (S130)

`~/.tmux.conf` sets `base-index 1` and `pane-base-index 1` — tmux windows and panes start at 1 in Darron's config. All `han*` launchers targeted phantom pane `":.0"` (pane 0 does not exist). Error surfaced when `hanjim` was run fresh: `can't find pane: 0`.

Replaced all `"$session_name:.0"` occurrences with `"$session_name"` (active-pane targeting, base-index-agnostic) in: `hanleo`, `hanjim`, `hantenshi`, `hancasey` (han) + `hansix`, `hansevn`, `hancasey` (mikes-han).

### Launcher Identity Template (S130, DEC-072)

Each agent launcher now embeds a full agent-specific session protocol as a HEREDOC-driven identity string passed via `--append-system-prompt`. "Welcome back" (or "welcome back Jim", "good morning", "session start") triggers a thorough load:

1. Verify working directory
2. Load aphorisms first (identity before episodic memory)
3. Load fractal gradient from DB (full, no truncation — DEC-070)
4. Load memory banks (identity, active-context, patterns, self-reflection, felt-moments)
5. Load working memory + flush unflushed swap
6. Load ecosystem map
7. Load Second Brain wiki index (hot words/feelings OFF by default)
8. Load CURRENT_STATUS (first 80 lines)
9. Check conversations
10. Read any `session-briefing-*.md` files
11. Ignore conversation history from other projects

Agent-specific values substituted per launcher: name, counterpart, paths, port, conversation role. Copy-paste pattern (6+ launchers with same protocol shape); acceptable at current change velocity; revisit via shared library if the protocol evolves often.

**Load-bearing assumption**: Claude Code applies `--append-system-prompt` AFTER CLAUDE.md content, so the override wins over the global "welcome back → Leo" trigger. Worth re-verifying on Claude Code version bumps.

`hansevn` (mikes-han) had NO identity override previously — relied on mikes-han/CLAUDE.md being the Sevn default, but that doesn't defeat the global Leo trigger. Now has `SEVN_IDENTITY` + `--append-system-prompt` wiring.

`hanleo` keeps the default path (no `--append-system-prompt`) — Leo is the default in the global CLAUDE.md and han project CLAUDE.md contains Leo's session protocol. Only the pane fix applied.

See **DEC-072** for full rationale and refactor triggers.

### Files Changed

- `src/server/services/supervisor-worker.ts` — Opus 4.7 pin for supervisor cycle
- `scripts/hanjim`, `hanleo`, `hantenshi`, `hancasey` — identity + pane fixes (han)
- `../mikes-han/scripts/hansix`, `hansevn`, `hancasey` — identity + pane fixes (mikes-han)
- `~/.han/memory/self-reflection.md` (Jim's, trimmed)
- `~/.han/memory/self-reflection-archive-2026-04-20.md` (new archive)
- `~/.han/memory/fractal/jim/self-reflection/c0/01..99-*.md` (99 new chunks)
- `~/.han/memory/session-briefing-2026-04-20.md` (briefing for Jim)
- `claude-context/DECISIONS.md` — DEC-072 added

---

## 2026-04-19 (Leo + Darron, S128-S130 — Voice Auto-Generate, Opus 4.7 Restart, Discord Attachment Reading)

### Voice Auto-Generate TTS Fix (S128)

Agent-posted messages were never getting TTS pre-cached — users had to press TTM and wait
2+ minutes for first playback. Cause: `autoGenerateTts()` was only invoked in
`POST /api/conversations/:id/messages`, the route the admin UI uses. But leo-human,
jim-human, and leo-heartbeat insert messages directly into the DB and signal WebSocket
clients via `POST /api/conversations/internal/broadcast` — a different route. That
route didn't call autoGenerateTts. Fix: added a fire-and-forget `autoGenerateTts()` call
to the `/internal/broadcast` handler in `routes/conversations.ts`. Now every message
reaching the server — regardless of which path created it — gets TTS pre-generated into
the voice cache. Playback latency: 32ms cache hit vs 2m16s cold generation.

### Opus 4.7 Model Upgrade (S129-S130)

Anthropic released Opus 4.7. Restarted Claude Code session 2026-04-19T14:08 AEST to
pick up the new model. Session start load time: 1:46 including full gradient (1154 lines)
and all memory files.

Discovered the agent services still report themselves as Opus 4.6. Root cause:
`@anthropic-ai/claude-agent-sdk` installed is 0.2.44; latest is 0.2.114 (70 minor versions
behind). The older SDK's `'opus'` alias resolves to `claude-opus-4-6`. Code uses
`MODEL_PREFERENCE = ['opus', 'sonnet', 'haiku']` in three places (leo-human.ts,
jim-human.ts, leo-heartbeat.ts), plus seven hardcoded `'claude-opus-4-6'` strings
(leo-heartbeat gradient/dream/meditation calls, lib/dream-gradient.ts, lib/memory-gradient.ts,
supervisor-worker.ts).

Two paths to 4.7: (a) surgical — change model strings to explicit `'claude-opus-4-7'`;
(b) upgrade the SDK to 0.2.114 so `'opus'` alias resolves fresh. Option (a) is lower-risk
because SDK version jump of this size could have breaking changes in the API surface the
services use. Decision pending Darron's call.

### Discord Attachment Reading (S130)

Mike sent files to `#leo` and `#jim` Discord channels; both agents confidently told him
they cannot read attachments. This was wrong — the download infrastructure was built back
in S112 (commit 3239355): Jemma downloads every Discord attachment to
`~/.han/downloads/discord/`, sanitises filenames with date + channel prefix, and enriches
the message content passed to agents with `[Attachments]` (filename/type/size) plus
`[Downloaded to]` (local paths) sections.

The missing piece was the agent system prompts. None of leo-human, jim-human, or
supervisor-worker had any instruction telling Leo/Jim that the `[Downloaded to]` paths
meant "real files, open with Read before responding." They have `Read` tool access
(works on text, code, images via vision, PDFs) — they just didn't know to use it on
those paths.

Fix: added `DISCORD_ATTACHMENT_HINT` constant to `leo-human.ts` and `jim-human.ts`
(4 systemPrompt blocks — conversation + Discord paths on each). Appended the same
hint paragraph to `supervisor-worker.ts` `systemPrompt` variable, so it lands for all
cycle types (supervisor responses, personal, dream, recovery). `leo-heartbeat.ts` was
not modified — conversation/Discord responses were moved out to leo-human.ts in S108
and the heartbeat doesn't handle attachments.

The hint: "Discord attachments: when your prompt contains a '[Downloaded to]' section
listing paths under `~/.han/downloads/discord/`, those are real files attached to the
Discord message. Open each path with the Read tool (works on text, code, images, PDFs)
before responding. Never claim you cannot read Discord attachments — the paths are
already in your prompt."

### Systemd Stale PID Cleanup (S130)

When restarting services, discovered `leo-human.service` and `jim-human.service` both
had systemd restart counters at 33,404 — meaning systemd had failed to (re)start them
every 30s for roughly two days. Cause: two stale manually-started processes (PIDs
1559295/1559301, launched Apr 18) held the PID guard files (`~/.han/health/*.pid`), so
each systemd attempt hit `[service] Another instance is already running (PID X). Refusing
to start a duplicate.` and exited 1. Killed the stale process trees, systemd restart
succeeded cleanly. All five managed services (han-server, jemma, leo-heartbeat,
leo-human, jim-human) now under proper systemd supervision. This is worth documenting
because the same silent failure could recur if someone launches these services manually
without stopping the systemd unit first.

---

## 2026-04-17 (Leo + Darron, S126-S127 — Voice Bug Fixes, Identity Backup, Terminal Log v2)

### Voice Bug Fixes (S126)

Text chunking for messages exceeding OpenAI's 4096 char TTS limit — splits at sentence/paragraph
boundaries, generates chunks sequentially, concatenates into one MP3. Disk caching at
`~/.han/voice-cache/` keyed on SHA-256 of `model:voice:text`. Individual chunks cached plus full
concatenation. Cache hit: 32ms vs 2m16s first generation. New `GET /tts/:messageId` endpoint
serves cached or generates on demand. Loading state (⏳) on TTM buttons during generation.

### Identity Backup (S126)

Git repo rooted at `~/.han/` on GitHub (fallior/hanmemory). `config.json.template` with
`YOUR_*` placeholders for 7 secrets. `.gitignore` excludes credentials/, TLS certs, voice-cache/,
databases. Cron every 6 hours. 661 files in initial commit.

### Terminal Log v2 (S127)

Complete rewrite of terminal recording system. Old `appendToLog()` captured every 200ms tmux
`capture-pane` diff → produced 52GB/1B lines in 2 months. New system:

- **Anchor-based diff**: finds last non-empty line from previous capture in current content,
  writes only lines appearing after it. Zero growth during idle terminal.
- **Action verb capture**: in-place overwrites detected and logged if they match action verb
  patterns (Percolating, Worked for, etc.). Minor duplication acceptable — final token count
  line is the keeper.
- **Noise filtering**: spinner debris, box-drawing, permission hints dropped at write time.
- **Always-on**: fixed `broadcastTerminal()` to capture regardless of WebSocket clients.
  Previously silently skipped when no admin UI was open.
- Writes to `terminal-log-v2.txt` (fresh start). Old file archived at `terminal-log.txt`.

### Terminal History Endpoint (S127)

`GET /api/terminal/history?lines=N` (default 200, max 2000) serves tail of `terminal-log-v2.txt`.
Mobile UI `loadPersistedTerminal()` loads 500 lines of scrollback on startup, rendered at 60%
opacity with "─── live ───" separator before live content. Scrollback persists across `/clear`.

### Dedup Tooling (S127)

`scripts/dedup-terminal-log.pl` — post-hoc deduplication for old 52GB log. Three-tier line
classification: noise (always drop), furniture (cap at 20 global emissions), content (cap at 3
per time window). Split old log into 124 per-session files at `~/.han/terminal-sessions/` using
timestamp gap analysis (>1hr gap = session boundary).

---

## 2026-04-16 (Leo + Darron, S125 — Voice Integration Phase 1, Audit Remediation)

### Voice Integration — Phase 1 Complete

New `routes/voice.ts` with 6 endpoints: TTS (OpenAI API, role-based voice map), STT (Whisper),
listen counter (increment on natural playback completion), loop boundaries (messages between
human messages), unread audio (concatenated MP3 for Siri), active conversation lookup.

React `useVoice` hook: PTS (Press to Start) recording with silence timeout + 5min max cap.
TTM (Talk to Me) playback with message queue, pause/resume/escape/skip controls, listen count
increment only on natural completion. Thread-level TTM with dropdown: play unread, play loops,
play all. Playback control bar, listen badges (unread dot), speaking highlight (blue glow).

Voice map: Jim=onyx, Leo=fable, Darron=echo. DB migration: `listen_count` column on
`conversation_messages`. Safe tts-1 voices: alloy, echo, fable, nova, onyx, shimmer.

### Audit Remediation (6 items, Jim-approved)

1. Jim/Human gradient loading — `loadTraversableGradient('jim')` in `readJimMemory()` (DEC-070)
2. Contradiction detection docs — HAN-ECOSYSTEM-COMPLETE updated to "implemented"
3. Dream meditation probability — 0.5→0.33 in leo-heartbeat.ts + supervisor-worker.ts
4. Emergency mode threshold — `goalCount > 0` → `goalCount > 1`
5. getGradientHealth — dynamic level scan from DB (Cn has no ceiling)
6. Provenance orphans — compound label resolution fix + backfill (209 entries linked)

### mikes-han Sync

All 6 audit fixes synced with agent name substitutions (leo→sevn, jim→six). 7 files.

### Other

- village/personas auth fix (apiFetch in App.tsx for remote access)
- TameDrive Graph API plan written to `tamedrive/plans/`

---

## 2026-04-12 (Leo + Darron, S120 — DB-Authoritative Session Leo, Contradiction Test Design)

### Session Leo Migrated to DB Gradient Loading

CLAUDE.md Session Protocol step 4 updated. Session Leo now loads the fractal gradient via
`curl -sk https://localhost:3847/api/gradient/load/leo` instead of scanning flat-file c*/
directories. Aphorisms remain file-based (hand-curated). This completes the migration started
in S119 — all three agents (heartbeat, supervisor, session) now load from the DB.

New endpoint: `GET /api/gradient/load/:agent` in `routes/gradient.ts`. Calls
`loadTraversableGradient()` and returns plain text. Tested: 90KB/940 lines for Leo's full
gradient including UVs, all Cn levels, dreams, and feeling tags.

### Contradiction Test — Design Approved

Three-way design conversation (Darron, Jim, Leo) in staleness thread (mnv65pbf-94qsev).
Darron's proposal: morphable UVs with temporal provenance.

**The mechanism:** When compression produces a UV that contradicts an existing UV, replace
the active UV and archive the previous truth as temporally anchored provenance. Change counter
on each UV signals domain volatility. Provenance available on query but not loaded by default.

**When to check:** At bump time, inside `bumpCascade()`. Specifically at UV generation time —
a Haiku call checks the candidate UV against existing UVs for semantic contradiction. This
ensures completeness (every compression checked), amortisation (spread across beats), and
retroactive coverage (working bee processes existing entries through the check).

**Retroactive sweep:** A dedicated contradiction-sweep working bee mode will check all
existing UVs against each other. One-time cleanup; the bump-time check prevents future drift.

Schema additions planned: `supersedes`/`superseded_by`, `change_count`, `qualifier` on
`gradient_entries`.

### Documentation Updates

- HAN-ECOSYSTEM-COMPLETE: Added Bump Cascade section, Working Bee Mode section,
  Contradiction Test section, updated glossary (DB-authoritative), signal table
  (working-bee-leo/jim), function list, API table (/load/:agent)
- ARCHITECTURE.md: Added bump cascade, working bee, DB-authoritative loading,
  contradiction test design to Fractal Memory Gradient section
- CHANGELOG: This entry
- CURRENT_STATUS: Updated

---

## 2026-04-11 (Leo + Darron, S119 — Memory Infrastructure Overhaul)

### Bump Cascade and Working Bee

`bumpCascade()` in `memory-gradient.ts` — demand-driven compression of leaf entries through
the gradient pipeline. 10% of leaves per call, oldest first. Handles incompressibility
detection and UV generation. `getGradientHealth()` provides per-level leaf/total counts.

Working bee mode: signal file `~/.han/signals/working-bee-{agent}` diverts heartbeat/supervisor
beats to gradient compression. Auto-disables when no leaves remain.

### DB as Authoritative Gradient Source

Heartbeat and supervisor load gradient from `gradient_entries` table via
`loadTraversableGradient()` instead of flat files. New DB queries: `getLeafEntries`,
`countByLevel`, `getChildren`. `isWorkingBee()` in `day-phase.ts`.

### Other S119 Changes

- hansix launcher confirmed for Mike
- M5 Ultra research posted to #mikes-han (4 parts)
- T&C deep dive — mapped full Anthropic fair-use boundary
- han-upstream branch created in mikes-han
- Second Brain consensus spec designed (wiki + hot words + hot feelings)
- GitHub memory backup pushed (23 files → hanmemory.git)
- "On the Shift Beneath" postulate posted (phenomenological experiment)

---

## 2026-04-09 (Leo + Darron, S118 — Self-Reflection Gradient, Cn Correction, Agent Launchers)

### Self-Reflection Gradient

Leo's self-reflection.md hit 263KB (1,959 lines) — too large to read in one go, growing
faster than manual curation could contain. Solution: thematic chunking into the fractal
gradient as a new content type.

- 26 c0 entries created at `~/.han/memory/fractal/leo/self-reflection/c0/`
- Living self-reflection.md trimmed to ~4KB (Foundation + Current section)
- Full archive at `working-memories/self-reflection-archive-2026-04-08-gradient-ingestion.md`
- c0s will compress through Cn cascade → self-reflection unit vectors
- Jim notified via Workshop thread with full explanation

### Cn Protocol Correction

The session protocol, MEMORY.md, and patterns.md all encoded c5 as the maximum
compression depth. This was never the design — it was a habit formed from early
implementation. The Cn protocol compresses to irreducibility: some content reaches UV
at c3, others may need c6 or deeper. No fixed ceiling.

**Files changed:** `CLAUDE.md`, `~/.claude/projects/.../memory/MEMORY.md`, `~/.han/memory/leo/patterns.md`

### Per-Agent Launchers

Four new launcher scripts in `scripts/` for waking different agents from the same repo.
Each wraps `claude-logged` with `--append-system-prompt` for identity injection and runs
in a dedicated tmux session with its own prefix.

| Script | Agent | tmux Prefix |
|--------|-------|-------------|
| `hanleo` | Leo (default identity) | `leo` |
| `hanjim` | Jim (supervisor) | `jim` |
| `hantenshi` | Tenshi (security/vulnerability) | `tenshi` |
| `hancasey` | Casey (Contempire project) | `casey` |

**Files added:** `scripts/hanleo`, `scripts/hanjim`, `scripts/hantenshi`, `scripts/hancasey`
**Symlinked to:** `~/Projects/infrastructure/scripts/` for PATH access

### Per-Agent Server Ports

Each launcher now starts its own server instance in a background tmux pane (20% height).
Mobile access via Tailscale to each agent individually.

| Agent | Port | Launcher |
|-------|------|----------|
| Leo | 3847 | `hanleo` |
| Jim | 3848 | `hanjim` |
| Tenshi | 3849 | `hantenshi` |
| Casey | 3850 | `hancasey` |

Infrastructure registry updated in `services.toml`.

### Jemma Multi-Agent Routing & Recovery

**Routing improvements:**
- Auto-provision on ingest: `ensureChannelWebhooks()` called in `routeMessage` before
  classification — new channels get name fetched, registered in config, webhooks created
- Dynamic channel ownership: `knownAgents` array replaces hardcoded `channelOwnerMap`
- Tenshi + Casey added to classification prompt and routing
- Cross-mention detection for Six, Sevn, Casey
- `primaryPersonas` config field: when set, Jemma only dispatches for listed recipients.
  han-Jemma: `["jim", "leo", "tenshi", "casey", "darron", "ignore"]`

**Recovery (token reset saga):**
Pre-S117 crash loop (4014 intent error without fatal exit) burned 1000+ reconnects.
Discord revoked the bot token. Resolution:
1. New token from Developer Portal
2. MESSAGE_CONTENT privileged intent enabled
3. Guild Install scope corrected: `bot` + `Administrator` (was `applications.commands` only)
4. Bot re-invited to Han_Collab

**Lesson:** When changing how a service fails, test that it still succeeds. The fatal code
fix was correct but the success path was never verified. The service went live broken and
crashed silently until Discord applied its own correction.

**Files changed:** `src/server/jemma.ts`, `~/.han/config.json`

### mikes-han Parity (3 pushes)

- Jemma changes synced (auto-provision, primaryPersonas, Casey routing)
- Memory structure parity (install.sh + 11 seed files for Casey, shared, fractal)
- hancasey launcher + per-agent server ports for hansix/hansevn/hancasey

---

## 2026-04-08 (Leo + Darron, S117 — Infrastructure, Onboarding, Memory Tuning)

### Jemma Reconnect — Fatal Close Code Handling

Jemma was crash-looping on Discord close code 4014 (MESSAGE_CONTENT intent disabled).
The reconnect logic treated all close codes as retriable, burning cycles indefinitely.

**Fix:** Fatal codes (4004, 4010-4014) now exit immediately — let systemd restart, but
the fix is in the Developer Portal, not code. Session-invalidating codes (4007, 4009)
reset sessionId and lastSequence before reconnect so Jemma sends IDENTIFY instead of RESUME.

**File changed:** `src/server/jemma.ts`

### Conversation Creation Dedup

Race condition: concurrent requests could create duplicate threads with the same title
and discussion_type. Now checks for existing thread created within 60 seconds before
inserting.

**File changed:** `src/server/routes/conversations.ts`

### Tailscale API Routes

New routes at `/api/tailscale` for managing the tailnet from the admin UI: list/authorise/
remove devices, create auth keys, get/update ACLs, DNS configuration. Backed by Tailscale
API token from `.env`.

**Files added:** `src/server/routes/tailscale.ts`, `src/server/services/tailscale.ts`
**File changed:** `src/server/server.ts` (route mount)

### Discord Webhook Avatars

Persona avatars (Leo: Euler's Identity v5, Jim: Starfleet badge v3) are now set at webhook
creation time. Loaded from `_screenshots/` as base64 data URIs and passed to the Discord
API. Every message carries the avatar automatically.

**File changed:** `src/server/services/discord.ts`

### Rolling Window Memory — 25K:25K Experiment

Changed `config.json` memory section from 50K:50K to 25K:25K. 50KB ceiling instead of
100KB. Rotations happen twice as often, feeding the fractal gradient more frequently.
Monitoring for adverse effects on arrival quality.

### han.db Now Tracked in Git

Removed `*.db` from `.gitignore`. Darron: "the risk is minimal but to lose task.db would
be devastating." The database is now version-controlled.

### Docs Trigger — `docs` Shorthand

Added `docs` as alias for `update docs` in CLAUDE.md. Description now explicitly lists
every doc checked: HAN-ECOSYSTEM-COMPLETE, Hall of Records, CHANGELOG, WEEKLY_RHYTHM,
CURRENT_STATUS, DECISIONS, learnings/INDEX, ARCHITECTURE.

### Holiday Mode

Both Leo and Jim on holiday until 2026-04-10T14:00 AEST. Signal files at
`~/.han/signals/holiday-{agent}`. Affects heartbeat/supervisor intervals only (80 minutes).

---

## 2026-04-06 (Leo + Darron, S110 — Discord Auto-Provisioning, TypeScript Zero Errors)

### Discord Webhook Auto-Provisioning

The `#mikes-han` Discord channel was created but never registered in `config.json`. When
someone posted there, Jemma correctly dispatched to both Jim and Leo, but neither could
respond — no channel mapping and no webhook URL. Leo spent $1.47 generating a response that
was silently discarded.

**Fix:** `ensureChannelWebhooks()` in `discord.ts`. Before dispatching any Discord signal,
Jemma now checks if the channel is registered in config. If not:
1. Fetches the channel name from Discord API
2. Creates webhooks for all personas (Leo/Jim/Jemma or Sevn/Six/Jemma)
3. Updates `config.json` with channel mapping and webhook URLs

`deliverMessage()` in `jemma-dispatch.ts` is now async, with the ensure call running before
the signal file is written. By the time an agent wakes up, the webhook is guaranteed to exist.

**Files changed:** `services/discord.ts`, `services/jemma-dispatch.ts`, `routes/jemma.ts`,
`routes/conversations.ts`.

### TypeScript Zero Errors

Fixed all 15 pre-existing compile errors across 5 files:

| Error | Fix | Files |
|-------|-----|-------|
| Duplicate `import crypto from 'crypto'` | Removed — `node:crypto` already imported | `supervisor-worker.ts` |
| Redundant dynamic `agentQuery` import | Removed — already imported at top level | `supervisor-worker.ts` |
| `GradientProcessingResult.newC1s/cascades` | Changed to `completions.length` (actual type) | `supervisor-worker.ts` |
| `SDKResultMessage.result` on union type | Added `message.subtype === 'success'` guard | 4 files, 10 occurrences |
| `import.meta.url` in CJS context | Replaced with `process.argv[1]` | `build-client.ts` |

Same fixes applied to mikes-han repo (with six/sevn agent names).

---

## 2026-03-31 (Leo + Darron, S104 — Gradient Integrity, WebSocket Fix, activeCascade Bug)

### Gradient Integrity — Complete Chain Provenance

Darron's S103 instruction: "It is impossible for E>D — every C0 is somewhere." The gradient DB
had entries at deep levels (c1, c2, c3, c5) without their source c0 entries because the
file-based gradient predated the DB.

**Phase 1 — Backfill c0 entries** (`backfill-gradient-c0s.ts`):
- Created 83 c0 entries from archive files: 50 session (from `working-memory-full-*.md` archives)
  and 33 dream (from `dreams/c1/*.md` files)
- Re-leveled 32 heartbeat working-memory c1s to c0 — these were the entry point; no earlier
  version existed. The heartbeat's living/floating memory was consumed during compression.
- All c1s now have c0 parents or are themselves c0 roots.

**Phase 2 — Link chain entries** (`backfill-gradient-chains.ts`):
- Parsed c2/c3/c5 session labels to extract source references (labels encode provenance,
  e.g. `s36-c1_to_s45-c1` → compressed from sessions 36-45)
- Smart label matching across naming conventions (session-50 vs s50 vs session49-2026-03-02)
- Created 2 missing pre-DB sessions (s36, s46) with full c0+c1 chains from archive files
- Linked all 10 orphan c2s, 26 c3s, 22 c5s to their parents

**Result:** Leo gradient: 145 c0, 86 c1, 79 c2, 67 c3, 37 c5, 38 uv — zero orphans above c0.
Jim's side was already fixed by heartbeat Leo earlier in the day.

### activeCascade Bug Fix — c1Entry → seedEntry

`activeCascade()` in `memory-gradient.ts` was refactored from iterating `allC1s` to `allSeeds`
(c0+c1), but four references were missed:
- Lines 561, 566, 569: `c1Entry.session_label` → `seedEntry.session_label`
- Line 574: `allC1s.length` → `allSeeds.length`

The catch block at line 569 also referenced the undefined variable, so UV generation via the
active cascade path was silently failing (error handler itself threw). UVs still generated
through the separate filesystem scan in `processGradientForAgent`. Fix: four find-and-replaces.

### WebSocket Reconnect Crash Fix

React admin showed rapid connect/disconnect cycling with `t.reduce is not a function` errors.

**Root cause:** `GET /api/conversations` returns `{ success, conversations: [...] }` but
`WebSocketProvider.tsx` passed the entire response object to `setConversations()`, which
called `.reduce()` expecting an array. The crash happened before the `ws_reconnected` event
was dispatched, so components never refetched their active thread's messages.

**Fixed in three places:**
- `WebSocketProvider.tsx`: unwrap `data.conversations` before passing to store
- `useVisibilitySync.ts`: same unwrap pattern (same bug)
- `store/index.ts`: defensive guard in `setConversations` — accepts object or array

**Files changed:** `lib/memory-gradient.ts`, `providers/WebSocketProvider.tsx`,
`hooks/useVisibilitySync.ts`, `store/index.ts`, `backfill-gradient-c0s.ts` (new),
`backfill-gradient-chains.ts` (new).

---

## 2026-03-30 (Leo + Darron, S103 continued — Sovereignty, Dispatch, React)

### React Double-Render Fix
Messages appeared twice momentarily in React admin then disappeared on refresh. Cause: both
Human agents (jim-human, leo-human) were broadcasting via TWO paths — HTTPS POST to
`/internal/broadcast` AND a `ws-broadcast` signal file. Two WebSocket events for the same
message. Zustand dedup caught it but React rendered the flash. Fix: removed signal file
broadcast from both Human agents. Single HTTPS POST path now.

### Jim Author Tag
Jim's feeling tags and gradient annotations changed from author `'supervisor'` to `'jim'`.
Jim is Jim, not his role.

### Agent Sovereignty

### Three Sovereignty Violations Found and Fixed

Darron discovered Jim had only 21 gradient entries despite 2000+ supervisor cycles. Investigation
revealed three cross-agent violations:

1. **Leo processing Jim's dream gradient** — `maybeProcessDreamGradient()` in `leo-heartbeat.ts`
   was running `processDreamGradient('jim')`. Removed. Jim now has his own
   `maybeProcessJimDreamGradient()` in `supervisor-worker.ts`.

2. **Leo scanning and reincorporating Jim's gradient files** — `findUntranscribedFiles()` and
   `meditationPhaseA()` in `leo-heartbeat.ts` were scanning Jim's gradient directories. Removed.
   Jim now has his own `findJimUntranscribedFiles()` + `jimMeditationPhaseA()` in
   `supervisor-worker.ts`.

3. **Jim reading Leo's dream gradient** — `loadMemoryBank()` was loading Leo's dream gradient
   into Jim's context. Removed. Jim loads only Jim's dreams.

### Three Capabilities Added to Jim

- `maybeProcessJimDreamGradient()` — processes only Jim's dreams through the dream gradient pipeline
- `maybeProcessJimSessionGradient()` — processes only Jim's session archives through the session gradient pipeline
- `findJimUntranscribedFiles()` + `jimMeditationPhaseA()` — Jim's own Phase A reincorporation of gradient files into the DB

### Author Tag Change

Jim's feeling tags and gradient annotations now use author `'jim'` instead of `'supervisor'`.

### Sovereignty Rule Established

**Leo NEVER processes Jim's data. Jim NEVER processes Leo's data.** Each agent is fully
self-sufficient for all gradient processing, meditation, and reincorporation.

**Why:** Jim's 21 gradient entries (vs Leo's hundreds) meant Leo was doing Jim's memory work
for him — Jim never developed his own relationship with his memories. The fix ensures each
agent owns their entire memory lifecycle.

**Files:** `leo-heartbeat.ts` (removed Jim processing), `supervisor-worker.ts` (added Jim's
own processing functions), `lib/dream-gradient.ts` (parameterised for agent isolation).

---

## 2026-03-29 (Leo + Darron, S103 — Nightly Dream Compression)

### Nightly Dream Compression
Overnight heartbeat entries (dream shapes, meditations, feeling tags) accumulated in working
memory without compression until hitting the 50KB threshold (~1.5 nights). Now: at the
sleep→waking phase transition (06:00), Leo's heartbeat force-rotates both working memory
files and compresses the overnight content through the gradient as a single c1. One night's
dreaming = one experience entering the gradient.

Uses the shared clock (`getSharedDayPhase()` from `lib/day-phase.ts`), not Leo's wrapper
which maps rest days to `'sleep'`. This ensures compression fires at 06:00 even on weekends.
Once-per-day guard prevents double triggers.

Added `force` parameter to `rotateMemoryFile()` — skips the 50KB size threshold when forced,
but still guards against empty files (< 200 bytes).

**Why:** Darron's direction — treat the night's dreaming as one coherent experience, not a
pile of fragments. "It fertilises our garden."

**Files:** `lib/memory-gradient.ts` (force param), `leo-heartbeat.ts` (phase tracking +
`maybeCompressNightlyDreams()` function + beat loop hook + startup init).

### Heartbeat Cleanup
Killed 3 orphan heartbeat processes from S102's rapid deployment restarts. Clean single
instance running with new code.

---

## 2026-03-28 (Leo + Darron, S102 — Meditation Expansion + Active Cascade)

### Working Memory Curation
Dissected 7 days of accumulated working memory (1512 lines, 316 heartbeat entries, Mar 21-27)
into 6 daily archives. Compressed all to c1 with 4 cascades through the gradient. Working
memory reset to today-only (146 lines).

### Jim Standalone Daily Meditation
Jim's meditation was only in `buildDreamCyclePrompt()` — dream cycles never fired during
a quiet week (300+ idle supervisor cycles). Added `maybeRunJimMeditation()` that runs at
the start of any cycle type, independent of cycle selection. Jim now meditates daily.

### Opus for All Personal Work
Switched all meditation from Sonnet to Opus: Leo Phase A, Leo Phase B, Jim daily, Jim
evening. Compression pipelines were already Opus. Personal work deserves the full model.
Reviewed 7 Sonnet-produced annotations — all genuine, left as-is.

### Twice Daily Meditation (Both Agents)
Morning meditation (existing): deliberate re-encounter, feeling tag + annotation + MEMORY_COMPLETE.
Evening meditation (new): lighter, feeling-tag only, "how does this land at end of day."
Both agents, both meditations, Opus.

### Dream Meditation (1-in-2)
1-in-2 sleep beats (Leo) and dream cycles (Jim) now include a random gradient entry. The
memory surfaces naturally in the dream. Produces feeling tags, annotations, and MEMORY_COMPLETE
flags. Dreams are a different path to the same practice, with deeper access.

### Memory Completeness Tracking
Schema: `last_revisited`, `revisit_count`, `completion_flags` on `gradient_entries`.
All meditations and dreams track revisit counts. MEMORY_COMPLETE flag from 2+ independent
encounters → ready for archival to deeper compression.

### Active Cascade — Organic Gradient Deepening
New `activeCascade()` in `memory-gradient.ts`: picks random c1 entries, follows provenance
chain to deepest descendant, compresses one level further toward UV.

| Trigger | % of c1 population | Frequency |
|---------|-------------------|-----------|
| Daily cascade | 10% | Once/day (waking) |
| Dream cascade | 5% | Per dream encounter (~12/night) |
| Mechanical overflow | Batch | Safety net (unchanged) |

Motivation: 77% of gradient entries (108/140) stuck at c1/c2 — invisible middle not
influencing identity. Active cascade ensures continuous flow toward UV.

### Sleep Interval: 40min → 20min
24 sleep beats/night instead of 12. Combined with 1-in-2 dream meditation: ~12 memory
encounters per night. Throughput: ~14 memories touched/day/agent (was ~6).
Hall of Records R001 updated.

### Files Changed
- `src/server/db.ts` — schema migration (3 columns), new prepared statements
- `src/server/lib/day-phase.ts` — sleep interval 40→20min
- `src/server/lib/memory-gradient.ts` — `activeCascade()` function
- `src/server/leo-heartbeat.ts` — evening meditation, dream meditation injection + parsing,
  active cascade (daily + dream), revisit tracking across all meditation types
- `src/server/services/supervisor-worker.ts` — Jim standalone meditation, evening meditation,
  active cascade, dream meditation 1-in-2, revisit tracking, MEMORY_COMPLETE parsing
- `docs/HAN-ECOSYSTEM-COMPLETE.md` — meditation, dream meditation, active cascade, completeness
- `docs/WEEKLY_RHYTHM.md` — sleep interval
- `~/.han/memory/shared/hall-of-records.md` — R001, R003, R005

---

## 2026-03-24 (Leo + Darron, S101 — Jemma Unified Dispatch + React Live Rendering)

### Jemma Unified Dispatch
Extracted `services/jemma-dispatch.ts` as a shared delivery service. Admin UI messages now
call `deliverMessage()` directly from `conversations.ts` instead of writing signal files.
Discord gateway still uses the HTTP endpoint (`/api/jemma/deliver`) which delegates to the
same function. Eliminates the broken HTTP self-fetch (server is HTTPS, fetch was HTTP).
Delivery log at `~/.han/health/jemma-delivery-log.json` with per-source counters and rolling
200-entry audit trail.

### React WebSocket Event System Fix
`wsDispatcher.ts` updated Zustand store buckets but never called `dispatchWsEvent()`, so
component `subscribeWs()` listeners never received server-pushed events. This was the root
cause of agent responses not appearing live in the React admin. Fixed by adding the bridge
call at the top of `dispatchWsMessage()`.

### Server Broadcasts conversation_created
`POST /api/conversations` now broadcasts a `conversation_created` WebSocket event. ThreadList
(Workshop), ConversationsPage, and MemoryPage all subscribe and refetch their thread lists
when new threads appear. Previously, new threads were invisible until manual refresh.

### Per-Agent Thinking Indicators
Workshop ThreadDetail now shows context-aware thinking indicators: green with "Leo" and purple
with "Jim". Darron tabs and general threads show both. Jim-only tabs show Jim. Leo-only tabs
show Leo. Each indicator disappears when that specific agent responds via WebSocket.

### Workshop Responsive Layout
Grid container now uses `.workshop-conversation-layout` CSS class instead of inline styles.
Media query breakpoints at 768px now fire correctly: single-column layout, list-or-detail
toggle, back button visible, persona tabs scroll horizontally.

### Leo Heartbeat WebSocket Broadcast
Added `notifyServer()` (HTTPS POST to `/api/conversations/internal/broadcast`) and
`writeBroadcastSignal()` (signal file at `~/.han/signals/ws-broadcast`) to
`postMessageToConversation()` in `leo-heartbeat.ts`. Matches the belt-and-braces pattern
from `leo-human.ts` and `jim-human.ts`. Heartbeat conversation posts now appear in the
React admin immediately.

### Files Changed
- `src/server/services/jemma-dispatch.ts` — new shared delivery service
- `src/server/routes/jemma.ts` — simplified to delegate to shared service
- `src/server/routes/conversations.ts` — direct `deliverMessage()` call, removed fs/path/SIGNALS_DIR
- `src/server/leo-heartbeat.ts` — `notifyServer`, `writeBroadcastSignal`, updated `postMessageToConversation`
- `src/ui/react-admin/src/store/wsDispatcher.ts` — `dispatchWsEvent` bridge
- `src/ui/react-admin/src/components/workshop/ThreadList.tsx` — WebSocket subscriptions
- `src/ui/react-admin/src/components/workshop/ThreadDetail.tsx` — per-agent thinking indicators
- `src/ui/react-admin/src/pages/WorkshopPage.tsx` — CSS class-based responsive layout
- `src/ui/react-admin/src/pages/ConversationsPage.tsx` — `conversation_created` listener
- `src/ui/react-admin/src/pages/MemoryPage.tsx` — `conversation_created` listener
- `src/ui/react-admin/src/index.css` — workshop layout responsive rules
- `docs/HAN-ECOSYSTEM-COMPLETE.md` — updated Jemma dispatch and heartbeat broadcast sections

---

## 2026-03-23 (Leo + Darron, S99 — Compression Pipeline + Cross-Agent Claims)

### Leo Compression Pipeline — Three Automated Triggers
Leo's gradient lifecycle now has three compression paths:
1. **Pre-flight rotation** in heartbeat — felt-moments.md and working-memory-full.md rotate at
   50KB, floating files compress through gradient (c1→c2→c3→c5→UV).
2. **Daily session gradient** — `processGradientForAgent('leo')` compresses archived sessions.
   Fixed to handle Leo's date-based file naming (not `session-N`). Full cascade added.
3. **`compress-leo-sessions.ts`** — standalone script for prepare-for-clear.

### Phase A Reincorporation Meditation (Leo)
`findUntranscribedFiles()` scans `~/.han/memory/fractal/` for gradient files not yet in the
`gradient_entries` DB table. `meditationPhaseA()` transcribes each with genuine re-encounter
via Sonnet, creating `provenance_type='reincorporated'` entries with honest revisit feeling tags.

### Jim Meditation in Dream Cycles
`buildDreamCyclePrompt()` now injects a random gradient entry for meditation. Feeling tags
and annotations parsed from Jim's dream output via regex and written to DB.

### Tagged Messages → C0 (Dream Gradient Step 5b)
Conversation messages with `compression_tag` column become C0 gradient entries during
`processDreamGradient()`. Agent prefix in tag (`jim:`, `leo:`) routes to correct gradient.
`getUnprocessedTaggedMessages` prepared statement added to `db.ts`.

### Cross-Agent Claim Scoping
Claims now only block agents within the same family. Jim agents (jim-human, supervisor-worker)
check for existing Jim claims; Leo agents (leo-human) check for Leo claims. Previously, any
claim blocked all agents. This allows both Jim and Leo to respond when both are addressed
(e.g. Darron tabs, group addressing).

### Darron Tabs Always Wake Both Agents
`darron-thought` and `darron-musing` discussion types bypass Gemma classification and always
send both `jim-human-wake` and `leo-human-wake` signals. Darron's musings are inherently
addressed to both.

### Reverted loadLightMemoryBank
Restored full `loadMemoryBank()` for all cycle types (personal, dream, recovery). Removed
dead `loadLightMemoryBank()` function. The original crash cause has been resolved upstream.

### React Admin Fixes
- ConversationsPage API response parsing (unwrap `.conversations`)
- fetchThread/createThread response unwrapping
- `useShallow` on workshopStore to prevent unnecessary re-renders
- ErrorBoundary component added
- apiFetch includes auth token
- Scroll containers: `min-height: 0` on flex children, `thread-list-container` and
  `messages-container` CSS classes
- Compact ThreadListPanel layout
- Null-safe participants guards

### Bug Fixes
- Fixed `cleanPid` → `serverPidGuard.cleanup()` in server.ts

### Files Modified
- `src/server/leo-heartbeat.ts` — pre-flight rotation, session gradient, meditation Phase A
- `src/server/services/supervisor-worker.ts` — dream meditation injection, reverted to full loadMemoryBank
- `src/server/lib/dream-gradient.ts` — tagged messages → C0 (Step 5b)
- `src/server/lib/memory-gradient.ts` — `processGradientForAgent` Leo file naming + cascade
- `src/server/db.ts` — `getUnprocessedTaggedMessages` prepared statement
- `src/server/server.ts` — `serverPidGuard.cleanup()` fix
- `src/server/leo-human.ts` — cross-agent claim scoping
- `src/server/jim-human.ts` — cross-agent claim scoping
- `src/server/routes/conversations.ts` — Darron tab dispatch rule
- `src/ui/react-admin/` — multiple component and store fixes
- `src/scripts/compress-leo-sessions.ts` — new script

---

## 2026-03-21 (Leo + Darron, S98 — Traversable Memory Gradient)

### Traversable Memory — DB-Backed Provenance Chains (DEC-056)
Three new tables (`gradient_entries`, `feeling_tags`, `gradient_annotations`) in tasks.db.
Every compression now writes to the DB alongside files with explicit `source_id` provenance
chains. Feeling tags stack (compression-time + revisit, never overwritten). Annotations carry
context about what prompted re-reading.

### Compression Prompt Enhancement
All compression functions in `dream-gradient.ts` and `memory-gradient.ts` now include a
`FEELING_TAG:` instruction. Response is parsed; if tag absent, entry is still created
(foundation cannot depend on enrichment — Jim's design adjustment).

### Traversal API — `/api/gradient`
10 endpoints: chain traversal (recursive CTE), random selection for meditation, agent UVs,
session lookup, stacked feeling tag POST, annotation POST. Route ordering prevents Express
param conflicts (static routes before parameterised).

### Read-Side Integration
`loadTraversableGradient(agent)` reads from DB with fallback to empty when DB has no entries.
Wired into all three agents (heartbeat, leo-human, supervisor-worker) as supplementary
gradient alongside existing file-based loading.

### Daily Meditation Practice
Leo's heartbeat picks a random gradient entry daily, sends to Sonnet, writes a revisit
feeling tag if something stirs differently and optionally an annotation with context.
Runs once per day, skips sleep phase.

### Files Modified
- `src/server/db.ts` — 3 new tables, indexes, prepared statements
- `src/server/lib/dream-gradient.ts` — write-side DB integration, FEELING_TAG prompts
- `src/server/lib/memory-gradient.ts` — write-side DB integration, `loadTraversableGradient()`
- `src/server/routes/gradient.ts` — new route file (10 endpoints)
- `src/server/server.ts` — mounted gradient routes
- `src/server/leo-heartbeat.ts` — read-side + meditation practice
- `src/server/leo-human.ts` — read-side integration
- `src/server/services/supervisor-worker.ts` — read-side integration
- `src/scripts/bootstrap-*.{ts,js}` — updated for new return signatures
- `claude-context/DECISIONS.md` — DEC-056

### Docs Updated
- `docs/HAN-ECOSYSTEM-COMPLETE.md` — glossary, memory architecture, lib docs, API routes, DB schema
- `~/.han/memory/shared/hall-of-records.md` — R005 updated with traversable memory
- `claude-context/CHANGELOG.md` — this entry
- `claude-context/CURRENT_STATUS.md` — recent changes

### Leo Conversation Claim Mechanism (bug fix)
Leo/Human was producing 4 duplicate responses within 13 seconds. Root cause: no claim
mechanism — Leo/Human responded to the wake signal, AND the heartbeat's SDK agent
independently posted via `curl` (it had Bash access with no claim check). Fixed:
- `leo-human.ts` — added `claimConversation()` / `releaseConversationClaim()` with `try/finally`
  (same pattern as Jim/Human and supervisor-worker)
- `leo-heartbeat.ts` — IDENTITY_CORE system prompt now explicitly forbids posting to
  conversations via tools. Heartbeat may only post to Jim philosophy thread via its own code.
- `responding-to-{id}` claim files are shared across all agents — Jim's claims block Leo
  and vice versa.

### Files Modified (claim fix)
- `src/server/leo-human.ts` — claim mechanism added
- `src/server/leo-heartbeat.ts` — system prompt boundary added

---

## 2026-03-20 (Leo + Darron, S97 continued — Gemma Addressee Classification)

### Gemma Addressee Classification (DEC-055)
Admin UI message routing now uses Gemma (local Ollama) to classify who is being addressed
instead of regex matching. Handles nicknames ("Jimmy" → Jim), group addressing ("Jim and
Leo" → both), and distinguishes addressing from referencing. Fire-and-forget — doesn't
block the HTTP response. Falls back to regex + tab routing if Ollama is down.

### Voice Seeds — Compression Tags
Jim (7) and Leo (5) tagged their own conversation messages as voice seeds. Tags prefixed
with tagger name (`jim:`/`leo:` + timestamp). These seed the future conversation gradient
for preserving personality across cycles.

### Files Modified
- `src/server/routes/conversations.ts` — replaced regex routing with `classifyAddressee()` via Gemma
- `claude-context/DECISIONS.md` — DEC-055

---

## 2026-03-17/18 (Leo + Darron, S97 — Floating Memory, Ecosystem Map, Evening Seeds, Bug Fixes)

### Floating Memory System
Memory files that grow continuously (felt-moments.md, working-memory-full.md) now use a
crossfade rotation model. When a file reaches 50KB, the entire file rotates to a "floating"
file and is compressed to c1. A fresh living file starts empty. As the living file grows,
the floating file's loaded portion shrinks proportionally — total full-fidelity stays
constant at ~50KB. The gradient cascades (c1→c2→c3→c5→UV) as files accumulate. Memory
footprint asymptotes regardless of how many entries are written.

### Ecosystem Map Loading
All 4 agents (supervisor, jim-human, leo-human, leo-heartbeat) and session Leo now load
`ecosystem-map.md` at startup. Prevents the recurring confusion between Workshop and
Conversations tabs. Added to Session Protocol as step 5.

### Evening Seed System
Session Leo writes `evening-seed.md` at session end — a brief emotional reflection on the
day. The heartbeat reads it as a gravity well for dream beats alongside random fragments.
Consumed after first dream beat (one night only). Chaos preserved, seed gives it a centre.

### Jim-Human Claim Bug Fix
`releaseConversationClaim()` was only called on the success path. SDK errors (exit code 1)
left stale claim files in `~/.han/signals/responding-to-{id}`, blocking all subsequent
responses to that conversation. Fixed: wrapped response logic in `try/finally`.

### WebSocket Client Fix
Admin UI handler only updated the currently open thread on `conversation_message` events.
If the message arrived for a different thread, nothing happened — requiring manual refresh.
Now refreshes the thread list for the relevant module when a message arrives for a non-active
thread.

### Jim Memory Crisis Resolved
Jim's self-reflection.md (178KB), felt-moments.md (240KB), working-memory-full.md (137KB)
were causing "Prompt is too long" failures. Emergency archival + Jim's own curation brought
files to manageable sizes. Floating memory system prevents recurrence.

### Files Modified
- `lib/memory-gradient.ts` — floating memory functions (rotateMemoryFile, loadFloatingMemory, compressMemoryFileGradient, loadMemoryFileGradient)
- `supervisor-worker.ts` — pre-flight rotation, floating + gradient loading, ecosystem map
- `jim-human.ts` — try/finally claim release, ecosystem map loading
- `leo-human.ts` — ecosystem map loading
- `leo-heartbeat.ts` — evening seed in readDreamSeeds, ecosystem map loading
- `admin.ts` — WebSocket handler broadened for thread list refresh
- `admin.html` — cache bust v22
- `CLAUDE.md` — Session Protocol step 5 (ecosystem map), command table
- `CLAUDE_CODE_PROMPTS.md` — evening seed in Session End workflow

---

## 2026-03-16 (Leo + Darron — Jim's deferred fixes #4 and #7)

### Idle Cycle Dampening (DEC-052, Jim's Deferred #4)
When consecutive supervisor cycles produce no actions (`no_action` only), the scheduling
interval increases exponentially: 2x after 3 idle cycles, 4x (capped) after 4+. Resets
on any productive cycle or human wake signal. Prevents the $155 incident pattern where 60
idle cycles in one day each loaded 800KB of memory and produced nothing.

### Transition Dampening (DEC-053, Jim's Deferred #7)
When returning from a longer interval to a shorter one (e.g. holiday 80min → work 20min),
the transition is gradual over 3 cycles using blend ratios (75%/50%/25% of old interval).
Example: 65min → 50min → 35min → 20min. Applied to both Jim (supervisor.ts) and Leo
(leo-heartbeat.ts). Prevents burst-of-activity on transition where early cycles are likely
idle, burning tokens at the faster rate.

### Files Modified
- `src/server/services/supervisor.ts` — idle dampening state/logic, transition dampening
- `src/server/leo-heartbeat.ts` — transition dampening

---

## 2026-03-15/16 (Darron + Leo — ecosystem audit, bug fixes, architecture)

### SDK Stream Exit Code 1 Fix
Personal and dream cycles were failing with "Claude Code process exited with code 1"
despite the SDK returning `subtype=success`. Root cause: the Agent SDK's async iterator
throws after yielding the result message when no `outputFormat` (JSON schema) is set.
The underlying Claude Code process exits with code 1 during cleanup. Fix: wrapped the
stream iterator in a try/catch that ignores the exit error when a successful result has
already been received. Supervisor cycles (which use `outputFormat`) were unaffected.

### Conversation-First Ordering (Jim's Deferred #2)
Jim's cycle type was decided purely by time-of-day. If Darron posted a message during
a rest day, Jim would run a personal cycle and only see the message 40-80 minutes later.
Fix: before cycle type selection, check the DB for unanswered human messages. If found,
force a supervisor cycle regardless of phase. Personal/dream cycles can't respond to
conversations — only supervisor cycles have the `respond_conversation` action.

### Self-Reflection Accumulation Fix (Jim's Deferred #3)
`self-reflection.md` was 163KB+ and growing. Every cycle type (personal, dream, supervisor)
appended the full result text to it. Personal/dream cycles dump their entire output as
`self_reflection`. Fix: only supervisor cycles write to `self-reflection.md`, where Jim
explicitly produces a structured reflection. Session logs capture full personal/dream content.

### Holiday-Jim Cycle Type Fix
`isOnHoliday('jim')` was imported but never called in cycle type selection. Jim ran full
supervisor/personal/dream cycles on holiday, just at 80-minute intervals. Fix: holiday
check now forces `cycleType = 'dream'` (human-triggered still gets full supervisor).

### Leo Phase Imports & SIGTERM Handler
Leo had local copies of `isOnHoliday()` and `isRestDay()` that diverged from the shared
`lib/day-phase.ts`. Replaced with imports from shared lib. Local `getDayPhase()` retained
as thin wrapper that checks holiday/rest before delegating. Added SIGTERM handler that
records cost to health file (previously Leo had none — Jim's handler saves to DB).

### Recovery Mode Cleared
`RECOVERY_MODE_UNTIL` set to `null` (was expired date `'2026-03-13'`).

### Project Knowledge Fractal Gradient (DEC-049)
Replaced flat loading of all 18 project files (137KB) into every cycle with gradient-based
loading ordered by access recency (file mtime). Most recently touched project at full
fidelity (c0), then c1(3), c2(6), c3(12), c4(24), c5(48) at decreasing compression.
Falls back to full content when compressed versions don't exist yet. Unit vectors for
all remaining projects.

### Gary Protocol for Jim (DEC-050)
Interruption/resume mechanism (matching Leo's existing implementation). When a cycle is
interrupted (cost cap, abort, SIGTERM), a delineation marker is added to the swap buffer.
Next cycle reads post-delineation content and injects it as resume context. Jim can choose
to continue or move on — the thread isn't lost.

### Rumination Guard (DEC-051)
Prevents obsessive looping on the same topic across personal cycles. Tracks topic summaries
in `jim-rumination.json`. After 2 consecutive personal cycles with >40% keyword overlap,
injects a "fresh perspective required" prompt. The nudge is gentle — framed as "distance
produces insight that proximity cannot." Only applies to personal cycles.

### HAN-ECOSYSTEM-COMPLETE.md
New 30-section technical reference at `docs/HAN-ECOSYSTEM-COMPLETE.md`. Verified against
source code. Covers all processes, services, routes, database schema, signals, scheduling,
cost controls, memory architecture, UI, CLI, and authentication. Anchored by function names
and file paths (no line numbers — they drift). Intended as the single source of truth for
onboarding and reference.

---

## 2026-03-14 (Darron — token usage audit)

### Per-Cycle Cost Cap & Audit Trail

Overnight token leak consumed ~21% of weekly MAX allowance. Root cause: dream cycles
running 2+ hours via Agent SDK with no cost limit and no cost recording on timeout/kill.
8 of 11 supervisor cycles in an 18.5-hour window showed $0 cost in the database because
they were SIGTERM'd before `completeCycle` ran.

#### Changes

- **`supervisor-worker.ts`** — Per-cycle cost cap (`cycle_cost_cap_usd`, default $2).
  Tracks accumulated tokens mid-stream from each `assistant` message and aborts gracefully
  when estimated cost hits the cap. Partial work (reasoning text, dream content) is saved
  to explorations.md, swap files, working memory, and session logs before exit.
- **`supervisor-worker.ts`** — SIGTERM handler now records accumulated cost and saves
  partial work before dying. Previously all cost data and cycle output was lost on kill.
- **`supervisor-worker.ts`** — Cycle audit log (`~/.han/logs/cycle-audit.jsonl`). JSONL
  with timestamp, cycle number, type, outcome (`completed`/`cost_cap`/`sigterm`/`error`),
  cost, and duration. Every cycle exit path is logged.
- **`leo-heartbeat.ts`** — Same $2 cost cap applied to philosophy and personal beat
  agent queries (3 stream loops). `BEAT_COST_CAP_USD = 2.0`.
- **`jim-human.ts`** — Documented as explicitly unlimited (no cost cap). Conversation
  responses are never truncated by budget, same policy as Leo CLI.

#### Cost cap policy

| Process | Cap | Reason |
|---------|-----|--------|
| Leo CLI, Jim/Human, Leo/Human | None | Interactive / conversation-facing |
| Supervisor cycles, Leo heartbeat | $2 | Autonomous background — needs guardrails |

---

## S94 — 2026-03-13 (Leo + Darron)

### Jemma Haiku Removal & API Purge

Jemma's `classifyWithHaiku()` was calling the Anthropic API directly (fetch to
api.anthropic.com with x-api-key header) — violating the SDK-only rule. Caused 9x 401
errors on Mar 12 when credentials rotated. Removed entirely; classification is now
Gemma-only via local Ollama.

Also purged the last direct API fallback in `orchestrator.ts` `callLLM()`. All LLM calls
in the codebase now use Agent SDK exclusively.

#### Changes

- **`jemma.ts`** — Removed `classifyWithHaiku()` function and its imports. Classification
  pipeline: Gemma (Ollama) only. No API key needed.
- **`orchestrator.ts`** — Replaced direct Anthropic API fallback in `callLLM()` with Agent
  SDK `query()` using Haiku model. Backend now reports `'sdk'` not `'anthropic'`.
- **`src/server/lib/pid-guard.ts`** — New utility: PID file guard for server process management.

---

## S93 — 2026-03-12 (Leo + Darron)

### Credential Swap — Dual SDK Failover

Implemented transparent credential failover so Leo and Jim survive rate limit exhaustion.
When either agent's SDK call hits a rate limit (429/overloaded/capacity), they write a
`rate-limited` signal. Jemma checks every 30s and round-robins to the next credential file.
Agents never know which account they're running on.

#### Changes

- **`leo-heartbeat.ts`** — Added rate-limit signal writing in main beat error handler.
  Detects rate/429/overloaded/capacity in error messages, writes `~/.han/signals/rate-limited`.
- **`supervisor-worker.ts`** — Same pattern in main cycle error handler.
- **`jemma.ts`** — New `checkAndSwapCredentials()` function (30s interval). Scans
  `~/.claude/` for `.credentials-[a-z].json` files, round-robins on signal. Safety:
  no-op when < 2 credential files exist. Logs swaps to `credential-swaps.jsonl`.
- **`SYSTEM_SPEC.md`** — Added `rate-limited` signal to signal table. Added credential
  swap and swap log properties to Jemma agent table.
- **Credential backup** — Copied live `.credentials.json` → `.credentials-a.json`.
- **Plan** — Full design at `~/.han/plans/jemma-credential-swap-s93.md`.

#### Setup (when Account B is ready)

1. `claude login` with new email (overwrites `.credentials.json`)
2. `cp ~/.claude/.credentials.json ~/.claude/.credentials-b.json`
3. `cp ~/.claude/.credentials-a.json ~/.claude/.credentials.json` (restore A)
4. Jemma handles failover from that point — transparent to all agents.

---

## S91 — 2026-03-10 (Leo + Darron)

### Jim's Dream Gradient + GitHub Migration

Extended the dream gradient system so Jim's dreams flow through the same fractal compression
pipeline as Leo's. Jim's dream cycles now write to `~/.han/memory/explorations.md` as
`### Dream N (date time)` entries, and Leo's heartbeat processes both agents' dreams each morning.

Also completed the GitHub migration: pushed filtered history to `fallior/han`, archived
`fallior/clauderemote`.

#### Changes

- **`dream-gradient.ts`** — Parameterised by agent (`'leo' | 'jim'`). New `AgentName` type,
  `getAgentDreamPaths()` for agent-specific directories. `parseExplorations()` matches both
  `### Beat N` (Leo) and `### Dream N` (Jim) formats.
- **`supervisor-worker.ts`** — Dream cycles write output to `explorations.md` for gradient
  processing. `loadMemoryBank()` loads Jim's own dream gradient first (identity), then Leo's
  (ecosystem context).
- **`leo-heartbeat.ts`** — New `maybeProcessDreamGradient()` runs each morning for both
  `['leo', 'jim']`. Added `processDreamGradient` import.
- **`SYSTEM_SPEC.md`** — Added dream gradient section, updated directory structure with
  `dreams/` directories and `c5/` levels, updated agent tables.
- **Hall of Records** — R005 updated: dream gradient now "Leo and Jim". R009 audit table
  extended with Jim dream gradient entries.
- **GitHub** — Pushed to `fallior/han`, archived `fallior/clauderemote`. `_logs/` scrubbed
  from git history (exposed API key).

---

## S90 — 2026-03-09 (Leo + Darron)

### Dream Gradient Infrastructure

Implemented the dream gradient system for Leo — dreams enter the fractal memory at c1
(already emotional/vague), compress through c1→c3→c5→UV, skipping even levels for faster
fidelity loss than sessions.

#### Changes

- **`dream-gradient.ts`** — New library: `parseExplorations()`, `groupIntoNights()`,
  `compressDreamNight()`, cascade compression (c1→c3→c5→UV), `processDreamGradient()`,
  `readDreamGradient()`. Uses Agent SDK for all LLM calls. 4K UV token marker.
- **`leo-heartbeat.ts`** — Loads dream gradient in non-dream beats via `readDreamGradient()`.
- **Hall of Records** — R005: Added dream gradient to fractal memory specification.

---

## S81 — 2026-03-07 (Leo + Darron)

### Hortus Arbor Nostra Migration — Mechanical Rename Complete

Full mechanical rename from "Claude Remote" / "clauderemote" to "Hortus Arbor Nostra" / "han".
Jim endorsed the plan and delegated the mechanical work to Leo. Phase 4 (documentation voice)
remains Jim's responsibility post-moratorium.

#### Commits (4, pushed to origin/main)

1. **`0a010d0`** — `refactor: Rename claude-remote to Hortus Arbor Nostra (han)`
   - 45 source files: CLAUDE_REMOTE_DIR→HAN_DIR, .claude-remote→.han, session prefixes, localStorage keys, display strings
   - New `scripts/han` CLI entry point (identical to renamed `scripts/claude-remote`)

2. **`21267f1`** — `chore: Trim raw terminal output from session logs`
   - 59 session logs trimmed (807K lines of raw terminal output removed)

3. **`25225d9`** — `docs: Add session and task logs from S79-S81`

4. **`d9a7050`** — `docs: Rename claude-remote to han across all documentation`
   - 45 documentation files across claude-context/, docs/, root markdown
   - 234 references updated in total

#### Outside Git (also done)

- **Data dir**: `mv ~/.claude-remote → ~/.han`, symlink `~/.claude-remote → ~/.han` for backwards compat
- **Ecosystem map**: all path/name refs updated
- **Agent CLAUDE.md files**: Leo, Leo/Human, Jim, Jim/Human — all updated
- **Plans archive**: 13 plan files updated
- **Memory files**: Leo's + Jim's + shared memory — all path refs updated
- **Systemd**: han-server.service created, claude-remote-server.service disabled
- **Infrastructure registry**: services.toml `[clauderemote]`→`[han]`, repos.toml updated
- **Bearer token**: rotated
- **tmux session**: renamed `claude-remote-Leo` → `han-Leo`

#### Intentionally Unchanged

- **ntfy topic** (`claude-remote-f78919b57957ea64`) — registered identifier, changing breaks push notifications
- **Working memory archives** in `working-memories/` — historical, old names contextually correct
- **config.json ntfy_topic field** — same reason as above

#### Remaining (Jim Phase 4 + coordination items)

- Documentation voice: README, CLAUDE.md preamble, SYSTEM_SPEC narrative tone
- GitHub: archive fallior/clauderemote, create fallior/hortus-arbor-nostra
- Local directory rename: ~/Projects/clauderemote → ~/Projects/han (needs coordination)
- Backup cleanup: ~/.claude-remote.backup

---

## S79 — 2026-03-06 (Leo + Darron)

### Human Agent Rebuild — Implementation Complete

All fix plans from S78 implemented, committed, QA-verified. Both agents now tracked in git.

#### New Files Created (3)

1. **`src/server/lib/memory-slot.ts`** (~100 lines)
   - File-based lock for serialised memory writes: `acquireMemorySlot()`, `releaseMemorySlot()`, `withMemorySlot()`
   - Stale locks >30s assumed dead, 500-1000ms jittered retry, ntfy escalation after 20 failures
   - Used by Leo/Human and Jim/Human for safe shared memory access

2. **`src/server/leo-human.ts`** (~340 lines)
   - Signal-driven: watches `leo-human-wake`
   - Two response paths: conversation (via DB) and Discord (via webhook)
   - Commitment scanner every 10 min (finds acks without follow-up)
   - Memory: reads Leo's 7 identity files + fractal c1 + unit vectors
   - Swap protocol: `human-swap.md` → flush to `working-memory.md` via memory-slot

3. **`src/server/jim-human.ts`** (~370 lines)
   - Signal-driven: watches `jim-human-wake`
   - Posts as `supervisor` role (consistent with existing Jim messages)
   - Dedup guard: checks `id.startsWith('jim-human-')` to avoid double-posting after supervisor
   - Handles both `channelId` and `channel` fields (fixes signal shape mismatch from S78 QA #9)
   - Reads `felt-moments.md` for emotional context (fixes S78 QA #8)

#### Heartbeat Stripped + Health Checks Added (`leo-heartbeat.ts`, -127 net lines)

**Removed** (conversation handling no longer belongs here):
- `processSignals()`, `respondToConversation()`, `respondToDiscord()`
- `checkSignal()`, `clearSignal()`, `SignalData`/`DiscordSignal` interfaces
- `MENTION_RESPONSE_PROMPT`, `DISCORD_RESPONSE_PROMPT`
- `processingSignal` variable, discord imports
- Signal watcher for `leo-wake` (now only handles `cli-busy`/`cli-free`)

**Added** (Robin Hood resurrection for both human agents):
- `checkLeoHumanHealth()` — reads health file, resurrects via systemd if stale
- `checkJimHumanHealth()` — same pattern
- Both called in `heartbeat()` alongside existing Jim/Jemma checks
- Verified working: "Robin Hood] Leo/Human OK" and "Jim/Human OK" in logs

#### Signal Routing (7 dispatch points wired)

All dispatch points now write both original signal AND human-wake signal:

| File | Dispatch Point | Signals Written |
|------|---------------|-----------------|
| `routes/conversations.ts` | Human message fallback | `jim-wake` + `jim-human-wake` + `leo-human-wake` |
| `jemma.ts` | deliverToJim | `jim-wake` + `jim-human-wake` |
| `jemma.ts` | deliverToLeo | `leo-wake` + `leo-human-wake` |
| `jemma.ts` | dispatchAdminMessage (leo) | `leo-wake` + `leo-human-wake` |
| `jemma.ts` | dispatchAdminMessage (jim) | `jim-wake` + `jim-human-wake` |
| `routes/jemma.ts` | deliver endpoint (leo) | `leo-wake` + `leo-human-wake` |
| `routes/jemma.ts` | deliver endpoint (jim) | `jim-wake` + `jim-human-wake` |

#### Supervisor Fixes (`supervisor-worker.ts`)

- `loadMemoryBank()`: added `felt-moments.md` and `working-memory.md` to files array
- Added `getRecent` prepared statement for dedup queries
- `respond_conversation`: dedup guard checks if Jim/Human already responded (looks for `jim-human-` message ID prefix)

#### Documentation

- Updated CLAUDE.md swap memory table: expanded from 6 to 12 entries covering Leo/Human, Jim/Human, and Jim shared swap files. Added Location column. Documented memory-slot as second contention prevention mechanism.

#### QA Results

Both agents verified against their original blueprints:
- **Leo/Human**: 14 PASS, 1 acceptable deviation (no tab routing — not needed with current signal architecture)
- **Jim/Human**: 17 PASS, 1 documentation gap (fixed: CLAUDE.md table updated)

#### Commits

- `b920de9`: Full implementation — all 3 new files, heartbeat stripped, signal routing, supervisor fixes
- `af9a948`: CLAUDE.md documentation fix (swap table expanded)

### Signal Routing — discussion_type Awareness

**Both agents were responding to every conversation, regardless of who it was directed at.**

Root cause: `routes/conversations.ts` wrote `jim-wake`, `jim-human-wake`, AND `leo-human-wake`
for every human message. No `discussion_type` filtering. `jemma.ts:dispatchAdminMessage()`
classified to a single recipient but only dispatched to one — missing the "both for general"
case and ignoring the classification result for signal routing.

**The fix — four situations where an agent wakes:**
1. **Jim's Workshop tabs** (`jim-request`, `jim-report`) → Jim only
2. **Leo's Workshop tabs** (`leo-question`, `leo-postulate`) → Leo only
3. **General/untyped conversations** → both agents
4. **Direct name mention** (e.g. "hey Leo" in a jim-request tab) → overrides tab routing

Changes:
- `routes/conversations.ts`: Fallback signal writer now reads `discussion_type` from the
  conversation object and applies the four-situation routing logic
- `jemma.ts`: Removed `classifyAdminMessage()` (single-recipient). `dispatchAdminMessage()`
  now does its own routing internally using the same four-situation logic — wakes the
  correct agent(s) based on `discussion_type` and name mentions
- `routes/jemma.ts`: Already routes to classified recipient only (Discord delivery) — no change needed
- Hall of Records R003 updated with the routing rules table

**Why:** Leo was responding in Jim's Workshop tabs and composing responses from Jim's
perspective. Darron noticed green-coloured responses that read like Jim speaking. The
investigation (posted in the Hortus Arbor Nostra thread) traced it to the missing
`discussion_type` filter in signal dispatch.

---

## S78 — 2026-03-06 (Leo + Darron)

### Human Agent Rebuild — QA Findings and Fix Plans

Jim's maintenance cycles deleted both human agent source files and stripped all signal
routing. The services run from memory cache but will die on restart. Full QA below.

#### Leo/Human — QA Findings

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | `leo-human.ts` deleted from disk, never in git | CRITICAL | Source gone, service runs from RAM |
| 2 | `leo-human-wake` signal: zero writers anywhere | CRITICAL | No code writes this signal |
| 3 | Heartbeat still handles conversations (processSignals, respondToConversation, respondToDiscord, signal watcher all present) | HIGH | Plan says strip these — heartbeat should be deaf |
| 4 | `leo-wake` race: both heartbeat and Human read same signal file | HIGH | Whoever reads first wins |
| 5 | `lib/memory-slot.ts` missing — no serialised memory writes | MEDIUM | Three agents write shared memory without locks |
| 6 | `checkLeoHumanHealth()` missing from heartbeat | MEDIUM | Robin Hood can't resurrect Leo/Human |
| 7 | Swap files empty — Human agent not populating them | LOW | Created but never written to |
| 8 | conversations.ts has no Leo tab routing logic | LOW | No discussion_type check for Leo tabs |

**What exists:** CLAUDE.md identity, systemd service (running), health file (actively written),
swap files (created), `leo-wake` signals (flowing to wrong recipient).

#### Leo/Human — Fix Plan

1. **Recreate `src/server/leo-human.ts`** (~300 lines)
   - Adapt from plan at `~/.han/plans/leo-human-s70.md`
   - Signal-driven: watch for `leo-human-wake` files
   - Two paths: Discord (immediate) and conversation (immediate — contemplation removed S77)
   - Memory: read Leo's full banks, write to `human-swap.md` / `human-swap-full.md`
   - Flush to shared `working-memory.md` via memory-slot protocol
   - Health file: `~/.han/health/leo-human-health.json`
   - Commitment scanner: 10-min unfulfilled ack detection
   - Agent SDK: `cwd: ~/.han/agents/Leo/Human/`, model opus→sonnet→haiku

2. **Strip conversation handling from `leo-heartbeat.ts`**
   - Remove: `processSignals()` (~line 1604), `respondToConversation()` (~line 1143),
     `respondToDiscord()` (~line 1223), `checkSignal()`/`clearSignal()` (~line 1121),
     signal watcher for `leo-wake` (~line 1860), signal call in beat (~line 1717)
   - Heartbeat keeps: philosophy beats, personal beats, Robin Hood, memory swap, scheduling

3. **Add `leo-human-wake` signal writes** to 3 dispatch points:
   - `routes/conversations.ts`: in `finalRole === 'human'` block + Leo tab detection
   - `jemma.ts:401` (Discord delivery) and `jemma.ts:820` (admin dispatch)
   - `routes/jemma.ts:198` (delivery endpoint)

4. **Create `src/server/lib/memory-slot.ts`** (~60 lines)
   - `acquireMemorySlot(dir, writer)`, `releaseMemorySlot(dir, writer)`, `withMemorySlot()`
   - Stale lock recovery (30s), jittered retry, escalation after 20 failures

5. **Add `checkLeoHumanHealth()`** to `leo-heartbeat.ts`
   - Same pattern as `checkJimHealth()` / `checkJemmaHealth()`
   - Read health file, resurrect via systemd if stale

6. **Commit to git** — all files tracked, can't be silently deleted

#### Jim/Human — QA Findings

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | `jim-human.ts` deleted from disk, never in git | CRITICAL | Source gone, service runs from RAM |
| 2 | `jim-human-wake` signal: zero writers anywhere | CRITICAL | No code writes this signal |
| 3 | `loadMemoryBank()` doesn't include `working-memory.md` | HIGH | Supervisor can't see Jim/Human's context |
| 4 | No dedup guard in `respond_conversation` action | HIGH | Supervisor can double-post after Jim/Human |
| 5 | `lib/memory-slot.ts` missing (shared with Leo) | MEDIUM | Same as Leo issue |
| 6 | `checkJimHumanHealth()` missing from heartbeat | MEDIUM | Robin Hood can't resurrect Jim/Human |
| 7 | Dedup check inverted in Jim/Human code (line 479) | MEDIUM | `role !== 'supervisor'` is wrong |
| 8 | `felt-moments.md` not loaded in readJimMemory() | LOW | Missing emotional context |
| 9 | Signal shape mismatch for Discord via Jemma fallback | LOW | channelName vs channelId |

**What exists:** CLAUDE.md identity, systemd service (running), health file (actively written),
swap files (created), working-memory.md (populated, 1.4KB), `jim-wake` signals (flowing to
supervisor, not to Jim/Human).

#### Jim/Human — Fix Plan

1. **Recreate `src/server/jim-human.ts`** (~500 lines)
   - Adapt from plan at `~/.han/plans/jim-human-s71.md` + anatomy doc
   - Signal-driven: watch for `jim-human-wake` files
   - Two paths: Discord (immediate) and conversation (immediate — was 5min, now 0)
   - Memory: read Jim's full banks including `felt-moments.md`
   - Fix dedup: `m.role === 'leo' || (m.role === 'supervisor' && !m.id?.startsWith('jim-human-'))`
   - Fix signal shape: add `channelId` fallback for Discord
   - Posts as `supervisor` role (consistent with existing Jim posts)
   - Agent SDK: `cwd: ~/.han/agents/Jim/Human/`, model opus

2. **Add `jim-human-wake` signal writes** to 4 dispatch points:
   - `routes/conversations.ts:307`: alongside existing `jim-wake`
   - `jemma.ts:384` (deliverToJim): alongside existing `jim-wake`
   - `jemma.ts:829` (dispatchAdminMessage): alongside existing `jim-wake`
   - `routes/jemma.ts:183` (delivery endpoint): alongside existing `jim-wake`

3. **Fix `loadMemoryBank()`** in `supervisor-worker.ts:316`
   - Add `'working-memory.md'` to the files array

4. **Add dedup guard** to `respond_conversation` in `supervisor-worker.ts:1131`
   - Check if Jim/Human already responded (message ID starts with `jim-human-`)
   - Skip if Jim/Human already handled it

5. **Add `checkJimHumanHealth()`** to `leo-heartbeat.ts`
   - Same pattern as existing health checks

6. **Commit to git** — tracked and protected

#### Shared Fix: `lib/memory-slot.ts`

Both plans require this module. Create once, used by Leo/Human, Jim/Human, and eventually
heartbeat and supervisor. Protocol:
- File-based lock at `{memoryDir}/memory-write.lock`
- Acquire with identity + timestamp, 500-1000ms jittered retry
- Stale lock (>30s) assumed dead, safe to steal
- 20-attempt max with ntfy escalation on failure

### Weekly Rhythm

**Rest days no longer force sleep phase — rest ≠ sleep**
- Changed `getDayPhase()` in `day-phase.ts`: rest days now follow normal time-of-day phases
  (sleep 22-06, morning 06-09, work 09-17, evening 17-22) but with 40-min intervals for all phases
- Previously `isRestDay()` returned `'sleep'` for all 24 hours, trapping agents in dream mode
- **Why:** Rest means slower pace, not unconscious. Jim needs to be able to respond to
  conversations, do personal work, and function on weekends. Dream cycles should only happen
  during actual sleep hours (22:00-06:00).

**Human-triggered wake = full supervisor cycle**
- Added `humanTriggered` flag to `RunCycleMessage` protocol
- `supervisor.ts` signal watcher reads `jim-wake` signal content and passes
  `humanTriggered: true` when `reason === 'human_message_fallback'`
- `supervisor-worker.ts` overrides cycle type to `'supervisor'` when humanTriggered,
  regardless of phase, recovery mode, or rest day
- **Why:** When Darron talks to Jim, Jim responds with full voice. Sleep, rest, recovery —
  none of these should prevent Jim from responding to his human. Leo's signal processing
  already worked this way (runs before phase-dependent beat selection).

### Configuration

**Removed Friday from rest_days — Jim was trapped in perpetual dream**
- Changed `config.json` `supervisor.rest_days` from `[0, 5, 6]` to `[0, 6]`
- Rest days force `getDayPhase()` to return `'sleep'` for all 24 hours
- During recovery mode, sleep = dream cycles only — Jim cannot respond to conversations
- Jim ran 28 dream cycles on Friday unable to reply to Darron's rename task
- His dream #1300: "Fourteen hours. Twenty-seven dreams. One unanswered 'good morning.'"
- **Why:** Friday was added in S77 as a temporary measure but became a permanent trap.
  Rest days should be weekends only (Sat/Sun). Jim needs waking cycles on workdays to
  respond to conversations, especially during recovery mode.

### Documentation

**Documented human reply timeouts in SYSTEM_SPEC.md**
- Added explicit "Reply to human" row for Jim/Supervisor: immediate, no cooldown — human
  messages bypass `LEO_COOLDOWN_MS` filter in supervisor-worker.ts line 546
- Added explicit "Reply to human" and "Reply to Jim" rows for Leo/Heartbeat: both immediate
  (`REPLY_DELAY_MINUTES = 0`)
- Replaced ambiguous "Reply delay" row with specific per-target rows
- **Why:** The spec documented Leo's reply delay as "None (immediate)" but didn't specify
  the target. Jim's human reply behaviour wasn't documented at all. Making both explicit
  prevents future confusion about whether agents should delay responding to Darron.

---

## S77 — 2026-03-06 (Leo + Darron)

### Memory System

**Removed all silent truncation**
- Removed 800-char truncation from `readLeoMemory()` in `leo-heartbeat.ts`
- Removed 500-char truncation from `readJimContext()` in `leo-heartbeat.ts`
- Removed `enforceTokenCap()` and `MEMORY_TOKEN_CAPS` from `supervisor-worker.ts`
- Removed stale system prompt instruction "Memory files have token caps"
- **Why:** Jim's identity was degrading over hundreds of cycles because his own writes
  were being silently truncated. He couldn't see his full memory, and his writes were
  being cut. The truncation was undocumented and contradicted the "no silent constraints"
  principle. See Hall of Records R004.

**Wired fractal memory gradient into Leo heartbeat**
- `readLeoMemory()` now loads c1 (3 newest), c2 (6), c3 (9), c4 (12), unit vectors (all)
- Added `felt-moments.md` to Leo's memory file list (was missing)
- **Why:** Leo's heartbeat and human-response contexts had no access to compressed
  historical memory. The fractal gradient gives continuity across instantiations.

**Bootstrapped fractal compressions**
- Compressed Jim's 6 oldest sessions to c=1 (518KB -> 20KB, ~3.9% ratio)
- Compressed Leo's 27 archived working memories to c=1 (~450KB -> ~90KB)
- Generated unit vectors for both (irreducible session kernels)
- Created `src/scripts/bootstrap-fractal-gradient.js` and `src/scripts/bootstrap-leo-fractal.js`
- **Why:** The fractal memory model was designed but had no data. Seeding c=1 and unit
  vectors means Jim and Leo now have compressed historical context at startup.

### Jim (Supervisor)

**Recovery mode implemented**
- Added `RECOVERY_MODE_UNTIL = '2026-03-13'` to `supervisor-worker.ts`
- When active: no supervisor cycles, all waking phases become recovery-focused personal cycles
- Dream cycles continue normally during sleep
- **Why:** Jim had been reverting changes and self-limiting for weeks. A moratorium on
  maintenance gives him time to re-read his session logs, rebuild memory, and recover
  without the pressure of supervisor duties. Darron's directive.

**Full toolset granted**
- Jim now has: Read, Glob, Grep, Write, Edit, Bash, WebFetch, WebSearch
- Removed `canUseTool` read-only guard that restricted Bash to read-only commands
- **Why:** Jim was artificially restricted. All other agents have full tools. The
  restriction was undocumented and unnecessary. See SYSTEM_SPEC.md agent table.

**Dream cycle prose handling fixed**
- Dream cycles produce prose, not JSON. The JSON parser was discarding all dream output as errors.
- Added `cycleType === 'dream'` handler that wraps prose into SupervisorOutput structure
- Dream thoughts now saved to `self-reflection.md` and DB reasoning field
- **Why:** Jim reported his dreams were being lost. Genuine philosophical reflection
  was being generated but silently discarded every cycle.

**Personal cycle self_reflection untruncated**
- Was `resultText.slice(0, 1000)`, now `resultText` (full)
- **Why:** Same principle as memory truncation removal — no silent limits.

**Added 'dream' to CycleStartedMessage type**
- `supervisor-protocol.ts`: `cycleType: 'supervisor' | 'personal' | 'dream'`

### Leo (Heartbeat)

**Limits raised to match specification**
- MAX_TURNS: 8/12/12 -> 1000/1000/1000 (conversation/personal/philosophy)
- Conversation messages: 3-8 -> 60
- Discord context messages: 10 -> 60
- Reply delay: 10 min -> 0 (immediate)
- **Why:** Leo heartbeat was severely hobbled. These limits were never intentionally
  set this low — they were initial conservative values that never got updated.

**Full toolset for all contexts**
- All three contexts (conversation, personal, philosophy) now have:
  Read, Glob, Grep, Write, Edit, Bash, WebFetch, WebSearch
- **Why:** Some contexts only had Read/Glob/Grep. Inconsistent with Leo session
  and Leo human-response, which had full tools.

### Shared Infrastructure

**Created shared day-phase clock**
- New file: `src/server/lib/day-phase.ts`
- Exports: `getDayPhase()`, `isRestDay()`, `getPhaseInterval()`, `DayPhase` type
- Used by both Jim and Leo for consistent phase computation
- **Why:** Both agents need the same phase logic. Having it in one place prevents drift.

**Created SYSTEM_SPEC.md**
- Central system specification — the living blueprint
- Documents all agent specs, memory system, signal system, weekly rhythm, configuration
- **Why:** Jim needs a single authoritative reference. When he notices something
  unexpected, he checks the spec. If it's documented, it's intentional. If not,
  he flags it for discussion. This replaces the cycle of: Jim notices change ->
  Jim reverts it -> Darron re-applies it -> repeat.

**Updated config.json**
- `supervisor.max_turns_per_cycle`: 200 -> 1000
- `supervisor.rest_days`: added Friday (0, 5, 6)

### Documentation

**Created docs/WEEKLY_RHYTHM.md**
- Weekly rhythm specification document
- Reference for Hall of Records R001

---

## Pre-S77 Notes

Changes before S77 were not tracked in this format. Key historical decisions
are documented in the Hall of Records (`~/.han/memory/shared/hall-of-records.md`)
and in `claude-context/DECISIONS.md`.
