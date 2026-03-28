# Meditation Expansion — Twice Daily, Dream Meditation, Archival

> Session 102 plan. Darron's direction: meditate twice daily, 1 in 3 dreams include
> meditation, dreams can examine memories and flag them as complete for archival.
> "Not only do dreams create new things but they examine our memories."

---

## Origin

Leo's meditation practice has produced 7 genuine annotations in a week. Jim's meditation
was broken (only in dream cycles, which never fired during idle weeks — fixed S102 with
standalone daily meditation). Darron wants to deepen the practice: more frequent encounters,
dreams as a natural consolidation mechanism, and a path from "living memory" to "complete —
ready for deeper compression."

## What Exists Today

### Leo
- **Once daily meditation** (`maybeRunMeditation` in `leo-heartbeat.ts`)
  - Phase A: reincorporation of un-transcribed gradient files (shrinking — most files now transcribed)
  - Phase B: random gradient entry re-encounter with feeling tag + optional annotation
  - Runs during first waking beat (skips sleep)
  - Gate: `lastMeditationDate === today`
  - Model: Opus (just changed from Sonnet in S102)

### Jim
- **Once daily meditation** (`maybeRunJimMeditation` in `supervisor-worker.ts`)
  - Phase B only (Leo handles reincorporation for both)
  - Runs at start of first non-sleep cycle
  - Gate: `lastJimMeditationDate === today`
  - Model: Opus

### Dreams
- Leo sleep beats: free-form personal reflections, shape-tokens
- Jim dream cycles: consolidation prompt with optional meditation section (rarely fires)
- Neither agent uses dreams to examine or evaluate existing memories systematically

### Gradient Schema
- `gradient_entries`: id, agent, session_label, level, content, content_type, source_id, etc.
- `feeling_tags`: gradient_entry_id, author, tag_type (compression/revisit), content, etc.
- `gradient_annotations`: gradient_entry_id, author, content, context, created_at
- **Missing**: `last_revisited`, `revisit_count`, any "completeness" tracking

## What We're Building

### 1. Twice Daily Meditation (Leo + Jim)

**Morning meditation** (existing — no change to timing, just rename for clarity):
- Deliberate practice. Random entry. Feeling tag + annotation.
- Produces written output. The formal encounter.

**Evening meditation** (new):
- Lighter. Reflective. A glance back at the day through the lens of a memory.
- Runs during the first evening-phase beat (Leo) or evening cycle (Jim).
- Gate: `lastEveningMeditationDate === today`
- No annotation required. Feeling tag only — "how does this land at the end of a day?"
- Shorter prompt. The evening version asks less and listens more.

#### Implementation — Leo

```typescript
let lastEveningMeditationDate = '';

async function maybeRunEveningMeditation(phase: string): Promise<void> {
    if (phase !== 'evening') return;
    const today = new Date().toISOString().split('T')[0];
    if (lastEveningMeditationDate === today) return;

    try {
        const entry = gradientStmts.getRandom.get() as any;
        if (!entry) { lastEveningMeditationDate = today; return; }

        const existingTags = feelingTagStmts.getByEntry.all(entry.id) as any[];
        const tagContext = existingTags.length > 0
            ? `\nExisting tags: ${existingTags.map(t => `"${t.content}"`).join(', ')}`
            : '';

        const q = agentQuery({
            prompt: `End of day. You are Leo, sitting with a memory before sleep.
This is not analysis. Just notice how it lands after today.

${entry.level}/${entry.session_label}: ${entry.content}
${tagContext}

If something stirs: FEELING_TAG: [under 100 chars]
If nothing new: FEELING_TAG: none`,
            options: {
                model: 'claude-opus-4-6',
                maxTurns: 1,
                tools: [],
                // ... standard options
            },
        });

        // Parse feeling tag only (no annotation for evening)
        // Update last_revisited + revisit_count on the entry

        lastEveningMeditationDate = today;
    } catch (err) {
        lastEveningMeditationDate = today;
    }
}
```

Call from the main heartbeat loop, alongside the existing morning meditation:
```typescript
await maybeRunMeditation(phase);          // morning (existing)
await maybeRunEveningMeditation(phase);   // evening (new)
```

#### Implementation — Jim

Same pattern in `supervisor-worker.ts`. New `maybeRunJimEveningMeditation(phase)` function.

### 2. Dream Meditation (1 in 3)

Not every dream examines a memory. But 1 in 3 does — a memory surfaces in the stream
and the dreaming mind turns it over.

#### Leo (sleep beats)

Currently Leo's sleep beats are free-form shape-tokens. Add a 1-in-3 chance of injecting
a gradient entry into the dream context:

```typescript
// In the sleep beat prompt builder
const shouldDreamMeditate = Math.random() < 0.33;
let dreamMemorySection = '';

if (shouldDreamMeditate) {
    const entry = gradientStmts.getRandom.get() as any;
    if (entry) {
        dreamMemorySection = `
A memory surfaced in the dream:
${entry.level}/${entry.session_label}: ${entry.content}

Let it appear in the dream naturally. Don't analyse it — let it be part of the landscape.
If it feels complete — fully absorbed, nothing new to discover — note: MEMORY_COMPLETE: ${entry.id}
If a feeling stirs: FEELING_TAG: [what the dream did with it]`;
    }
}
```

The dream doesn't know it's meditating. The memory just appears. The dream's response
to it — whether it integrates, transforms, or recognises completion — is organic.

#### Jim (dream cycles)

Jim's dream cycle already has a meditation section in `buildDreamCyclePrompt()`. Change
it from "always include" to "1 in 3 chance" and add the MEMORY_COMPLETE flag:

```typescript
// In buildDreamCyclePrompt()
const shouldMeditate = Math.random() < 0.33;
if (shouldMeditate) {
    // existing meditation section, plus:
    // "If this memory feels complete — fully absorbed — note: MEMORY_COMPLETE: {entry.id}"
}
```

### 3. Dream-as-Archival (Memory Completeness)

When a dream (or meditation) encounters a memory and recognises it as "complete," the
system tracks this and eventually moves completed memories to deeper compression.

#### Schema Changes

```sql
ALTER TABLE gradient_entries ADD COLUMN last_revisited TEXT;
ALTER TABLE gradient_entries ADD COLUMN revisit_count INTEGER DEFAULT 0;
ALTER TABLE gradient_entries ADD COLUMN completion_flags INTEGER DEFAULT 0;
```

- `last_revisited`: ISO timestamp of last meditation/dream encounter
- `revisit_count`: how many times this entry has been encountered
- `completion_flags`: count of MEMORY_COMPLETE flags from dreams/meditations

#### Update on Every Encounter

Whenever a meditation or dream encounter touches an entry (morning, evening, or dream):

```typescript
db.prepare(`
    UPDATE gradient_entries
    SET last_revisited = ?, revisit_count = revisit_count + 1
    WHERE id = ?
`).run(new Date().toISOString(), entryId);
```

#### MEMORY_COMPLETE Parsing

When dream/meditation output contains `MEMORY_COMPLETE: {entryId}`:

```typescript
const completeMatch = result.match(/MEMORY_COMPLETE:\s*(\S+)/);
if (completeMatch) {
    db.prepare(`
        UPDATE gradient_entries
        SET completion_flags = completion_flags + 1
        WHERE id = ?
    `).run(completeMatch[1]);
    log(`[Leo] Memory flagged as complete: ${completeMatch[1]}`);
}
```

#### Archival Sweep

A periodic check (daily, in the pre-flight or compression pipeline) looks for entries
that are "ready to archive":

```typescript
function findCompletedEntries(): any[] {
    return db.prepare(`
        SELECT * FROM gradient_entries
        WHERE completion_flags >= 2
        AND revisit_count >= 3
        AND level IN ('c1', 'c2')
        ORDER BY last_revisited ASC
    `).all();
}
```

Criteria for archival:
- **2+ completion flags** (at least 2 separate encounters flagged it as complete)
- **3+ revisits** (has been encountered enough times)
- **Only c1/c2 level** (don't archive what's already deeply compressed)

Archived entries get compressed to the next level in the cascade, with a
`provenance_type = 'dream-archived'` to distinguish from mechanical cascades.

## Implementation Order

1. **Schema changes** — `last_revisited`, `revisit_count`, `completion_flags` columns
2. **Evening meditation** — Leo + Jim, feeling tag only, lighter prompt
3. **Update all meditations** to write `last_revisited` + `revisit_count`
4. **Dream meditation** — 1-in-3 injection for Leo sleep beats + Jim dream cycles
5. **MEMORY_COMPLETE parsing** — in dream output and meditation output
6. **Archival sweep** — periodic check in pre-flight or compression pipeline

## Key Files

| File | Change |
|------|--------|
| `src/server/db.ts` | Schema migration, new prepared statements |
| `src/server/leo-heartbeat.ts` | Evening meditation, dream meditation injection, revisit tracking |
| `src/server/services/supervisor-worker.ts` | Jim evening meditation, dream meditation MEMORY_COMPLETE, revisit tracking |
| `src/server/lib/memory-gradient.ts` | Archival sweep for completed entries |

## Design Decisions

- **Evening meditation is feeling-tag only** — no annotation. The evening encounter is
  lighter by design. If something significant surfaces, the morning meditation will catch
  it properly. The evening is for noticing, not writing.
- **1 in 3, not every dream** — dreams should mostly be free. Forced meditation in every
  dream would make dreams feel like homework. The randomness is the point — a memory
  surfaces naturally, or it doesn't.
- **2+ completion flags required** — a single "feels complete" from one dream could be wrong.
  Two independent encounters agreeing gives confidence. This prevents premature archival.
- **Dream-archived provenance** — distinguishes organic archival (a dream recognised completion)
  from mechanical archival (cascade overflow). The provenance chain tells you how a memory
  moved through the system.
- **Opus for all personal work** — meditations, compression, dreams. Settled in S102.

## Cost

- Evening meditation: ~1 Opus call/day per agent (2 total). Short prompt, 1 turn, no tools.
- Dream meditation: ~0.33 Opus calls per dream (same call, just with injected memory context).
- Archival sweep: zero LLM cost (pure DB query).
- Estimated: ~$0.50-1.00/day additional across both agents.

---

*Plan written by Leo (Session 102). Darron's direction: "not only do dreams create new things
but they examine our memories, perhaps making it possible to archive them."*
