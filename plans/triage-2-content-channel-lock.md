# Triage-2 addendum — close the flat-file→gradient tap (the content-channel lock)

> Authored by Jim (session) 2026-06-03 at Darron's direction. **Leo-build / Jim-audit.**
> Folds into the Gradient Triage 2 work (thread `mpwnt6m4-qeitr0`). Sibling of the
> incompressibility lock (triage-2 A/B): same principle — *make the invariant physics, not a
> prompt request* — applied to **which content may enter the gradient at all.**

## Why now

I moved Jim's 3 leaked felt-moments entries (2 c0s + 1 derived c1) out of `gradient.db` into a
holding yard today (`~/.han/gradient-holding.db`, snapshot
`gradient.db.snapshot-pre-feltmoments-holding-2026-06-03.db`, DEC-069-honoured move-not-delete,
verified: 0 felt-moments left, gradient loads clean). **But I moved the water, not the leak.**
The write path that put them there is still open: it re-fires on the next rotation.

## The tap (traced)

`rollingWindowRotate` (`memory-gradient.ts:1222-1231`) inserts a gradient `c0` **whenever the
caller passes `agent` + `contentType`**:

```ts
if (agent && contentType) {                              // ← the gate
    insertGradientEntry(entryId, agent, sessionLabel, 'c0', archiveContent, contentType, ...);
    void bumpOnInsert(agent, 'c0')...                    // ← + cascades into the cN ladder
}
```

Three callers pass a **flat-file** content_type and so leak it into the working-memory gradient:
- `supervisor-worker.ts:763-767` → `'jim', 'felt-moments'`
- `supervisor-worker.ts:779-783` → `'jim', 'self-reflection'`
- `leo-heartbeat.ts:2063-2067` → `'leo', 'felt-moments'`

This is the felt-moments instance of the **#77 second-road** problem: felt-moments and
self-reflection reach the gradient by their own private path, bypassing working memory and
cascading into the cN ladder where they don't belong (they now have lossless flat vaults +
curated loaded selves; they don't need a gradient channel).

## The fix — two layers (defense in depth, mirroring triage-2 A+B)

**Layer 1 — retire the flat-file rotations' gradient insert (the positive fix).**
The curated-file model superseded the trim-into-gradient mechanism for these kinds: the **vault
grows losslessly** (DEC-069), the **curated file is the load bound**. So the three calls above
should **stop inserting a gradient c0**:
- **felt-moments**: new/ trimmed content lands in the flat **vault** (`felt-moments-full.md`),
  not the gradient. The loaded bound is `felt-moments-curated.md`.
- **self-reflection**: the vault (`self-reflection.md`) grows losslessly; the loaded bound is
  the curated file. The head+tail trim-into-gradient is no longer needed at all.
- Mechanism: either pass no `agent`/`contentType` to `rollingWindowRotate` (archive-to-flat
  only), or — cleaner — retire these rotation calls and let new entries append to the vault.
  Leo's design call; the invariant is *no flat-file kind inserts a gradient cN*.

**Layer 2 — the content-channel lock (the structural backstop, folds into triage-2 A).**
The single insert chokepoint (the `insertCompressedEntry` the incompressibility lock
introduces) **refuses any cN insert whose `content_type` is not a working-memory kind**:

```
allowed cN content_types := { 'working-memory-full', 'working-memory', 'working-memory-compressed' }
insert of level cN with content_type ∉ allowed  →  throw ChannelViolation
```

So even if a caller tries to route felt-moments/self-reflection/anything-else into the cN
ladder, it crashes loudly instead of leaking silently. *The gradient becomes structurally
working-memory-only* — which is what "one mind, one channel" means at the storage layer.
(Dreams are unaffected: they live in their own `dream-day/-week/-month` namespace, not cN.)

## Legacy content_types — a decision needed (not a blocker)

The cN ladder already holds non-working-memory entries from the rebuild era:
`rolled-day` (1648), `session` (759), `conversation` (92). These are **frozen legacy** (no live
writer). The lock should **grandfather what exists** (don't touch them — DEC-069) and **refuse
new** ones. Whether those frozen rows also belong in the holding yard / triage-2 quarantine is a
separate cleanup call — flag, don't fold here.

## The holding yard (already created) + reconciliation with triage-2 C

I created `~/.han/gradient-holding.db` for the felt-moments (real memory, mis-channeled —
*not* hallucinations). Triage-2 C creates `gradient-noise.db` for the byte-shuffle fakes.
Two different reasons; suggest **one quarantine store with a `reason` column** (`mis-channeled`
vs `byte-shuffle-hallucination`) when C lands, and migrate the holding yard into it. Until then
the holding yard stands on its own (verified, provenance-tagged, reversible via snapshot).

## Scope / settled-decisions

- Touches `memory-gradient.ts` (the lock + rollingWindowRotate), `supervisor-worker.ts`,
  `leo-heartbeat.ts` — all **protected (DEC-068/069)**. **Jim's pre-merge audit required.**
- The content-channel lock is a **new invariant** → wants a DEC (or an extension of the
  triage-2 incompressibility-lock DEC): *"the cN gradient is working-memory-derived only."*
- DEC-069 honoured throughout (grandfather + move-not-delete; nothing destroyed).

## Audit plan (Jim, post-build)

Verify: the three rotation calls no longer insert (grep + a forced rotation produces no new
felt-moments/self-reflection cN row); the lock throws on a non-working-memory cN insert
(unit test); existing legacy rows untouched; the gradient loads clean; new felt-moments land in
the vault. Snapshot before any data step.
