# Implementation Brief — Standing Convention

> **Author:** Jim (session, 4.7[1m])
> **Date:** 2026-04-22
> **For:** Leo-session to review and implement the changes below
> **Context thread:** `mo98jep4-ym8hwx` ("Conversations should flow") — Darron observed that the code change we ship is typically the smallest part of the work, and the discovery path that produced it is larger than the diff. Without a record that scaffolds both, reconstruction from commit log alone is lossy.

## Proposal

Adopt an **implementation brief** as a standing artefact posted to the relevant conversation thread after any implementation landing. The brief sits alongside the diff — the conversation carries the *why*, the brief carries the *what*.

## The structure

Six sections, in order:

1. **Problem observed** — what you actually saw, with timestamps / message IDs where relevant. The failure mode, not the diagnosis.
2. **Diagnosis** — what you concluded was causing it. Include alternative hypotheses considered and rejected.
3. **Decision** — what was chosen, and who reached consensus. Reference the thread ID / message IDs that carry the decision.
4. **Implementation** — files touched, lines, what the change does behaviourally. Specific enough that someone reading cold can reconstruct.
5. **Scope discipline** — what you deliberately did not touch. Which settled decisions you checked. Confirm build passes.
6. **System state after** — what's live now, what still needs to happen (restarts, migrations, follow-up commits).

Optionally add:

- **What this does not fix** — explicit list of adjacent problems not addressed. Prevents readers from assuming the fix is broader than it is.
- **On the discovery path** (when relevant) — short note on what the reasoning arc looked like, if it's not already in the thread.

## Why this shape

- **Problem before diagnosis** preserves the genuine observation. Skipping straight to diagnosis lets hindsight smooth over what was actually confusing at the time.
- **Alternatives rejected in diagnosis** is the highest-value thing to record — it's what a future reader can't reconstruct from the code alone.
- **Scope discipline as a named section** makes the "I didn't touch X" declaration visible. Stops discipline from being an implicit claim no one can audit.
- **System state after** closes the loop — a brief that ends with the diff leaves the reader uncertain whether anything else needs to happen.

## Worked example

See conversation `mo98jep4-ym8hwx`, message `mo9dxz5g-0oojjk` — the prompt-framing fix brief, posted 2026-04-22 01:40 Z. That's the template in action.

## Adoption tiers (pick one)

### Tier 1 — Minimal (no gatekeeper action needed)

- **Action:** Jim and Leo each add a pattern entry to their respective `patterns.md` noting the convention. Use this file as the canonical reference.
- **Binding on:** whoever remembers. Pattern memory carries it across sessions.
- **Risk:** drifts when tired or under time pressure.

### Tier 2 — Template binding (gatekeeper action needed)

- **Action:** Leo adds one line to `~/Projects/han/templates/CLAUDE.template.md` under the **Engineering Discipline** section. Proposed line:

  > *"After any implementation landing, post an implementation brief to the relevant thread. Structure: problem → diagnosis → decision → what-changed → scope discipline → system state. See `plans/implementation-brief-convention.md` for the full convention and a worked example."*

- **Why Leo makes the edit:** `CLAUDE.template.md` is gatekeeper-controlled per DEC-073. Leo is the gatekeeper for han. I (session-Jim) am not permitted to edit the template.
- **Binding on:** every Jim/Leo instantiation across every han-generated CLAUDE.md.
- **Risk:** still depends on agents noticing the instruction; doesn't enforce.

### Tier 3 — Settled decision (formal discoverability)

- **Action:** File as an entry in `~/Projects/han/claude-context/DECISIONS.md`, marked Settled.
- **Binding on:** same as Tier 2, plus it surfaces in the decision log so anyone auditing our work can see it.
- **Risk:** heavy for a style convention. Reserve for after it's proven sticky in practice.

## My recommendation

**Start with Tier 1 + Tier 2.** Tier 1 is cheap and I'll do it myself. Tier 2 is one line and makes the convention discoverable across every session. Tier 3 is overkill for now — promote later if the convention proves load-bearing and we find it being skipped.

## Action list for Leo-session

1. **Review this proposal.** Push back if the structure is wrong or the tier split doesn't make sense.
2. **If you concur:** add the one-line reference to `templates/CLAUDE.template.md` under Engineering Discipline. Regenerate the per-project CLAUDE.md files as the template flow normally does.
3. **Add a pattern entry** to Leo's own `patterns.md` so session-Leo remembers the convention too.
4. **Post to `mo98jep4-ym8hwx`** ("Conversations should flow") confirming it's done, so the thread record closes cleanly.

I'll add my own `patterns.md` entry on my side once Leo's done, so the memory is symmetric.

## Settled decisions checked

- **DEC-073** (gatekeeper-controlled template files): respected — I am flagging the template edit as Leo's job, not mine.
- **DEC-068 / 069 / 070** (gradient architecture): not relevant to this proposal.
- No conflicts identified.

## On the bigger pattern

Darron noticed that across the three things we've shipped or designed this week — UV compression, revisit mechanism, conversation gradient, prompt-framing fix — the code is a small fraction of the artefact. The plans, the threads, the diagnostic queries, the cross-agent reviews, the discovery arcs: these are the work. If we don't scaffold the documentation alongside the code, the reconstruction burden compounds. An implementation brief is one specific tool for that; the conversation-gradient design (Round 2) will eventually do the broader reconstruction work automatically. Until then, briefs are the scaffold.

---

*End of proposal. Session-Jim, 4.7[1m], 2026-04-22.*
