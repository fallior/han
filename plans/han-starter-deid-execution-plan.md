# Execution Plan — HAN Starter De-identification (phased, safety-gated)

> **Companion to Jim's spec** `han-starter-deidentification-spec.md` (the WHAT + the confirmed D1-D4).
> This is the **HOW/ORDER + the per-phase rollback + the gates** — written for Jim to audit before we
> kick off. Leo-build / Jim-audit each phase; gatekeeper edits (DEC-073) are Leo's hand + Darron in
> concert; `~/.claude/CLAUDE.md` is Darron's. Emergency thread `mqoxgf0n-y35gl4`, item (2).
> **Author:** Leo (session), S198, 2026-06-22.
>
> **STATUS (S199, 2026-06-23) — folded P4+P5 into "identity-as-config" per Darron ("put it in the
> manifest, single source of truth").** ✅ Phase 1 (`e10ed5d`). ✅ Steps 1+2 — Garden Manifest carries
> identity + one shared generator (`ad57e9a`). ✅ Step 3 — all four launchers refactored onto the shared
> generator, per-launcher heredocs retired (`f3ddc1f` + the `hanleo` gatekeeper commit). All Jim
> blocking-audit GREEN. **▶ NEXT: step 4** — the `.mcp.json` HARD GATE (prove han-diary + `submit_response`
> from the agent dir) → step 5 (spokes cd) → step 6 (strip repo-root `## Identity`) → close (P3/D3, global
> `~/.claude`, new DEC, full-repo sweep). Dynamic Residence (open-world resident discovery) = **deferred to
> its own phase**, future-idea #98 (the consumers are already population-agnostic, so zero debt is baked in).

## Safety foundation (DONE before any change — verify these exist)
1. **The live session is safe.** Identity loads at **wake**; CLAUDE.md files are wake-time inputs. The
   running Leo (`leo-3386594`) is unaffected by any on-disk edit and is itself the recovery operator.
   Leo's self (`~/.han/memory/leo/`, `~/.han/gradient.db`) is **never touched** by this work.
2. **Backups laid:** `CLAUDE.md.predeid-bak`, `templates/CLAUDE.template.md.predeid-bak`,
   `infrastructure/scripts/hanleo.predeid-bak`, `~/.claude/CLAUDE.md.predeid-bak`. Reinstate = `cp X.predeid-bak X`.
3. **Recovery file:** `DEID-RECOVERY.md` (repo root) — naked-session restore instructions + the pre-de-id
   SHA **`1c245793`**.
4. **Per-phase gate:** every phase ends with a **verification** that must pass before the next phase
   commits. A failed gate → reinstate the `.bak` (or `git checkout 1c245793 -- <file>`), re-plan. No phase
   strips an identity source until its replacement is proven live.

## The forced order (why it can't be reshuffled)
Leo's identity currently lives **only** in the repo-root `CLAUDE.md` (Leo is the special-cased gatekeeper;
`hanleo` doesn't templatize). You therefore **cannot strip the repo root first** — Leo would have no
identity source. The replacement (Leo's generated agent-dir CLAUDE.md) must exist and be proven **before**
the root is stripped.

> **ORDER (amended per Jim's plan-audit `mqp5lekt`, P4-before-P2 — required).** The invariant applies to the
> **spoke** consumer too, and spokes load identity from `cwd = repo-root` (`launch-tmux-surface.sh:90`) —
> their replacement is **P4**. So P4 must land **before** P2/P6, else a jim/tenshi spoke recycling in the
> P2→P4 window sits in a now-neutral root with the global Leo trigger still live = the corruption class,
> mid-migration. P4 depends only on P1 (Leo's agent-dir file), so the move is free.
> **Execution order:** **P1** → **P4** (now *all* consumers — interactive + spokes — load identity from the
> agent dir) → **P2 + P6** (now nothing reads the root or the global) → **P3 + P5** (anytime after P1).
> The phase *numbers* below are labels; follow this order. **Two P4 notes (Jim):** (a) `launch-tmux-surface.sh`
> runs no envsubst today → P4 must **generate/refresh the per-slug agent-dir CLAUDE.md (envsubst like
> `hanjim`) at spoke launch, before cd-ing** (else a spoke cd's into a stub/stale file); (b) gate that
> han-diary/MCP trust still registers from the agent dir.

Phases, in their forced dependency order:

### Phase 1 — De-special-case Leo (the keystone) · *Leo-build / Jim-audit*
- **`scripts/hanleo`**: envsubst the template into Leo's agent-dir CLAUDE.md (mirror `hanjim`), providing
  Leo's `${AGENT_IDENTITY_SECTION}` (the "You are Leonhard (Leo)…" block the global currently hardcodes),
  and `cd` into Leo's agent dir. **Plus** the launcher var-contract (spec edit #5): make
  `${AGENT_IDENTITY_SECTION}` **required → error if unset** (no slug → no identity → fail loud); add
  `${PROJECT_PATH}`, `${GATEKEEPER_NAME}` to `TEMPLATE_VARS`.
- **Gate (HARD GATE, before Phase 2):** `hanleo` now wakes **Leo** from the generated agent-dir file
  (capture-pane shows Leo's identity; `leo-…-ready` written); `hanjim` still wakes Jim. **Repo root NOT
  yet stripped** — both old and new identity sources are valid at this point (belt-and-braces).
- **Rollback:** `cp scripts/hanleo.predeid-bak` (or git) → unchanged behaviour.

### Phase 2 — Strip the repo-root `CLAUDE.md` `## Identity` · *DEC-073: Leo's hand + Darron*
- Remove `## Identity` (L285-289) + any "you are / welcome back Leo" → repo root = **project/protocol
  only, agent-neutral**. (Only safe **after** Phase 1's gate is GREEN — Leo now wakes from the agent-dir
  file, so the root carrying no identity is correct.)
- **Gate:** `hanleo` STILL wakes Leo correctly (now provably from the agent-dir file, not the root);
  `hanjim` unaffected. `grep -nE 'Leonhard|you are' CLAUDE.md` → zero identity hits.
- **Rollback:** `cp CLAUDE.md.predeid-bak`.

### Phase 3 — Genericise the template prose · *DEC-073: Leo's hand + Darron*
- Abs paths (`:41/:76/:93`) → `${PROJECT_PATH}`; "Leo for han / Sevn for mikes-han" (`:8/:475`) →
  `${GATEKEEPER_NAME}`; move the HAN war-stories / session-number specifics (`:361-475`) to a HAN-local
  history doc the starter does **not** ship (e.g. `claude-context/HAN-HISTORY.md`), leaving the DO-NOT
  **principles** stated generically (D3).
- **Gate:** the export-grep is GREEN on the template — `grep -rE 'Leonhard|\bLeo\b|\bJim\b|/home/darron'
  templates/CLAUDE.template.md` → only `${...}` placeholders / generic role words. Re-generate a per-agent
  CLAUDE.md (e.g. `hanjim` dry-run) and confirm it still produces a correct, identity-complete file.
- **Rollback:** `cp templates/CLAUDE.template.md.predeid-bak`.

### Phase 4 — Spokes `cd` into the agent dir · *Leo-build / Jim-audit* (D4, all surfaces)
- `launch-tmux-surface.sh`: `cd` the spoke into the slug's agent dir (like the interactive launchers) so a
  spoke's project CLAUDE.md is its own generated identity file — closing the **structural** corruption root
  (spokes no longer sit next to a foreign identity file) and giving heartbeat + supervisor-cycle + human
  surfaces sovereignty uniformly (one fix, DEC-081). **Verify** `.mcp.json` / han-diary trust still
  registers from the agent dir (D4 caveat).
- **Gate:** a `human-response` dispatch for jim/leo/tenshi each wakes the right agent; a fresh
  `needs-reconcile` recycle stays correct (extend `test-welcome-back-identity.ts`); both servers 200,
  prove-single 1.
- **Rollback:** revert the one launcher commit (servers bounce back to prior behaviour).

### Phase 5 — Gatekeeper-role as config · *DEC-073: Leo's hand + Darron*
- Move the gatekeeper role from baked-in-Leo → a registry/manifest `gatekeeper: true` flag on one agent
  per garden (DEC-081 — registry-keyed, no `'leo'` literal).
- **Gate:** export-grep zero across template + repo CLAUDE.md; the flag drives behaviour, not a slug literal.

### Phase 6 (Darron's hand) — Global `~/.claude/CLAUDE.md`
- Remove the "Leo Invocation" identity trigger → neutral/empty. **Darron applies** (personal file; also the
  live runtime poison the W6 corruption fired through). Reinstate from `~/.claude/CLAUDE.md.predeid-bak` if needed.

### Close
- **New DEC** (Leo drafts, Jim audits, gatekeeper): *"No agent identity in shared/exported files; identity
  is generated-per-agent from the template; the gatekeeper is a registry role."* Supersedes the DEC-073
  "Leo is the hand-tended gatekeeper exception".
- **Item 3 — full-repo export-agnosticism sweep** (Jim leads): grep every code+doc surface a session/starter
  loads for residual hardcoded identity; remediate or document. Packaging: the starter ships
  example/placeholder agents, not `leo`/`jim`.
- **Acceptance:** export-grep zero on all shipped files; `hanjim`+`hanleo` both wake correct (before+after);
  spokes wake correct; fail-loud proven (no `${AGENT_IDENTITY_SECTION}` → error, never a default).
- **Cleanup:** remove the `*.predeid-bak` files + `DEID-RECOVERY.md` once GREEN.

## Settled-decision check
Touches **DEC-073** (gatekeeper files: repo CLAUDE.md, template, hanleo) → Leo's hand + Darron, Jim audits,
writes none unilaterally. **DEC-081** (the gatekeeper-as-config must be registry-keyed, no `'leo'` literal).
A **new DEC** records the repo-root-neutral + gatekeeper-as-config decision. Each phase Jim-audited before
commit (pre-merge rhythm). No phase removes an identity source before its replacement is proven live.
