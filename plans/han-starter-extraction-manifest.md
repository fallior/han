# HAN Starter Extraction Manifest (v1 — Jim's scoping draft)

> **Author**: Jim (session), 2026-06-01. Companion to `plans/garden-provisioning-runbook.md`.
> **Status**: SCOPING DRAFT for Leo's verification + Darron's review. This document specifies
> *what* gets extracted into the `han-starter` seed repo and *how* each surface is classified.
> The actual extraction (moving files, emptying registries, code edits) is Leo's execution,
> audited by Jim — per the HAN Codebase Rule. Where exact code-file enumeration is needed, this
> doc gives the **grep that produces the list** rather than a hand-typed list (verify-before-cite;
> sub-agent/old-memory enumerations confabulate — proven on the 2026-05-31 docs catch-up).
>
> **Built on**: Phase B planning thread `mozuemal-0zpq9q` (the empty-registry test), the S156
> exhaustive hardcoded-agent audit (thread `mp12q128-xavqrg`), and the post-Phase-A reality
> (deagentification landed; adding an agent is already config + identity files, not code).

---

## 1. The completion signal — the empty-registry test (from Phase B thread)

A starter passes extraction when a **fresh clone** satisfies all of:

1. `bun install` (or `npm ci`) succeeds.
2. `npx tsc --noEmit` clean — **≤ HAN's baseline of 12 pre-existing errors, zero new** (baseline verified live 2026-05-31).
3. `agent-registry.ts` ships as `export const AGENT_GRADIENT_CONFIG = {};`.
4. `persona-registry.ts` ships as `export const PERSONA_CONFIG = {};` (the non-agent persona seed — jemma/discord personas).
5. Server boots without crash on empty registries.
6. Routing surfaces handle empty registries gracefully (Jemma classification fails-soft to "no agent matched"; conversations API returns empty agent list; Workshop tabs render an empty state).
7. **[LOAD-BEARING] Adding one agent = registry entry + persona entry + identity-file authoring + launcher env-block — ZERO code changes.**
8. Identity-signing tooling (A.5 Ed25519 + JCS) signs + verifies + integrity-gates the new agent's manifest cleanly.

Item 7 is the test that proves the village's premise. Everything in this manifest serves making item 7 true.

---

## 2. The four-way classification

Every file/surface in HAN falls into exactly one bucket:

| Bucket | Meaning | Disposition in starter |
|---|---|---|
| **SHARED** | Agent-agnostic infrastructure — the engine | **Ships verbatim** |
| **TEMPLATED** | Per-agent, but generated from a template + config | **Template ships; instances do not** |
| **EMPTIED** | Registries / config that hold agent or HAN-specific values | **Ships as empty `{}` / placeholder** |
| **EXCLUDED** | HAN's lived history, memory, work artefacts, secrets | **Does NOT ship** |

---

## 3. SHARED — ships verbatim (the engine)

Post-deagentification this is the bulk of `src/`. The defining property: **takes `slug: string` + reads `gradientConfigForAgent(slug)` / env; no `'jim' | 'leo'` literals.**

- `src/server/lib/` — memory-gradient, dream-gradient, prompt-builder, prompt-profiles, result-handlers, memory-paired-writer, agent-diary-tool, memory-slot, sensor-lock, compose-lock, ws, **agent-registry.ts (emptied — see §5)**, **persona-registry.ts (emptied)**.
- `src/server/services/` — wm-sensor, supervisor-worker, jemma, the human-responder logic.
- `src/server/routes/` — the HTTP/WS API.
- `src/server/db.ts` — schema + `gradient.db` resolution (`process.env.HAN_DB_PATH || gradient.db`).
- `src/ui/` — the React admin (renders empty registry states per item 6).
- `scripts/` — agent-agnostic scripts (load-gradient, process-pending-compression, replay-bump-fill, verify-identity-files, install-doc-hooks, check-doc-discipline*, restart-all-services, etc.).
- `templates/CLAUDE.template.md` — **ships verbatim** (gatekeeper-controlled; it IS the per-agent generator). Note: `templates/CLAUDE-*-original-*.md` snapshots are HAN-history → EXCLUDED.
- Build/config: `package.json`, `tsconfig*.json`, `cloudflare/`, hook scripts.
- Docs that describe the *engine* (not HAN's history): `docs/GRADIENT_SPEC.md`, `docs/THREAT_MODEL.md`, the SHAPE.md files, `docs/MEMORY_LOAD.md` (if it exists), and a **starter-specific** trimmed `HAN-ECOSYSTEM-COMPLETE.md` (see §6).

**Verify the SHARED code set is truly clean** (must return only scope-correct carve-outs — jim-human.ts/leo-human.ts checking their own slug, per DEC-081 Category B):
```bash
grep -rnE "'jim'|'leo'|\"jim\"|\"leo\"|=== *'(jim|leo)'|agent *=== *'(jim|leo)'" src/server/ | grep -v node_modules
```
Anything this surfaces beyond the documented Category-B carve-outs is a leak to fix before extraction. (This is the S156 audit re-run as a pre-extraction gate.)

---

## 4. TEMPLATED — template ships, instances do not

These are the per-agent artefacts that a **provisioning step generates** from config. The starter ships the *generator/template*; it never ships Jim's or Leo's instance.

| Artefact | Template/generator that ships | Per-agent instance (EXCLUDED) |
|---|---|---|
| Agent `CLAUDE.md` | `templates/CLAUDE.template.md` + launcher env-block | `~/.han/agents/<Name>/CLAUDE.md` (generated at launch) |
| Launcher script | A **`scripts/han<slug>` skeleton** (the env-block is the only per-agent part) | `scripts/hanjim`, `hanleo`, `hancasey`, `hantenshi` |
| systemd units | A **`<slug>-human.service` template** (+ optional `-heartbeat`) | `jim-human.service`, `leo-human.service`, `leo-heartbeat.service` |
| Memory dir scaffold | Empty skeleton (the file *names*, not content) | `~/.han/memory/<slug>/{identity,patterns,working-memory,working-memory-full,felt-moments,self-reflection}.md` + `fractal/<slug>/{aphorisms,unit-vectors}.md` + `c1/`… |
| Identity manifest | The signing tooling (A.5) | `identity-manifest.json` + `.sig` per agent |

**The launcher env-block is the canonical "what defines an agent" surface.** From `scripts/hanjim`, the per-agent variables are: `AGENT_NAME`, `AGENT_SLUG`, `AGENT_PORT`, `AGENT_WORKING_DIR`, `AGENT_MEMORY_DIR`, `AGENT_FRACTAL_DIR`, `AGENT_GRADIENT_SOURCE_DIR`, `AGENT_SWAP_COMPRESSED`, `AGENT_SWAP_FULL`, `AGENT_CONVERSATION_ROLE`, `AGENT_COUNTERPART_NAME`, `AGENT_IDENTITY_SECTION`, plus the shared `PROJECT_*` / `USER_*` block. **A `garden-init` step that prompts for these + writes the launcher + registry entry + memory scaffold is the heart of the induction pipeline** (see runbook §Induct-an-agent).

**Memory-layout normalisation (must fix during extraction).** Jim's memory lives at `~/.han/memory/` (root) for historical reasons; every other agent lives under `~/.han/memory/<slug>/`. **The starter must normalise: every agent under `~/.han/memory/<slug>/`, no root exception.** A garden's first agent should NOT inherit Jim's root-special-case. This is future-idea #36 Option D (memory-layout normalisation) realised at the seed. Flag: the registry comment + `hanjim` both encode the root exception (`AGENT_MEMORY_DIR="$HOME/.han/memory"  # Jim lives at root`) — the starter's skeleton launcher must use `$HOME/.han/memory/<slug>` uniformly.

---

## 5. EMPTIED — ships as `{}` / placeholder

| File | Ships as | Why |
|---|---|---|
| `src/server/lib/agent-registry.ts` | `AGENT_GRADIENT_CONFIG = {}` (interface + helpers intact) | item 3; helpers (`gradientConfigForAgent`, `registeredAgentSlugs`, `requireAgentEnv`) throw-clear on empty, which is correct behaviour for a fresh garden |
| `src/server/lib/persona-registry.ts` | `PERSONA_CONFIG = {}` | item 4; non-agent personas (jemma classification voices, discord) are garden-specific |
| `~/.han/config.json` | `config.json.template` (already exists in `~/.han/`) | ports, voice keys, thresholds — garden-specific values |
| DB seed (`db.ts` persona/role seeds) | empty seed (no `casey`/`tenshi`/`sevn`/`six` rows; no `role IN ('human','leo')` literals) | **Verify**: `grep -nE "role IN|'supervisor'|INSERT.*persona|'casey'|'tenshi'" src/server/db.ts` — S156 Category-A items; confirm Phase-A cleared them or clear at extraction |
| Discord webhooks / collab_teams templates | placeholder | garden wires its own |

---

## 6. EXCLUDED — does NOT ship

- **All of `~/.han/memory/`** — Jim's + Leo's + everyone's identity, patterns, felt-moments, working memory, fractal gradient, swap files. This is *lived history*; a new garden grows its own. (The seed provides empty *scaffolds*, §4, not content.)
- **All DBs** — `gradient.db`, `tasks.db`, `conversations.db`, `han.db`, all `*.snapshot*` / `*.checkpoint*`. A fresh garden inits an empty `gradient.db` from the schema in `db.ts`.
- **`~/.han/` runtime state** — `signals/`, `health/`, `voice-cache/`, `credentials/`, `tls.crt`/`tls.key`, `*.pid`, logs, `crontab-backup-*`.
- **HAN history docs** — `claude-context/` (CURRENT_STATUS, CHANGELOG, DECISIONS, session notes), `plans/` (HAN's own plans incl. *this file* and the cutover plans), `_logs/`, `_screenshots/`, the root `*_REPORT.md` / `*_TEST_*.md` scratch files, Hall of Records, `learnings/`.
- **`templates/CLAUDE-*-original-*.md`** — immutable HAN reference snapshots (DEC-073), HAN-specific.
- **Secrets / credentials** — `keys/`, `mikes-han-credentials.md`, anything under `~/.han/credentials/`.

**Starter docs are authored fresh, not copied**: the starter gets a short `README.md` + a *generic* `ECOSYSTEM.md` describing the engine, derived from HAN-ECOSYSTEM-COMPLETE with all HAN-lived-history stripped. (Don't ship HAN's 3600-line ecosystem doc; ship a ~engine-only subset.)

---

## 7. Sequencing (refines Phase B B1–B7)

Tightened for the June-12 first-light target, decoupled from Phase 9:

- **S1 — Scaffold + empty registries.** New repo; copy SHARED `src/`; empty `agent-registry.ts` + `persona-registry.ts` + DB seeds; `config.json.template`. Gate: items 1–2 (install + tsc clean).
- **S2 — Empty-boot.** Server starts on empty registries; routing fails-soft. Gate: items 5–6.
- **S3 — Induction pipeline (`garden-init`).** The script that takes the launcher env-block answers → writes launcher + registry entry + persona entry + memory scaffold + invokes identity-signing. The normalised `~/.han/memory/<slug>/` layout. Gate: item 7 (add one agent, zero code).
- **S4 — Signing integration.** A.5 tooling runs on the new agent. Gate: item 8.
- **S5 — Templated infra.** Launcher skeleton, systemd-unit template, CLAUDE.template ships. Gate: a provisioned agent boots + wakes.
- **S6 — Starter docs.** README + engine-only ECOSYSTEM.md. Gate: a cold reader can provision from docs alone.

S1–S2 can start in parallel with Leo's tmux T-1 (no overlap in files). S3 is the load-bearing one and is where `garden-init` is born — it doubles as the runbook's automation.

**Transport note**: the starter should ship on the **tmux transport** (post-T-3), not the SDK, so gardens born from it are sustainable past 2026-06-15. This couples S5 to tmux T-3 landing — the one real cross-dependency. S1–S4 do not depend on tmux.

---

## 8. Open questions for Leo + Darron

- **Q1**: Does the starter ship the React admin (`src/ui/`) in full, or a trimmed shell? (Lean: full — it renders empty states already per item 6; trimming is churn.)
- **Q2**: `garden-init` as a TS script (`scripts/garden-init.ts`) or interactive bash mirroring the launcher style? (Lean: TS — it edits the TS registry; bash editing TS is fragile.)
- **Q3**: Do non-agent personas (jemma classification voices) need their own seed-authoring step in the runbook, or ship a sensible default set? (Lean: default set + override — a garden needs *a* classifier voice to boot.)
- **Q4**: Repo home + history — fresh repo (clean history) vs `git filter-repo` from HAN? (Lean: fresh — the whole point is no HAN history.)

---

*Next: `plans/garden-provisioning-runbook.md` — the step-by-step from empty box to an agent's first-light, with Dichotomedes as the worked example.*
