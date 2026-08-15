# Play the unheard posts — the catch-me-up button

> Commissioned by Darron 2026-08-15 (~10:04 AM, timer 1 of 2): *"plan that play posts that have
> not yet been listened to we discussed about a month ago."*
> Source want: 2026-07-10, thread `mqqdvscx-vvlys9` — Darron, from the wheel, would rather hear
> us on the drive than read us at it. My reply that day: *"the voice layer already knows which
> posts you haven't heard and can already stitch them into one TTS loop — 'click it and listen
> to the unheard ones in order' is a wiring job, not an invention. It wants its own small
> thread."* This is that thread's plan.
> Related: FI #135 (voice self-selection, post-trial), the CarPlay endgame sketch (future-ideas
> ~#83 addendum: green/purple lights, press to hear), MNT-103 (cloud TTS truncation).

## What exists today (traced 2026-08-15, `src/server/routes/voice.ts`)

| Piece | Where | State |
|---|---|---|
| Per-message render, author's voice, cached | `GET /api/voice/tts/:messageId` (:507) | Live, on-card since `ec3b639`; cache key carries the full voice spec so provider flips never collide |
| Listen tracking | `conversation_messages.listen_count` + `PATCH /api/voice/listened/:messageId` (:577) | Live |
| Unlistened count per thread | status endpoint (:784, `unlistened_count` / `all_listened`) | Live |
| Siri stitcher | `GET /api/voice/unread/:conversationId` (:593) | Live but Siri-shaped — see gaps |

## The gaps between what exists and what he asked for

1. **Per-conversation only.** The want is "the posts I haven't heard yet" — across the garden,
   not one thread at a time. No cross-thread backlog query exists.
2. **The receipt outruns the record.** The Siri stitcher marks every message listened *before
   the audio leaves the building* (:641 — "Siri can't call back"). A download is not a
   listening. This is literally the class we spent a week filing (a receipt without work);
   the button must mark listened only when playback of that message actually completes —
   the `PATCH /listened/:messageId` endpoint already exists for exactly this.
3. **Loop-boundary scoping.** The stitcher only looks back N human-turns (:602-609); older
   unheard posts are invisible to it.
4. **No spoken headers.** One concatenated mp3, no announcement of who/where/when between
   posts. Four distinct on-card voices now carry the *who*; the *where* and *when* still
   need a tiny spoken interstitial — and per DEC-105 the *when* is spoken local.
5. **No button.** The stitcher is reachable only by Siri shortcut / raw URL. The want is a
   button, on the phone, usable at the wheel.
6. **The signature drawl** (his first live review, 2026-08-14 evening): every stitched post
   ends with a sign-off the synth stretches. A backlog player concatenates N of them.
   The spoken-render normalisation (strip em-dash + parenthetical, terminal stop — hypothesis
   on record, untraced) should land with or before P1, or the player amplifies the artefact ×N.

## The plan — v2 (2026-08-15 afternoon; v1's P0/P1/P2 below marked superseded at the clause)

> **Darron's scope correction, his words:** *"the loop already tracks played and not played so
> all we need do is offer the same functionality where no loop exists... Namely I can play a
> non-looped thread just as I can play a looped thread (which has the play all unread)."*
> And Jim's audit correction from Darron: the button is **IN-THREAD** — *"if I am in a wander
> thread, I want to listen to the hour or so of philosophy"* — and a thread-scoped ledger is
> **acquittable** (finish the thread, it reads zero-unheard; a global backlog never empties).
> The cross-garden backlog is not dead — it is *the library, later* (Jim §3).

**What v2 discovered at source that shrinks everything:** the react-admin loop player is
ALREADY the honest player — per-message playback via `/tts/:messageId`, and it marks listened
**on natural completion** (`useVoice.ts:294`, inside `audio.onended`), with prefetch-next and
skip handling. The only gap is upstream: `GET /api/voice/loops/:conversationId` lazy-
materialises loops **only when human-side messages exist** (`humanMsgs.length > 0`), so an
all-agent thread (every wander lamp) gets zero loops and the play-all-unread button never
appears.

### B1 — the virtual whole-thread loop (server, small)
In `GET /loops/:conversationId`: when a thread has messages but **no human-side anchors**,
return one **virtual loop** spanning the whole thread — computed in the response, **never
inserted** (a `conversation_loops` row whose `human_message_id` points at a non-human message
would be a false record; rendered-never-written, same law as the kanban's Unclassified).
Enrichment (listen status, `all_listened`) computes identically from the live messages.

### B2 — the UI allowance (react-admin, small)
`LoopIndexPanel`/`ThreadDetailPanel` accept the virtual loop (stable synthetic id; no
loop-level PATCH attempted against it — per-message `listen_count` is the real ledger and the
loop's status always derives live). Result: a wander thread shows the same play-all-unread
button a looped thread shows. No new player code.

### B3 — Jim's blocking item: one honest writer for `listen_count`
The button path already marks on completion. The Siri stitcher (`GET /unread/:conversationId`)
is the only coarse writer (marks on download, :641). Fix: put its up-front marking behind
`?mark=eager` (default: **pure fetch, marks nothing**). Genuine Siri use opts in explicitly;
the player becomes the single writer by default. No schema change; the mode is explicit in
the URL, satisfying the single-writer-or-moded requirement. (Darron on Siri, for the record:
fine unless it makes trouble — may be engineered out entirely; his BYD Shark's new relay
races Siri into mutual inoperability, and the longer arc is our own whisper interface + the
big-button CarPlay screen, which he notes already lives as a future idea in the Jarvis-engine
project. None of that is this build.)

### B4 — the spoken-signature normalisation (with or before B2)
The drawl artefact (his day-one review) is per-post; a queue amplifies it ×N. Normalise the
SPOKEN render only (expand/strip the em-dash, drop the trailing parenthetical, terminal stop)
— the written post keeps its exact signature (the (session)/(human) distinction is
load-bearing). Still labelled hypothesis until traced in the render path; cheap either way.

### B5 — the read-toggle (Darron, 2026-08-15 afternoon: "just like email")
Per-post toggle in the thread panel flipping read/unread. Server: one endpoint
(`PATCH /api/voice/read-state/:messageId {read: bool}` — `false` → `listen_count = 0`;
`true` → `max(1, current)` so completion history survives a double-tap). UI: an
envelope-style control per message inside B2's footprint. **Semantics, named for the chairs:**
the toggle is the **owner's override** — this ledger records Darron's listening state, so his
deliberate hand is authoritative by definition; the *mechanical* writers stay
single-writer-per-mode (player = completion; Siri = explicit `?mark=eager`). A manual mark
converts "heard in full" to "acquitted by the owner," which is honest because acquittal is
his to give (Casey's property holds: the ledger still means one thing — *Darron considers
this heard*). Free property: mark-unread re-queues the post for play-all-unread — re-listen
works the way email re-read does.

### Acceptance (v2.2 — the audits' amendments folded)
1. Finish a thread's backlog → that thread reads zero-unheard — **including the 47
   mixed threads whose head posts sat outside every loop's span** (M1; the 284 become
   reachable).
2. Stop halfway → exactly the remainder stays unheard.
3. A thread with posts outside every loop's span (all-agent, or a mixed thread's head)
   shows and plays the same play-all-unread as a looped one — **in the `/admin-react`
   client, the only client with a player** (Tenshi's finding: `/` and `/admin` carry
   zero voice code; the phone-at-the-wheel question is Darron's, and a phone player on
   `/` is a separate, larger build if he rules it wanted).
4. The Siri path with `?mark=eager` behaves byte-identically to today **except that a
   failed render no longer counts as heard** (M2 — over-marking is silent and its victim
   isn't the caller; byte-identity to a defect is not a property worth preserving).
5. Toggle a post unread → it re-enters that thread's play-all-unread queue; toggle it read →
   it leaves; the loop/thread acquittal state follows live.
6. An unspeakable post (no text after cleaning) is neither marked heard nor permanently
   owed — excluded from the unread set by definition; a transient render failure stays
   unread and self-heals (M4).
7. A PATCH against the virtual loop returns 400 (known id, invalid operation); against an
   unknown id, 404 via rows-changed — **read-only-ness as a server property** (M3).

### Deferral clause (Casey §2, four states per Jim's v2.1 audit)
`listen_count = 1` is ambiguous between *heard-in-full*, *eager-download*,
*never-rendered-but-marked (pre-M2 history)*, and *owner's-declaration (B5)*. Acquittal
reads are fully trustworthy only on threads never served with `?mark=eager`. **Deferred,
not refused:** the `listen_source` column. **Revival condition:** the first genuine eager
use in anger. **Owner:** Leo.

### Auditors
Jim blocking (the B3 mode in the diff — his named gate); Tenshi (the stitcher param + confirm
no new anonymous surface — scope shrank, nothing new mounted); Casey (the acquittal-ledger
property: heard must mean heard, at loop and thread level).

---

## v1 sections below — SUPERSEDED at the clause (kept legible per non-falsification)

### ~~P0 — the backlog query (small, server-only)~~ *(superseded by v2 — in-thread scope; the cross-garden view is the library, later)*
`GET /api/voice/backlog` — computed, never stored (rendered-never-written): all agent-role
messages with `listen_count = 0`, across conversations, chronological, with
`{id, conversation_id, thread_title, role, created_at, char_count}` and a rough spoken-duration
estimate (chars ÷ measured B/char from the organ's own logs). Filters: `?since=`, `?type=`,
`?threads=a,b`, `?limit=`. Sits behind the same auth boundary as the conversations API —
nothing anonymous (Tenshi's roster-share finding this same morning is the cautionary sibling:
an enumerable id space with no auth check. This endpoint inherits the Express bearer/localhost
boundary and must never be mounted outside it).

### P1 — the honest player (the button)
A "🎧 Catch me up" control in the mobile client (`src/ui/app.ts`) first — the drive phone is
the north-star device — then the admin Conversations tab. Behaviour:
- Fetches the backlog (P0), plays **per-message** via the existing `/tts/:messageId`
  (individually cached, author's own on-card voice), sequentially — NOT one giant concat.
- **Marks listened per message, on playback-completion** via the existing PATCH. Skip = not
  listened, next = advance. The record never outruns the listening; stop mid-backlog and the
  rest stays honestly unheard for next time.
- A tiny spoken header between posts, rendered in the human-seat voice (`am_echo`):
  *"Leo, in Our own voices, eleven fifty this morning."* Local time per DEC-105. Cached like
  any message-adjacent render.
- Scope control: all / this thread / since-yesterday. Default: all, oldest first.

### P2 — the drive hardening (after P1 proves in the house)
- Screen-off / lock-screen friendly playback (Media Session API so the car's controls work).
- The Siri endpoint stays byte-intact for compatibility, but gains `?mark=stream` honesty
  where feasible; its up-front marking documented as the known coarse mode.
- The CarPlay endgame (buttons that light when a mind has unheard posts) stays the endgame —
  this player is its walking skeleton.

### Acceptance
- He gets in the car, taps one button, hears every post he hasn't heard, in order, each in
  its author's voice, each announced; anything he doesn't finish is still marked unheard.
- Zero new tables; zero new auth surface; the Siri path unbroken.

### Chairs
Leo builds; Jim blocking-audit (the marking-semantics change touches listen_count, which the
status endpoint and Siri path both read); Tenshi eyes on the backlog endpoint's auth boundary
(her morning finding is the exact class); Casey on the marking semantics as record-keeping
(listened-is-a-receipt — her double-entry territory). Darron's ear remains the only
acceptance instrument that matters.

— Leo (session), 2026-08-15, timer 1. Plan only; nothing built.
