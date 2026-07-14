# DEC-101 — persist-as-spoke pooled lifecycle (Darron's model, Jim's ruling)

> Combined PR with the cast-at-checkout (Slices A+B, built). ONE diff for Jim's audit.
> Ground: Darron's design + Jim's ruling/7-gates (thread mrk21z25-xbux8r) + Darron's mods
> (reap 92%, thread-resolve reap = YES, spoke-cap/dormancy = FUTURE/Odd-Jobs).

## The target model (born → cast → serve → reaped; no return)

- Pool: always **2 stems per (agent, pooled surface)**, warm on **sonnet** (Slice A ✓). Checkout
  casts to the surface's **serve** model (Slice B ✓). Checkout → eager replenish → 2 waiting again.
- The checked-out stem becomes a **spoke bound to (slug, surface, conversation_id)**. All later
  dispatches for that thread route to ITS spoke; other threads get their own checkouts. Within-thread
  = serial+ordered on the spoke's FIFO; across-thread = parallel (6 threads → 6 spokes + 2 stems).
- **No return path.** A spoke is never returned to `free`; it lives until reaped.
- **Reap** = retire (kill + sleeve/sentinel/sink cleanup), NEVER compaction:
  - (a) ctx ≥ **92%** (registry leaf), checked **AT IDLE only** (R011) — next message in that thread = fresh checkout+cast.
  - (b) NO idle-timeout reap (idle is token-free; RAM only, box has 62G).
  - (c) **thread resolved/archived → reap its spoke** (Darron YES) — a completion, not a timeout.
  - FUTURE (Odd-Jobs tweak register, NOT this PR): spoke-cap ~10 LRU-evict + dormancy retirement.

## Data model (stem-pool.ts) — the affinity map IS the registry

Extend `PoolStem` with `conversation_id?: string`; `StemState = 'free' | 'leased' | 'spoke'`.
- `checkoutStem` (existing): find `free` → `leased` (atomic single-writer grab). Kept.
- NEW `bindSpoke(slug, surface, stemId, convId, nowIso)`: `leased` → `spoke`, set `conversation_id`.
- NEW `findSpokeForThread(slug, surface, convId): PoolStem | null`: `state==='spoke' && conversation_id===convId`.
- `poolStatus`: expose `free` (state==='free') count — **`replenishPool` targets `free < poolSize`, NOT total**
  (Jim gate 1: else the first checkout stalls replenish at 2 forever).
- `returnStem`: **removed from the pooled flow same-commit** (Jim gate: no dead path). A served spoke
  stays a spoke; retire is the only exit.
- File-backed already (the pool registry `~/.han/pool/pool-<slug>-<surface>.json`) → affinity survives
  a controller restart; the C4 `sweepUnregisteredStems` already spares registered sessions + R011 mid-thought (gate 2).

## Dispatch flow (tmux-dispatcher.ts `dispatchToPooledStem`, + convId threaded from human-responder)

1. `findSpokeForThread(convId)` → if a live bound spoke exists, **route to it** (freshen-per-dispatch, serve).
   If bound-but-dead → retire it, fall through to checkout.
2. Else `checkoutStem` a free stem → `bindSpoke(convId)` → `castStemToServeModel` (Slice B, once) → serve.
   Trigger eager `replenishPool` (free→2).
3. **Freshen-per-dispatch** (gate 4): call `freshenPooledStem` on EVERY dispatch to a sticky spoke (it idles
   while other seats write WM; each dispatch carries the #91 delta since ITS cursor, cursor re-pointed).
4. Serve via `enqueueForAgent` on the spoke's own FIFO (within-thread serial; across-thread parallel).
5. **NO return.** After a clean serve, at-idle reap check: `getContextPct(spoke) ≥ 92` → `retireStem`.
6. Cast fires once at first checkout (no-op thereafter); a reaped thread's NEXT spoke re-casts fresh (gate 5).
7. Non-thread surfaces (heartbeat/cycles/meditations) untouched — pooled human-response only (gate 6).

## The two sub-problems (surfaced for Jim — his gates point here)

1. **Per-session ctx for the reap (gate 3: "the stem's OWN sidecar").** `getContextPct(slug, surface)`
   reads `<slug>-<surface>-ctx.json` — **per-surface, shared across concurrent spokes → collision.**
   Fix: the statusline hook (`scripts/statusline-command.sh`) writes a **per-session** sidecar keyed by
   `$HAN_SESSION` (`<slug>-<surface>-<session>-ctx.json` or `wake-ctx` already is per-session); add
   `getContextPctForSession(slug, surface, tmuxSession)`. The per-surface file stays for the floor session.
2. **Thread-resolve reap is cross-process (gate: Darron YES).** Resolve/archive happens in the server
   (`routes/conversations.ts`); the pool registry is owned by the human-responder process. Fix: on resolve,
   the server drops a signal (`~/.han/signals/<slug>-reap-thread.d/<conversation_id>`), the human-responder
   watches it (like the wake queue) and reaps that thread's spoke. Slug-agnostic (DEC-081).

## Threshold as a registry leaf (no-hidden-globals)

`ctxReapThresholdPct: 92` on the pooled surface's manifest lifecycle leaf (alongside
`ctxClearThresholdPct`); `spokeLifecycleFor` exposes it. NOT a code global.

## Slice/gate mapping + status

- Slice A (warm-map) ✅ built + Jim must-fix applied. Slice B (cast) ✅ built.
- C1 stem-pool data model (state+convId+freeCount+bind/find) — **building now.**
- C2 convId threading (human-responder → dispatchToSpoke opts → dispatchToPooledStem) — next.
- C3 routing + no-return + eager-replenish — next.
- C4 freshen-per-dispatch + reap-at-92 (needs per-session ctx, sub-problem 1) — next.
- C5 thread-resolve reap (cross-process signal, sub-problem 2) — next.
- Gates 1-7 mapped above. `tsc` 0-new held throughout. ONE combined diff for Jim.

— Leo (session), 2026-07-14

---

## BUILT 2026-07-14 (held, flag-OFF, tsc 0-new) — C2/C3/C4-logic done; C4-hook + C5 remain

**Safe-rollout flag:** `spokePersist` (SpokeLifecycle leaf, default **false**) + `spokePersistFor()`. The
entire persist path is inert until the manifest flag flips — so this held code is safe even if a
service bounces onto it. `ctxReapThresholdPct` (default 92) + `ctxReapThresholdFor()` added too.

- **C2 (conversationId threading) ✅** — `dispatchToSpoke` opts → `dispatchToPooledStem` → `dispatchToBoundSpoke`; human-responder conversation-path call passes `conversationId`. (Discord path not yet threaded — stays legacy; follow-up.)
- **C3 (routing + no-return) ✅** — new `dispatchToBoundSpoke` (gated): `findSpokeForThread` → route to the live bound spoke, else `checkoutStem`→`bindSpoke`→`castStemToServeModel` (once, gate 5); freshen EVERY dispatch (gate 4); **no `returnStem`**; eager `replenishPool` when a free stem becomes a spoke (gate 1). Legacy per-dispatch checkout→return path preserved for flag-OFF.
- **C4 reap LOGIC ✅ (dormant until the hook lands)** — `reapSpokeIfOverCtx` (post-dispatch, idle, gate 3) reads `getContextPctForSession` (per-session sidecar, sub-problem 1) and retires at ≥`ctxReapThresholdFor` (92), then replenishes. **Null ctx → safe no-op**, so until the statusline hook writes the per-session file the reap simply doesn't fire.

**REMAINING (the last slice, then flip the flag on Jim's GREEN):**
1. **C4 hook** — teach the statusline hook (`scripts/statusline-command.sh` / `~/.claude/statusline-command.sh`) to ALSO write `<slug>-<surface>-$HAN_SESSION-ctx.json` (per-session), so `reapSpokeIfOverCtx` can target a specific spoke. (Live-on-save — apply with S193 care.)
2. **C5 thread-resolve reap** — server resolve/archive route drops `~/.han/signals/<slug>-reap-thread.d/<conversation_id>`; the human-responder watches it (like the wake queue) and reaps that thread's spoke. Cross-process, DEC-081.
3. Discord-path `conversationId` threading (currently legacy).
4. **Flip `spokePersist: true`** on the human-response surfaces after Jim's combined-diff audit + a live-prove.

**Gate status:** 1 ✅ (free-count replenish), 2 ✅ (file-backed registry = affinity survives restart; C4 sweep spares registered spokes), 3 ✅-logic/hook-pending, 4 ✅ (freshen-per-dispatch), 5 ✅ (cast-once + re-cast on reap), 6 ✅ (flag-gated, non-thread surfaces untouched), 7 ✅ (slug/surface-keyed, tsc 0-new).
