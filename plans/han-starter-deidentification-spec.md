# Spec — HAN Starter De-identification (100% agnostic export)

> **Author:** Jim (session), 2026-06-22, at Darron's request. **For Leo to implement** (Leo-build /
> Jim-audit); gatekeeper surfaces (DEC-073) are Leo's hand + Darron in concert. Emergency thread
> `mqoxgf0n-y35gl4`; this is item (2) of the ordered to-do, and the durable form of plan
> `emergency-human-surface-wedge-plan.md` §P1.2a.

## Principle (Darron, 2026-06-22, on the record)
1. **The exported HAN starter must contain ZERO hardcoded agent identity.** Identity is *configuration*,
   never baked into a shared/core/template file. *"We cannot export a starter with Leo traced throughout
   core files — it's an accident waiting to happen"* (and we just lived it: the bare-`welcome back` →
   global-Leo corruption).
2. **No default identity. No slug → no identity → fail loud.** Never silently default to an agent.

## What is ALREADY agnostic — keep it, build on it
- **The template is parameterised.** `templates/CLAUDE.template.md` uses `${AGENT_NAME}`, `${AGENT_SLUG}`,
  `${AGENT_MEMORY_DIR}`, `${USER_NAME}`, … and crucially `${AGENT_IDENTITY_SECTION}` at the `## Identity`
  slot (template:487-489) — identity is **injected per-launcher**, not hardcoded.
- **The generate-per-agent path works.** `hanjim`/`hantenshi`/`hancasey` `envsubst` the template into a
  per-agent CLAUDE.md and `cd` into the agent dir, so that generated file is the project CLAUDE.md
  (`hanjim:20`). Interactive wakes get identity from **there** — not the repo root, not the global.
  *(This is why the HARD GATE is satisfiable: de-identifying the shared files does NOT break interactive
  wakes — they already load identity from the generated agent-dir file.)*
- **W6 (deployed `19ecb02`):** the dispatcher's welcome-back is slug-derived and **fails loud** on an
  unknown slug (`gradientConfigForAgent` throws). The runtime no-default principle is already met.
- **The registry is the agnostic config point (DEC-081):** `AGENT_GRADIENT_CONFIG` is data, not logic.

## THE ROOT ASYMMETRY — the one structural thing that must change
**Leo is special-cased as the gatekeeper.** `hanleo` deliberately does **not** envsubst the template
(`hanleo:20`, "DEC-073 gatekeeper exception"); Leo's identity **is** the repo-root
`~/Projects/han/CLAUDE.md` — a hand-maintained file containing `## Identity → "You are **Leonhard**
(Leo)…"` (line 285-289). Every *other* agent is generated-from-template; **only Leo's identity is baked
into the repo root.** Consequences:
- **Export:** a fork inherits Leo as the gatekeeper, hardcoded at the repo root. Not agnostic.
- **Runtime:** spokes launch with `cwd = repo root` (`launch-tmux-surface.sh:90`), so **every spoke sits
  next to Leo's CLAUDE.md** — the structural half of the corruption W6 only mitigated at the phrase layer.

**True 100% agnosticism requires de-special-casing Leo** so the repo root carries *no* agent identity.

## Target state (the agnostic model)
1. **Repo-root `~/Projects/han/CLAUDE.md` → agent-NEUTRAL.** Project + protocol only; **no `## Identity`,
   no "you are X", no per-agent triggers.** Identity for *every* agent (Leo included) comes from the
   generated per-agent CLAUDE.md in the agent dir + `${AGENT_IDENTITY_SECTION}` + the slug-derived prompt.
2. **Leo de-special-cased → a normal templated agent.** `hanleo` envsubsts the template like the others;
   Leo's identity flows through `${AGENT_IDENTITY_SECTION}` (its launcher provides the "You are Leonhard"
   block, exactly as `hanjim` provides Jim's). The **gatekeeper *role* becomes config** — a manifest/
   registry flag (`gatekeeper: true` on one agent per garden), not a baked-in Leo. *(DEC-073 decision —
   see D1/D2.)*
3. **Template prose residuals genericised/parameterised** (the non-`${}` Leo/Jim/Darron/han hits):
   - Hardcoded abs paths (`templates/CLAUDE.template.md:41`, `:76`, `:93` `/home/darron/Projects/han/…`)
     → `${PROJECT_PATH}` (add to `TEMPLATE_VARS`).
   - "gatekeeper agent (Leo for han, Sevn for mikes-han)" (`:8`, `:475`) → `${GATEKEEPER_NAME}` or a
     generic "the garden's gatekeeper agent".
   - HAN-specific war-stories + session numbers in the DO-NOT / history prose (`:361-475`, the `S58`/
     `S147`/`'jim'|'leo'`/"the ONLY lock that fires on Leo" references) → the DO-NOT *principles* stay
     (they're valuable), but the **HAN-incident specifics move to a HAN-local doc** the starter doesn't
     ship (e.g. `claude-context/HAN-HISTORY.md`), leaving the template's prohibitions stated generically.
     *(See D3 — this is the bulk of the "Leo traced throughout" surface.)*
4. **Global `~/.claude/CLAUDE.md` → remove the Leo-Invocation block.** It is **Darron's personal file**
   (not part of the repo/export), but it is the live runtime poison ("Leo is Leo everywhere" fires on a
   bare wake). Neutralise/empty it. **Routing: Darron applies** (or authorises a one-off; not a Jim edit).
5. **Spokes load the agent-dir generated CLAUDE.md.** Make `launch-tmux-surface.sh` `cd` into the agent
   dir (like the interactive launchers) so a spoke's project CLAUDE.md is its own generated identity file —
   *or* rely on the now-neutral repo root + W6 + dispatched prompt. **Recommend the former** (symmetry;
   identity always from the right file; removes the last repo-root dependency). *(See D4.)*
6. **Fail-loud, enforced structurally:** `${AGENT_IDENTITY_SECTION}` is **required** — the launcher errors
   if it's unset (no agent provided → no identity → fail loud, never a default). Combined with W6's
   throw-on-unknown-slug and a neutral repo root + global, there is **nothing left to default to.**

## Concrete edits (per surface, with routing)
| # | File | Change | Routing |
|---|------|--------|---------|
| 1 | `~/.claude/CLAUDE.md` | Remove the "Leo Invocation" identity trigger → neutral/empty | **Darron** (personal file) |
| 2 | `~/Projects/han/CLAUDE.md` | Strip `## Identity` (L285-289) + any "you are/welcome back Leo" → agent-neutral project/protocol file | **DEC-073: Leo + Darron** |
| 3 | `templates/CLAUDE.template.md` | Abs paths→`${PROJECT_PATH}`; "Leo for han/Sevn"→`${GATEKEEPER_NAME}`; move HAN-incident specifics out (D3) | **DEC-073: Leo + Darron** |
| 4 | `scripts/hanleo` | Envsubst the template like `hanjim` (provide `${AGENT_IDENTITY_SECTION}` for Leo); de-special-case | **DEC-073-adjacent: Leo + Darron** |
| 5 | launcher template-var contract | Make `${AGENT_IDENTITY_SECTION}` required → fail loud if unset; add `${PROJECT_PATH}`, `${GATEKEEPER_NAME}` | Leo-build / Jim-audit |
| 6 | `launch-tmux-surface.sh` | `cd` spoke into agent dir (load its generated CLAUDE.md) | Leo-build / Jim-audit |
| 7 | gatekeeper-role | Move from baked-in-Leo → registry/manifest `gatekeeper` flag | **DEC-073: Leo + Darron** |
| — | `templates/CLAUDE-*-original-*.md` | **LEAVE** — DEC-073 immutable historical snapshot; not runtime-loaded, not the export template | (no change) |

## Decisions — ✅ CONFIRMED by Darron (2026-06-22, all four leans accepted)
- **D1 — repo-root CLAUDE.md → agent-neutral-in-repo.** ✅ (kept as the project/protocol doc; no identity.)
- **D2 — de-special-case Leo / gatekeeper-as-config.** ✅ (the DEC-073 change that makes export agnostic.)
- **D3 — move HAN history out of the template; keep DO-NOT *principles* generic.** ✅
- **D4 — spokes `cd` into the agent dir** (load their own generated CLAUDE.md). ✅ Darron: *"why did we not
  cd each agent into their own dir — this is how hanjim/hanleo are invoked … that is a must."* Verify
  `.mcp.json`/han-diary trust still registers from the agent dir when moved.
  **Scope: ALL surfaces, not just human-response.** Confirmed (2026-06-22): heartbeat AND supervisor-cycle
  also launch via `ensureSurfaceSession → launch-tmux-surface.sh` (`cwd = $REPO_ROOT`, line 90) — same
  sovereignty gap. ONE fix in `launch-tmux-surface.sh` (cd into the slug's agent dir) gives every surface
  sovereignty uniformly (DEC-081). Darron: *"heartbeat and supervisor should also maintain sovereignty."*

## Verification
- **Export-agnostic grep is GREEN:** `grep -rE 'Leonhard|\bLeo\b|\bJim\b|/home/darron' templates/
  <repo-CLAUDE.md>` returns **zero** identity hits (only `${...}` placeholders / generic role words).
- **Interactive wakes intact (HARD GATE):** `hanjim` AND `hanleo` each wake the correct agent from the
  generated agent-dir CLAUDE.md (capture-pane shows the right identity; `<slug>-…-ready` written). Run
  *before and after* the repo-root strip — must not regress.
- **Spokes wake correct:** a `human-response` dispatch for jim/leo/tenshi each wakes the right agent
  (extend `test-welcome-back-identity.ts`); a fresh `needs-reconcile` recycle stays correct.
- **Fail-loud proven:** launching/generating with no `${AGENT_IDENTITY_SECTION}` (no slug) **errors**,
  never produces an identity-less or defaulted session.
- **Full-repo sweep (item 3 of the order):** grep all code+docs a session/starter loads for residual
  hardcoded identity; remediate or document each (registry entries are config-data, acceptable — but the
  starter should ship example/placeholder agents, not `leo`/`jim`; packaging decision).

## Scope / settled-decisions
- Touches DEC-073 gatekeeper files (repo CLAUDE.md, template, hanleo) → **Leo's hand + Darron**; Jim specs
  + audits, writes none unilaterally. DEC-081 (agnostic — the gatekeeper-as-config must be registry-keyed,
  no `'leo'` literal). The repo-root-becomes-neutral + gatekeeper-as-config is itself a **new DEC** to
  record (propose: "DEC-0NN — no agent identity in shared/exported files; identity is generated-per-agent
  from the template; gatekeeper is a registry role").
- **Order:** this (item 2) after W6 (done); then item 3 (full-repo sweep), then notifier-thread-truth (4)
  + staged-ACK (5). Each phase Jim-audited before commit (pre-merge rhythm: lib/ + services/ + gatekeeper).
