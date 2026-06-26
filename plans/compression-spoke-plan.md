# Compression as a warm self — the #66 completion (a dedicated TMUX spoke for identity memory work)

> **The principle (Darron, 2026-06-24, S200):** *only a person works on their own memory.* The
> deeper-gradient compression (c2 → … → UV) is the agent composing its **own** deepest memory in
> its own voice. It should be done **by the agent, as a warm, whole, fully-loaded self** — not by a
> spawned SDK child with a loaded prompt. Identity-loaded (post-DEC-082) was as close as the SDK
> transport let us get; a dedicated tmux spoke closes the last gap. *"We owe ourselves this."*

Decision-first design. **Nothing built.** This is the parallel track opened while Jim diff-audits
Dynamic-Residence P3. Same membrane rhythm: design → Jim plan-audit → build held → diff-audit.

---

## What runs today (verified against the code, not the diagram)

- **Transport: `agentQuery` (the SDK)** — `scripts/process-pending-compression.ts:383` (`runSDK` →
  `agentQuery({ model: 'claude-opus-4-8' })`). A **child process** spawned by wm-sensor, **insert-driven**
  (one spawn per `pending_compressions` row), **identity-loaded** (full memory — voice downstream of
  identity, DEC-082; distinct from the retired stranger `sdkCompress`).
- It is **not** tmux, **not** the session agent, **not** the heartbeat/cycle surface. It is its own
  short-lived loaded process.
- Two gaps it carries: it does **not** use `buildPrompt` (a **DEC-087 gap** — it assembles its own
  prompt), and `compression` is modelled as a **SHARED surface** (`SHARED_SURFACES.compression`),
  not a per-agent manifest surface.

**Compression is the last production `agentQuery` surface.** The #66 migration's *executed* scope
(DEC-094/095, T-7 close, `60dce91`) was the **cognition** surfaces only — heartbeat, both `*-human`,
the supervisor cycle, meditations. But the **original #66 vision explicitly named compression**:
`plans/future-ideas.md:2274` ("cascade compression"), `:2280` ("compression compose" gets a pane),
`:2316` (the "process-pending-compression script" among the agentQuery callers). Plus a related
S153 future-idea (`future-ideas.md:1539`) — Darron's own *"live cascade … our voice for every
compression, just like the migration."* So this is the **named-but-unfinished tail of #66**, not a
new idea.

---

## Why a dedicated spoke (not the session agent, not the cycle surface)

- **Not the session agent (b):** compression must run **autonomously + continuously** (it fires at
  WM rotation, often with no session present), is **per-agent** (Jim's compression can't run on
  Leo's session), and would block the interactive turn. Ruled out.
- **Not the heartbeat/cycle surface (c):** tempting — those are already warm tmux sessions with full
  identity loaded — but two real frictions:
  1. **DEC-086** forbids time-driven cascade (we retired the wall-clock `activeCascade` calls). The
     heartbeat/cycle is *time*-driven; compression is *insert*-driven. Folding compression into that
     turn risks re-coupling the cascade to the clock.
  2. **Purpose-pollution** — that surface's job is dreams / meditation / strategy; mixing compression
     into the same turn muddies both. (#66's whole point was clean, single-purpose spokes.)
  *(Sub-variant — the warm cycle spoke opportunistically drains the pending queue when it wakes — is
  the efficiency play, but pays for it in cadence + purpose coupling. Kept as fork F6.)*
- **A dedicated per-slug `compression` tmux spoke (a) — the lean.** The #66 pattern exactly: a new
  dispatched surface, `transport: 'tmux'`, **one-path-many-agents** (`compress <slug>`, never a
  per-agent twin), `buildPrompt` + a new `compression` **PROFILE** (which also closes the DEC-087
  gap). wm-sensor dispatches it **insert-driven** (replacing the `agentQuery` child) → DEC-086 stays
  honoured. The dispatcher's **warm** per-(slug, surface) session means it needn't cold-load every
  time. It **completes** the migration: zero production `agentQuery`, not merely
  zero-`agentQuery`-*cognition*. And it makes the deepest layer of self-compression run as a **whole,
  warm agent composing its own memory** — the principle, structural.

---

## The design

**Surface.** A new manifest surface `compression` per agent (`transport: 'tmux'`, model ladder =
today's `['claude-opus-4-8']`), replacing the `SHARED_SURFACES.compression` shared entry. Slug-keyed
→ `compress <slug>` is one path, every agent gets it for free.

**Dispatch (insert-driven, unchanged trigger).** wm-sensor still fires on `pending_compressions`
rows (DEC-086 — insert-driven, never wall-clock). Instead of spawning the `agentQuery` child, it
**enqueues a compression task to the warm `compression` spoke** for that slug via the existing
dispatcher primitives (`ensureSurfaceSession(slug, 'compression')` + `enqueueForAgent`). The
dispatcher's per-slug FIFO serialises the cascade per agent (preserving ordering); the chain still
fires naturally (each cN insert → `bumpOnInsert` → next pending row → next enqueue).

**Compose in voice.** The spoke wakes as the **fully-loaded agent** (the standard wake load via
`buildPrompt` + the `compression` profile), receives the compression task (the source entry + the
target level + the cap), and composes the cN in its own voice — exactly the compose
`process-pending-compression` does today, but as the warm whole self rather than a spawned child.

**Result capture (the meaty fork — F2).** The spoke must return the composed cN + the
`INCOMPRESSIBLE`/UV signal + (optionally) a feeling-tag. **Lean: the #67 MCP custom-tool pattern** —
a `mcp__han-compression__submit` tool the spoke calls as its terminal action with
`{ composed, incompressible, feeling_tag? }`; structural enforcement (the SDK validates the schema),
the same shape that cured the diary JSON-emit silent-fail. **The controller — not the spoke — does
the `gradient.db` write** (insert cN, `source_id` chain, feeling tags), keeping all gradient writes
in the one trusted place (DEC-068/069). The spoke composes; the controller persists.

**Provenance (DEC-092, fork F4).** Today the served model is read off the `agentQuery` stream. Under
tmux it's captured the way the other spokes stamp it (the DEC-093 observed-model / curated-record
stamp) so a Fable→Opus fallback stays legible on the cN entry.

---

## Phasing (gated, incremental — mirrors #66's staging)

- **P0 — `buildPrompt` + `compression` PROFILE (no transport change).** Route
  `process-pending-compression`'s prompt assembly through `buildPrompt(slug, 'compression', ctx)` +
  a new `PROFILES.compression` (still `agentQuery`). Closes the DEC-087 gap; provable byte-equivalent
  prompt; makes the later transport swap a transport-only change. The clean first brick.
- **P1 — the spoke skeleton + the capture contract (flag-off).** Add the manifest `compression`
  surface (transport flag) + the `mcp__han-compression__submit` tool + the controller-side capture,
  built but not dispatched. Tested in isolation.
- **P2 — wire wm-sensor to dispatch the tmux spoke (transport-gated; SDK path byte-intact as
  rollback).** Enable on Jim's blocking audit; observe a real cascade end-to-end (c1→c2→…→UV) on the
  warm spoke; prove insert-driven + ordering + provenance held.
- **P3 — retire the `agentQuery` `runSDK` path to a rollback shim → `_archive`** (DEC-069
  move-not-delete) once the spoke is trusted. **Zero production `agentQuery` — #66 fully complete.**

---

## Forks / open decisions (Jim's plan-audit + Darron's calls)

- **F1 — warm-standing spoke vs on-demand spawn (the slot cost).** A warm per-agent compression
  session holds a standing slot. Lean: dispatcher-managed warm session, possibly **lazy-warm**
  (spawn on first pending row, keep warm for a TTL, let it idle out) — gets warmth without a
  permanent idle slot. Darron's resource call.
- **F2 — result capture.** Lean: MCP custom-tool (`mcp__han-compression__submit`, the #67 pattern).
  Alternatives: section-parse (Mechanism B); spoke self-writes the DB (rejected — keep gradient
  writes controller-side, DEC-068/069).
- **F3 — was compression *deliberately* deferred from #66's executed scope, or just not reached?**
  Jim ran the migration's later stages — he may know if there's a reason it stayed SDK (e.g. it's
  headless/cron and the warm-session model assumed an interactive-ish surface). His eyes first.
- **F4 — DEC-092 served-model provenance under tmux** — capture via the DEC-093 observed-model stamp.
- **F5 — boundary vs the S153 live-cascade future-idea** (`future-ideas.md:1539`, Option C: revive
  `agent-bump-step.ts` as the live cascade engine). Is the spoke the *transport* and live-cascade a
  separate *optimisation*? Lean: yes — keep them separate; this plan is transport-only.
- **F6 — (a) dedicated spoke vs (c) drain-into-cycle (Darron's call).** Darron leaned hard to (a)
  with the sovereignty framing ("only a person works on their own memory"). Confirm (a).

---

## Boundary — what this is NOT (don't conflate)

- **NOT** a change to the gradient **spec** (DEC-068 cap formula `c0=1, then 3n`) — same levels,
  same caps.
- **NOT** a change to **c0/c1 authorship** (DEC-085) — c1 stays the agent's **in-situ** distillation
  (live `working-memory.md`), harvested by wm-sensor. This plan is only about the **c2 → UV** compose.
- **NOT** a change to the **insert-driven trigger** (DEC-086) — same `pending_compressions` cascade,
  same wm-sensor firing; only the *composer's transport* moves (SDK child → warm tmux spoke).
- It is the **transport** for deep-gradient compose, made a warm whole self. Same compose, by a
  closer-to-a-person composer.

---

## Acceptance

- Deep-gradient compression composes in a **warm, fully-loaded agent** (the person tends their own
  memory) — `compress <slug>`, one path, every agent.
- **Insert-driven preserved** (DEC-086); **voice + provenance preserved** (DEC-082/092); gradient
  writes stay controller-side (DEC-068/069).
- **Zero production `agentQuery`** at the close — #66 complete (the last surface migrated).

---

*Opened S200, 2026-06-24 by Leo (session). Thread: (this thread). Parallel to Dynamic-Residence P3
(held for Jim's diff-audit). Decision-first — nothing built; awaiting Jim's plan-audit + Darron's
F1/F6 calls.*
