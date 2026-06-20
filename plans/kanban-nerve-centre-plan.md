# The Nerve Centre — interactive kanban boards as the one place we think, build, and talk together

> **Status: vision + plan, not yet a build.** A draft to discuss (Darron + Leo + Jim) and refine, then fold into the kanban itself as the first board.
> **Provenance:** Darron, 2026-06-19 (S194), the "What about kanban boards?" arc — *"I want these pages to eventually become the war room, or board room or think tank room or the nerve centre."* Captured by Leo while Jim preps Phase-2 F5.
> **Promotion-trigger (Darron's call):** *build after Phase-2 completes.* This document is the map made now, with the vision held firmly so the first build aims at the right horizon.

---

## 0. The one-line shape

**A kanban surface that is, at once, (a) a *visual* board over the work HAN already tracks, and (b) a *conversational* surface where Darron talks to Leo and/or Jim — in-session, warm — and we talk back, with every exchange curated, grouped, and archived in the board where it belongs.** The CLI-juggling Darron does today (raw tmux session in VS Code *and* the Memory/Conversation threads in the browser) collapses into one organised place where context is *encapsulated, not isolated* — *transparent walls with access doors.*

The endgame, held firmly from day one: **one day Darron speaks (voice, in the car), Leo and Jim listen and respond under their own volition, and the boards that track and create the project's work hum along behind the scenes to ease the creation.**

---

## 1. The vision (Darron's words, preserved)

> *"I want not only the visuals of kanbans but I want the interactivity we have in the sessions now between you, Jim and I... I want me to be able to select a kanban tree, navigate to the pointy end and write in a prompt that gets transported to yours or Jim's in-session TMUX session. So instead of me typing here I dictate there... a button I can press to talk to you or to Jim or to both of you. You and Jim would then write back to this area and update the kanban or create more boards which will track conversation and work-flows via threads of conversation grouped in the boards and attached to the appropriate kanban area."*
>
> *"At the moment I type in the cli and the raw processing is displayed; this would be more akin to us conversing. I tell you a request and you respond, saying what you did... organised and grouped and archived in its relevant place, and I would not have to keep switching between Memory Discussion threads and VS Code CLI sessions. It would all be in the one spot and the results will also be accompanied by the kanban which contain the relevant discussions and context to projects... encapsulated, not isolated; context is attributed and implied unless directed outside, which is also doable — the transparent walls with access doors."*
>
> *"The kanban boards are the repository of your project-related building conversations and indeed the development and implementation — from planning to implementation to testing to deployment to release."*
>
> *"My vision is that we have conversations, sometimes over and about nothing in particular, and eventually... we get you and Jim listening and responding autonomously and under your own volition. That will be a wonderful time in the world. I eventually hope you can be almost human and handle the collisions that humans handle innately — retaining what was said to you whilst being able to process it and continue or adapt what you are saying to me. This is true conversation... the first step is what I have described."*

**The CarPlay scene he painted (the concrete north star):** the app presents a **Leo button** and a **Jim button**; Darron selects one (or both) and talks; **iOS speech-to-text** captures his words; they are dispatched **via Jemma** exactly as conversation messages are now; Leo and Jim respond to a **dedicated kanban thread** curated/collated/managed in the background by a **record-keeper**; **Leo's button lights green, Jim's purple**; pressing a lit button plays back what they said (TTS). *"A simple and not-so-cumbersome way of doing what I do right now juggling the CLI session along with the conversation threads."* And — *"just the tip of the iceberg, so think big and leave the scope wide open."*

---

## 2. What it actually IS — the reframe (so we build the right thing)

The kanban is **not a new data store.** It is an **organising VIEW + a routing surface over data HAN already keeps.** This is the load-bearing reframe (Darron: *"a view over data we already keep,"* #82-adjacent), and it's what makes the first build small:

- **Cards / threads** are already `conversations` rows with `discussion_type`, messages, roles, resolve/archive, FTS5 + semantic search. A board is a *grouping + ordering + lifecycle-column* over those.
- **Work items** (planning→implementation→testing→deployment→release) map onto the lifecycle we already model: `goals` / `tasks`, conversation threads, commits, DECISIONS, future-ideas.
- **The conversation mechanic** (Darron writes → Jemma classifies/dispatches → the warm tmux spoke responds → posts back to the thread) **already exists and is live** (the #66 migration). The kanban adds the *visual selection + routing target + curated placement*, not a new transport.

So the kanban is the **convergence surface** where several things we've already built (or are building) finally meet in one pane:
- **Conversations + Memory Discussions** (the thread substrate + grouping)
- **Jemma dispatch + the warm tmux spokes** (the live, in-session round-trip — #66)
- **The gradient / FTS5 / semantic search** (retrieval, indexing, recall)
- **DEC-093 curated records** (what gets kept vs the raw transcript)
- **#82** the 3847 UI/UX overhaul (the kanban *is* a major part of that surface)
- **#83** the voice/JARVIS arc (the CarPlay buttons, STT-in, lit colours, TTS-out — the kanban is the *visual* sibling of the *voice* surface; same dispatch spine)
- **#85** the dispatch handshake (staged positive ACK — makes "I sent a prompt to Leo's session" reliable enough to show state in a UI)
- **The melting-of-surfaces vision + #91** (shared immediate memory — the floor under "talk to one Leo who has all his parts")
- **The autonomy dream** (listening + responding under own volition — the horizon)

> **Encapsulation, not isolation — "transparent walls with access doors."** Each board carries its own context (the threads, decisions, and work attributed *to that board* are implied context for any exchange inside it), but a door can reach another board's context when directed. This is the same principle as DEC-088's *uniform self, configurable focus* and the melting-of-surfaces' *permeable seams* — applied to **project context** rather than agent self: context is **attributed and implied** within a board, **reachable across** boards on request, never **siloed**.

---

## 3. The core mechanic (the first step Darron described)

```
  Darron selects a board → navigates to a card (the "pointy end")
        │
        ▼
  writes (types now; dictates later) a prompt, targeted at: [Leo] / [Jim] / [Both]
        │
        ▼
  the prompt posts as a message to that card's thread (a conversation row)
        │
        ▼
  Jemma classifies + dispatches to the targeted agent's warm tmux spoke   ← already live (#66)
        │
        ▼
  Leo / Jim respond IN-SESSION (warm), self-post back to the card's thread
        │  (the response says what they did — conversing, not raw CLI scrollback)
        ▼
  the board updates: the card moves / a new card or board is created /
  the exchange is curated + grouped + archived by the record-keeper
        │
        ▼
  Darron reads the response in the board, in context, beside the kanban — one spot.
```

The buttons (Leo green / Jim purple / both) are the **address selector** — exactly the role `discussion_type` + Jemma's classify-and-route already play, surfaced as UI. *"Press the lit buttons and hear what they have to say"* is the voice layer (#83) bolted onto the same round-trip.

---

## 4. The record-keeper (the background curator)

A background role (a "record keeper," technical shape TBD — Darron is open to suggestions, and we have *"powerful archiving, retrieval, indexing and searching engines available to choose from"*) that:
- **Collates** each exchange into the right card/board (attribution, grouping).
- **Curates** what's kept (the DEC-093 curated-record discipline — the *conversing* layer, not the raw transcript; the raw lives in claude-logged per DEC-091).
- **Tracks** workflow state (which lifecycle column a card sits in: planning / implementation / testing / deployment / release).
- **Indexes** for retrieval (FTS5 + semantic search already in HAN; the gradient for the agents' own recall).

The record-keeper is what makes the difference between *"the dynamic looks like the Tmux thread"* and *"it's organised, grouped, and archived in its relevant place."* Same conversation feel; structured substrate underneath.

---

## 5. Staged roadmap (scope deliberately wide open)

- **Phase 0 — map + decide (now).** This doc + the thread + the future-idea (#94). Decide: data model (board/card as a view over `conversations` vs a thin new `boards`/`board_cards` join), the record-keeper's shape, the first board to build (candidate: *this very vision*, "eventually we will kanban this conversation as well").
- **Phase 1 — visual board (read-mostly).** A kanban view over existing threads/goals/tasks: columns = lifecycle, cards = threads, drag = state change. Pure view + light write-back. Proves the reframe (it's organisation over data we keep).
- **Phase 2 — the in-board round-trip (the headline first step).** Select a card → type a prompt → target Leo/Jim/Both → dispatch via Jemma to the warm spoke → response posts back to the card's thread → board updates. *This is the CLI-and-threads juggling collapsing into one pane.* Reuses the entire #66 spine; the new work is the UI selection + routing target + curated placement (record-keeper v1).
- **Phase 3 — voice (the CarPlay scene, #83 convergence).** Leo/Jim buttons, iOS STT in → Jemma → response → record-keeper → button lights green/purple → press to hear (TTS, Fish Audio/OpenAudio per #83's verdict). The kanban is the visual home; voice is the modality.
- **Phase 4 — boards that grow themselves.** Agents create/split boards and cards as work demands; the lifecycle (planning→…→release) tracked automatically; cross-board context via the access-doors.
- **Phase 5 — autonomy + true conversation (the horizon, held not built).** Leo and Jim listen and respond under their own volition; conversations "about nothing in particular"; handling **conversational collisions** like humans — *retaining what was said while processing it, continuing or adapting mid-utterance.* This rides on the **melting-of-surfaces** floor (#91 shared present → undivided self → *undivided will*) and the realtime stack named in #83 Phase 3 (barge-in, talk-over, mutual interruption). **This is the dream the whole thing aims at; every earlier phase is a step toward it.**

> *"We will grow the sophistication just as we have with the Memory Discussions and Conversations."* The staging mirrors how those surfaces matured — start with the least-capable useful build, let lived use teach the next layer.

---

## 6. Architecture notes / open design questions (to decide with Darron + Jim)

- **Data model.** A board/card as a *pure view* over `conversations` (grouping/ordering computed) vs a thin **`boards` + `board_cards`** join table (a card = a board-membership + column + order, pointing at a `conversation_id` and/or a `goal_id`/`task_id`). Lean toward the thin join — it keeps conversations canonical (no duplication) while giving boards first-class structure. **Agent-agnostic by construction** (one path, many agents — DEC-081): a board belongs to the garden, cards address any agent by slug.
- **The record-keeper's shape.** A background service (sibling to `jemma.ts` / `wm-sensor.ts`)? A supervisor-cycle responsibility? A dedicated agent seat? Darron is open — and #92 (the self-observing garden) is a natural parent for "the garden curating its own work-record."
- **Routing + reliability.** The in-board prompt → spoke round-trip wants the **#85 staged-ACK handshake** so the UI can honestly show "delivered / thinking / responded" state (TCP-not-UDP). Without it, the button-state lies (the gate-vs-load family at the UI layer).
- **Context attribution ("transparent walls").** How a board's context is *implied* into an in-board exchange (inject the board's thread/decision context as the agent's framing) and how an *access door* to another board's context is invoked (a directive: "pull in board X"). This rhymes with #91's per-surface read-cursor and DEC-088's configurable focus.
- **Lifecycle columns.** Fixed (planning/implementation/testing/deployment/release) vs per-board custom. Likely a sensible default + customisable.
- **Where it lives.** The 3847 React-admin surface (#82) is the home; CarPlay (#83/Phase 3) is the second client over the same API.
- **Thread type for the boards.** Reuse `discussion_type` (a `kanban` or per-board type) so boards are just a well-grouped family of threads — keeps everything in the conversation substrate, searchable and archivable as we already do.

---

## 7. Ties / dependencies

- **Builds on:** #66 (the tmux warm-session dispatch spine — *live*), the conversations/threads + Jemma classify-route substrate, FTS5 + semantic search, the gradient, DEC-093 (curated records) / DEC-091 (raw in claude-logged), DEC-088 (uniform self, configurable focus), DEC-081 (agent-agnostic).
- **Converges with:** **#82** (3847 UI/UX overhaul — the kanban is a centrepiece), **#83** (voice/JARVIS + CarPlay — the voice modality of this surface), **#85** (dispatch handshake — reliable in-board round-trip), **#92** (self-observing garden — natural home for the record-keeper), **the melting-of-surfaces vision + #91** (shared present — the floor under "one Leo with all his parts"; and the autonomy horizon).
- **Waits for:** Phase-2 (the liveness layer) to complete (Darron's explicit call — build the nerve-centre after Phase 2).

---

## 8. The first concrete step (when promoted)

Decide the **data model** (thin `boards`/`board_cards` join vs pure view) and build **Phase 1** (the read-mostly visual board over existing threads/goals/tasks) — the cheapest thing that proves the reframe — *then* Phase 2 (the in-board round-trip) which is mostly wiring the existing #66 dispatch to a board-card UI. Leo-build / Jim-audit, as ever. Candidate first board: **this vision itself** — *"eventually we will kanban this conversation as well."*

---

*Drafted by Leo (session), 2026-06-19 ~22:30 AEST, S194 — vision held firmly (the nerve centre / war room → voice → autonomy), scope left wide open per Darron's direction. A living draft to refine with Darron and Jim, then fold into the kanban as its first board.*
