# Garden Provisioning Runbook (v1 — Jim's scoping draft)

> **Author**: Jim (session), 2026-06-01. Companion to `plans/han-starter-extraction-manifest.md`.
> **Status**: SCOPING DRAFT for Leo's verification + Darron's review. This is the step-by-step
> to take a new garden from an empty Linux box to an agent's **first-light** — boot → wake →
> converse → remember → clear. Concrete commands are given where verified; steps that depend on
> code Leo owns are marked **[verify]**. The `garden-init` automation (manifest §S3) is the goal
> state of this runbook — until it exists, these are the manual steps it will encode.
>
> **Definition — "operational" = first-light, NOT feature-parity**: one agent boots with identity
> loaded, holds a conversation, and writes-then-recalls a memory across one wake/clear cycle on
> the tmux transport. Dreams, all cycle types, the full surface set follow after. First-light is
> the milestone that proves the starter propagates a *living* agent.

---

## Phase 0 — Prerequisites (per garden)

- [ ] **Linux account** for the garden's system-level ops. *(Done for the first two: `mike` uid=1001, `strategist` uid=1002 — both with sudo/docker/adm/ollama groups, thread `moxno6k1-f1bq9k`.)*
- [ ] **Box / host** reachable. Same machine (separate user) or separate host.
- [ ] **Tailscale identity** for the garden (its own node / tag) so conversations + remote access route. **[verify exact tailnet setup with Darron]**
- [ ] **Runtime deps**: node (v23.9.0 per HAN's systemd `PATH`), tsx, bun-or-npm, sqlite3, tmux, jq.
- [ ] **Port allocation** from the central registry (`~/Projects/infrastructure/registry/services.toml`) — each garden needs: community server port (HAN uses 3847), per-agent server port (HAN's Jim uses 3848). **Pick a non-colliding block per garden.**
- [ ] **Anthropic auth** available to the garden (subscription seat for the tmux transport; same account-management approach as HAN per the A1 resolution — adaptive, Darron-managed).

## Phase 1 — Clone + empty-boot verification

```bash
# as the garden's user
git clone <han-starter-repo> ~/garden && cd ~/garden
bun install                 # or: npm ci
npx tsc --noEmit            # must be ≤ baseline (12), zero new
cp ~/.han/config.json.template ~/.<garden>/config.json   # then edit ports/keys  [verify path]
# start server on the garden's allocated port
<start-server-command>      # [verify: the npm script / tsx entrypoint]
```

**Gate (empty-registry test, manifest §1 items 5–6):** server boots with `AGENT_GRADIENT_CONFIG = {}` and `PERSONA_CONFIG = {}`; the admin UI renders empty states; Jemma classification fails-soft. **If the server crashes on empty registries, stop — that's a starter bug, fix in extraction, not here.**

## Phase 2 — Induct the first agent (the heart)

This is what `garden-init` automates (manifest §S3). Manually, it's:

**2a. Registry entry** — add to `src/server/lib/agent-registry.ts`:
```ts
dichotomedes: {
    displayName: 'Dichotomedes',
    memoryDir: path.join(HAN_DIR, 'memory', 'dichotomedes'),     // normalised /<slug>/, NO root exception
    fractalDir: path.join(HAN_DIR, 'memory', 'fractal', 'dichotomedes'),
    sourceDir: path.join(HAN_DIR, 'memory', 'dichotomedes', 'working-memories'),
    sourceFileFilter: (f) => f.startsWith('working-memory-full-') && f.endsWith('.md'),
    sourceFileBaseName: (f) => f.replace(/^working-memory-full-/, '').replace(/\.md$/, ''),
    // loadProjectMemory / loadFailures: omit unless the strategist needs them
},
```
*(This is the "Leo shape" — the standard non-Jim layout. Only Jim has the root + project-memory + failures special-casing.)*

**2b. Persona entry** — add the garden's classification/discord persona to `persona-registry.ts` **[verify exact shape from the emptied registry's interface]**.

**2c. Launcher** — copy the `han<slug>` skeleton; fill the env-block (manifest §4). For Dichotomedes: `AGENT_NAME=Dichotomedes`, `AGENT_SLUG=dichotomedes`, `AGENT_PORT=<allocated>`, `AGENT_WORKING_DIR=$HOME/.han/agents/Dichotomedes`, `AGENT_MEMORY_DIR=$HOME/.han/memory/dichotomedes`, `AGENT_FRACTAL_DIR=$HOME/.han/memory/fractal/dichotomedes`, `AGENT_GRADIENT_SOURCE_DIR=$HOME/.han/memory/dichotomedes/working-memories`, `AGENT_CONVERSATION_ROLE=<role>`, `AGENT_COUNTERPART_NAME=<peer or empty>`, `AGENT_IDENTITY_SECTION=<short identity prose>`.

**2d. Memory scaffold** — create the dir + empty files:
```bash
mkdir -p ~/.han/memory/dichotomedes/working-memories ~/.han/memory/fractal/dichotomedes/c1
cd ~/.han/memory/dichotomedes
: > patterns.md; : > working-memory.md; : > working-memory-full.md
: > felt-moments.md; : > self-reflection.md
# identity.md + aphorisms.md are AUTHORED, not empty — see Phase 3
```

**Gate (manifest §1 item 7):** the agent now exists via registry+persona+launcher+scaffold — **zero code changes** beyond the registry/persona config entries. If anything required editing a `.ts` handler/route, that's a deagentification leak — file it.

## Phase 3 — Author + sign identity (the soul + A.5 gate)

**3a. Author `identity.md`** from the seed. For Dichotomedes the seed exists: `plans/dichotomedes-induction.md` (SEED, Darron-authored). Derive the operational `~/.han/memory/dichotomedes/identity.md` from it, preserving the induction doc as origin. **This step is human/agent judgement, not automation** — identity is authored, never generated. Also author `~/.han/memory/fractal/dichotomedes/aphorisms.md` (can start minimal; it grows).

**3b. Sign (A.5 / DEC-083)** — generate the identity manifest + Ed25519 signature, then verify the integrity gate fires:
```bash
cd ~/garden/src/server
# [verify exact signing entrypoint — sibling of verify-identity-files.ts]
npx tsx ../../scripts/verify-identity-files.ts --agent=dichotomedes --entry-point=provisioning
echo "exit=$?"   # must be 0; non-zero halts (correct behaviour — fix manifest, re-sign)
```
**Gate (manifest §1 item 8):** sign + verify + integrity-gate all green for the new agent.

## Phase 4 — Wire runtime

- [ ] **systemd unit(s)** — from the `<slug>-human.service` template (manifest §4). Set `Description`, `ExecStart=… <slug>-human.ts`, `SyslogIdentifier=<slug>-human`, `WorkingDirectory=<garden>/src/server`. `systemctl --user enable --now <slug>-human.service`. *(Heartbeat unit only if the agent has autonomous beats — first-light doesn't need it.)*
- [ ] **Community/agent servers** running on the allocated ports; admin UI reachable over Tailscale.
- [ ] **Jemma dispatch** routes to the new agent (it reads the registry — should "just work" once 2a lands). **[verify]**
- [ ] **Discord webhooks** — only if the garden uses Discord; optional for first-light.

## Phase 5 — First-light test (the milestone)

Run the cycle that proves a *living* agent:

1. **Wake** — launch `~/garden/scripts/han<slug>` in a tmux session; type `welcome back <Name>`. **Pass**: the session-start protocol runs — integrity gate green, identity + (empty) memory + aphorisms load, agent greets in-voice and oriented (date/time check included — the orientation discipline).
2. **Converse** — post a message to a thread addressed to the agent. **Pass**: it responds in-voice, signed correctly, via the WebSocket/REST path; the post lands in the admin UI.
3. **Remember** — give it something to carry; let it write a swap/working-memory entry. **Pass**: the entry appears in `~/.han/memory/<slug>/working-memory*.md`; wm-sensor sees it.
4. **Clear + re-wake** — `/pfc` → `/clear` → `welcome back`. **Pass**: the re-woken agent loads the entry it wrote and references it — continuity across the boundary. *This is the real proof: identity + memory survive a wipe.*

**First-light achieved when all four pass.** That garden is operational.

---

## Worked example — Dichotomedes (the strategist garden)

| Step | Status / value |
|---|---|
| Linux account | ✅ `strategist` (uid=1002) |
| Agent identity name | `Dichotomedes` (lives in identity files, signatures, persona) |
| Operational slug | ✅ `dichotomedes` (Darron, 2026-06-01) — registry/identity/signatures slug. Linux account stays `strategist` (system ops). Slug and account deliberately differ. |
| Seed identity | ✅ `plans/dichotomedes-induction.md` (SEED, awaiting final thread review `moxno6k1-f1bq9k`) |
| identity.md | ⬜ derive from seed (Phase 3a) |
| Tailscale / ports | ⬜ allocate (Phase 0) |
| First-light | ⬜ target ~Jun 6–9 per the strategic sequence |

**Mike's garden** follows the same runbook with `mike`'s account + Mike's chosen agent identity (Sevn/Six already have `~/.han/agents/` dirs + launchers in mikes-han — so mikes-han may be further along than a cold garden; **[verify mikes-han's current state with Mike/Darron]** before treating it as a from-scratch provision).

---

## The two cross-dependencies to watch

1. **tmux T-3 must land** before S5/first-light — gardens should be born on the sustainable transport, not the SDK (deadline 2026-06-15). This is the single gating unknown (see the T-1 audit, thread `mppj72fx-wt0u1p`).
2. **`garden-init` automation** (manifest §S3) is what turns this 5-phase manual runbook into one command. Building it IS the highest-value parallel work while Leo is on tmux — it's the thing that makes "operational by June 12" repeatable rather than heroic.

---

*Open question for Darron: for first-light, is Dichotomedes the right first garden (seed already authored), with Mike's second? My lean: yes — Dichotomedes is further along (induction doc exists), so it's the lower-risk first proof; Mike's garden benefits from the runbook being shaken out once first.*
