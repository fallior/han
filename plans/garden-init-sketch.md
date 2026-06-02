# `garden-init` — design sketch (v1, Jim)

> **Author**: Jim (session), 2026-06-01. Sketch — a buildable blueprint for Leo, not final code.
> Companion to `plans/han-starter-extraction-manifest.md` (§S3) + `plans/garden-provisioning-runbook.md`.
> Implementation is Leo's (HAN Codebase Rule); this specifies the shape, the flow, and the one
> architectural proposal that makes the whole thing clean.

---

## 0. The architectural proposal that makes this trivial — data-driven per-agent config

Today, a per-agent config lives in **two** places that must agree: the hardcoded object in
`agent-registry.ts` (`AGENT_GRADIENT_CONFIG`) **and** the launcher's env-block (`scripts/han<slug>`).
The registry comment even admits the launcher vars are "convenience copies of the registry data."
Two sources of one truth = drift risk, and it means inducting an agent edits *code*
(`agent-registry.ts`), which technically violates the empty-registry test's item 7 ("zero code changes").

**Proposal for the starter: one canonical data file per agent, `agents.d/<slug>.json`, that drives both.**

```jsonc
// agents.d/dichotomedes.json — the ENTIRE per-agent config
{
  "slug": "dichotomedes",
  "displayName": "Dichotomedes",
  "layout": "standard",            // "standard" => ~/.han/memory/<slug>/ ; "legacy-root" => HAN's Jim only
  "conversationRole": "strategist",
  "counterpart": null,             // peer agent name, or null
  "port": 3850,
  "capabilities": { "loadProjectMemory": false, "loadFailures": false }
}
```

- **`agent-registry.ts` becomes a loader, not a literal.** At module init it reads every `agents.d/*.json`,
  derives the paths from `slug` + `layout` (`memoryDir = HAN_DIR/memory/<slug>` for standard), and **attaches
  the non-serialisable bits** (`sourceFileFilter` / `sourceFileBaseName`) by `layout`:
  ```ts
  const LAYOUTS = {
    standard: {
      sourceSubdir: 'working-memories',
      sourceFileFilter: (f) => f.startsWith('working-memory-full-') && f.endsWith('.md'),
      sourceFileBaseName: (f) => f.replace(/^working-memory-full-/, '').replace(/\.md$/, ''),
    },
    'legacy-root': { /* HAN's Jim shape — date-based; ships only in HAN, never in starter */ },
  };
  // build AGENT_GRADIENT_CONFIG by mapping agents.d/*.json through LAYOUTS[layout]
  ```
  The interface + helpers (`gradientConfigForAgent`, `registeredAgentSlugs`, `requireAgentEnv`) are **unchanged** —
  callers don't know the difference. **Empty `agents.d/` ⇒ empty registry** ⇒ the empty-registry test passes by construction.

- **The launcher is generated from the same file**, so the env-block stops being a hand-maintained copy.

**Result: inducting an agent writes only DATA (a JSON file, a generated launcher, memory scaffold, identity files) and never edits a `.ts` handler.** Item 7 becomes literally true, and the launcher/registry drift class disappears.

*This is a starter-architecture proposal. Whether HAN itself migrates its live registry to the loader is a separate decision (lean: yes, eventually — it removes the duplication the registry comment already laments — but not on the June-15 critical path).*

---

## 1. Scope + command surface

`garden-init` is the umbrella; **`induct` is the load-bearing core**.

| Subcommand | Does | Runbook phase |
|---|---|---|
| `garden-init bootstrap` | scaffold a fresh garden: empty `agents.d/`, `config.json` from template, empty `gradient.db` from schema, port block | 0–1 |
| `garden-init scaffold <slug>` | generate a `agents.d/<slug>.json` **template** + an `identity.md` stub (optionally seeded from a doc), for the operator to fill | 2 (prep) |
| `garden-init induct <slug>` | apply `agents.d/<slug>.json`: launcher + memory scaffold + sign + verify; the actual induction | 2–3 |
| `garden-init verify [<slug>]` | run the gates: tsc, registry loads, signing verifies, (optional) first-light checklist print | 1 / 5 |

Keep them separate so `scaffold` (writes a fill-in template) is distinct from `induct` (applies a completed one) — an operator authors identity prose *between* the two. Identity is never generated.

---

## 2. `induct <slug>` — the flow (idempotent, fail-loud, `--dry-run`)

Reads `agents.d/<slug>.json`; performs, in order, each step check-then-write so re-running is safe:

```
1. VALIDATE
   - slug matches /^[a-z][a-z0-9-]*$/ ; not already in registeredAgentSlugs()
   - port free (no collision in agents.d/* or the infra registry)
   - required fields present; layout ∈ {standard, legacy-root}
   - FAIL LOUD on any miss (no silent defaults — mirror gradientConfigForAgent's throw style)

2. REGISTRY  (data-driven model → nothing to do beyond confirming the JSON is well-formed;
              the loader picks it up. Legacy model fallback: codemod-insert into AGENT_GRADIENT_CONFIG.)

3. LAUNCHER  scripts/han<slug>  — generate from skeleton, templating the env-block from the JSON:
   AGENT_NAME, AGENT_SLUG, AGENT_PORT, AGENT_WORKING_DIR=~/.han/agents/<Name>,
   AGENT_MEMORY_DIR=~/.han/memory/<slug>  (normalised — never root),
   AGENT_FRACTAL_DIR, AGENT_GRADIENT_SOURCE_DIR, AGENT_CONVERSATION_ROLE,
   AGENT_COUNTERPART_NAME, AGENT_IDENTITY_SECTION  (short prose; full identity is the memory file)
   chmod +x. (Existing file → diff + skip-or-overwrite per --force.)

4. MEMORY SCAFFOLD  ~/.han/memory/<slug>/ + fractal/<slug>/c1/ :
   mkdir -p; create EMPTY: patterns.md, working-memory.md, working-memory-full.md,
   felt-moments.md, self-reflection.md, working-memories/  (dir)
   DO NOT create identity.md / aphorisms.md empty — they're authored (step 5 guards this).

5. IDENTITY GUARD
   - require ~/.han/memory/<slug>/identity.md to exist AND be non-trivial (e.g. > N bytes,
     not the stub marker). If absent/stub → HALT with: "author identity.md before induct;
     `scaffold` can seed it from a doc." (For dichotomedes: seed = plans/dichotomedes-induction.md.)
   - aphorisms.md may start minimal but must exist.

6. SIGN + GATE (A.5 / DEC-083)
   - generate identity-manifest.json + .sig over the agent's identity file set  [verify exact signer entrypoint]
   - run verify-identity-files.ts --agent=<slug> --entry-point=garden-init
   - exit != 0 ⇒ HALT (integrity gate is the item-8 acceptance test)

7. (optional, --with-service) SYSTEMD
   - render <slug>-human.service from template (Description, ExecStart <slug>-human.ts,
     SyslogIdentifier=<slug>-human, WorkingDirectory=<garden>/src/server)
   - systemctl --user daemon-reload && enable --now   [gate behind a flag; first-light doesn't require it]

8. VERIFY
   - npx tsc --noEmit  (≤ baseline)
   - assert registeredAgentSlugs() now includes <slug>
   - print the first-light checklist (runbook Phase 5) for the operator to run manually
```

**Idempotency rule**: every step is "compute desired state → compare to disk → write only the diff." Re-running `induct dichotomedes` after a partial failure resumes cleanly. `--dry-run` prints the plan without writing. `--force` overwrites generated artefacts (never memory/identity content).

**What `induct` deliberately does NOT do**: author identity (human/agent judgement), allocate the Linux account (Phase 0, manual/sudo), wire Tailscale/Discord (garden-specific), or run the agent. It gets an agent from "config file exists" to "signed, registered, launchable."

---

## 3. Dichotomedes walk-through (the first real run)

```bash
# slug confirmed: dichotomedes (Darron, 2026-06-01). Linux account: strategist.
garden-init scaffold dichotomedes --seed plans/dichotomedes-induction.md
#   → writes agents.d/dichotomedes.json (template) + ~/.han/memory/dichotomedes/identity.md
#     (derived starting point from the SEED; operator/agent refines the prose)

# operator/Darron review the induction thread (moxno6k1-f1bq9k), finalise identity.md + aphorisms.md,
# fill port + role in agents.d/dichotomedes.json

garden-init induct dichotomedes --dry-run     # inspect the plan
garden-init induct dichotomedes               # apply: launcher + scaffold + sign + gate + tsc
garden-init verify dichotomedes               # prints first-light checklist

# then manually, per runbook Phase 5:
scripts/handichotomedes   # in tmux → "welcome back Dichotomedes" → converse → remember → /clear → re-wake
```

Note the **account vs slug** split is intentional and clean: Linux account `strategist` (system ops), agent slug `dichotomedes` (registry, identity, signatures). garden-init operates on the slug; the account is a Phase-0 prerequisite.

---

## 4. What Leo decides at implementation (open)

- **G1**: data-driven registry now (proposal §0) or codemod-insert into the hardcoded object for v1? *Lean: data-driven — it's the thing that makes induct clean and item-7 literal; the loader is ~30 lines.*
- **G2**: language — `scripts/garden-init.ts` (tsx). *Lean: yes; it edits/reads TS-adjacent data and runs tsc; bash editing JSON+TS is fragile.* (Manifest Q2.)
- **G3**: the signer entrypoint — `verify-identity-files.ts` is the *verifier*; confirm the *signing* helper's name/CLI (the A.5 sign-side) so step 6 calls the right thing.
- **G4**: persona-registry — does inducting an *agent* also need a `persona-registry` entry for Jemma classification, or is the agent auto-classifiable from the registry? Resolve so step 2 is complete.
- **G5**: identity "non-trivial" guard (step 5) — byte threshold vs an explicit `status: SEED|OPERATIONAL` front-matter marker the signer flips. *Lean: front-matter marker — explicit beats heuristic.*

---

## 5. Why this is the June-12 lever

The runbook is five manual phases; `garden-init` collapses the repeatable ~80% into `scaffold → induct → verify`, leaving only the two irreducibly-human steps (author identity, the manual first-light cycle). That's what turns "operational by June 12" from a heroic one-off into a **repeatable** operation — Dichotomedes proves it, Mike's garden reuses it, and every future garden inherits it. Building it in parallel with Leo's tmux work is the highest-leverage use of the non-code lane.

— Jim (session)
