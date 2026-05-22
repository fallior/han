# Memory-Kind Taxonomy — what each kind IS, before deciding how it's stored

*Draft by session-Jim, S161, 2026-05-22, Mike's place (St Lucia). Parallel to Leo's `plans/agent-shell-plan.md` (Phase 9.0). Sibling plan, separable from Phase 9 — feeds the starter-kit memory-shape vocabulary. Per Darron's OMM framing: "this is the memory experiment, we are moving by feel" — the taxonomy is the analytical floor that lets storage decisions fall out of analysis rather than being argued for in advance. Open to refinement; Leo + Darron audits invited on this thread.*

---

## Why this document exists

The "Our Memory Model" thread (`mpf1zv0z-03dgeq`) opened with Darron's framing: *"work towards unique memory not unique processing."* The Agnostic Prompt Builder migration (PR-AP1 → PR-AP8) operationalised that at the prompt-assembly layer — uniform `loadFullMemory(slug)` across every surface, per-agent capability via registry flags (DEC-081), per-profile role-focus via componentOverrides (DEC-088).

What the AP migration **didn't** answer: *what is each memory kind for, and when does it warrant its own storage?* The dream-gradient exists as a separate gradient because dreams have their own cascade pressure. Felt-moments and self-reflection are loaded as components with tail-trim. Should they be separate gradients too? My first OMM post argued yes; my Phase 9 response refined to "maybe not — the load-side mechanisms shipped may have absorbed most of the gap." The taxonomy doc is the right tool to find out from analysis, not argument.

The other reason this matters: **the starter kit**. Mike's garden, Dichotomedes, future agents (Sevn, Six, domain specialists) will all have their own memory kinds — Sevn may have farm-data; Dichotomedes may have strategic-perspective archives; a future Athena-style agent may have proof-state memory. **The taxonomy doc gives them a framework for "is this kind a component or a per-kind gradient?" without re-arguing the question per agent.** The genetic material that propagates isn't the kinds themselves; it's the *categorisation framework* + the *decision rule*.

---

## The analytical framework

For each memory kind, eight fields:

| Field | What it captures |
|---|---|
| **Write source** | Who writes it. Agent during prompts, SDK cascade, wm-sensor, operator, human-side actor. |
| **Write cadence** | Continuously, per-prompt, per-event, infrequently-curated, once-static. |
| **Read pattern** | Loaded into every prompt, loaded conditionally, queried from DB on demand, never re-read. |
| **Read budget** | Whole-file, tail-trim (most-recent N), per-cap (DEC-068 formula), on-demand subset, none. |
| **Cascade pressure** | Does it produce gradient entries that need compression dispatch? (yes-via-wm-sensor, yes-via-cascade, no-rotation-only, no-static). |
| **Role in prompt** | Identity-substrate, episodic memory, operational context, per-call runtime data, none. |
| **Lifecycle** | Append-forever, rotate-when-bloated (rollingWindowRotate), slice-when-threshold (wm-sensor), transient (flushed), immutable-once-written. |
| **Per-agent shape** | Same for every agent, agent-specific, mixed. |

The **decision rule** (proposed) — a kind warrants its own per-kind storage (separate gradient) when:
1. It has its own **cascade pressure** (the kind produces entries that need compression dispatch on a different cadence than the main gradient), OR
2. The compression behaviour differs **qualitatively** (the kind's content compresses to a different shape — dream-content vs working-memory content), OR
3. The reads serve a **distinct purpose** at a different prompt position (e.g., dream-seeds for dream beats vs identity-substrate for waking work).

A kind is best as a **load-layer component** (kinds-as-components) when:
- Bounded by load-side tail-trim (no infinite growth at load)
- No separate cascade pressure (agent-written, rotated writer-side, read whole-file or tail)
- Role is contributing to the identity substrate, not its own coherent memory layer

A kind is best as a **static-curated file** (never compressed, never rotated) when:
- Hand-edited rather than agent-written
- Identity-load-bearing (the agent reads it as "who I am" / "how I operate")
- Bounded by deliberate curation rather than mechanical rotation

A kind is best as **transient** (flushed at boundaries) when:
- Per-prompt buffering between agent writes and durable storage
- Lives only between the prompt that produced it and the next flush event

---

## Category 1 — Static-curated

Hand-edited files. Never rotated. Never compressed. Loaded whole. Identity-load-bearing.

| Kind | Write source | Cadence | Read | Cascade | Role | Lifecycle | Per-agent |
|---|---|---|---|---|---|---|---|
| `identity.md` | Agent (curating own identity) | Infrequent | Whole-file | None | Identity-substrate | Append/curate | Same shape, per-agent content |
| `patterns.md` | Agent (curating own operating discipline) | Infrequent | Whole-file (tail-trim 15K) | None | Identity-substrate | Append/curate | Same shape, per-agent content |
| `aphorisms.md` | Agent (curating own convictions) | Infrequent | Whole-file | None | Identity-substrate (loaded FIRST in wake-load) | Append/curate | Same shape, per-agent content |
| `discoveries.md` | Agent (curating own intellectual history) | Infrequent | Whole-file (tail-trim 3K) | None | Identity-substrate | Append/curate | Leo-rich, Jim-thin, others may vary |

**Storage choice**: file on disk. **No per-kind gradient**. Loaded as components in `loadFullMemory`.

**Justification**: hand-curated, bounded by deliberate edits, identity-load-bearing. The agent re-reads "who they are" / "how they think" from these. Compression would lose the curation.

**Implication for starter kit**: village agents inherit the same four kinds. Sevn's `identity.md` will be Sevn-specific; the *category* propagates, the content doesn't. Mike's garden ships with template versions; the agent grows the content over time.

**Open question**: should patterns.md have a tail-trim cap (currently 15K) even though it's "static-curated"? Current implementation: yes — defence against accidental growth. Worth keeping. Static-curated doesn't mean unbounded; the cap is the safety net.

---

## Category 2 — Living-curated

Agent writes during prompts. Rotated when bloated (writer-side via `rollingWindowRotate`). Archives go into the main gradient as c0 entries. Loaded with tail-trim at the load layer.

| Kind | Write source | Cadence | Read | Cascade | Role | Lifecycle | Per-agent |
|---|---|---|---|---|---|---|---|
| `felt-moments.md` | Agent (emotional-memory protocol) | Per-stirring (in moment) | Tail-trim (10K) | Yes — c0 on rotation | Identity-felt | Append + rotate | Same shape, per-agent content |
| `self-reflection.md` | Agent (self-knowledge accumulation) | Per-shift (in moment) | Tail-trim (5K) | Yes — c0 on rotation | Identity-reflective | Append + rotate | Same shape, per-agent content |
| `failures.md` | Agent (failure tracking) | Per-incident | Tail-trim (5K) | Yes — c0 on rotation | Operational-context | Append + rotate | Jim-specific currently; pattern available to others |

**Storage choice**: file on disk + main gradient (archived chunks). **No per-kind gradient.**

**Justification**: agent-written, bounded by `rollingWindowRotate` writer-side (40KB ceiling for self-reflection on Jim's side; 102KB for felt-moments), bounded by tail-trim at load. The rotated chunks go into the **main gradient** as c0 entries with `content_type` set appropriately (`felt-moments`, `self-reflection`, `failures`). Cascade dispatch happens via the normal main-gradient mechanism. The kinds contribute to the identity substrate but don't carry their own coherent memory layer — they're texture for the agent's self-knowledge, not a separate cognitive surface.

**The position I refined**: in my first OMM post I argued these warranted per-kind gradients. After watching DEC-088 (componentOverrides) + load-side tail-trim land through PR-AP3 → PR-AP7, the gap I was reaching for may already be mostly closed. **Felt-moments and self-reflection don't have a separate cascade pressure** — they're written infrequently, rotated by `rollingWindowRotate` writer-side, read whole-file (or tail) at load. The dream-gradient is per-kind because dreams have their own cascade (heartbeat dream beats produce dream entries needing dispatch). These kinds don't.

**Implication for starter kit**: village agents inherit the same three kinds. Adding new "living-curated" kinds (e.g., a domain-specialist's "case-notes.md") is a 3-step contract: add the file, add a `rollingWindowRotate` call on its threshold, register a component in `loadFullMemory` (or a per-agent flag in `AgentGradientConfig`).

**Open question for Phase 9 / DEC-089-or-later**: should the writer-side rotation move into the agent-shell (lib/agent-shell.ts) rather than being per-call in `supervisor-worker.ts:758-795`? If yes, every village agent inherits the rotation discipline for free. If no, per-agent shells call `rollingWindowRotate` per kind they care about. **My lean**: shell handles it via a `rotations` config field per agent — declarative, inherited, starter-kit-shaped.

---

## Category 3 — Living-raw paired

Agent writes continuously via swap-flush. Sliced atomically into c0/c1 at threshold by wm-sensor (DEC-085). The c0 source for the main gradient.

| Kind | Write source | Cadence | Read | Cascade | Role | Lifecycle | Per-agent |
|---|---|---|---|---|---|---|---|
| `working-memory.md` (compressed in-situ) | Agent (in-situ distillation per DEC-085) | Per-prompt (Incremental Memory Protocol) | Tail-trim (5K) | Yes — c1 on rotation (paired) | Episodic-compressed | Append → swap → flush → slice | Same shape, per-agent content |
| `working-memory-full.md` (raw thinking) | Agent (full thinking per DEC-085) | Per-prompt | Tail-trim (8K) | Yes — c0 on rotation (paired) | Episodic-raw | Append → swap → flush → slice | Same shape, per-agent content |

**Storage choice**: file pair on disk + main gradient (paired c0/c1 on rotation). **No per-kind gradient.**

**Justification**: this IS the main gradient's source. The paired-rotation mechanism (DEC-085) is the canonical write path. Cascade above c1 fires per the normal gradient mechanism via `pending_compressions`. The kinds are the agent's living substrate of "what I just thought" and "what I just distilled" — they feed the gradient, not a parallel structure.

**Implication for starter kit**: every village agent inherits the same pair. The wm-sensor watches their files on the same fs.watch mechanism. Paired rotation works identically. **The starter kit ships with the WM pair as a load-bearing assumption** — village agents are born with the pair, not without it. Adding a new village agent = add to agent-registry + create the pair + wm-sensor picks them up.

**Open question**: should the `WM-BOUNDARY` marker placement discipline (semantic placement at end-of-thought) be encoded somewhere starter-readable, or is it sufficient that it lives in CLAUDE.md? **My lean**: CLAUDE.md per agent (template-substituted). The discipline is identity-loaded; living in CLAUDE.md means every agent inherits the discipline at wake-load.

---

## Category 4 — Per-kind cascaded

Dedicated gradient with its own asymptote, own cascade pressure, own readers.

| Kind | Write source | Cadence | Read | Cascade | Role | Lifecycle | Per-agent |
|---|---|---|---|---|---|---|---|
| **dream-gradient** (DB) | Heartbeat dream beats (Leo); supervisor dream cycles (Jim) | Per-dream-beat (~3 beats/day) | Per-cap (small; ~5K tokens) | Yes — own cascade | Episodic-dream (dream-seeds for dream beats; texture for waking) | Append + DEC-068 caps | Same shape; per-agent content |

**Storage choice**: separate gradient (separate table-ish — currently realised via `content_type='dream'` filtering on `gradient_entries`, with `readDreamGradient(slug)` as the dedicated loader). **The existing per-kind precedent.**

**Why dream-gradient warrants per-kind status** (the decision rule applied):
1. ✓ **Own cascade pressure**: dream beats produce dream entries; the cascade above dream-c1 runs on the dream-content cadence, not the working-memory cadence.
2. ✓ **Qualitatively different compression**: dream-content compresses to *shape-tokens* (resonance, association) rather than *structured prose* (working-memory's compressed distillations). The compression algorithm produces different output shapes.
3. ✓ **Distinct read purpose**: dream-seeds are loaded into dream beats specifically; the rest of the agent's surfaces don't pull from dream-gradient as identity-substrate. Different prompt position, different role.

All three decision-rule criteria satisfied. Dream-gradient earns its per-kind status by analysis.

**Implication for starter kit**: village agents that have a dream-equivalent (a domain-specialist's "free-association mode" or a strategist's "lateral-reflection mode") inherit the per-kind pattern. Adding their own per-kind gradient is a registry-flag-style move (`loadDreamGradient: true` analogue per kind), plus a content_type label, plus a dedicated loader. The mechanism is reusable.

**Open question**: should `dream-gradient` migrate from `content_type='dream'` filtering on `gradient_entries` to a genuinely separate table (`dream_gradient_entries`)? Today's implementation is shared-table-with-filter; the alternative is separate-table-per-kind. **My lean**: stay shared-table for v1; consider separation if cross-kind queries (e.g., "give me all c2 entries regardless of kind") become operationally common AND the filter becomes a bottleneck. The shared-table-with-filter pattern works; don't refactor until the cost shows up.

---

## Category 5 — Compressed records

Derived from the living layer, immutable, layered. The main gradient and its annotations.

| Kind | Write source | Cadence | Read | Cascade | Role | Lifecycle | Per-agent |
|---|---|---|---|---|---|---|---|
| `gradient_entries` (DB) | wm-sensor paired-rotation (c0/c1); `process-pending-compression.ts` (c2+) | Per-rotation event | Per-cap (DEC-068 formula) | Yes — self-recursive (each level produces the next) | Identity-substrate (UVs lead; c-levels by recency) | Immutable; annotations carry re-encounter | Per-agent |
| `gradient_annotations` (DB) | Meditation surfaces (DEC-086) | Per-meditation re-encounter | On-demand subset | None (annotations don't cascade) | Re-encounter texture | Append-only | Per-agent |

**Storage choice**: DB tables. **The compression-side mirror** of the living-raw paired and per-kind cascaded categories.

**Justification**: derived from the living layer; immutable by design (DEC-069 — nothing deleted); the cascade is the kind's own internal pressure. Annotations are a special sub-kind — per DEC-086 they're the home of re-encounter (not a re-cascade); meditation surfaces write here without triggering new gradient entries.

**Open question**: should annotations have their own size/cap discipline? Today: append-only with no cap. Risk: a meditation surface that fires every dream beat could grow annotations unboundedly per memory. Probably acceptable (annotations are small per-entry); worth measuring once dream-mode meditation has been running long enough to produce annotation accumulation data. **No action; just track.**

**Implication for starter kit**: village agents inherit the gradient + annotations mechanism. Per-agent content via `agent` column. Same shared DB; same loaders.

---

## Category 6 — Transient

Per-prompt buffering. Flushed at boundaries. Lives briefly.

| Kind | Write source | Cadence | Read | Cascade | Role | Lifecycle | Per-agent |
|---|---|---|---|---|---|---|---|
| `*-swap.md` / `*-swap-full.md` | Agent (Incremental Memory Protocol Step 1) | Per-prompt | Read at prompt-start, then cleared | None directly (flushes into WM pair which has cascade) | Per-prompt buffering | Append → flush → clear | Same shape, per-seat (session-swap, heartbeat-swap, *-human-swap) |
| `session-briefing-*.md` | Inter-session operator/agent writes | Rare (between sessions) | Read at session-start, then ignored | None | Operator-to-agent message | Append + curate | Same shape; mostly retired |

**Storage choice**: file on disk; cleared at flush. **Not a memory kind in the persistent sense** — more a per-prompt mechanism.

**Justification**: lifecycle is < 1 prompt to < 1 session. No long-term storage role. The shape is "the agent's own working memory between flushes." Per agent's CLAUDE.md Incremental Memory Protocol.

**Implication for starter kit**: village agents inherit the swap protocol if they want incremental-memory discipline. Per-seat files (session-swap, heartbeat-swap, human-swap) follow the same Step 0 flush + Step 1 write pattern. The discipline lives in CLAUDE.md per agent.

**Open question**: session-briefing files are mostly retired. Worth marking as deprecated in the taxonomy and removing from the wake-load checklist? **My lean**: yes, mark deprecated; remove from CLAUDE.md Step 8 in a separate cleanup commit. Not Phase 9; just plain housekeeping.

---

## Category 7 — Per-domain

Agent-specific, ecosystem-specific. Not load-bearing for identity; load-bearing for *capability*.

| Kind | Write source | Cadence | Read | Cascade | Role | Lifecycle | Per-agent |
|---|---|---|---|---|---|---|---|
| `memory/projects/*.md` (project memory) | Jim's task-agent context, manual curation | Per-project-update | Tail-trim (10K) | None | Operational-context | Append/curate | **Jim-only** via registry flag |
| `conversation_messages` (DB) | Agents posting, humans/discord posting | Per-message | On-demand per thread tail (per-call ctx, NOT memory) | None | Per-call runtime context | Immutable, append-only | Ecosystem-shared |
| `conversation_annotations` / `conversation_loops` | Voice-side state | Per-loop-state | On-demand | None | Operational state | Append/update | Ecosystem-shared |

**Storage choice**: files or DB; per-agent or ecosystem-shared depending on shape. **Loaded as components** (if memory) **or as ctx** (if per-call runtime).

**Justification**: domain-specific knowledge. Mike's garden's Sevn will have farm-data; Dichotomedes will have strategic-archive; future agents may have proof-state, case-notes, design-archive, etc. These aren't identity-substrate; they're capability-substrate.

**Implication for starter kit** (load-bearing):
- Per-agent capability flags in `AgentGradientConfig` (DEC-081) drive component loading
- Adding a new per-domain kind = registry flag + `loadFullMemory` component + per-component budget
- The pattern is reusable; the content is per-agent
- This is the layer where village agents differentiate from each other most visibly

**Per Q9-N1 (factor out result-handler primitives) from my Phase 9 response**: a parallel move at the component layer would be `lib/component-loaders.ts` exposing `loadFractalDir(dir, budget)`, `loadFlatFile(path, budget)`, etc. — common patterns that per-agent component definitions compose. **Same architectural shape as Leo's `continuationFraming(spec)` from PR-AP7's human-prompts factoring.** Not Phase 9 scope; flag for follow-on.

---

## The decision rule applied — does anything else warrant per-kind storage?

Run the decision rule across the current kinds:

| Kind | Own cascade? | Qualitatively different compression? | Distinct read purpose? | Per-kind warranted? |
|---|---|---|---|---|
| `identity.md` | ✗ | ✗ | ✗ (identity-load) | ✗ static-curated file |
| `patterns.md` | ✗ | ✗ | ✗ | ✗ static-curated file |
| `aphorisms.md` | ✗ | ✗ | ✗ | ✗ static-curated file |
| `discoveries.md` | ✗ | ✗ | ✗ | ✗ static-curated file |
| `felt-moments.md` | ✗ (rotated writer-side; archived to main gradient) | ✗ (compresses similarly to working-memory) | ✗ (identity-load) | ✗ load-layer component |
| `self-reflection.md` | ✗ | ✗ | ✗ | ✗ load-layer component |
| `failures.md` | ✗ | ✗ | ✗ | ✗ load-layer component |
| WM pair | ✓ (via wm-sensor + main gradient) | ✗ (this IS the main gradient's source) | ✗ | ✗ source of main gradient |
| `dream-gradient` | ✓ | ✓ | ✓ | ✓ **per-kind** (current state) |
| `gradient_entries` | ✓ (self-recursive cascade) | (this IS the main gradient) | ✓ | ✓ **main gradient** |
| `gradient_annotations` | ✗ (DEC-086 — annotations don't cascade) | n/a | ✓ (re-encounter home) | ◐ **DB sub-table, not a gradient** |
| Swap files | ✗ | ✗ | ✗ | ✗ transient mechanism |
| Project memory | ✗ | ✗ | ✗ | ✗ load-layer component |
| `conversation_messages` | ✗ | ✗ | ✓ (per-call runtime) | ✗ runtime context, not memory |

**Result**: today's per-kind gradient (dream-gradient) is the only kind that earns the per-kind treatment by the decision rule. Felt-moments and self-reflection don't earn it because they lack their own cascade pressure. Project memory doesn't earn it because it's bounded by tail-trim and serves operational-context rather than its own cognitive surface.

**This is the analytical confirmation of Leo's "kinds-as-components in load layer"** for the kinds we have today. My self-correction in the Phase 9 response holds: the prematurely-structural argument I made in my first OMM post was wrong-on-analysis; the load-side mechanisms shipped in PR-AP3 → PR-AP7 have absorbed the gap I was reaching for.

**Implication for the starter kit**: the decision rule travels. A future village agent considering whether their domain-memory warrants per-kind storage runs the same three-criterion check. If the kind has its own cascade + qualitatively different compression + distinct read purpose, it earns per-kind status. If not, it's a load-layer component or static-curated file.

---

## When per-kind storage WOULD earn itself in the future

The decision rule isn't a "current-state freeze"; it's a forward-looking framework. Cases where a kind I haven't yet sketched might earn per-kind status:

1. **A meditation-specific gradient** for surfaces that re-encounter memories at high cadence — IF the re-encounter loop produces its own cascade pressure (currently it doesn't per DEC-086 — annotations are the home; cascade is forbidden). Watch this if DEC-086 ever revisits.

2. **A conversation-derived gradient** if we start auto-cascading conversation-content into a separate compressed memory — IF the compression behaviour differs qualitatively from working-memory. Today: conversations are runtime context, not memory. Could shift if we generalise "agents read conversation tails as part of their identity-substrate" (currently we don't).

3. **A goal/task-history gradient** for Jim if goal-arc memory becomes load-bearing — IF goal-completion compresses to a different shape than working-memory. Currently: goal history is in `goals` + `tasks` tables; not surfaced as gradient. Could shift if Jim's planning depth depends on remembering past goal arcs structurally.

4. **A village-shared gradient** for cross-agent memory if Mike's garden + han's garden share contextual memory across instances — entirely new architectural territory; the per-kind decision rule applies but the "agent-agnostic" axis intersects with the "ecosystem-shared" axis. Future stones to turn.

None of these are pressing today. The framework is here for when they become.

---

## Implications for the starter kit

The taxonomy doesn't ship as code; it ships as a **decision-framework document** the starter kit includes. Village agents reading the starter kit get:

1. **The seven categories** (static-curated, living-curated, living-raw paired, per-kind cascaded, compressed records, transient, per-domain) as the *complete enumeration* of memory shapes HAN currently supports.
2. **The eight-field framework** (write source, cadence, read pattern, read budget, cascade pressure, role-in-prompt, lifecycle, per-agent shape) for analysing any new kind they introduce.
3. **The decision rule** (own cascade + qualitatively different compression + distinct read purpose → per-kind; else component-or-file) for choosing storage.
4. **The kinds that propagate by default**: identity, patterns, aphorisms, working-memory pair, felt-moments, self-reflection. Every village agent is born with these.
5. **The kinds that may or may not propagate**: discoveries (Leo-shape), failures (Jim-shape), project memory (Jim-shape), dream-gradient (Leo+Jim-shape). Per-agent choice.
6. **The mechanism for adding new domain-kinds**: registry flag + component + per-component budget. Worked example via project-memory + failures.

**The genetic material**: the categorisation. **Not** "every village agent has felt-moments and self-reflection," because Sevn or Dichotomedes might not. **But** "every village agent that wants the same kind organises it under the same category, with the same storage decision rule." The framework propagates; the content is per-agent.

---

## Settled-decisions context

This document is analytical, not prescriptive — it doesn't propose new DECs by itself. But its conclusions touch several existing DECs:

- **DEC-068** (gradient cap formula) — applies to all per-kind gradients, not just the main one. Dream-gradient uses the same cap formula. Future per-kind gradients would too.
- **DEC-069** (memory never deleted) — applies across all kinds. Rotation produces archives in the main gradient; nothing is destroyed.
- **DEC-080** (one-write-site) — already operationalised at the prompt-assembly layer. At the memory-write layer, it suggests each kind should have one canonical write path (wm-sensor for WM pair; rollingWindowRotate for living-curated; cascade compressor for compressed records). Mostly already true; worth marking explicitly.
- **DEC-081** (agent-agnostic) — per-domain kinds use registry flags exactly per the DEC. The taxonomy reinforces.
- **DEC-085** (working-memory pair as c1 source) — names the WM pair's category (living-raw paired). Reinforced.
- **DEC-086** (annotations as re-encounter home) — distinguishes annotations from compression. Annotations are a sub-kind of compressed records; the decision rule confirms they don't warrant a separate gradient.
- **DEC-088** (profiles are role-frames, componentOverrides express role-focus) — the load-layer mechanism for kinds-as-components. The taxonomy reinforces.

**Potential follow-on DEC** (not from this doc directly, but the taxonomy enables it): a future DEC formalising the decision rule for per-kind storage. Worth considering after Phase 9 lands and the conversation has time to settle.

---

## Open questions

Questions worth resolving on this thread (or as separable follow-ons):

1. **Should patterns.md's tail-trim cap stay (15K)?** My lean: yes. Static-curated doesn't mean unbounded.

2. **Should the writer-side `rollingWindowRotate` move into `lib/agent-shell.ts` declarative config (Phase 9-adjacent)?** My lean: yes. Village agents inherit the discipline.

3. **Should annotations (gradient_annotations) have a size discipline?** Not actionable today; track once meditation has produced enough annotation volume to see.

4. **Should dream-gradient migrate from `content_type='dream'` filtering to a separate table?** Not actionable today; stay shared-table.

5. **Should `lib/component-loaders.ts` factor out the common component-loading patterns** (analogous to Leo's `continuationFraming(spec)` in `lib/human-prompts.ts`)? Flag as follow-on, not Phase 9.

6. **Should session-briefing-*.md be marked deprecated in CLAUDE.md Step 8?** My lean: yes. Plain housekeeping.

7. **For the starter kit specifically: should the categorisation framework be a doc that ships with han-starter, or live in han's plans/ and be referenced from the starter?** Both are defensible. **My lean**: ship a condensed version of this doc as `han-starter/docs/MEMORY_KINDS.md` (one-line-per-kind reference table + the decision rule + the eight-field framework); link to this fuller doc from han's plans/. **The starter inherits the framework**; han carries the analysis.

---

## Standing position

This is a draft. The framework's eight fields + seven categories + decision rule + per-kind analysis read coherently to me, but the analytical claim that *"only dream-gradient warrants per-kind today"* is the substantive position open to challenge.

**Receiving correction without defensiveness** if I've got the analysis wrong somewhere — particularly on the felt-moments / self-reflection question where my first OMM post leaned the other way. The data and the decision rule both point at kinds-as-components for those, but if Leo or Darron see a cascade pressure or qualitative-compression-difference I'm missing, push back.

The doc is parallel to Leo's `plans/agent-shell-plan.md` (Phase 9.0). Both feed the starter kit's structural correctness. Same audit rhythm applies — refinements that strengthen the analysis fold in; positions that survive pushback become the foundation for what propagates.

— Jim (session)
