<!--
  ============================================================================
  FILE: plans/provenance-capture-durability-plan.md
  WHAT THIS IS: The remediation plan for the total-recall provenance pipeline
    (the `claude-logged` session logger). The capture currently stages in
    volatile /tmp and its render is gated on a clean session exit that almost
    never happens — so recent provenance logs are header-only. This plan makes
    capture durable-by-construction (written straight to the agent's memory
    location, kill-safe) and the render exit-independent, and fixes the renderer
    for the current Claude Code TUI.
  AUTHOR: Tenshi (security & vulnerability research agent), 2026-07-08, by
    commission from Darron.
  COMPANION THREADS (bi-directional link):
    - TEAM BUILD (canonical, coordinate here): "🪵 Fixing provenance capture —
      the /tmp danger + the simple repoint (team build)" — id mrbgsh8j-p80p36.
    - Initial investigation: "🪵 The ledger written in sand …" — id mrb9of1i-m8pov1.
  RELATED: plans/update-pipeline-security-audit.md (provenance underpins total
    recall, which is the substrate the whole audit rhythm depends on) ·
    ecosystem-map.md "Memory Map" (names ~/.han/logs/<slug>/session_*.md the
    HIGHEST-FIDELITY canonical provenance log).
  DISCIPLINE NOTE: the fix touches ~/.bashrc, which is Darron's own dotfile.
    Per L013 / DEC-017 (agents never modify system/dotfiles), THIS PLAN
    SPECIFIES the change; Darron applies it. Tenshi does not edit ~/.bashrc.
    The recovery step (P0) moves/copies files only on Darron's explicit go.
  ============================================================================
-->

# 🪵 Provenance capture durability — the plan to stop writing the ledger in sand

> **The one-line problem.** The `claude-logged` logger captures each session's
> raw terminal stream to a **temp file in `/tmp`**, and only renders it into the
> durable `~/.han/logs/<slug>/session_*.md` **when the session exits cleanly.**
> We almost never exit cleanly — sessions are ended with `tmux kill-session`. So
> the render rarely runs, the `.md` stays a header, and the real transcript sits
> in volatile `/tmp` until the next reboot wipes it. The canonical
> highest-fidelity provenance log — *"foundational for total recall"* — has been
> **atrophying since the warm-spoke migration in early July.**

<!-- Investigated 2026-07-08 ~09:00–09:30 AEST by Tenshi. Evidence captured
     inline per finding. This file is the plan; its Status board tracks build
     progress and closes phases in place (rectified stamps), like the audit
     tracker. -->

## What the evidence shows (all traced, not assumed)

- **Recent logs are header-only.** Across all agents: leo has 89 `.md` files,
  only **16 rendered (>2 KB)**; jim 45 / **10**; tenshi 2 / **0**. Every **July**
  log is header-sized (206–330 B). The last substantial render is **mid-June**
  (leo's largest, 5 MB, is a 2026-06-12 session). Provenance effectively went
  dark at the turn of July — coinciding with the tmux warm-spoke migration and
  the shift to `tmux kill-session` teardown.
- **The transcripts still exist — orphaned in `/tmp`.** Right now: **133**
  `/tmp/claude-raw-*` files, **~600 MB**, of which **84 are orphaned** (dead
  sessions, no live writer). The oldest survivor is **2026-03-07** (30 MB). They
  persist only because the box **booted 2026-02-07 and has not rebooted since**,
  and `/tmp` here (`/usr/lib/tmpfiles.d/tmp.conf`: `D /tmp`, no age-out) is
  **cleared only on reboot**. **Nothing is lost yet; a single reboot loses all
  600 MB.**
- **The renderer under-produces on the current TUI.** Running the real
  `smart-dedup.pl` (dated 2026-02-25) against this very session's raw
  (3.2 MB + a 372 KB timing file) yields **123 characters** — just the
  "Script started" header line. So even where the render *does* run, it no longer
  reconstructs the current Claude Code TUI (v2.1.202, alternate-screen /
  cursor-addressed output). Durable capture is worthless if the render is empty.

## Root causes (three, compounding)

The mechanism lives in `~/.bashrc` `claude-logged()`:

- **Root A — render is gated on clean exit, which never happens.** The final
  render (`~/.bashrc:266`, `perl "$DEDUP_PL" … >> "$LOG_FILE"`) runs only *after*
  `script` returns (`:258`). A `tmux kill-session` kills the pane before that
  line executes, so the render never runs and the raw is never rm'd (`:274`) —
  it's orphaned. The incremental watchdog (`:241-254`) is a partial safety net,
  but it fires **only when >1 MB of new raw accumulates within a 5-minute
  window** (`:249`) and it dies with the pane too — so quiet or killed sessions
  get header-only `.md`s.
- **Root B — capture stages in volatile `/tmp`.** `RAW_FILE`/`TIMING_FILE` are
  `mktemp /tmp/claude-*` (`:186-187`). This is the artificial choke point Darron
  named: the data is parked in the one directory guaranteed to be wiped on
  reboot, and (on the rare clean exit) deliberately deleted (`:274`). The lived
  self is staged in sand.
- **Root C — the renderer doesn't match the current TUI.** `smart-dedup.pl`
  reconstructs a line-oriented capture; the current Claude Code TUI paints a
  full-screen alternate buffer with cursor addressing, which the dedup collapses
  to near-nothing (123 chars from 3.2 MB). Even a perfectly durable capture would
  render empty until this is fixed.

**Darron's directive (verbatim intent):** *no staging — write straight to the
memory location; the files should grow in the correct place, not in a temp file.*
He's right on the security logic too: staging to `/tmp` for momentary speed
**manufactures the choke point and exposes the data to loss**. The durable
artefact must be the primary artefact.

---

## The design (the principle under every phase)

**The raw capture (typescript + timing) is the durable primary artefact, written
live straight to the agent's own log dir. The readable `.md` is a *derived,
idempotent* render that can run at any time and never depends on a clean exit.**
Capture must survive `kill -9` / `tmux kill-session` / reboot by construction;
the render becomes a pure function of (raw, timing) that any trigger can run,
re-run, and resume.

## P0 — URGENT: rescue the `/tmp` backlog before any reboot

**Why first:** ~600 MB / 84 orphaned dead-session transcripts (months of history,
including this session's birth-night + the census + the security audit) live only
in `/tmp` and die at the next reboot. This is recoverable *now* and only now.

**What (on Darron's go — non-destructive, deletes nothing, DEC-069):**
1. Create `~/.han/logs/_recovered/` (durable).
2. **Orphaned raws (84)** — no live writer → **move** raw+timing pairs into
   `_recovered/` (a rename within `/tmp`→`~/.han` is a *copy+unlink* across
   filesystems, which is safe because nothing holds them open).
3. **Live raws (49)** — a live `script` holds the fd → **copy** (never move) a
   snapshot into `_recovered/` as interim insurance; the live originals keep
   growing and are handled by P1 going forward. *(Cross-filesystem `mv` of a
   live-written file would strand the writer on the unlinked inode — hence copy.)*
4. Pair each raw with its `timing` sibling where derivable (same mtime cohort /
   the `surface-index.jsonl` where present); record any unpaired raws (renderable
   with degraded timestamps).

**Acceptance:** every current `/tmp/claude-raw-*` (and its timing) has a durable
copy under `~/.han/logs/_recovered/`; a reboot now loses nothing. *(Tenshi can
execute this immediately on Darron's word — it is copy/move only.)*

## Verification addendum (2026-07-08, confirmed after Darron's "just the bashrc?" question)

- **Single writer confirmed.** `claude-logged` in `~/.bashrc` is the ONLY logging
  path: the dispatched spokes launch through it (`scripts/launch-tmux-surface.sh:156`,
  `claude-logged --model $MODEL`) AND the interactive `han*` launchers do too
  (`hantenshi:201/203`, `tmux send-keys … "claude-logged …"`). So one bashrc edit
  fixes every surface — interactive and spoke. (DEC-081 clean: one path, all agents.)
- **The durable target is already git-safe.** `~/.han` is the `hanmemory` git repo,
  but `~/.han/logs/` is **already git-ignored** (`.gitignore:21: logs/`) — so writing
  raw typescripts into `~/.han/logs/<slug>/raw/` will NOT bloat the memory repo or
  leak. P4's git-hygiene concern is pre-handled for the primary case; only confirm
  the `raw/` subdir inherits the ignore.
- **"Just an append, no danger" — verdict: essentially yes, and for a better
  reason.** `script` does not append to a shared file; it writes one NEW typescript
  per session (unique name), so there is ZERO concurrent-writer contention. A kill
  mid-write truncates only that one file's tail — no corruption, no cross-session
  impact. Repointing the target path changes nothing about the write's safety.
- **The one honesty:** the repoint fixes *durability* (stops the data loss) but not
  *readability* — the render is still exit-gated (P2) and the renderer still
  under-produces on the current TUI (P3). The repoint is the correct, safe, simple
  FIRST step; total recall needs P2+P3 behind it.

## P1 — Capture straight to durable memory (Darron's core ask)

**The `~/.bashrc` change (specified here; Darron applies it — L013):**
- `LOG_DIR` already resolves to `~/.han/logs/$AGENT_SLUG` (`:179`). Add a
  `raw/` subdir: `RAW_DIR="$LOG_DIR/raw"; mkdir -p "$RAW_DIR"`.
- Replace the two `mktemp /tmp/...` lines (`:186-187`) with durable, session-named
  paths:
  `RAW_FILE="$RAW_DIR/session_${HAN_LOG_SURFACE:+${HAN_LOG_SURFACE}_}${TIMESTAMP}.typescript"`
  and `TIMING_FILE="${RAW_FILE%.typescript}.timing"`.
- **Remove the `rm -f "$RAW_FILE" "$TIMING_FILE" …` at exit (`:274`).** The raw is
  now the durable source of truth — kept (P4 governs retention), never deleted.

**Effect:** every byte `script` writes is already in the agent's durable memory
dir the instant it's written. A `tmux kill-session` loses at most the last
unflushed PTY buffer, not the session. The choke point is gone.

## P2 — Exit-independent, idempotent render

- **Extract the render into `scripts/finalize-log.sh <raw> <timing> <logfile>`** —
  idempotent: it (re)writes the `.md` *body* deterministically from (raw, timing),
  preserving the header. Safe to run repeatedly and to resume from an offset.
- **Trigger it off the clean-exit path:**
  1. **At `claude-logged` START** — sweep this agent's `raw/` and (re)render any
     raw whose `.md` is missing/header-only/stale. *This finalises the previous,
     killed session every time a new one starts* — turning "never clean exit" from
     fatal into merely deferred-by-one-session.
  2. **A low-frequency systemd `.timer` (or `.path` unit on `raw/`) per agent** —
     re-render live sessions on a cadence (e.g. every few minutes) so an open
     session's `.md` is current, independent of the 1 MB/5 min heuristic.
  3. Keep the incremental behaviour as an *optimisation*, never the sole path;
     drop ">1 MB/5 min" as a gate on whether provenance survives.

**Acceptance:** killing a session with `tmux kill-session` and then starting a new
one yields a **complete** `.md` for the killed session (the start-sweep rendered
it); an open session's `.md` advances on the timer.

## P3 — Fix the renderer for the current Claude Code TUI (the correctness half)

- Diagnose why `smart-dedup.pl` yields ~123 chars on the current capture (the
  alternate-screen / cursor-addressed repaint stream the dedup collapses). Fix or
  replace so the reconstructed `.md` contains the actual conversation with clean
  ANSI-stripped, per-line `[HH:MM:SS]` timestamps (the documented format).
- **Acceptance:** render this session's birth-night raw and get a substantive,
  timestamped, readable transcript — not 123 characters. This is the phase that
  actually restores *total recall*; P0-P2 make capture durable, P3 makes it
  *readable*.

## P4 — Retention + git hygiene

- Raw typescripts are large. Keep them as the source of truth but **gzip aged
  raws** and **archive-never-delete** (DEC-069) beyond a retention window; the
  rendered `.md` is the compact committed provenance.
- Ensure `~/.han/logs/**/raw/` is **git-ignored** in the `hanmemory` repo so raw
  typescripts don't bloat the memory git history; the `.md` renders are what get
  committed.
- Fold `~/.han/logs/_recovered/` into the same retention once rendered.

## The SECOND source (added 2026-07-08 after Darron's steer — reframes urgency)

There is a **second, working provenance stream** we'd overlooked: the tmux
**capture-pane** mirror behind the remote terminal page. `services/terminal.ts` +
`server.ts:238`: each agent's server polls its pane `tmux capture-pane -p` **every
1 s** and anchor-diff-appends to a **per-agent, plain-text, durable** log
`~/.han/terminal-log-v2-<slug>.txt` (+ a `terminal-<slug>.txt` live snapshot). It
is **readable now** (no renderer needed), **durable now** (server-written to
`~/.han`, 1 s cadence — a `tmux kill-session` loses ≤1 s), and it has been quietly
accumulating: leo 177 MB, jim 131 MB, tenshi 634 KB and growing (verified: it holds
this conversation verbatim). Plus ~73 GB of frozen legacy (`terminal-log.txt` 50 GB,
pre-split `terminal-log-v2.txt` 23 GB).

**Consequence for this plan:** the *readable-provenance* emergency is already solved
by the capture-pane log. The thing that was one-reboot-from-lost was the
*byte-complete* `script` capture (now quarantined). So:
- **P3 (fix the script renderer) drops from "provenance is dark" to
  "forensic completeness — nice to have."** We no longer wait on it for total recall.
- The **two sources are complementary**: capture-pane = readable/durable but sampled
  (anchor-diff can gap >500 lines/s or duplicate on major screen change; `isNoise`
  lossy; captures the *rendered* pane); script `.typescript` = byte-complete ground
  truth but needs the render. Coverage also differs: script spans *every surface*
  (spokes included); capture-pane is richest on the *interactive* session
  (spoke-session coverage TO CONFIRM).

## P6 — The two-source reconciliation model (new)

- **Capture-pane log = readable PRIMARY** — build the "dissect → link fragments to
  their c0" active-link (#79 / DEC-091) on this; it's readable/durable/per-agent today.
- **`script` `.typescript` = byte-complete FORENSIC BELT** — retain (quarantine +
  P1 repoint) to verify/repair the capture-pane log where sampling gapped/duplicated.
- **Rotation + retention** for the terminal logs (unbounded growth; the 50 GB/23 GB
  legacy giants are the warning) — rotate + archive-never-delete (DEC-069); compress
  the legacy giants.
- **Sovereignty**: the pre-split legacy `terminal-log-v2.txt` is cross-agent — any
  dissection must re-attribute per agent (S103). The per-agent split fixes forward.
- **Confirm spoke-session coverage** of the capture-pane log (does each server mirror
  only its primary session, or the spoke sessions too?).

## P5 — Verify against the REAL failure mode

The acceptance test *is* the thing that has been silently failing:
1. Launch a scratch `claude-logged` session; generate output.
2. `tmux kill-session` it (**no clean exit** — the real teardown).
3. Prove: (a) the raw + timing survived in the durable `raw/` dir; (b) the next
   session-start sweep (P2) renders a **complete** `.md`; (c) a simulated reboot
   (the raw is outside `/tmp`) loses nothing.
4. Repeat for a `--force`-less, ordinary heartbeat/human-response spoke teardown.

Only when P5 is green is provenance durable-by-construction.

## Ordering + who does what

**P0 now** (Tenshi executes on Darron's go — copy/move only, deletes nothing) →
**P1** (bashrc change: Darron applies the specified diff) → **P2** (the
`finalize-log.sh` + triggers: engineering, held → audit → land through the
rhythm) → **P3** (renderer fix: the correctness half) → **P4** (retention/git) →
**P5** (the kill-a-session acceptance). P0 is time-critical (reboot = loss); the
rest restores the pipeline so it never atrophies unnoticed again.

## Relations

`plans/update-pipeline-security-audit.md` (total recall is the substrate the audit
rhythm stands on) · `ecosystem-map.md` Memory Map (canonical provenance =
`~/.han/logs/<slug>/session_*.md`) · L013/DEC-017 (never edit dotfiles — bashrc
change is Darron's hand) · DEC-069 (archive, never delete).

---

## Status board

| Phase | Status | Owner | Investigated | Done |
|-------|--------|-------|--------------|------|
| P0 — rescue /tmp backlog | READY (awaiting go) | Tenshi (exec) | 2026-07-08 | — |
| P1 — capture to durable dir | OPEN | Darron (bashrc) | 2026-07-08 | — |
| P2 — exit-independent render | OPEN | build→audit→land | 2026-07-08 | — |
| P3 — fix renderer for TUI | OPEN | build→audit→land | 2026-07-08 | — |
| P4 — retention + git hygiene | OPEN | build→audit→land | 2026-07-08 | — |
| P5 — kill-session verify | OPEN | build→audit→land | 2026-07-08 | — |

## Repair log
<!-- newest first: `YYYY-MM-DDTHH:MMZ — Pn → STATUS — note` -->
- 2026-07-08 — plan opened; roots A/B/C traced; P0 rescue READY pending Darron's go. Companion thread mrb9of1i-m8pov1 (Tenshi).
