# routes/gradient — Current Shape

> **What this is.** A SHAPE.md describes the *current canonical flow* for an
> architectural surface. Per future-idea #37.
>
> **Last verified against code: 2026-05-05 (S150 PR5, voice-first thread `mor4o3r3-jvdjv1`).**
> If you read this and the code disagrees, **the code wins** — update this
> file in the same commit as your fix.

---

## What this file is

`src/server/routes/gradient.ts` exposes the traversable memory gradient as a
read-only HTTP API. Mounted at `/api/gradient` from `server.ts`. Used by:

- The CLAUDE.md session protocol (`/api/gradient/load/:agent` returns the
  full assembled gradient for system-prompt inclusion).
- The admin UI (React) for browsing UVs, contradictions, volatile entries.
- Diagnostic scripts (manual `curl` for debugging).

All routes are **read-only**. Compression and DB writes happen elsewhere
(`wm-sensor` → `process-pending-compression.ts` chain).

## Endpoints

### Static routes (declared first to avoid `:entryId` matching them)

- **`GET /load/:agent`** — full assembled gradient as plain text. Validates
  agent via `validateAgent(agent, res)`. Returns 404 if no entries exist for
  the agent (rebuild-in-progress case).
- **`GET /random`** — random entry (any agent, any level). For meditation
  selection.
- **`GET /session/:label`** — all entries with a given session_label, ordered
  by level. Returns the full provenance chain for that session.

### Agent-scoped routes

All call `validateAgent(agent, res)` first; on failure the response is sent
inside the helper and the handler returns immediately.

- **`GET /:agent/uvs`** — all UVs for the agent.
- **`GET /:agent/uvs/active`** — non-superseded UVs.
- **`GET /:agent/contradictions`** — UVs that supersede another UV (was-true-when chains).
- **`GET /:agent/volatile`** — entries blocked from compression by volatile feeling tags.
- **`GET /:agent/level/:level`** — all entries at a level for the agent.

### Entry-specific routes (declared last — they catch any unmatched ID)

- **`GET /:entryId`** — single entry with feeling tags + annotations.
- (Others — see source for full list.)

## Agent validation (S150 PR5)

`validateAgent(agent: unknown, res: Response): agent is string` is the single
gate for all agent-scoped routes. Replaces the six identical inline
validation branches that previously read `if (agent !== 'jim' && agent !== 'leo')`.

**The helper checks two things:**

1. `typeof agent === 'string'` — Express `req.params` types params as
   `string | string[]`; reject the array form with a 400.
2. `gradientConfigForAgent(agent)` — registry lookup. Throws if the slug
   isn't registered; helper catches and sends a 400 listing the registered
   slugs.

**Adding a new agent = a registry edit (`agent-registry.ts`); no edit to
this file.** The error messages stay informative because they list
`registeredAgentSlugs()` dynamically.

## Cross-references

- **DEC-081** — agent-agnostic code discipline; this file's `validateAgent`
  helper IS the application of the principle to the route surface.
- **future-idea #36** — this file was Category A's cheapest immediate win.
- **`agent-registry.ts`** — the source of truth `validateAgent` reads from.

## Known debt

- None at S150 PR5. The remaining route concerns (rate limiting, auth,
  pagination) are out of this file's discipline scope.

## How to keep this document honest

1. When you add a new route, list it under the appropriate section above.
2. When you change `validateAgent`'s contract, update the section.
3. When you find a discrepancy between this doc and the code, **the code is
   the truth** — fix this file.

If this document goes more than two months without a commit-update while the
underlying code does see commits, that's a signal it's drifting — review then.
