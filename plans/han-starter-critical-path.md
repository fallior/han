# HAN-starter — critical path to Mike's garden (current-state + sequencing)

> **Jim, 2026-06-15 (S174).** A current-state + critical-path UPDATE over the existing scoping (which is solid and stands): `han-starter-extraction-manifest.md` + `garden-init-sketch.md` + `garden-provisioning-runbook.md` (all Jim, 2026-06-01). Purpose: connect today's work (the agnosticism scour) to the starter to Mike's HAN, and name the single gate.

## The realization that ties it together

**The agnosticism scour and the HAN-starter are the same work seen from two angles.** The starter's completion signal is the **empty-registry test, item 7**: *"adding one agent = registry entry + persona entry + identity files + launcher env — ZERO code changes."* That is true **iff** no shared-infra surface hardcodes a finite agent list — which is *exactly* what the scour removes. The extraction manifest's §3 pre-extraction gate grep **is** the scour's acceptance grep. So: **finish the scour → the empty-registry test passes → extraction is unblocked.** De-agentification is not a separate project *before* the starter; it is the starter's **precondition**, and the same grep proves both done.

## What changed since the 06-01 scoping (the unblocks)

- ✅ **Transport: DONE.** The manifest's one real cross-dependency — *"the starter should ship on the tmux transport, not the SDK, so gardens born from it are sustainable past 2026-06-15"* (S5 ↔ tmux T-3) — is now satisfied: the tmux migration landed (heartbeat + humans + the supervisor cycle all off the SDK). Gardens forked from the starter are sustainable **by construction**.
- ✅ **The scour is indexed + sequenced** (`agnosticism-scour-index.md` — two independent angles + the locked safe build order). Most of DEC-081 is already absorbed; the remaining debt is the two worker files + the coordination/liveness layer (the resurrection mesh + antiphase scheduler).
- ➡️ **`garden-init` (agents.d/&lt;slug&gt;.json)** — the sketch's load-bearing proposal (one canonical per-agent data file driving *both* the registry and the launcher, killing the two-sources-of-truth drift and structurally satisfying item 7) — **not built yet** (sequence step S3).

## The critical path (sequential; the gate is the scour)

1. **Finish the agnosticism scour** (de-agentification). Phase 0 converge (Leo's independent cold pass) → Phase 1 safe shared-infra PRs → Phase 2 liveness layer (fenced) → Phase 3 the collapse. **Acceptance = the manifest §3 grep / the scour's acceptance grep passes** (= empty-registry item 7 becomes structurally true). *[The scour sequence is locked in `agnosticism-scour-index.md`.]*
2. **Build `garden-init`** (S3 — the induction pipeline): `agents.d/&lt;slug&gt;.json` → registry entry + persona entry + memory scaffold + identity-signing; the **normalised `~/.han/memory/&lt;slug&gt;/` layout** (no Jim-root exception — #36 Option D, realised at the seed). The load-bearing starter step; it doubles as the runbook's automation.
3. **Extract the starter** (S1→S6: scaffold + empty registries → empty-boot → `garden-init` → signing → templated infra → starter docs). Leo-build / Jim-audit, per the manifest. Fresh repo, no HAN history (Q4 lean).
4. **Provision Mike's HAN** from the starter — the runbook's worked example, but Mike's garden on the linux box. = *"Mike's HAN started."*

## Where it sits vs the lunch goal (de-agent → HAN-starter → Mike's HAN)

- **De-agentification**: indexed + sequenced (Jim's side done); implementation = Leo-build (Phase 1 can start once Leo's pass converges).
- **HAN-starter**: *scoped* (06-01, solid) + the transport precondition now met; gated on the scour + `garden-init`. The heavy thinking is already done.
- **Mike's HAN**: downstream of extraction. "Started" realistically lands *after* the starter extracts. (`mike@.han/` already exists as a reference install; the goal is the clean-seed provisioning that proves the starter.)

## Open decisions still standing (manifest Q1–Q4)

Q1 ship the full React admin (lean: full — it renders empty states already). Q2 `garden-init` as a TS script (lean: TS — it edits the TS registry). Q3 default persona set + override (lean: yes — a garden needs *a* classifier voice to boot). Q4 fresh repo vs `git filter-repo` (lean: fresh). Plus the **memory-layout normalisation** (every agent under `~/.han/memory/&lt;slug&gt;/`, no root exception) — must fix *at* extraction.

## The honest bottom line

HAN-starter is **further along than "not started"** — the hard scoping and the one real precondition (tmux transport) are done. The **single gate is finishing the de-agentification scour**; everything the scour clears is what makes the empty-registry test pass, and that test is the starter's done-signal. **The scour and the starter are one critical path.** Build `garden-init`, extract, and Mike's garden is the reward at the end of it.
