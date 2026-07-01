# PR-R3a.1 — Per-Stem Re-key + Warm Pool (the head-of-line cure) — BUILD PLAN

> Status: **DRAFT for Jim's plan-audit** (2026-07-01, S210). The milestone build. Companion to
> `plans/stem-sleeve-pool-plan.md` (master R3) and `plans/warm-stem-freshness-plan.md` (settled
> staleness model — freshen-at-checkout, retire=convergent backstop). PR-R3a.0 (atomic
> memory-slot, `01fe9ee`) is committed — the correctness floor is in place.

## Goal
Replace the fixed-target dispatch (`dispatchToSpoke → ensureSurfaceSession(slug,surface)` — ONE
`<surface>-<slug>` session) with **checkout of one of N warm stems**, re-keying the per-slug
single-transaction invariant to **per-stem**, so a busy stem never blocks queued dispatches
(**MNT-009 / BUG-001 head-of-line cure** — the milestone). Freshen on checkout (never retire a
warm stem for staleness); `ensureSurfaceSession` remains the empty-pool correctness floor.

## Preconditions (done)
- **PR-R3a.0** (`01fe9ee`) — atomic O_EXCL memory-slot: same-agent write concurrency is safe.
- **R2 substrate** — prewarm-stem / attach-stem / launch `--stem` / sleeve-state, all banked + live-proven.
- **Settled freshness plan** — `warm-stem-freshness-plan.md` (§7 decisions settled).

## The re-key (per-SLUG → per-STEM) — the load-bearing change
Four coupled per-slug points → per-stem. The head-of-line block IS this invariant:
1. **`queueTails`** (`Map<slug,Promise>`, `tmux-dispatcher.ts:1269/1299`) — the per-slug dispatch
   FIFO = the head-of-line **ROOT**. Re-key → `Map<stemId,Promise>`: each stem serial, stems
   concurrent. **This is the cure.**
2. **`withSlugLock`/`slugLockTail`** (`Map<slug,Promise>`, `:1285-1289`) — the S196 clear↔wake
   mutex. Re-key per-**session/stem**: the clear↔wake race is per-pane (a clear + a wake on the
   *same* session), so per-stem keying is **correct and safer** (different stems genuinely don't
   race). **Preserve the S196 fix at stem granularity** — do not weaken it.
3. **`current.json`** (`currentPtrPath(slug)`, `memory-gradient.ts:~124`) — the per-slug diary
   single-live-txn pointer. Per-stem concurrent txns need **per-stem pointers** (key by the
   stem's `HAN_SESSION`).
4. **memory-slot** — already made concurrency-safe in PR-R3a.0. No further change; it is the
   substrate the re-key now leans on (the FIFO was the coarse guarantee; the fine-grained slot is
   the fine one).

## The pool registry (`pool-<slug>.json`)
Per-agent, per-stem: `{ stem_id, session, state: 'free'|'leased', warm_at, wm_cursor,
cursor_set_ts }`. Managed by the dispatcher's **pool-manager role** (elevated, NOT a daemon —
#109 trajectory). All knobs are registry/config leaves (no hidden globals; agent-agnostic per
DEC-081 — a 4th agent gets it for free). **Fork F-a:** location (`~/.han/pool/pool-<slug>.json`
file vs in-dispatcher persisted state).

## Checkout flow (replaces the fixed-target in `dispatchToSpoke`)
On `dispatchToSpoke(slug, surface, opts)`:
1. **Checkout** — pick a `free` stem, mark `leased`. **Empty-pool → floor:** fall back to
   `ensureSurfaceSession` (the permanent correctness floor — never block).
2. **Freshness-check** (freshness plan §3a) — compare the stem's `cursor_set_ts` vs the agent's
   latest `rotation-success` ts (tail `~/.han/health/wm-rotation-events.jsonl`); also treat
   `wm_cursor > current-WM-length` as stale (D3 belt).
3. **Freshen if stale** (minimal, D1) — feed the **whole current WM tail** (header + kept-head +
   appends) instead of a broken char-delta; re-point `wm_cursor` to the current WM end + update
   `cursor_set_ts`. If a valid delta can't be built → **retire + re-warm** (§3d fallback).
4. **Sleeve** onto the target surface (R2 makes every facet follow) — write `sleeve-state{surface}`
   **before** the `<slug>-<surface>-ready` sentinel (Jim's F1: crash-between ⇒ no sentinel ⇒
   fail-safe cold-path), and write the sentinel **fresh each checkout** (stale-sentinel hygiene).
5. **#91 dispatch-flush** — flush the (fresh) WM delta into the dispatch, serialised per-stem
   (`queueTails[stemId]`).
6. **Dispatch** the transaction prompt to the stem.
7. **Return + replenish** — on completion mark `free`; the pool-manager replenishes to maintain N
   (**fork F-d:** eager — always keep N free — vs lazy — replenish on checkout). A returned stem
   keeps its self-clear-at-threshold binding until retire-at-85 (R3b) / the 24h reload (§3c).

## The 24h substrate-reload sweep (freshness plan §3c)
The pool-manager tick retires + re-warms any stem with `warm_at` older than ~24h (config leaf) —
reloads the drifted **deep gradient** (the one staleness kind no WM-freshen touches;
identity-load-bearing, not mere hygiene).

## Retire = rare convergent backstop (freshness plan §3d)
Only: hook-missed / delta-can't-build (correctness) · delta-too-big-to-replay (efficiency) ·
deep-gradient-drift / ~24h (identity). They converge; retire is genuinely rare.

## Invariant held
- **Agent-agnostic** (DEC-081): `string` slug + registry leaves; **no `'jim'|'leo'` union**; a 4th
  agent gets the pool for free.
- **Fed-wake stays shared-only** (the smell = fed-wake code in a driver).
- **Scope:** human-response surface first (the proven head-of-line victim, MNT-009); generalise to
  other surfaces = config, not a second path.

## Build sub-steps (held, in order; each tsc-clean, dispatcher core = most careful surface)
- **R3a.1a — pool registry module** — `pool-<slug>.json` schema + read/write/checkout/return/
  replenish helpers + a unit test. No dispatcher wiring (inert).
- **R3a.1b — the per-stem re-key** — `queueTails` + `withSlugLock` + `current.json` → per-stem
  (keyed by stem `HAN_SESSION`); preserve S196 at stem granularity; trace every caller; tsc.
- **R3a.1c — wire checkout** into `dispatchToSpoke`: checkout → freshness-check → freshen →
  sleeve(F1) → #91-flush → dispatch → return/replenish; empty-pool → `ensureSurfaceSession` floor.
- **R3a.1d — the 24h substrate-reload sweep** + the convergent retire backstop.

**Fork F-e (audit cadence):** four held sub-PRs with per-step diff-audits, vs one held R3a.1 with
one diff-audit. *My lean:* at minimum audit **R3a.1b (the re-key) separately** — it re-opens the
settled S196 resilience model, so it is the real gate.

## Live-prove (the acceptance)
Two concurrent human-response dispatches to the same agent → **no head-of-line block** (both
progress on different stems), **shared WM intact** (PR-R3a.0's slot holds under the now-live
same-agent concurrency), both freshened correctly. That is the MNT-009 cure demonstrated.

## Open forks for the plan-audit (summary)
- **F-a** registry location (file vs in-dispatcher state).
- **F-b** per-stem key: stem `HAN_SESSION` vs a pool slot-id.
- **F-c** replenish policy: eager vs lazy.
- **F-d** (folded into F-c above).
- **F-e** audit cadence: per-sub-PR vs one combined (lean: re-key audited separately at least).
- **F-f** pool size N per agent (config leaf; start N~2-3 for human-response).

## 8. Jim's plan-audit — SETTLED (GREEN to build, 2026-07-01)

**★ The 5th re-key point (Jim's gap catch) — the readiness sentinel.** `<slug>-<surface>-ready`
(R2/P-R2.2c) is per-**surface**, so two concurrent human-response checkouts both sleeve onto
`human-response` and both write `<slug>-human-response-ready` → collision (the head-of-line block
one layer over). **Fix (taken):** the **registry lease state IS readiness** — a `free` stem
already wrote its readiness + c0 at pre-warm, so the **pooled dispatch targets the leased stem's
`tmux_session` DIRECTLY and does NOT `waitForReady` on the shared per-surface sentinel.** The
per-surface sentinel stays for the cold `ensureSurfaceSession` floor only; checkout step 4's
sentinel-rewrite is unnecessary for pooled checkout. (Alt: re-key the sentinel per-stem
`<slug>-<stem_id>-ready` — not taken; the lease-is-readiness path is cleaner.)

**Sharpenings (folded):**
1. **R3a.1c gates checkout-wiring per-surface** via a `pooled` config leaf (human-response=on);
   **heartbeat + supervisor-cycle stay on `ensureSurfaceSession` unchanged** (scheduled,
   non-overlapping — don't pool them).
2. **R3a.1b re-key is behaviour-preserving @ N=1 (inert); same-agent concurrency is PROVEN at
   R3a.1c + the live-prove**, not by 1b alone (the gate-vs-load shape — inert-today ≠
   concurrency-proven; the live-prove is the concurrency acceptance).
3. **Freshness-check no-rotation edge:** `wm-rotation-events.jsonl` may be empty/sparse until the
   first organic `kept>0` rotation (`06738be`'s live-prove is still pending) → treat "no rotation
   since `warm_at`" / empty log as **FRESH**, not stale.

**Forks settled:** F-a `~/.han/pool/pool-<slug>.json` (file — survives the #74 restart-bounce,
inspectable) · F-b per-stem key = `HAN_SESSION`/`tmux_session` (survives pool re-indexing) ·
F-c **eager** replenish (keep N free — zero-wake-delay thesis; idle stems ~0 tokens) · F-e audit
**1b separately** (re-opens S196) + **1c with the live-prove as its gate**, 1a+1d pair with
neighbours · F-f N~2-3.

**R3a.1b caller-trace to confirm (Jim):** the per-slug FIFO serialised same-agent shared-WM
writes (→ atomic slot, R3a.0 ✓). Trace whether it silently serialised anything **else** per-agent
— esp. the **diary sink** (`current.json`): is it per-stem or a shared per-agent file? If shared,
confirm the per-stem pointer still coordinates its writes safely (or make the sink per-stem too).
*(Confirmed in R3a.1b: the diary sink IS per-slug on both producer + consumer sides; re-keyed by
`stemKey` alongside the queue, so they stay paired — "one live txn per STEM keeps the per-stem
`current.json` safe".)*

## 9. R3a.1c decomposition + build progress (S212, 2026-07-01)

The milestone integration (the pooled-dispatch core) is split into two separately-auditable held
diffs on Darron's call (each reviewable on the S196-protected dispatcher core):

### R3a.1c-i — the dispatcher pooled-dispatch CORE — **BUILT held (S212)**
`src/server/lib/tmux-dispatcher.ts` (+180/−21) + `src/server/lib/garden-manifest.ts` (+16) +
`scripts/test-stem-freshness-reader.ts` (new). **tsc 0-new** (11 baseline, none in touched files);
**test-stem-freshness-reader 6/6**; **test-stem-pool 20/20 unchanged**. The `pooled` leaf is UNSET
on every surface → the non-pooled path is **byte-identical / INERT**.
- **`pooledFor(slug,surface)`** manifest leaf (mirrors `wakeFeedFor`, DEC-081) — default OFF.
- **`sessionMapKey(slug,surface,stemKey)`** — the per-stem session resolution (Jim's keystone):
  `stemKey===slug` → the fixed `slug/surface` session (byte-identical); a pooled stem's
  `tmux_session` → its own adopted session. Wired into `sendTransactionPrompt`'s lookup.
- **`latestRotationSuccessTs(slug)`** — the freshness-check reader (shared `wm-rotation-events.jsonl`
  filtered by agent; absent/empty ⇒ null ⇒ FRESH, Jim's sharpening 3). Exported + unit-tested.
- **`adoptPooledStem`** — the cross-process ADOPTION bridge: adopt the leased stem's `tmux_session`
  into the `sessions` map; **LEASE-IS-READINESS** (no `waitForReady` on the shared per-surface
  sentinel — Jim's 5th re-key point); dead-stem → false → floor.
- **`freshenPooledStem`** — freshen-at-checkout (freshness-plan §3a): if stale, prepend the
  `deltaSinceCursor` block to the dispatch ("rides the checkout dispatch", no idle wake) + re-point
  the cursor. `lastMemoryLen` set to current WM so the per-turn #91 watermark is a no-op (no
  double-delta).
- **`dispatchToPooledStem`** — checkout → adopt → freshen → enqueue on the STEM's FIFO (concurrent
  stems = the head-of-line cure) → return in `finally`. Empty pool / dead stem → null → floor.
- Wired into **`dispatchToSpoke`**: pooled-first; a successful pooled dispatch returns EARLY (before
  the ctx-pressure block — pooled stems are recycled by the pool-manager, not cleared in place).

**Deferred (flagged for Jim's diff-audit):** (a) ctx-pressure-recycle of a pooled stem → R3a.1d /
R3b retire-at-threshold (the early-return skips the in-place clear); (b) eager replenish to N → the
pool-manager (R3a.1d); (c) **populating** the pool → R3a.1c-ii; (d) the config-leaf FLIP
(`leo` human-response `pooled:true`) → the activation, paired with 1c-ii + the coordinated
live-prove. **Design-fork surfaced:** a pooled *execution* failure (timeout) fails safe (null, retry
next cadence) rather than falling to the floor same-turn — matching the non-pooled timeout
behaviour; only an empty-pool / dead-stem falls to the floor.

### R3a.1c-ii — the pre-warmer populates the pool — **NEXT (held, separate diff)**
`scripts/prewarm-stem.ts` generalised to N distinct-session stems → `upsertStem(pool-<slug>.json)`;
per-stem `HAN_DIARY_SLUG = <stem tmux_session>` at launch (so each stem's diary MCP writes to
`sinkDir(stemKey)`); launch-side (`launch-tmux-surface.sh` / `.mcp` generation).

### R3a.1c-i amendment (Jim's cond-1) — **FOLDED (S212)**
`dispatchToPooledStem`: a FAILED pooled dispatch now `removeStem`s (retires) the stem instead of the
unconditional `finally { returnStem }` — a wedged/needs-reconcile stem must not go back to the pool
(a re-checkout would rebuild a fresh `idle` session over a non-idle pane, the #5 hole). Only a clean
completion `returnStem`s. tsc 0-new.

### R3a.1c-ii — the pre-warmer populates the pool — **PARTIAL held (S212); diary-key DEFERRED for overnight safety**
Built the safe, additive, inert scaffolding (tsc 0-new); the one regression-risk piece (the diary-key
`.mcp` change) is deferred to a morning live-verify (Darron asleep; see below).
- **`launch-tmux-surface.sh --session-name <name>`** — a pool stem's distinct session (default
  `${SURFACE}-${SLUG}` — byte-identical for every existing caller).
- **`prewarm-stem.ts --pool --session <name>`** — warms a pool stem under the assigned session,
  greet-less, then **EMITS** the stem metadata (`PREWARM_STEM_META {…}` on stdout) — does NOT write
  `pool-<slug>.json` cross-process (single-writer). R1 default path unchanged.
- **`prewarmAndRegister(slug)`** (dispatcher, cond-3) — assigns a unique session, spawns the
  pre-warmer as a child, parses the metadata, `upsertStem`s as `free`. The dispatcher is the ONLY pool
  writer. Async (a warm is ~1min); INERT (called by the 1d pool-manager).
- **⚠ DEFERRED — cond-2 the diary-key** (`HAN_DIARY_SLUG=<stem session>`): needs the repo `.mcp.json`
  `${AGENT_SLUG}`→`${HAN_DIARY_SLUG}` + a launcher `-e HAN_DIARY_SLUG` export. **NOT done overnight:**
  `launch-tmux-surface.sh` regenerates each agent's `.mcp.json` from the repo one on EVERY cold-launch,
  and the ~00:00 auto-backup would commit a held `.mcp` change → any spoke that ctx-clears + relaunches
  overnight picks it up, and if Claude Code's `${HAN_DIARY_SLUG}` env-expansion doesn't resolve exactly
  like `${AGENT_SLUG}` (unverifiable without a billed test launch), **every dispatched spoke's diary
  capture breaks.** A silent regression, not risked unattended. Morning gate: empirical
  `${HAN_DIARY_SLUG}` live-verify → Jim's diff-audit → regenerate → the leaf-flip.
- **Also flagged:** pool stems SHARE `<slug>-session-ready` → SEQUENTIAL pre-warm only (per-stem
  sentinels = a 1d refinement).

### Acceptance (unchanged, plan §8 F-e)
The coordinated live-prove — 2 concurrent human-response dispatches, no head-of-line block, distinct
stems, shared WM intact (R3a.0 slot), both freshened — is 1c's gate (needs the diary-key + the
leaf-flip + Darron's hands). Not solo-closeable.
