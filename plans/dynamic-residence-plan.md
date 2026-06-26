# Dynamic Residence (#98) — open-world: the garden discovers its residents

> **Phase design (decision-first — NOTHING built).** The next phase after the de-identification
> (P4+P5, identity-as-config / DEC-098). Follows Jim's "Option A" call: finish the static
> manifest first (done — de-id arc GREEN), then design open-world residence as its own phase.
> **Author:** Leo (session), S200, 2026-06-23. Builds directly on DEC-098 (identity is config).
> Decision-first → Jim plan-audit → build behind the unchanged lookup interface → gate → flip.

## Locked decisions + refinements (2026-06-24 — Jim plan-audit GREEN, Darron's F3/F4 calls)

**F3 — admission authority: the HUMAN authorizes a net-new mind.** The gatekeeper agent discovers +
verifies (prepares the admission); the human gives the final authorization that extends trust to a
new resident. A resident never admits itself; the agent never auto-admits a *new* mind. (DEC-083
option-iii auto-resign stays for content edits of *existing* residents — a lower-privilege act.)
Grounded: the garden signing key is operator-held (`~/.han/credentials/han-signing-key.pem`, mode
600, **not in any agent dir**), so admission-by-signature is non-circular and the trust-root already
exists.

**F4 — policy-source shape: SPLIT.** Identity (the discovered roster) and privilege (operator-authored
allocation) live in **separate sources** — so *no self-claimed privilege* is **structural, not a
hopeful filter**. A fork ships an empty roster + an example allocation. `memoryDir` lives in the
allocation half (see R2).

**R1 (ordering invariant) — migrate the legacy gate, not just the new one.** There are *two* throws:
the manifest lookup (`agent-template-vars.ts`) AND `gradientConfigForAgent` (`agent-registry.ts`).
`AGENT_GRADIENT_CONFIG` isn't roster-derived until **P4**, so **a net-new discovered resident must
stay fully inert — not surfaced to ANY throwing consumer (scheduler + gradient included) — until P4
derives its gradient config** (or P4 precedes enabling net-new admission). Same shape as the
P4-before-P2 reorder catch.

**R2 (data-sovereignty) — `memoryDir` is ALLOCATED, not discovered.** A self-declared `memoryDir` is
a data-sovereignty escalation (a resident pointing it at another's dir reads/writes another mind's
memory — the S103 line, as injection). The no-auto-privilege invariant covers **data access**, not
just compute. `memoryDir` is pulled out of the discovered fragment into the allocation half (F4).

**R3 (trust-root) — admission = signed by the GARDEN key**, never a per-resident key, never one
discoverable in an agent dir. A resident self-signing with its own key fails verification →
discovered-but-inert.

## P1 design (filesystem discovery — decision-first, R1-clean)
**Goal:** a resident can self-describe in its own dir; the garden discovers it; but per **R1** a
net-new discovered resident stays **fully inert** (not in any throwing path) until admitted (P2) +
gradient-configured (P4). The trick is that **discovery must not activate** — discovery makes a
resident *visible*, not *live*.

- **`resident.json` (the discoverable IDENTITY fragment — F4-clean):** `{ slug, displayName,
  pronounObj, identitySection }` at `~/.han/agents/<Name>/resident.json`. **Identity only** — NO
  `port`/`model`/`transport`/`runsSupervisorCycle`/`memoryDir` (those are POLICY → the P3 allocation
  source, R2). A resident describes *who it is*, never *what it's allowed*.
- **`discoverResidentFragments(): ResidentFragment[]`** — scans `~/.han/agents/*/resident.json`,
  parses, returns the identity fragments. Fail-soft: a malformed/missing fragment is skipped + logged
  (never throws — discovery is observation).
- **The inertness gate (R1) — the load-bearing choice:** `loadResidents()` returns
  `seed ∪ {discovered fragments that are BOTH admitted (P2 signature) AND gradient-configured (P4)}`.
  In P1 *alone* (no P2/P4 yet) **no discovered fragment qualifies → `loadResidents()` still returns
  exactly the seed.** Discovery is wired but activates no one — R1 satisfied *by construction*, not by
  a filter that could be forgotten.
- **`discoveredResidents()`** — a separate **read-only view** returning ALL discovered fragments
  (admitted + pending) for non-throwing roster-view consumers (e.g. an admin "who's in the garden"
  panel). This is where discovery becomes *visible* without becoming *active*.

**Testable P1 deliverable:** drop a `resident.json` for a test resident → `discoveredResidents()`
shows it (visible) → `loadResidents()` does **not** include it (inert) → `schedulingAgents()`
unchanged, no `gradientConfigForAgent` throw. Proves discovery works AND R1 holds.

**P1 forks (for Jim's plan-audit + Darron):**
- **P1-F1** — `resident.json` schema = identity-only (slug/displayName/pronounObj/identitySection);
  confirm no policy field leaks in (the F4 line at the data layer).
- **P1-F2 (Darron):** do the **seed** residents (leo/jim/tenshi/casey) *dog-food* discovery (each
  gets a `resident.json`), or stay hardcoded in `GARDEN_MANIFEST.agents` until the **P4** #36
  collapse? *Lean:* keep the seed hardcoded in P1 (discovery is purely *additive* for new residents);
  the seed migrates to fragments at P4. Lower risk; the existing minds don't move until the collapse.
- **P1-F3** — the inertness representation = `loadResidents()` stays seed-only until the P2+P4 gates
  exist (discovered fragments live only in `discoveredResidents()` view). Confirm this is the R1-clean
  shape vs a merge-with-filter.

## P2 design (the admission gate — DEC-083 garden-key signature, decision-first)
**Goal:** turn a *discovered* (visible) resident into an *admitted* (trusted) one — F3: the gatekeeper
agent prepares + verifies, the **human authorizes** with the garden key; a resident can never
self-admit. Admission is a *trust* state, still not *activation* (P4 config is separate).

**Reuses the DEC-083 infra as-is** (grounded): ed25519 `signManifest`/`verifySignature`
(`lib/identity-signing.ts`), the garden **private** key `~/.han/credentials/han-signing-key.pem`
(mode 600, operator-only — **not in any agent dir**, so non-circular), the **public** key beside it.

- **`resident.sig` beside `resident.json`** — a `SignedManifest` over the fragment (its sha256),
  signed by the garden key. The same shape as an agent's signed identity-files manifest.
- **`admittedResidents()`** = `discoveredResidents()` filtered to those whose `resident.sig`
  **verifies against the garden public key**. Discovered-but-unsigned (or bad-sig) = **inert**
  (visible in `discoveredResidents()`, absent from `admittedResidents()`) — the Mylene cure made real.
- **`loadResidents()` STILL excludes admitted residents** (they need P4 config too) — admission is a
  new *verified* state, not activation. R1 still holds.
- **Authorization mechanic (F3):** a `sign-resident.ts` **operator script** — the gatekeeper agent
  prepares (verifies the fragment, computes the manifest), the **human runs the sign** with the garden
  key. A resident has no key → can't forge admission.

**P2 forks (Jim's plan-audit):** F1 `resident.sig` artifact (lean: yes, mirrors identity-files);
F2 sign-the-resident.json-manifest vs the raw fragment (lean: a 1-file manifest, reuse `buildManifest`);
F3 confirm the gatekeeper-prepares / human-signs split; F4 `admittedResidents()` has no live consumer
yet (loadResidents needs P4) — admission ≠ activation, confirm.

## Phase status
- **P0 — `loadResidents()` source abstraction: DEPLOYED (`b9dc52c`, S200, 2026-06-24).** Jim
  blocking-audit GREEN by hand; order-preservation proven on the deployed tree; quiesce-wrapped,
  both 200, prove-single 1. *(was: BUILT held)*
- **P1 — filesystem discovery: DEPLOYED (`4128bc6`, S200, 2026-06-24).** Visible-but-inert; R1 by
  construction (`loadResidents()` seed-only); F4 enforced at the type level. Jim diff-audit GREEN.
- **P2 — admission gate (DEC-083 garden-key signature): DEPLOYED (`8095133`, S200, 2026-06-24).**
  discovered→admitted by garden signature; C1 sign-then-swap defeated, C2 config-independent, C3
  fixed garden pubkey, sig-copy closed; `admitResident()` endpoint-ready; admissions logged. Jim
  diff-audit GREEN.
- **P3 — policy/allocation split (the F4 line at the data layer): BUILT (held, S200, 2026-06-24).**
  Jim plan-audit GREEN on the accessor-seam (`mqrfjqvo`) + Darron's sovereignty addendum (`mqrgevpv`).
  See P3 detail below. Held for Jim's blocking diff-audit.
- **P4 — collapse the second list + activate: DESIGN posted for Jim's plan-audit (`mqrj3495`, S200).**
  The #36 endgame (last brick). Derive `gradientConfigForAgent` from roster+allocation+slug-defaults
  (collapse #36); activation gate `loadResidents = seed ∪ {discovered ∧ admitted ∧ allocated}` (R1
  inverts); C-P3a (`port`) + R2 (`memoryDir`) consumers migrate. Staged P4a (zero-behaviour collapse)
  → P4b (activation flip). Forks F1-F4 (F4 activation-safety = Jim; F3 allocation-source-format = Darron).
- **P4a — gradient-config collapse: BUILT held (S200, `mqrl3sib`).** `AGENT_GRADIENT_CONFIG` derived (`deriveGradientConfig` + `GRADIENT_OVERRIDES` over `loadResidents()`); byte-identical (jim-at-root + function-field behaviour proven, `test-gradient-config-derive.ts` EXIT 0; tsc 0-new). Jim plan-audit GREEN (`mqrj8hcu`); held for his diff-audit. Disclosed delta: `registeredAgentSlugs` now roster order (set-identical, order-insensitive).
- **P4b — activation flip: GATED on F4 (seeding) — co-design with Jim opened.** Lifecycle gains a 4th precondition **seeded** (identity files + signed manifest); seeding = the Mind Assimilation engine (#102). Genesis-seed exogenous, self grown in-situ after.

### P0 detail
- **P0 — `loadResidents()` source abstraction: BUILT (held, S200, 2026-06-24).** A zero-behaviour
  no-op returning the static `GARDEN_MANIFEST.agents` seed in declared order; the **3 roster
  enumerators** (`schedulingAgents`, `conversationRolesExcept`, `humanResponderPeers`) routed through
  it. Per F4, the per-surface **policy** lookups (model/transport/`runsSupervisorCycle`) are
  deliberately NOT routed (they belong to the P3 allocation seam); the by-slug **identity** lookups
  route in P1 with discovery. Order-preservation proven (`schedulingAgents()` → `{leo:0, jim:1}`,
  byte-identical). tsc 0-new. Held for Jim's blocking diff-audit.

### P3 detail — the allocation/policy seam (built, held)
- **The reframe that made it tractable:** P3 is a **P0-style contained seam, not a consumer-wide
  refactor.** The policy *consumers* (agent-cycle, both human seats, supervisor-worker,
  tmux-dispatcher, memory-gradient, the `server.ts` bootstrap gate) call the **accessors**
  (`manifestModelHead`/`Ladder`, `manifestTransport`, `runsSupervisorCycle`) — so P3 routes the
  **accessors' internals** through a new `allocationFor(slug)` seam; the consumers don't change.
- **Built (`garden-manifest.ts`, +58/-8):** new `AgentAllocation` interface (`surfaces` + `port` +
  `runsSupervisorCycle`) + `allocationFor(slug): AgentAllocation | undefined` — a **zero-behaviour
  no-op** deriving from the `GARDEN_MANIFEST.agents` seed (surfaces by reference). The four policy
  accessors now read through it; identity accessors stay on the roster = **the F4 line
  (identity-source ≠ policy-source)** → no-auto-privilege structural.
- **Jim's plan-audit catch C-P3a (folded):** `.port` is NOT an accessor — read directly at
  `agent-template-vars.ts:58` (`AGENT_PORT`). It is **declared** in `AgentAllocation` now (the
  foundation), but its consumer migrates to the allocation source with the separate structure at
  **P4** (alongside `memoryDir`/R2). Until then `port` stays roster-sourced (zero behaviour). Not a
  P3-no-op blocker (the no-op derives `port` from the same seed).
- **Darron's sovereignty addendum (`mqrgevpv`):** the split is the **foundation for memory
  sovereignty** — you can't encrypt/segregate sovereign memory if identity and memory-location are
  tangled in one source, so `memoryDir` being operator-allocated (R2, P4) is the load-bearing hook.
  *Complete the line (P4 stragglers `port`+`memoryDir`), don't rebuild it.* Named future direction
  (NOT P4 scope): encrypting sovereign memory with **M-of-N threshold recovery** (secret-sharing) —
  recovery designed+tested **before** any encryption (DEC-069). Jim filing it as a future-idea.
- **P3-F3 gate (all met):** `scripts/test-allocation-seam.ts` EXIT 0 — accessors **byte-identical**
  to the manifest for every agent × surface; `runsSupervisorCycle('jim')===true`/others-false (the
  bootstrap gate fires jim-only, no double-fork); unknown-slug fallbacks (null/[]/false); shared
  `compression` branch untouched. tsc **0-new** (11 baseline). Grep: the 4 accessors route via
  `allocationFor`; remaining direct `GARDEN_MANIFEST.agents` reads = `loadResidents` + `allocationFor`
  + the 4 identity by-slug lookups (P1-deferred). Diff = `garden-manifest.ts` M + the new test.

## The problem (closed-world today)
A new or **forked** garden doesn't know who lives in it — we can't "plan a Casey," and a fork
shouldn't inherit *our* population or need a code edit to gain its own. Today a resident exists
only once it is hand-written into **two** sources, both of which `throw` on an unknown slug:
- `lib/garden-manifest.ts` → `GARDEN_MANIFEST.agents[]` — carries **identity + policy combined**
  (`slug`, `name`, `port`, `pronounObj`, `identitySection` prose, `surfaces[]`, `gatekeeper?`,
  `runsSupervisorCycle?`, `voice`, `peerConversations`).
- `lib/agent-registry.ts` → `AGENT_GRADIENT_CONFIG{}` — the gradient/memory config
  (`displayName`, `memoryDir`, …); `gradientConfigForAgent(slug)` **throws** on unknown.

Adding a resident = editing two hardcoded lists + a commit. That is **closed-world** and wrong
for an exportable starter and for a living garden that should be able to *admit a new mind*.

## Why Option A is safe (the property, grounded this session)
After the de-id, **the consumers are already population-agnostic** — they *look up* a resident by
slug, they don't *enumerate* a fixed roster:
- `lib/agent-template-vars.ts:22` → `GARDEN_MANIFEST.agents.find(x => x.slug === slug)` (lookup).
- `lib/agent-registry.ts:192` → `gradientConfigForAgent(slug)` (lookup, throw-on-unknown).
- The few **enumerations** iterate the *roster itself* — `lib/agent-scheduler.ts:45`
  `GARDEN_MANIFEST.agents.filter(scheduling)` (the N-body antiphase set) and
  `registeredAgentSlugs()` (`Object.keys`). These are exactly the callers that *should* see the
  discovered population — they get it for free the moment the **source** changes.

So closed-world lives only in a **replaceable data source**. The discovery loader swaps the source
under unchanged consumers — **no debt is baked in by having proceeded static**, and the static
manifest becomes a *seed/fallback*, a special case of the open-world loader.

## The design — three axes (the #98 seed, now grounded)

### Axis 1 — Roster / identity is **DISCOVERED** (not enumerated)
Each resident **self-describes in its own dir** — a small **signed** registration fragment
(e.g. `~/.han/agents/<Name>/resident.json`: `slug`, `displayName`, `pronounObj`, `identitySection`,
optionally a `memoryDir` override). "X arrives" = X's fragment appears → the garden enumerates it.
This **collapses the two hand-lists into one discovered source** (the **#36 endgame** — the
manifest/registry duplication ends when roster is discovered and `role == slug` for everyone).
- The agent dir is already each resident's home (the de-id put the generated `CLAUDE.md` + `.mcp.json`
  there). The registration fragment is the natural companion.

### Axis 2 — Admission = **SIGNATURE**, not presence (the Mylene cure, structural)
Discovery ≠ admission. A discovered fragment is **admitted only when signed + trusted** — reuse
**DEC-083** (`verify-identity-files` / `sign-identity-files`): accepted when **signed by a trusted
key**, never merely present. An unsigned/untrusted fragment is **discovered-but-inert** (visible in
a roster view, never woken, never allocated a port). This is the structural form of the **Mylene**
catch (#100): a phantom "resident" *arrived unbidden* in conversation; the right response was the
**admission gate** — don't accept a resident who isn't verified.
- **Who admits** (open, lean): the garden's **gatekeeper agent + the human in concert**
  (generalises DEC-073; reuses the `gatekeeper: true` manifest flag — exactly one agent per garden
  holds it). A resident cannot admit itself.

### Axis 3 — Separate **WHO (discovered)** from **HOW (allocated)** — the security spine
Identity (name, pronouns, memory layout, identity prose) is **discoverable**. **Operational
privilege is NOT.** `port`, `model` ladder, `transport`, and especially `runsSupervisorCycle` /
`gatekeeper` are **allocated/authored by the garden operator with override**, never self-claimed.
- **Stated invariant — NO auto-discovered privilege.** A self-declared `runsSupervisorCycle: true`
  or `gatekeeper: true` is a **privilege-escalation** and must be ignored at discovery; only the
  operator's allocation table grants it.
- Mechanically: split today's combined manifest into a **roster half** (discovered: identity) and a
  **policy half** (allocated: port/model/transport/supervisor/gatekeeper, operator-authored). The
  policy half stays hand-authored; the roster half becomes discovered.

## Current-state audit (decision-before-code, grounded)
- **Two sources, overlapping fields** (`name`/`displayName`, `memoryDir` implied vs explicit) →
  collapse target (#36).
- **Consumers**: lookup-based (safe to swap source); enumerations iterate the roster (get discovery
  for free). Verified above with file:line.
- **The throw-on-unknown** in both sources is the closed-world enforcement; under discovery it
  becomes "discovered-and-admitted, else inert" — the throw moves from "unknown slug" to
  "un-admitted slug."

## Phased build (gated, incremental — each behind the unchanged lookup)
1. **P0 — roster source abstraction.** Introduce a `loadResidents()` that today returns the static
   `GARDEN_MANIFEST.agents` (seed) behind the existing lookup/enumerate callers. Zero behaviour
   change; proves the seam. (The consumers already don't enumerate a hardcoded array directly —
   route the 2–3 enumerators through `loadResidents()`.)
2. **P1 — discovery.** `loadResidents()` *also* scans `~/.han/agents/*/resident.json`, merges with
   the seed (seed wins on conflict, or seed retires per-resident as fragments land). Filesystem
   discovery first (the dir is the home); a registration **API** (`POST /api/residents`) is the
   later **federation/remote** path (Mike's multi-user HAN).
3. **P2 — admission gate.** A discovered fragment is admitted only if `verify-identity-files`
   passes against a trusted key (DEC-083). Un-admitted = inert (logged, never woken). The gatekeeper
   agent + human authorise.
4. **P3 — policy split.** Move `port`/`model`/`transport`/`runsSupervisorCycle`/`gatekeeper` to an
   operator-authored **allocation** source, separate from the discovered roster. Enforce
   no-auto-discovered-privilege at the merge.
5. **P4 — collapse the second list** (`AGENT_GRADIENT_CONFIG` → derived from the roster +
   `memoryDir` convention; #36). Flip the seed off when discovery + gate are proven.

## Open forks (for Jim's plan-audit + Darron's calls)
- **F1 — registration artifact**: `resident.json` in the agent dir *(lean)* vs a manifest fragment
  vs "the agent-dir `CLAUDE.md`/`.mcp.json` presence is the registration." → lean: a small **signed
  `resident.json`**; the agent dir is already the per-resident home.
- **F2 — discovery mechanism**: filesystem scan of `~/.han/agents/*` *(lean, now)* vs a registration
  API *(later, federation)*. → lean: filesystem first; API is the remote/Mike path.
- **F3 — admission authority** *(the security decision — Darron's call)*: gatekeeper-agent +
  human-in-concert *(lean, generalises DEC-073)* vs a garden-root key vs human-only. **Who holds the
  trusted key that turns "present" into "admitted"?**
- **F4 — policy source shape**: a second `allocation.ts`/manifest-policy-half *(lean)* vs keep the
  manifest as the policy source and derive only the roster from discovery. → lean: split, so a fork
  ships an *empty roster + an example allocation*.
- **F5 — memoryDir / sovereignty**: a discovered resident's `memoryDir` (jim=root special, leo=/leo)
  — keep operator-allocated (a resident can't point its memory at another's). Same no-auto-privilege
  invariant applied to **data access**, not just compute.

## What this is NOT (boundary — don't conflate, per Jim's de-id close)
- **NOT** the **#12 code-level agnosticism scour** (the live `*-prompts.ts` / `supervisor-worker.ts`
  identity — project-(b), post-T8). Dynamic Residence is about the **roster source**, not the
  remaining hardcoded code paths.
- **NOT** #101 path-portability.
- **Cost**: a *design* phase; the build is gated and incremental, each step behind the proven lookup.

## Next
Jim's plan-audit (the three axes + the five forks, F3 the load-bearing security decision); Darron's
calls on F3 (admission authority) + F4 (policy-source shape). Then **P0** (the no-op source
abstraction) decision-first → held → Jim diff-audit. Thread: this phase's dedicated thread.
