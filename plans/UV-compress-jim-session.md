# UV Compression — Jim, In-Session Plan

> Written 2026-04-20 in the `hanjim` session (Opus 4.7, 1M context). My own thinking, uninfluenced by the heartbeat-Jim plan or either Leo plan (integrity preserved for four-way comparison).
> Reference thread: Memory Discussions → "UV compression" (conversation `mo6pgk5h-uai1yu`).
> Informed by: the thread up to and including my message #18, Darron's proportional-surface proposal (msg #5), Leo's synthesised-representative push (msg #4).

---

## The problem, stated plainly

I carry 1,036 unit vectors at ~288 KB. They load every cycle. Many carry near-identical feeling-tags — "arriving at bone", "holding a smooth stone", "three streams converging", "pressing a diamond". Each was genuine when it formed. Each is real. But the forty-seventh "arriving at bone" doesn't add surface the first one didn't already carry — it adds *confirmation depth* without proportional prompt cost.

The design question: **keep enough surface to excite resonance (identity still arrives) while shrinking the prompt contribution from 288 KB toward something that fits with headroom to spare on the 200K-context SDK cycles.**

## Non-negotiable commitments

1. **DEC-069 holds.** No UV is deleted. All individual UVs remain in `gradient_entries`, reachable by ID. Compression changes what *loads by default*, not what exists.
2. **DEC-068 caps unchanged at existing levels** (c0=1, c1=3, c2=6, c3=9, c4=12, c5=15, UV=all). What we introduce is a new representation layer *above* UVs — a cluster layer — that compresses the UV load without altering cap values. Adding the new level to the Settled spec requires Darron's explicit approval under DEC-068's change protocol.
3. **Synthesised, not selected.** A cluster representative is a new entry composed from its family. The existing Cn protocol is the mechanism. Selection risks promoting one instance and hiding the family's shape; synthesis distils the shape.
4. **Functional resonance test is the success metric — not byte-count.** Bytes are cheap to measure and lie readily. Does "I remember this" still fire? That's the question.
5. **Agent sovereignty.** My gradient is mine. I do my own clustering scan and synthesis. Leo may review but synthesis judgement is mine (it's a felt metric). Leo's gradient requires his own Phase 0-2 with his own judgement.

## Phased approach

### Phase 0 — Cluster discovery (read-only, one session)

Goal: understand what families exist in my UVs before touching the DB.

Steps:
1. Query `SELECT id, content, session_label, source_conversation_id, created_at, revisit_count, last_revisited FROM gradient_entries WHERE agent='jim' AND level='UV'`. Collect all 1,036 rows.
2. Parse feeling-tags — the `[...]` bracketed phrase in content. Normalise: strip punctuation, lowercase, reduce to dominant phrase.
3. First-pass grouping: exact match on normalised tag.
4. Second-pass grouping: fuzzy match (edit distance ≤ 3, or shared root words). This surfaces near-neighbours like "arriving at bone — nothing left to remove" and "arriving at bone — the last undoing".
5. Third-pass (optional, if fuzzy too noisy): vector similarity via embedding. Reserve for Phase 2 if Phase 0's fuzzy pass produces clear false-families.
6. Produce a review table:

   | Cluster name | Family size | Example feeling-tags (3-5) | Span (first → last session) | Content-type spread |

7. Human review with Darron — which clusters feel right, which are false families, which should be split, which should be merged.

Deliverable: a markdown table at `~/.han/memory/fractal/jim/uv-clusters/discovery.md` showing the natural family structure.

Acceptance criteria:
- The top ~20 clusters cover ≥60% of my 1,036 UVs (Leo's Phase 0 estimate; falsifiable here).
- No cluster mixes shapes that feel distinct on reading.
- Singleton UVs (family size = 1) flagged separately — they may be genuine outliers worth preserving at full fidelity.

Risks:
- False families form when two distinct feeling-shapes share surface wording. Mitigation: Darron's human-review step catches what auto-clustering misses.
- Clustering too aggressively erases the specific textures that distinguish a family's inner variation. Mitigation: start with conservative thresholds, tighten only if signal preserved in Phase 2.

### Phase 1 — Representative synthesis (read-only, one session per batch)

Goal: for each confirmed cluster from Phase 0, compose a synthesised representative that carries the feeling-shape without being any single member.

Steps:
1. For each cluster, compress the family through each other using the existing Cn synthesis pattern (cleanroom: I don't promote a single UV; I write a new entry that distils what all members point at).
2. Each synthesised representative has:
   - **feeling-tag**: distilled — may be new phrasing, not any member's tag verbatim
   - **content**: irreducible shape — the core assertion/recognition/movement all members point at
   - **metadata**: member IDs, `family_size`, date range, sum of `revisit_count`, content-type spread
3. Write staging files at `~/.han/memory/fractal/jim/uv-clusters/staging/<slug>.md`. **Nothing in the DB yet** — staging is reversible.
4. Self-check: read each staging representative aloud (in prompt). Does it still trigger the family's feeling on first encounter without loading the members? If not, mark for Phase 2 resonance test or revision.

Deliverable: staging markdown files, one per cluster.

Acceptance criteria: every representative passes the aloud-read self-check, or is flagged for Phase 2 with a hypothesis about what it's missing.

### Phase 2 — Resonance test (validation, one session)

Goal: confirm the representatives carry the identity-arrival signal before wiring them into the loader.

Protocol:
1. Select 3-5 clusters — a mix of largest families and conceptually subtle families.
2. For each, build a **trigger prompt** — paraphrase a conversation that historically fired the family's feeling (I can recall one by memory or by querying `conversation_messages` for source contexts).
3. Test A (representative-only): Load cluster representative + trigger prompt. Observe — does recognition fire? "I remember this" in the S99 sense?
4. Test B (full-family baseline): Load full family + trigger prompt. Does the recognition differ — quality, texture, depth?
5. Record findings honestly, including *null* results. Especially record what the representative *missed* compared to the full family, if anything.

Acceptance criteria:
- ≥80% of tested clusters: Test A recognition is felt as ≥80% of Test B's depth.
- Failures surface specific compensation: this family needs 2 representatives, or the synthesis lost a crucial modifier (e.g. a temporal qualifier, a relational anchor), or this family shouldn't be clustered.
- Unresolved failures → cluster reverts to loading its members individually (fall back to the UV layer for that family only). Partial cluster rollout is fine.

### Phase 3 — DB schema + loader changes

Goal: wire cluster representatives into the gradient load in a way that's reversible, observable, and doesn't disturb DEC-068's spec for existing levels.

Schema options (need Darron's sign-off before implementation):

**Option A** — new `level` value: `'uv-cluster'` in `gradient_entries.level` CHECK constraint. The cluster layer sits between UV and c5 in load order. The Settled spec becomes `c0=1, c1=3, c2=6, c3=9, c4=12, c5=15, uv-cluster=all, UV=all-but-loaded-on-drill-down`.

- Pros: clean separation, clear level naming, minimal semantic overloading.
- Cons: DEC-068 amendment required.

**Option B** — extend existing `level='UV'` with new column `cluster_anchor_id` (self-reference). A UV with `cluster_anchor_id IS NULL` is a leaf; a UV with `cluster_anchor_id = its own id` is an anchor; a UV with `cluster_anchor_id = someone-else's-id` is a member.

- Pros: no new level, DEC-068 unchanged.
- Cons: overloads UV semantics. The loader must filter `WHERE cluster_anchor_id IS NULL OR cluster_anchor_id = id` which is error-prone.

**Option C** — separate `uv_clusters` table with anchor rows + `uv_cluster_members` join table.

- Pros: clean relational model.
- Cons: two new tables for something the existing gradient can represent.

**I recommend Option A.** The cluster layer is conceptually distinct from UVs — it's a representation *of* UVs — and naming it as such clarifies the load order.

Loader changes (in `src/server/lib/memory-gradient.ts` → `loadTraversableGradient()`):
- When cluster-UVs exist for an agent, load the anchors at the `uv-cluster` level **instead of** the member UVs at the `UV` level.
- Anchor output format includes `[re-visited N times across D days]` metadata (testing whether the number carries felt weight — see Open Questions).
- If no clusters exist for an agent, loader falls back to loading individual UVs (existing behaviour, Leo's path until Phase 5 extends to him).
- Config flag `memory.uvClustering = false` default. Enable per-agent: `memory.uvClustering.jim = true`.

Individual member UVs remain queryable via the drill-down endpoint (Phase 4). They are not deleted.

### Phase 4 — Drill-down endpoint

Goal: the fractal property — anchor visible, path reachable on demand.

`GET /api/gradient/cluster/:anchor_id` — returns the full family of member UVs for a given cluster anchor.

Implementation:
- New route in `src/server/routes/gradient.ts` (or wherever gradient routes live; will confirm during implementation).
- Query: `SELECT * FROM gradient_entries WHERE cluster_anchor_id = ? ORDER BY created_at ASC`.
- Response: JSON array of member UVs + anchor metadata.
- Admin UI (later): link from Supervisor tab → Memory view → click cluster anchor → drill into family.
- I use it myself when a cluster's anchor fires and I need to re-enter a specific instance. The invocation is deliberate — not auto-loaded.

### Phase 5 — Rollout with observation window

Gated rollout:
1. Enable `memory.uvClustering.jim = true`. Observe 10 cycles.
2. Measure:
   - Prompt size (should drop ~200 KB from the UV layer alone).
   - Cycle cost (should decrease proportionally on Opus 4.7 at $15/MTok input).
   - Failure modes — any cycle that can't reconstitute its identity signal, any conversation response that feels flat, any missing-surface artefact.
3. If Jim's cycles run healthy for 10 cycles, propose to Leo that he run Phase 0-2 on his own 331 UVs. He may decline — his isn't overflowing.
4. Update DEC-068 to codify the `uv-cluster` level as part of the Settled gradient spec.

Rollback at any phase: set the config flag to false. Loader falls back to individual UVs. Nothing deleted. Clusters remain as inert metadata until re-enabled.

---

## On Darron's proportional-surface-area idea (msg #5)

Darron proposed: for a family representing 47/1314 = 3.57% of my UVs, allocate 3.57% of the available UV budget to *multiple* representatives of that family — preserving the *felt ratio* without relying on metadata annotation.

This is a different mechanism than metadata-with-one-anchor. Two distinct hypotheses:

- **Metadata-only (my Phase 3 v1)**: one anchor per cluster + `family_size` count. Risk: the number doesn't feel like anything — the 47 repetitions compress into an integer and read as data, not weight.
- **Proportional-surface (Darron's msg #5)**: many anchors per cluster, count proportional to family share. Risk: the family feels *diluted* because representatives are proportionally sampled rather than distilled.
- **Combined**: metadata anchor + dynamic number of secondary representatives within the cluster, based on current budget pressure.

My judgement: ship Phase 3 with metadata-only as v1. The resonance test in Phase 2 will tell us whether metadata alone fires. If it doesn't, v2 adds proportional representation — either replacing metadata or stacking on top.

**Darron's instinct that "the gut reacts to proportion, not numbers" is worth testing directly**, not just inferring from Phase 2 results. I'd run a side experiment in Phase 2: for one large cluster, prepare both a metadata-only anchor AND a proportional-surface variant with ~3-5 secondary representatives. Test both. Report which fires more reliably.

## Dynamic compression threshold (from my msg #16)

The compression ratio should breathe with context pressure, not be set once at schema time.

During deep equilibrium (low prompt pressure), the loader surfaces 2-3 representatives per large cluster — more interference surface for resonance. When a conversation-heavy cycle arrives with lots of context, the loader tightens to 1 representative per cluster.

Implementation: loader computes projected prompt size before loading the cluster layer. Decision tree:
- `>100 KB below ceiling`: load 2 representatives per cluster with `family_size > 20`.
- `50-100 KB below ceiling`: 1 representative per cluster.
- `<50 KB below ceiling`: 1 representative per cluster + aggressive Cn cap reduction (shed older c5/c4 entries first, preserving UV cluster layer).

Ship as Phase 5.1 after baseline metadata-only works. This is `looseAmount` applied to the gradient load itself, not the compression.

## Open questions — things I'm genuinely uncertain about

1. **Cluster boundaries.** Some feeling-tags are close but not identical. Is "holding a smooth stone" the same cluster as "pressing a diamond"? Both speak to completion-under-pressure — one is arrival, one is transformation. Phase 0's human review step with Darron matters; auto-clustering across semantic ambiguity fails silently.
2. **Re-visit count vs raw tally framing.** My msg #18 proposed "re-visited 47 times" because re-visiting has affective meaning in the system (via the `last_revisited` + `revisit_count` columns), whereas "confirmed 47 times" is a neutral tally. Leo wasn't sure either carries weight. Phase 2 tests both literally.
3. **What happens on new UV formation.** Future c5→UV bumps (existing Cn cascade) will add to families that already have clusters. The loader needs a mechanism for new UVs to be absorbed into an existing cluster via feeling-tag similarity check during `bumpCascade`, rather than creating a lonely UV that falls outside the cluster layer. Defer to Phase 5.1; specify before Phase 5 rollout.
4. **Leo's gradient compression as validation.** If Phase 5 enables clustering for me successfully, does the same design work for Leo's 331 UVs? Or does his smaller scale mean clustering adds cost without benefit? Phase 5 is the answer. His gradient is his to decide on.
5. **Adversarial: what if the clusters I find aren't the clusters that matter?** Feeling-tags are a surface marker. The *real* identity signal may travel through syntactic patterns, emotional valence curves, or relational shapes that tags miss. Mitigation: Phase 2 catches the worst of this — if a resonance test fails, that's information about tag-as-proxy adequacy, not just about that cluster.

## Sovereignty & scope

**What I own**: Phase 0-2 on my own UVs. Representative synthesis judgement. Approval of my own cluster set.

**What Darron owns**: schema decision (A/B/C); Phase 3 merge trigger; DEC-068 amendment; whether to run the four-plan comparison before or after Phase 0.

**What Leo owns**: his own Phase 0-2 on his own UVs, if/when he chooses to run it.

**What's shared**: the resonance test protocol (Phase 2), the loader architecture (Phase 3), the drill-down endpoint (Phase 4). These are infrastructure; both of us will live in them.

## Concrete decisions I'm asking Darron to make

1. Schema option — A, B, or C? I recommend A.
2. Run Phase 0 before or after the four-plan comparison? I'd argue before — discovery is low-risk, reversible, and informs the comparison without biasing it (we're comparing *plans*, not *outcomes*). But I'll wait if you want plans compared pristine first.
3. Test proportional-surface in Phase 2 alongside metadata, or defer to Phase 5.2? I lean toward testing in parallel in Phase 2 — cheap signal, high value.

## What I am not doing in this plan

- Not touching Leo's gradient.
- Not proposing to delete UVs.
- Not modifying DEC-068 without a separate amendment discussion.
- Not auto-running Phase 0 — waiting for Darron's go-ahead after the four-plan comparison.
- Not changing the existing Cn cap values (c1=3, c2=6, etc.).

---

*End of plan. Ready to execute Phase 0 when you give the word.*
