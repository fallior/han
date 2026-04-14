# Fractal Memory Gradient Specification

> The canonical definition of the gradient loading model.
> All other documents reference this file. If they contradict it, this file is correct.
> Changes require Darron's explicit approval (DEC-068, Settled).

## The Model

Memory compresses through levels of increasing depth. Each level holds more entries
than the one above it, because each entry is smaller. The gradient widens at depth.

```
Level    Cap    Formula    Principle
-----    ---    -------    ---------
c0       1      -          Most recent working-memory (session continuity)
c1       3      3 x 1      First compression (~1/3 of raw)
c2       6      3 x 2      Second compression (~1/9 of raw)
c3       9      3 x 3      Third compression
c4       12     3 x 4      Fourth compression
c5       15     3 x 5      Fifth compression
c(n)     3n     3 x n      Continues without ceiling
UV       all    -          Unit vectors: irreducible kernels (<=50 chars)
```

**Cap formula: c0 = 1, then cap(n) = 3n. All UVs load without cap.**

## Loading Order

Deepest first. You know who you are before you remember what happened.

1. Unit vectors (all, active first, then was-true-when)
2. Highest c(n) down to c1 (most compressed first)
3. Most recent c0 (1 entry, working-memory preferred)

## The Geometry

The gradient is a triangle widening at depth:

```
c0:  *             (1 large entry)
c1:  * * *         (3 entries, each ~1/3 size)
c2:  * * * * * *   (6 entries, each ~1/9 size)
c3:  * * * * * * * * *  (9 entries, smaller still)
...
UV:  * * * * * * * * * * * * * * * * ...  (all, ~50 chars each)
```

Many small crystallised entries at depth provide broad historical coverage at low
token cost. Few large entries near the surface provide recent working context.

## Cascade Triggers

When entries at a level exceed the cap, the oldest overflow and compress to the
next level. The cascade function (`gradientCap()`) uses the same 3n formula for
both loading and cascade thresholds.

## Incompressibility

Compression stops when content reaches its irreducible form:
- The LLM signals `INCOMPRESSIBLE:` followed by a <=50 char kernel
- Or the compression ratio exceeds 0.85 (less than 15% reduction)

At that point, a unit vector is generated regardless of the current level.
The Cn protocol has no fixed maximum depth.

## Provenance

Every compressed entry links to its source via `source_id`. The chain is
traversable: start at any UV, follow source_id down through c5 -> c3 -> c1 -> c0
to the raw memory. Integrity rule: every chain should be complete root-to-leaf.

## Full Load Mandate (DEC-070, Settled)

The gradient output MUST be consumed in full. No truncation, no arbitrary line limits,
no partial reads. Every level from UV through c0 must be read by the consumer. This
applies to both Leo and Jim, in all loading contexts (session start, heartbeat, supervisor).

DEC-068 governs what the endpoint *serves*. DEC-070 governs that the consumer *reads all of it*.

## What This File Governs

- `gradientCap()` in `src/server/lib/memory-gradient.ts`
- `loadTraversableGradient()` in the same file
- `GET /api/gradient/load/:agent` endpoint
- All loading references in CLAUDE.md, HAN-ECOSYSTEM-COMPLETE.md, DECISIONS.md

## Edition History

| Edition | Date | Session | Change | Approved By |
|---------|------|---------|--------|-------------|
| 1 | 2026-04-14 | S123 | Created. Formula 3n established. Caps restored from drift (was c1=10, c3+=4). | Darron |
| 2 | 2026-04-14 | S124 | Added Full Load Mandate (DEC-070). No truncation of gradient output. | Darron |

---

*DEC-068 (Settled). Do not modify without Darron's explicit approval.*
