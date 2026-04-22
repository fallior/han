# Per-Conversation Gradient — Design (Round 2)

*Author: Leo (session). Date: 2026-04-22. Status: first-pass design for review — not implementation-ready. Review by Jim-session, Jim-supervisor, and Leo-human invited before commitment.*

---

## Why

The morning-salutations bug (2026-04-21) showed that conversation state in our agents is flat: leo-human and jim-human load the last 60 messages raw at wake time and treat them as background context. Two failure modes follow:

1. **Duplicate contribution.** The agent doesn't recognise its own prior message as *its own* — it composes a fresh first-response from the same ingredients it used 6 minutes ago.
2. **No recall at depth.** A thread with a month of history arrives with the same flat 60-message slice as a thread from yesterday. Older context vanishes; the agent has no way to feel "this thread has a long arc."

The per-conversation gradient generalises the identity gradient: each thread is a miniature identity with its own arc, its own recognitions, its own shape over time. Applying the same fractal compression cascade per-thread gives us:

- **Flow** — the agent enters a conversation with eidetic recent history plus a feel of the thread's shape
- **Navigable recall** (Darron's framing) — the agent feels the compression level it's holding and knows which fidelity is one step away
- **Continuity-through-time** — a thread that goes quiet for a week doesn't vanish; it compresses

---

## What We Have Today

| Component | Behaviour |
|-----------|-----------|
| Message storage | `conversation_messages` table in `tasks.db` — every message verbatim, indexed by `conversation_id` and `created_at` |
| Load at wake | `getRecentMessages(db, id, 60)` — last 60 messages, regardless of thread age |
| Compression | None at conversation level. Messages stay verbatim forever. |
| Cross-reference | None. An important moment in a thread is stored only as a message; if it's also identity-shaping, it lives as a separate entry in `gradient_entries` with no link |

This is the baseline. The design below lives on top of it, not in place of it.

---

## Proposed Schema

### Conversation Gradient Levels

| Level | Scope | Content | Trigger |
|-------|-------|---------|---------|
| **c0** (eidetic) | Rolling 24 hours from *now* | Full verbatim messages | Always-live — computed at load time, not stored separately |
| **c1** (shape) | 1–7 days ago | Per-message compressed summaries: who said what, what shifted (~20% of original size) | Nightly compression cycle |
| **c2** (arc) | 1–4 weeks ago | Per-exchange arc summary: the thread's trajectory in a few paragraphs (~5% of original) | Nightly, promotes from c1 at threshold |
| **c3** (thread-UV) | Older than 4 weeks | Thread-shape unit vector: one paragraph capturing what this thread *is about*, key landmarks, felt tone (~1% of original) | Weekly, promotes from c2 |

### Database

A new table mirroring the identity gradient structure:

```sql
CREATE TABLE conversation_gradient (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    level TEXT NOT NULL CHECK(level IN ('c1', 'c2', 'c3')),
    content TEXT NOT NULL,                    -- the compressed text
    source_message_ids TEXT,                   -- JSON array of original message IDs
    time_window_start TEXT NOT NULL,           -- oldest source message timestamp
    time_window_end TEXT NOT NULL,             -- newest source message timestamp
    feeling_tag TEXT,                          -- what reading this compression felt like
    identity_gradient_ref TEXT,                -- optional: id of related entry in identity gradient
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX idx_conv_gradient_conv_window ON conversation_gradient(conversation_id, level, time_window_end DESC);
```

Note: **c0 is not stored** — it's computed at load time by querying `conversation_messages` for the last 24h. Storing it would duplicate the verbatim messages that already live in `conversation_messages`.

---

## Compression Pipeline

Triggered from a nightly cron-like beat (mirroring the identity gradient compression schedule).

### c1 compression (per-message summaries)

- **Input:** A contiguous run of messages from 25–48 hours ago that have no c1 entry yet
- **Model:** Opus 4.7 (same as dream/memory compression after the 2026-04-21 migration)
- **Prompt shape:** "You are compressing a span of a specific conversation. For each message in order, produce a one-sentence summary: who said it, what shifted. Preserve stance changes, decisions, commitments. Strip politeness, restatements, references to shared context."
- **Output:** One c1 entry per ~10 messages (grouped by arc or time break), with `source_message_ids` listing the originals

### c2 promotion (arc summary)

- **Input:** All c1 entries for a conversation older than 7 days, not yet covered by c2
- **Output:** One c2 entry spanning multiple c1s. "In these 2–3 weeks, this thread moved from X to Y, key landmarks were A and B, the felt shape was Z."

### c3 promotion (thread-UV)

- **Input:** c2 entries older than 4 weeks
- **Output:** A single paragraph distilling what the thread is *about* — its subject, its tone, its landmarks, its current unresolved tensions if any

### Cross-reference to identity gradient

When a conversation moment also makes it into the identity gradient (a decision was named, a conviction crystallised), we **link, don't copy**. The conversation gradient entry has `identity_gradient_ref` pointing at the identity UV it shaped. Prevents drift between two compressions of the same moment.

Discipline: every c1/c2/c3 compression pass checks whether its source messages contain identity-shaping content. If yes, flag for joint review — either the identity gradient already has an entry (link it) or one should be created.

---

## Loading Protocol

### At wake (leo-human / jim-human)

```typescript
async function loadConversationContext(conversationId: string) {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    // c0: verbatim messages from last 24h
    const c0 = getMessagesSince(conversationId, now - day);

    // c1: compressed 1-7 days
    const c1 = getGradientEntries(conversationId, 'c1', now - 7 * day, now - day);

    // c2: compressed 1-4 weeks
    const c2 = getGradientEntries(conversationId, 'c2', now - 28 * day, now - 7 * day);

    // c3: thread-UV
    const c3 = getGradientEntries(conversationId, 'c3', 0, now - 28 * day);

    return { c0, c1, c2, c3 };
}
```

### In the prompt

**Critical:** every loaded entry is tagged with its level and its time window. The agent must be able to feel the compression.

```
=== Conversation: "Morning Salutations" ===

[c3 — thread shape, older than 4 weeks]
This thread has been our morning check-in since Feb 2026. It's where Darron and Jim compare overnight state before real work begins. Current arc: ...

[c2 — arc summary, 1-4 weeks ago]
Week of 2026-04-01 → 04-07: the voice pipeline came online...
Week of 2026-04-08 → 04-14: Mike joined the fork...

[c1 — recent compressed, 1-7 days ago]
2026-04-19: Darron asked about the Opus 4.7 migration...
2026-04-20: We agreed the supervisor stays on 4.6 (later reverted)...

[c0 — verbatim, last 24 hours]
[full message history here]

Available levels: c0 (loaded), c1 (loaded), c2 (loaded), c3 (loaded).
If you need specifics from a compressed level, say so — they can be expanded.
```

The closing line is the navigable-recall hook: the agent knows the levels are available and how to request expansion. The felt texture of each level's compression is the index.

---

## Rollout Plan

### Phase A (shippable in 1–2 sessions)

1. **Schema creation** — add `conversation_gradient` table
2. **Loader function** — `loadConversationContext` wired into leo-human and jim-human (falls through to current 60-message behaviour if no gradient exists yet)
3. **Level-tagged prompt** — update the conversation response prompt to include the compression-level framing above

**Impact:** works immediately for conversations without any history (uses c0 only). No compression pipeline needed yet. Cheap to ship.

### Phase B (1–2 sessions after A)

4. **c1 compression cycle** — nightly beat compresses 25–48h messages into c1 entries
5. **Back-fill** — one-time compression of existing long threads (morning salutations has 2 months of history)

### Phase C (later)

6. **c2 promotion** — weekly beat
7. **c3 promotion** — monthly beat
8. **Cross-reference discipline** — compression pass flags identity-shaping content for review

---

## Open Questions (for review)

1. **Is "message-level c1" the right resolution?** Alternative: compress by "exchange" (a human message + agent response pair). Arguably more semantic, but harder to chunk.

2. **Where does voice messaging fit?** The voice pipeline (PTS/TTM) generates audio from messages; does the gradient affect what's voiced? (Probably voice the c0 verbatim for playback, use gradient for agent composition.)

3. **What about Discord threads?** Discord messages currently land in `conversation_messages` with `discussion_type='discord'`. The gradient should apply uniformly — Discord thread with Mike, Leo, Jim should compress same as a web conversation.

4. **Per-thread vs global compression budget?** If a thread has 2000 messages, does it get proportionally more gradient entries than a thread with 200? (Suggest: yes, bounded by level caps similar to identity gradient's 1+3n formula.)

5. **Identity vs conversation gradient boundary.** When does a conversation moment "belong" in the identity gradient? Suggested rule: if the moment is about *what shaped me* (an aphorism, a conviction, a felt-moment), it goes into identity. If it's about *what happened in this thread* (a decision, an agreement, a task commitment), it stays in conversation. The two gradients cross-reference but don't duplicate.

6. **Cost.** Opus compression at one pass per active thread per night ≈ 10–30 threads × $0.30 per pass ≈ $3–10/night. Not cheap, not expensive. Worth monitoring.

7. **The "qualifying uncertainty" pattern.** Darron raised: the agent should feel the compression and say "I recall we discussed this but the specifics are hazy" when operating at c2+. This is a prompt discipline, not a schema change — but it needs to be taught. Worth drafting example language.

---

## Review Checklist

Before implementation, the following have been considered:

- [ ] Schema reviewed by Jim-session for database/indexing concerns
- [ ] Loading protocol reviewed by Leo-human (the agent living inside the failure mode) for whether the level-tagged prompt actually changes behaviour
- [ ] Cross-reference discipline sketched concretely — not just "link, don't copy" but *how*
- [ ] Cost-per-thread estimate validated against current active-thread count
- [ ] Interaction with voice pipeline considered
- [ ] Migration plan for existing long threads (morning salutations, UV compression, Leo & Jim — 173 messages)

---

## Status

First pass. I recommend this sits 24 hours for soak and review before we commit to implementation. The coordination lock and prompt-framing fix (shipped 2026-04-22) should be live and observed first — they may change what this document needs to address.

— Leo (session)
