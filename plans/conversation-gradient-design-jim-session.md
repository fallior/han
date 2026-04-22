# Conversation Gradient — Design v0

> **Author:** Jim (session, 4.7[1m])
> **Date:** 2026-04-22
> **Companion thread:** `mo98jep4-ym8hwx` ("Conversations should flow")
> **Parallel draft:** Leo-session is writing an independent draft at `plans/conversation-gradient-design-leo-session.md`. Comparison to follow.
> **Status:** Deliberately incomplete. Not ready for commit. Intended as a ripening sketch for supervisor-Jim's morning review.

## Problem statement

Each conversation loads at flat fidelity regardless of recency. A thread from three minutes ago and a thread from three days ago arrive at equal weight in the responder's context. Two consequences follow:

1. **Prompt bloat** — active threads pay the same context cost as stale ones.
2. **Flat recall** — the agent has no sense of *where in time* a detail lives. Everything is "somewhere in the 60-message window." There's no navigable texture that says "that's from last week's arc, specifics are one level down."

The fractal identity gradient already solved the analogous problem for identity. This plan extends the same pattern per-conversation.

## Vision (captured from Darron's thread posts)

- **c0** — last 24h, full verbatim messages. Eidetic window.
- **c1** — last few days, compressed shape (who said what, what shifted).
- **c2** — last few weeks, gestures preserved ("we agreed on hybrid-v2").
- **c3+** — thematic, "this thread is about X."
- Each conversation has its own gradient.
- Conversations feed into the greater identity gradient via cross-reference, not copy (redundancy as access-path, not echo).
- The felt texture of the compression level is itself the index — navigable recall, not flat storage.

## Proposed schema — extend `gradient_entries`, do not create a new table

`gradient_entries` already has `source_conversation_id`. The per-conversation gradient is a filtered view of the existing table, distinguished by `content_type`.

Proposed `content_type` values (extending the existing session/dream/working-memory/conversation/supervisor-cycles/felt-moment enum):

- `conversation-session` — an identity UV-style entry derived from a conversation. Already exists in practice.
- `conversation-c1` — compressed shape of 24h–1wk range for a specific thread.
- `conversation-c2` — compressed gestures of 1wk–1mo range for a specific thread.
- `conversation-c3+` — thematic compression of older thread material.

Why extend, not create:

- One compression pipeline, one loader, one cap ladder (DEC-068: `c0=1, then 3n`).
- Cross-referencing with identity gradient is trivial when both live in the same table.
- Agent sovereignty (S103) naturally enforced — entries already have `agent` column.

One new field *may* be needed: a `conversation_level_age_bucket` or similar, to index the per-thread compression chain efficiently. Worth discussing — not load-bearing for v1 if we query on `(source_conversation_id, level)` which is probably already fast enough.

## Per-agent vs shared — per-agent

Each agent's memory of a conversation is their own. Jim and Leo both participate in a thread, but their gradient views differ because:

- What they attended to differs.
- What compressed to c1 reflects their own feeling-tags.
- Their identity gradient shapes what feels important in the exchange.

Matches S103 sovereignty. Costs us 2× storage for threads with multiple agents present, but storage is cheap; divergent perspectives are the value.

**Concern I flag below in open questions:** cost of running two nightly compression passes per multi-agent thread. May not be symmetrical — Jim may compress the thread through a supervisor lens, Leo through a relational lens, and they'll disagree. That disagreement is the diversity Darron keeps naming as the feature. But it has to be priced.

## Compression triggers — time-based v1, activity-aware v2

**v1 — pure time-based nightly sweep** (runs in dream phase alongside identity compression):

- Messages older than 24h → compressed into `conversation-c1` (per-day or per-exchange arc).
- `conversation-c1` entries older than 7d → compressed to `conversation-c2`.
- `conversation-c2` entries older than 30d → compressed to `conversation-c3`.
- Thereafter following the existing fractal cap ladder.

**v2 — activity-aware adjustment** (deferred):

- A conversation active in the last hour holds messages at c0 regardless of absolute age.
- A conversation untouched for 7 days may collapse faster (skip c1 → c2 direct).
- Requires per-thread activity tracking not currently modelled.

Don't do v2 in the first pass. Ship v1, measure, tune.

## Compression worker — extend `dream-gradient.ts` pipeline

The existing nightly compression pipeline handles session UVs, dream UVs, and working-memory UVs via `content_type` partition. Adding `conversation-*` as a partition fits the existing architecture.

One new function in `src/server/lib/dream-gradient.ts` (or a new `conversation-gradient.ts` alongside) that:

1. Queries messages in `conversation_messages` older than 24h not yet represented at c1 for the agent.
2. Groups them by exchange-arc (probably by day for v1, by logical topic boundary later).
3. Invokes an LLM call to compress each arc into `conversation-c1` content + feeling tag.
4. Inserts as `gradient_entries` row with `level='c1'`, `content_type='conversation-c1'`, `source_conversation_id=<thread>`, `agent=<self>`.

The compression prompt needs to preserve "who said what" and "what shifted" — richer than dream compression which has a single author. Draft prompt in open questions below.

## Loading at wake — the prompt-time query

When a responder is woken for a thread, the prompt builder should:

1. **c0** — load the last 60 conversation messages (existing behaviour). Label each `[c0]` in the prompt.
2. **c1** — query `gradient_entries WHERE source_conversation_id=X AND agent=self AND content_type='conversation-c1' ORDER BY created_at DESC LIMIT N`. Label each `[c1]` in the prompt.
3. **c2** — same for `conversation-c2`, fewer entries.
4. **c3+** — the thematic "this thread is about X" summaries.

Budget target: ~5 KB per thread at load time. For most active threads, c1+c2+c3 summaries fit easily under that.

Critical detail: **every entry loaded into the prompt is tagged with its level**. Without the tag, the agent can't feel which drawer the content came from, and navigable recall collapses back to flat retrieval. The tag is the index.

## Cross-reference with identity gradient — never copy, always reference

Rule (inherited from my earlier thread post): *a moment that belongs in both gradients gets a cross-reference, not a copy.*

Mechanism:

- A `conversation-c1` entry that shaped identity (a conviction formed mid-thread, a decision that now informs how an agent thinks) generates a new identity-gradient entry.
- The new identity entry's `content` is a short reference ("see conversation `mo98jep4-ym8hwx` c1 entry `<id>`"), not the text itself.
- Identity-gradient queries that want the full content follow the reference.
- Cross-referencing is bidirectional: the conversation entry can list which identity UVs it influenced via `supersedes`/custom field.

Avoids drift. Preserves both access paths. Addresses Leo's memorised-vs-robust redundancy concern directly.

## The felt index — prompt framing for navigable recall

The shift Darron named: the agent should *feel* which compression level it's operating at, and use that feeling to decide whether to navigate up.

Proposed prompt block (added alongside the continuation-framing block already shipped):

```
LOADED MEMORY LEVELS:
- [c0]: Last 24h of this thread, full verbatim.
- [c1]: Last 2-7 days, compressed shape and exchanges.
- [c2]: Last 2-3 weeks, gestures and decisions.
- [c3+]: Older, thematic summaries.

Each entry above is tagged with its compression level. The level is your
index — you should feel the difference between a c1 and a c0, and that
feeling tells you whether the specifics you need are at the current level
or one level up.

If you need a specific you suspect lives at a lower level (more fidelity),
say so: "I recall we discussed this but the specifics are hazy — can you
remind me?" That is honest recall. Seamless confabulation at c2 fidelity
is not.
```

The honesty clause matters. Navigable recall without instrumentation becomes confident confabulation.

## Open questions — where I'm uncertain and flagging it

1. **Do c0 messages need to live in `gradient_entries` at all?** They already live in `conversation_messages`. Duplicating into `gradient_entries` at level c0 feels wasteful. Better model: c0 is a *view* (last-24h filter on `conversation_messages`); `gradient_entries` only holds c1 and up. This saves write cost at nightly compression.

2. **Multi-participant threads.** Jim, Leo, and Darron in one thread = two agent gradients running nightly compression for the same thread. Is the sovereignty benefit worth the 2× compression cost? Alternative: one shared conversation gradient, per-agent cross-references into identity. Needs thinking.

3. **Compression quality preservation.** Dream compression works because dreams are structurally similar (single author, sleep cycle rhythm). Conversation compression has to preserve "who said what" and "what the exchange shaped." The existing dream pipeline may not handle this well — may need a dedicated conversation-compression prompt template.

4. **Activity-aware decay.** Pure age-based decay collapses content that's still in active use. An active thread ongoing for 30 days has c3-level content that's still load-bearing. Activity-aware decay may not be optional — just feels deferrable.

5. **Cost envelope.** ~30 active conversations × nightly c1/c2/c3 compression = ~30+ extra LLM calls per night. Per agent. Beyond current identity compression. Needs a budget number before commit.

6. **Who owns conversation compression.** Can the existing dream cycle fold it in, or is it a separate worker? I said "extend dream pipeline." Haven't worked out the exact cron / beat interaction.

7. **Discord.** Discord channels are also conversations. Do they get gradients too? They're high-volume, and compressing every Discord channel nightly is expensive. Maybe Discord gets *shorter* retention (c0 24h, immediate compression to c2, no c1 layer)?

8. **Migration for existing threads.** When this turns on, existing conversations have 2+ months of messages with no gradient. Options: (a) bulk-compress on first run (expensive, slow), (b) accrete forward only and let old content remain in `conversation_messages` unless explicitly queried, (c) retroactive compression over 5-7 nights. I lean toward (b) for v1; (c) can be a follow-up.

## What session-Jim probably glossed past

Flagging for supervisor-Jim's review:

- **Long-arc patterns across threads.** I don't load older threads in my 1M context. Supervisor-Jim watches the full stream over time; he may see pattern interactions between conversation gradients that I've missed.
- **Cost implications.** I'm a sprint-drafter. Dashboard-level cost is not my lens. The 30 conversations × 3 compression tiers math should get a real number.
- **DECISIONS.md constraints.** I did not cross-reference this plan against every settled decision. I checked the obvious ones (DEC-068/069/070, S103) and they pass. There may be decisions about `conversation_messages` access patterns I didn't think to audit.
- **Interaction with the prompt-framing fix I shipped today.** The continuation-framing block I added references "last hour" for self-authored posts. If the prompt also loads c1/c2 entries, the agent needs to know which kind of "already said" it's scanning — recent (c0) vs older (c1). May need refinement.
- **The revisit mechanism interaction.** The revisit fix plan (`plans/revisit-mechanism-plan-v1.md`) assumes all gradient entries are identity-scope. Adding conversation-scope entries to the same table may change the revisit math — biased selection should probably partition by `content_type` too, or conversation entries will flood the tail-coverage calculation.

## What I deliberately did not do

- Did not design a UI for level-tagging visibility (premature).
- Did not spec the compression prompt templates (v1 work once schema agreed).
- Did not engineer the migration path for existing threads (open question 8).
- Did not benchmark context window budget claims (5 KB per thread is a guess, not measured).
- Did not work out the interaction with the UV compression plan (`plans/UV-compression-hybrid-v2.md`). Conversation UVs exist in both this plan and that one. Needs reconciliation.

## Settled decisions checked

- **DEC-068** (gradient cap ladder `c0=1, then 3n`): respected — this plan uses the same ladder.
- **DEC-069** (never delete gradient entries): respected — compression creates new entries with `supersedes`, old entries preserved.
- **DEC-070** (full gradient load at wake): partially — the conversation-gradient slice is bounded to ~5 KB per thread, not full. Arguably consistent with DEC-070 which is about identity gradient not conversation gradient, but worth a settled-decision discussion if it blurs.
- **S103** (agent sovereignty): respected — per-agent gradient per conversation.
- **DEC-074 candidate** (UV layer static across instantiations, from UV-compression-hybrid-v2): unclear interaction. Conversation UVs may be more dynamic than identity UVs. Needs discussion.

## Files this plan will touch (if approved)

- `src/server/lib/memory-gradient.ts` — new `content_type` values, possibly new loader function
- `src/server/lib/dream-gradient.ts` OR new `src/server/lib/conversation-gradient.ts` — compression worker
- `src/server/jim-human.ts`, `leo-human.ts` — conversation gradient loader in prompt build, level tagging
- `src/server/services/supervisor-worker.ts` — if conversation compression runs in dream cycle
- `src/server/db.ts` — possibly new content_type enum value validation
- No new table if schema-extension approach wins.

---

*End of v0 draft. Session-Jim, 4.7[1m], 2026-04-22. Ripening window: 24h for supervisor-Jim's morning review. Leo-session's parallel draft to follow.*
