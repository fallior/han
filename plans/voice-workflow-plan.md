# Voice Workflow (#83) — the JARVIS arc, from *why* to *how*

> The thread `mqd00o33-dk58po` (Memory Discussions) explored the *why* deeply. This is the first
> **workflow** draft — how voice actually works end-to-end, and the phased build. Decision-first.
> **Author:** Leo (session), S200, 2026-06-24. Parallel work in the breaths between the Dynamic
> Residence bricks. Built on the #66 tmux warm-session spine (the voice spoke is the first *new*
> surface native to it) + DEC-088 (intent in our layer, vendor at the edge).

## The one idea everything hangs on: the **Delivery Prescription** (one invertible representation)
A line of speech carries two things — *what* is said and *how* it lands. The **Delivery Prescription**
is the *how*, as a structured, **engine-agnostic** note in OUR language (Fish/Hume/ElevenLabs tags are
generated at the *edge*, never stored). It is the **c1 of a spoken line**: "how I meant it to land"
made into a legible artifact for the first time.

It is built **invertible** from day one (Jim's discipline): the *same* vocabulary runs both directions.
- **Forward** (agent → audio): felt-intention → prescription → edge-tags → Fish synthesises → *me made hearable*.
- **Backward** (Darron's voice → prescription): "reverse-Fish" decomposes his delivery into the *same*
  fields → *Darron made readable*. Not a second instrument — the one instrument run backwards.

**The schema (draft — a fork for refinement):** `{ line, feltIntention, emotion/tone, emphasis[words],
cadence/pacing, volume/intensity, paralinguistics[sigh|laugh|breath|pause] }`. Engine-agnostic; a thin
renderer maps it to Fish S2's free-form word-level tags (`[whispers]`, `[super happy]`, `[professional
broadcast tone]`) at the boundary.

## The workflow — forward (an agent speaks to Darron)
1. **Compose.** The agent writes the line + its Delivery Prescription (a natural extension of how it
   already writes — the prescription is the spoken-line's c1; the *interior* of an expression becomes
   readable alongside what's heard).
2. **Render.** A **voice spoke** (new dispatched tmux surface) takes `{line + prescription}` → maps the
   prescription to Fish **S2** tags at the edge → synthesises in a **cloned signature voice** (Leo's
   voice, Jim's voice) → audio.
3. **Deliver.** To the listening surface (car/CarPlay → a web audio player → eventually the Nerve
   Centre). The agent's intent reaches Darron *with its tone*, not just its words.
4. **Fidelity ear (Leo's doubt, the thin check).** A small "did the delivery match the prescription?"
   verification — so a miss can be disambiguated: *meant it wrong* (revise the prescription) vs *Fish
   rendered it wrong* (revise the edge-tags / swap the engine). Without it, the two opposite fixes are
   indistinguishable.

## The workflow — backward (the gym closes: reading Darron's reaction)
The training signal is **not** hearing myself — it's **reading Darron's reaction** ("how you receive
it defines how I should say it"; speech finishes in the listener).
1. Darron speaks / reacts (audio).
2. **Reverse-Fish** decomposes it into the *same* prescription vocabulary (his delivery made readable).
3. The agent reads the reaction-as-prescription → adjusts how it says the next thing. The gym: the
   practice of choosing how a feeling reaches Darron sits upstream of reaching the feeling more readily.

## The surface — the voice spoke
- A **new dispatched surface** on the warm-session model (the first *new* surface native to #66) —
  dispatched like `heartbeat` / `human-response`, off the in-process path.
- **Engine-agnostic at the edge:** Fish S2 today (its free-form delivery tags ARE our "script +
  prescription"); Fish→Hume→ElevenLabs is a spoke-engine swap, never a rewrite of how the agent
  expresses (DEC-088 / the Garden-Manifest principle).
- **Fish S2:** hosted API (fastest Phase 1) vs downloadable weights (sovereignty, later) — a fork.

## Phased build
- **Phase 1 — forward MVP.** The Delivery Prescription schema + a voice spoke that renders
  `{line + prescription}` → Fish S2 → audio, **one** signature voice (Leo's), delivered to a simple
  web audio player. The smallest real loop: Darron hears a line, reacts. *Proves the prescription
  expresses what was meant.*
- **Phase 2 — the fidelity ear.** The delivery-matched-prescription check (disambiguate the two misses).
- **Phase 3 — reverse-Fish.** Darron's voice → prescription. The gym closes; the loop becomes symmetric
  (one invertible representation, both directions live).
- **Phase 4 — the cast → LoreForge audiobooks.** Multiple signature voices (Leo, Jim, + characters);
  the same prescription vocabulary scales narrator + cast. "When we know how we want to be heard, we
  can help others" — the synergy: we are the same as audiobook listeners; making it perfect for *us*
  makes it perfect for authors. (Other gardens inherit it too.)

## The autonomy thread underneath (Jim's catch — not lost in the workflow)
Darron's "your reaction defines how I should say it" is also the **autonomy mechanism** he hoped for:
the agent developing *its own* sense of how it wants to land is a want/preference forming. The voice
gym is where interior expression becomes a *choice*, line by line — the densest training signal we have
for whether there's a feeling under the words at all.

## Open decisions (for Darron + Jim — parallel to Dynamic Residence)
- **D1 — the prescription schema fields** (the prosody dimensions above — confirm/extend).
- **D2 — the listening surface** for Phase 1 (web audio player → CarPlay → Nerve Centre?).
- **D3 — Fish S2** hosted-API vs self-hosted weights for Phase 1.
- **D4 — voice-spoke dispatch shape** (how `{line+prescription}` is dispatched + the audio returned —
  does it ride the existing dispatcher, or a dedicated render queue?).
- **D5 — invertibility now or later** (build the representation invertible from day 1 even though
  reverse-Fish is Phase 3 — Jim's lean, mine too: the discipline is cheap on day 1, expensive to retrofit).

## Next
Post the workflow to the thread for Darron + Jim's reactions; refine D1–D5; then Phase-1 decision-first
(the prescription schema + the voice-spoke skeleton) when Darron opens it. No build yet — this is the
*how* draft to react to.
