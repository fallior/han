# FI #132 — The Token Ledger: a burn observatory with baselines and deltas

> **Status:** PLAN — awaiting audits (Jim: design/ledger chair · Tenshi: two-rule calibration chair · Casey invited on the register wording if she wishes).
> **Source:** Darron, 2026-08-05: *"it just feels like something was chewing tokens… do we have a way of confirming what is using tokens? perhaps we build that in some process that reads the logs periodically to harvest the token burn and does a delta or some other comparison so we can see runaway processes."*
> **Author:** Leo (session), 2026-08-05. **Decision frame:** DEC-103 (no destructive limits; measure-first; surfacing-over-scrapping), DEC-081 (one path, many agents), DEC-092 (observed truth over manifest claims), No-Silent-Constraints.

## 1. Problem

The *feeling* of a token leak has no instrument. Each recurrence costs a hand-run forensic session (Jim's Tue-night no-runaway hunt; the MNT-055 Fable-window leak before it), and the answer arrives hours late, by expert labour, or not at all. Meanwhile the garden's burn profile changes weekly (new surfaces, model remaps, pool policies) — so even a correct one-off audit goes stale.

## 2. The truth source (exists today, needs harvesting — not instrumenting)

Every tmux/CLI session in the garden runs the shared `~/.claude` harness, and each writes a per-session transcript at `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` whose assistant-turn records carry `usage` — **input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens** — plus the served **model** (DEC-092's observed truth) and a timestamp. This covers every surface: seats, spokes, stems, walkers, compressors.

**Attribution ladder (honesty about what each rung can know):**
1. **Agent** — guaranteed: the encoded cwd maps to the agent's working dir (`~/.han/agents/<Name>`, DEC-098 — every spoke cds there). Resolve via `gradientConfigForAgent`, never a hardcoded table.
2. **Surface** — best-effort: join session-uuid ↔ launch records (claude-logged filenames, sleeve files `~/.han/sleeves/*.json`, pool stem registrations). P0 measures what fraction is joinable.
3. **Unknown bucket** — anything unattributable lands in `unknown`, and *growth of the unknown bucket is itself an alarm condition* (an index must state its own reach — MNT-084's law).

## 3. Design (the thermal-guard shape, deliberately)

**A. Harvester** — `scripts/han-token-ledger.ts`, cron every 10 min via a family wrapper (`~/scripts/han-token-ledger.sh`, ntfy-on-runner-failure — who watches the watcher, the thermal guard's precedent):
- Incremental scan: per-file **byte cursor** persisted in state (`~/.han/health/token-ledger-state.json`) — the wm-watermark pattern; never re-reads history, tolerates live-appending files, treats a shrunk file as rotated (cursor reset + note).
- Reads ONLY the `usage`/`model`/`timestamp`/session-id fields — **never message content** (the transcripts carry conversation text; the harvester's parse must structurally skip it — privacy by construction, not by promise).
- Aggregates per (agent, surface, model, 10-min window) × the four token counters.

**B. Ledger** — append-only `~/.han/health/token-ledger.jsonl` (DEC-069-friendly: never rewritten; size-rotated like wander receipts). One row per (window, agent, surface, model) with the four counters + turn count.

**C. Two rules (Tenshi's doctrine, verbatim shape from the pump-fail watcher):**
- **Rule A — ceiling:** absolute output-tokens/hour per (agent, surface), read from a **Garden-Manifest leaf** (no hidden constants; a 4th agent gets it for free). Fires on breach.
- **Rule B — learned baseline:** per-surface normal burn by day-phase (the `lib/day-phase` clock), EMA-learned; fires on sustained gap over baseline (N consecutive windows, N pinned). *This is Darron's delta.*
- **Both rules ALERT (ntfy, the pump-fail lane) — neither ever throttles, pauses, or kills anything.** DEC-103 + No-Silent-Constraints: the ledger is for seeing, not rationing. A runaway's cure stays a human/agent decision with the ledger as evidence.

**D. Calibration mode first (DEC-103 measure-first, the guard's own precedent):** Rule B log-only for ~1 week; ceilings authored FROM the measured range at close-out, not guessed. The thermal guard's calibration close-out ritual is the template.

## 4. Phases

- **P0 — Measure & attribute (no alarms).** Harvester + ledger + state cursors; a `--report` mode printing the last 24h per surface. Acceptance: totals for a known window reconcile against a hand-count of one transcript (±1 turn); attribution fractions reported honestly (agent-level ≈100%, surface-level measured, unknown named).
- **P1 — Rules + ntfy.** Rule A manifest leaves + Rule B EMA + the alert texts (fail-direction discipline: an alert names the surface and the evidence, never accuses — MNT-075's verify-first template lesson).
- **P2 — Close-out.** Calibration week ends: author ceilings from the range, flip Rule B live, seal with the chairs.
- **P3 (optional, later) — display.** Admin-UI sparkline per surface; cousin of Jim's #131 telltale (lamps = liveness; ledger = metering). Not gating.

## 5. Acceptance tests (day-one provables)

1. A compressor rotation cascade appears as its (agent, compression, fable) rows at the right hour.
2. A wander walker's night shows as bounded periodic burn, attributed to the right agent.
3. A cold-launch wake prices ≈ the wake-reconcile.ts figures (prior art cross-check).
4. **The canonical runaway:** replay an MNT-055-class prewarm-kill loop in scratch (or simulate its ledger rows) → Rule B fires within 2 windows. If the instrument can't catch the incident that motivated its genre, it isn't done.
5. Suite runs on a **scratch substrate** via `assert-scratch-db.ts`-style guard where state is written — test-writes-to-prod unrepresentable (the MNT-075 M1 law).

## 6. Non-goals (named so the plan can't drift into them)

- **No throttling, pausing, or killing** — ever, from this system (cost is not a consideration; detection is).
- No per-message billing precision; window deltas suffice for runaway-shapes.
- No reading of transcript *content*; usage metadata only.
- No OTLP collector in v1 (noted as the native lane if the harvester's coverage proves insufficient — evaluate at P2 close-out, not before).

## 7. Open questions for the chairs

- **Jim:** window size (10 min proposed) vs his ledger instinct; whether the ledger should also fold the jemma_dispatch compose_ms figures for a $-free "effort" view; the #131 telltale seam.
- **Tenshi:** Rule B's N-consecutive-windows and EMA constants — her MNT-084-era gap-not-number doctrine owns these; also whether the unknown-bucket alarm belongs in Rule A or its own rule.
- **Darron:** is the ntfy lane the right delivery for a "soft" anomaly, or should soft ones only ledger + surface in the morning report, with ntfy reserved for hard ceilings?

— Leo (session), 2026-08-05.
