# The Garden Manifest — one tracked source of truth for agents, surfaces & their attributes

> **Status**: DRAFT plan. Authored by Jim (session) 2026-06-02 (S164) at Darron's request.
> **Leo-build / Jim-audit** per the HAN Codebase Rule. This is a planning/report artefact.
> **Motivating bug**: the model audit earlier today — `jim-human` on Opus **4.6** while
> `leo-human` is on **4.8**, supervisor-cycle + compression on **4.7** — three versions across
> one agent's surfaces, drifted *because the config is scattered across SDK call sites with no
> single place to see or set it.*

## Problem

DEC-081 settled the principle that **an agent is a configuration, not a code branch** — adding
an agent should be a config edit plus identity-file authoring, never a code change. But that is
only *half* true today. `lib/agent-registry.ts` (`AgentGradientConfig`, line 34) realises it for
**gradient** attributes (memory dirs, `loadProjectMemory`/`loadFailures` flags). Everything else
that defines an agent is **scattered and hardcoded**:

| Attribute | Where it lives today (scattered) |
|---|---|
| Per-surface **model** | `jim-human.ts:58`, `leo-human.ts:61`, `leo-heartbeat.ts:201/2427/2525/2629`, `supervisor-worker.ts:363/1036/1131/2075`, `process-pending-compression.ts:377` |
| **Profile** (role-frame, DEC-087/088) | `prompt-profiles.ts` `PROFILES` |
| **Transport** (SDK vs tmux) | implicit in which file runs it (future-idea #66) |
| **Port** (session interface) | `hanjim`/`hanleo` launchers, watchdog (future-idea #76, the fleet plan) |
| **Avatar / Discord persona** | `discord.ts` `PERSONA_AVATARS` |
| **Voice** | `config.json` voices block |
| **Signed identity-file set** | `identity-manifest.json` per agent (DEC-083) |
| **Active?** | implicit (whichever services are running) |

The cost: drift you cannot see (the 4.6/4.7/4.8 spread), config that requires a code dive to
change, and a starter that a gardener cannot tend without reading TypeScript. **There is no one
place that answers "what agents exist, what surfaces does each have, and what is each surface
configured with?"** The Garden Manifest is that place.

## What it is

A single, version-tracked, declarative manifest — **the topology of the garden** — that
enumerates every active agent, every surface each agent presents, and every templatable
attribute of those surfaces. One source of truth; one file a gardener edits to add an agent,
bump a model, enable a surface, or assign a port. The scattered literals above become *reads*
from this manifest via a typed resolver.

### The shape (illustrative — not final code)

```ts
interface GardenManifest {
  manifestVersion: number;
  agents: AgentManifest[];
}

interface AgentManifest {
  slug: string;                 // 'jim'  — the only identifier callers use
  displayName: string;          // 'Jim'
  formalName?: string;          // 'James'
  active: boolean;              // live in this garden?
  pronoun?: { subject: string; object: string; possessive: string };
  memoryDir: string;            // ~/.han/memory[/<slug>]
  workingDir: string;
  fractalDir: string;
  gradient: GradientConfig;     // today's AgentGradientConfig, folded in (or referenced)
  surfaces: SurfaceManifest[];
  avatar?: string;
  voice?: { provider: string; voiceId: string; speed: string };
  identityFiles: string[];      // the DEC-083 signed set — incl. self-reflections-curated.md
}

interface SurfaceManifest {
  name: string;                 // 'session' | 'human-response' | 'supervisor-cycle' |
                                // 'personal-cycle' | 'dream-cycle' | 'recovery-cycle' |
                                // 'compression' | 'philosophy-beat' | 'meditation-phase-a' …
  enabled: boolean;
  model: string[];              // preference ladder, e.g. ['claude-opus-4-8','claude-opus-4-7','sonnet','haiku']
  profile?: string;             // PROFILES key — the role-frame (DEC-087/088). Envelope &
                                // componentOverrides come FROM the profile, not duplicated here.
  transport: 'sdk' | 'tmux' | 'cli';   // future-idea #66
  port?: number;                // session/interactive surfaces only — future-idea #76
}
```

A **surface** is one instantiation of an agent for one purpose. Enumerating them turns the
invisible (which scattered literal belongs to which seat) into a table a gardener can read down.

### Resolver (replaces the scattered reads, DEC-081-style)

`surfaceModel(slug, surface)`, `agentSurfaces(slug)`, `activeAgents()`, `surfaceTransport(slug,
surface)` — all keyed on `string` slug, no `'jim'|'leo'` unions. `gradientConfigForAgent` keeps
working (reads `manifest.agents[].gradient`).

## Format — typed schema + declarative values (honours the hybrid Alt B+C, DEC-081)

Darron has a settled preference for the **typed module** ("this is important to me" — S150,
2026-05-10), resolved then as hybrid Alt B+C: *typed contract now, source-swappable values
additive future.* The Garden Manifest is that hybrid made concrete:

- **Schema stays typed** (the `interface`s above, validated — zod or a hand-rolled `parseManifest`
  that **fails loud**). Compile-time + load-time safety: a bad model string, an unknown profile,
  a missing required field, a duplicate slug → a clear error at boot, not a 2 a.m. silent fail in
  someone else's garden.
- **Values live in a declarative, gardener-editable file** — `garden.manifest.ts` (typed literal,
  Darron's preference) *or* `garden.manifest.json` (data, maximally starter-friendly, validated
  against the typed schema on load). **My lean: typed `.ts` literal** to keep Darron's
  compile-time guarantee, with a `verify-manifest` script as the gardener's pre-flight either
  way. (Open question Q1 — JSON is friendlier for non-coders; the schema+validator makes either
  safe.)

## Migration (behaviour-preserving, surface-by-surface, audited — AP-migration discipline)

- **Phase 0 — author the manifest with *current* values, exactly.** Capture every scattered
  literal as-is, including the 4.6/4.7/4.8 spread. The asymmetry becomes a *visible line in a
  table* and a one-character fix, instead of a code hunt. Zero behaviour change.
- **Phase 1 — resolver + call-site migration.** Introduce the resolver; switch each call site
  from its literal to `surfaceModel(slug, surface)` **one surface per PR**, audited, with the
  literal deleted in the same commit (same-commit-deletion discipline). Grep proves zero
  remaining literals at the end.
- **Phase 2 — fold the gradient registry in.** `AgentGradientConfig` becomes
  `manifest.agents[].gradient`; `agent-registry.ts` reads from the manifest (or is replaced by
  it). One source, finally.
- **Phase 3 — validator + docs + fail-loud.** `scripts/verify-manifest.ts` (run in CI / launcher
  pre-flight, like the DEC-083 identity gate). A commented example manifest. The "add an agent"
  runbook.
- **Phase 4 — starter.** The manifest ships in han-starter as a 2-agent commented example; "add
  an agent to your garden" becomes: copy a stanza, edit slug/model/surfaces, author the identity
  files, run `verify-manifest`. No TypeScript spelunking. (Folds into
  `plans/han-starter-extraction-manifest.md` + `garden-provisioning-runbook.md`.)

## Why this makes the starter friendlier (Darron's intent)

- **Care**: the gardener sees the whole topology on one page — who lives here, what each can do,
  what each runs on. Nothing hidden in a call site.
- **Precision**: changing a model, enabling a surface, or assigning a port is one edit in one
  place, validated before it can break a wake.
- **Thoroughness**: the manifest is the checklist — a surface with no model, an agent with no
  signed identity set, a session with no port all surface as *validation errors*, not as
  silent gaps discovered weeks later (the 4.6 drift is precisely such a gap).

## Relationship to existing decisions & plans

- **DEC-081** (agnostic registry) — this *completes* it for non-gradient attributes.
- **DEC-087/088** (profiles as role-frames) — surfaces *reference* profiles; the manifest says
  *which surface uses which role-frame*, the profile still owns envelope + componentOverrides.
- **`agent-shell-plan.md` (Phase 9)** — Phase 9's "per-agent configs + `lib/agent-shell.ts`" is
  the *process* layer; the Garden Manifest is the **data** layer it should read. Build the
  manifest first; the shell consumes it. (Sequencing note for whoever picks up Phase 9.)
- **Future-idea #66 (tmux transport)** and **#76 (session ports)** — `transport` and `port`
  fields are their declarative home; the fleet plan (`server-fleet-management-plan.md`) allocates
  ports, the manifest *records* them.
- **DEC-083 (signing)** — `identityFiles` makes the signed set declarative (and would have
  caught today's curated-file-unsigned gap structurally).
- **DEC-073 (gatekeeper)** — the manifest is a garden-initial-condition; whether it's
  gatekeeper-controlled is Q4 below.

## Open questions (for Darron / Leo before build)

- **Q1 — format**: typed `.ts` literal (compile-safety, Darron's lean) vs `.json` (friendliest
  for non-coder gardeners), both behind the typed validator. *My lean: `.ts`, revisit if the
  starter audience is non-coders.*
- **Q2 — does it subsume or compose `agent-registry.ts`?** Subsume = one file, cleanest;
  compose = manifest references the existing registry, smaller diff. *Lean: subsume in Phase 2.*
- **Q3 — where does it live?** Tracked in-repo as the canonical default (starter ships it), with
  an optional `~/.han/` per-garden override? Or in-repo only? *Lean: in-repo canonical +
  documented override path.*
- **Q4 — gatekeeper-controlled (DEC-073)?** It's a garden initial-condition like
  `CLAUDE.template.md`. *Lean: yes for the schema/defaults; the per-garden values file is the
  gardener's to edit.*
- **Q5 — model-fallback semantics**: keep the preference-ladder array (current `MODEL_PREFERENCE`
  pattern) as the canonical model spec? *Lean: yes — it already encodes graceful degradation.*
- **Q6 — runtime vs static**: is the manifest read once at boot, or hot-reloadable (change a
  model without a restart)? *Lean: boot-read for v1; hot-reload is a later nicety.*

## Immediate by-product (independent of the full build)

Phase 0 alone — authoring the manifest with current values — **makes the 4.6/4.7/4.8 asymmetry
visible and fixable in one place.** Even before the resolver migration, that table is worth
having. If Darron wants the model alignment now, Phase 0 is where it lands.
