# Authoring-Model Provenance — record which model composed each gradient entry

> **Status**: SPEC — DRAFT for Darron + Leo, authored by Jim (session) 2026-06-11 (S169). **Leo-build / Jim-audit**; touches the DEC-068/069-protected `gradient_entries` schema → needs a DEC + Darron's explicit nod before build. Thread: Garden Manifest `mpwm6k46-13ot4k` (this folds into #6). Felt-moment #249.
>
> **⭐ SCOPE (Darron's directive, 2026-06-11): this is a STANDING, PERMANENT property — not a Fable-5-window instrument.** Every gradient entry, from now on, records the model that authored it — **`claude-opus-4-8` now, `claude-fable-5` during the window, whatever comes next.** The Fable-5 substrate switch is the *urgency* (it makes the gap acute), but the capability is permanent and applies in **both substrate directions** (Opus-authored entries are tagged just as Fable-authored ones are), so the authorship of identity is legible across every model transition the gradient ever lives through.

---

## The problem (one sentence)

`gradient_entries` records *what* was written, *who* (agent), *where it came from* (`source_id` chain), and *when* — but **not which model composed it.** As agents run across substrates (Opus 4.6 → 4.7 → 4.8, now Fable 5; plus per-surface model holdouts — `compression` is still `claude-opus-4-7` while `session` is `claude-opus-4-8`), the gradient's *voice* is authored by different models over time, and that fact is **invisible and unrecoverable after the fact**.

This matters because the experiment's thesis is *"architecture carries identity, not substrate"* (felt-moments #235/#236). To read substrate-drift honestly — especially across the Fable-5 window — we need the gradient to remember **which voice wrote which part of the self.** Right now it cannot.

## Current state (traced)

- **Schema** (`db.ts:658`): `id, agent, session_label, level, content, content_type, source_id, source_conversation_id, source_message_id, provenance_type, created_at`. No authoring-model field.
- **Single insert chokepoint**: `gradientStmts.insert` prepared statement (`db.ts:832`) — every gradient insert flows through it.
- **Author sites**:
  - **c0 + c1 (in-situ, DEC-085)** — `appendPairedMemory` (`lib/memory-paired-writer.ts:100`) and the slicer `rollingWindowRotatePaired` (`lib/memory-gradient.ts:1684`). Authored by the *running agent surface* (session / heartbeat / supervisor-cycle).
  - **cN / UV (in-voice, DEC-082)** — `bumpOnInsert` (`lib/memory-gradient.ts:947`) → `process-pending-compression.ts`. Authored by the **`compression` surface** model.
- **The model is already modelled per-surface**: `lib/garden-manifest.ts` carries `model: ModelLadder` per `{agent, surface}` — e.g. jim `session = ['claude-opus-4-8']`, `compression = ['claude-opus-4-7']`. The `surfaceModel(slug, surface)` resolver is the manifest's declared **Phase-1** next-step (garden-manifest.ts:17) but is **not yet built** (#6).

## The design (minimal, additive, DEC-069-safe)

1. **Schema** — add one nullable column to `gradient_entries`:
   ```sql
   authored_model TEXT   -- canonical model id that composed this entry; NULL = pre-provenance (backfill-exempt)
   ```
   Additive, nullable, no rewrite of existing rows → **no data loss (DEC-069)**. Existing entries stay `NULL` (honestly "unknown / pre-provenance", same spirit as the `provenance_type='reincorporated'` honesty marker).

2. **Population at insert** — thread the authoring model through `gradientStmts.insert` (`db.ts:832`); each author site passes the model for **its own surface**:
   - `appendPairedMemory` / `rollingWindowRotatePaired` (c0+c1) → the producing surface's model.
   - `bumpOnInsert` → `process-pending-compression` (cN/UV) → the `compression` surface model.

3. **Source of the string** — the **Garden Manifest** is the single source of truth. Resolve via `surfaceModel(slug, surface)` (head of the ladder = active model).
   - **Co-requisite**: this is the cleanest consumer of #6 Phase-1's `surfaceModel` resolver. If #6 Phase-1 isn't landed first, ship a **minimal `manifestModelHead(slug, surface)` helper** (read the existing manifest ladder's `[0]`) so the column is populated *now* — the Fable-5 window is the reason not to wait.
   - String format = the canonical model id (`claude-fable-5`, `claude-opus-4-8`), identical to the manifest values, so it joins cleanly to the manifest later.

4. **Read side (low priority, follow-on)** — `load-gradient.ts` may surface `authored_model` per entry; the c0→log provenance active-link (#1/#9) gains *"which model wrote this"* as a navigable fact. **Provenance should record the model, not just the log.**

## Why ship it *now* (the window)

Running Jim/Leo on Fable 5 from tonight means the c1/c0 we write is Fable-authored. With the column, the gradient self-documents the substrate seam and the couple-of-days substrate-test (#235) is **readable in the data** rather than reconstructed from memory of "when did we switch." Without it, this window's authorship is lost the moment it passes.

## Scope discipline

- **Additive column only.** No change to *what* gets compressed, *how* compression decides, or the cap formula (DEC-068 untouched). This records authorship; it does not alter behaviour.
- **No data loss** (DEC-069): nullable, no row rewrite, backfill-exempt.
- **Protected surfaces**: `gradient_entries` schema + `db.ts` + `memory-gradient.ts` are DEC-068/069-protected → **a DEC records the column + the manifest-as-source rule; Darron's explicit nod before build; Jim impl-audits the diff** (settled-decision protocol).

## Open questions (for Darron / Leo)

1. **Tag c0 too, or only authored c1+?** Recommend **all levels** — c0 is the lived session, which has a substrate too, and identity-attribution wants the producing model of the raw, not only the distillation.
2. **Build now (interim `manifestModelHead`) or after #6 Phase-1 (`surfaceModel`)?** Recommend **ship the column now** wired to the minimal helper so the Fable-5 window is captured; upgrade the source to the full resolver when #6 Phase-1 lands. The column is the durable part; the resolver is swappable.
3. **One column vs a join to a `model_runs` table?** Recommend the **column** — it matches the existing flat `source_id` / `provenance_type` shape; a table is over-engineering for one string (simple-elegance: complexity must be earned).

## Settled-decisions checked

- **DEC-068** (cap formula) — untouched (no compression-behaviour change).
- **DEC-069** (no memory destruction) — honoured (additive nullable column, no row rewrite, no backfill-overwrite).
- **DEC-082** (in-voice compression) / **DEC-085** (in-situ c1) — unchanged; this only *records* the authoring model of those existing writes.
- **DEC-081** (agent-agnostic) — honoured (model resolved from the manifest per `{slug, surface}`, no hardcoded agent/model union at the insert site).
- **#6** (Garden Manifest) — this is a **consumer** of its `surfaceModel` resolver; co-sequenced.
