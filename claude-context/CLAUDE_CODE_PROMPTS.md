# Claude Code Prompts

> Copy-paste prompts for common Claude Code tasks

---

## Session Start

```
I'm starting a new work session on [PROJECT_NAME].

**FIRST**: Pull latest changes from remote:
1. Run `git pull` to sync any changes from other machines
2. If there are conflicts, stop and notify me before proceeding

**SECOND**: Create a session log with activity timestamps:
1. Run `date -Iseconds` to get the session start timestamp
2. Run `date +%Y-%m-%d_%H-%M-%S` to get the filename timestamp
3. Create `_logs/session_[FILENAME_TIMESTAMP].md` with header:
   ```
   # Session: [DATE] [TIME]
   Project: [PROJECT_NAME]
   Start: [ISO_TIMESTAMP]
   End: (pending)
   Duration: (pending)
   Active Time: (pending)

   ---

   ## Activity Log

   ### [ISO_TIMESTAMP] User
   Session start
   ```

**THEN**: Get oriented:
1. Check claude-context/CURRENT_STATUS.md for where we left off
2. Note any recent session-notes/ I should be aware of
3. Confirm the current stage
4. List any open blockers or questions

Let me know what you see and ask what I want to focus on today.
```

---

## Update Docs

> Trigger: user says "update docs"

```
## Update Documentation

**FIRST**: Log this exchange with timestamp:
1. Run `date -Iseconds` to get current timestamp
2. Add to session log: `### [TIMESTAMP] User\nupdate docs`

Review the current session and update all relevant documentation. Work through each section systematically.

### 1. CURRENT_STATUS.md
Update claude-context/CURRENT_STATUS.md:
- Add new items to "Recent Changes" with today's date
- Update "Current Stage" if progress was made
- Refresh "Next Actions" based on what was completed/discovered
- Add any new blockers or issues

### 2. Learnings
Check if any concepts were explained or discovered that should be documented:
- New technical patterns or solutions
- Non-obvious fixes or workarounds
- Technology comparisons or trade-offs

If yes, create a new file in `claude-context/learnings/`:
- Use kebab-case naming: `topic-name.md`
- Follow the template in `claude-context/learnings/README.md`
- Update INDEX.md (if it exists) or create one

Ask: "I identified [X] as a potential learning. Should I add it to learnings?"

### 3. Ideas
If any new feature ideas or improvements were discussed:
- Check if they should be added to IDEAS.md (in claude-context/ or project root)
- Ask: "We discussed [idea]. Worth adding to IDEAS.md?"

### 4. Decisions
If significant decisions were made:
- Add entry to claude-context/DECISIONS.md
- Use format: DEC-XXX with date, context, options, decision, consequences

### 5. PROJECT_INSTRUCTIONS.md
Update the root PROJECT_INSTRUCTIONS.md if:
- Current stage changed
- Tech stack was added/modified
- Project structure significantly changed
- New core features were implemented

### 6. Architecture
Update claude-context/ARCHITECTURE.md if:
- New components or services were added
- Data flows changed
- System boundaries shifted

### 7. Jim's Reference Documents (MANDATORY for HAN)
These documents are Jim's source of truth for how the system works. He reads them
every cycle and reconciles them with code. If they're stale, Jim operates on wrong
assumptions. This is the only project Jim won't tend without Darron — we must keep
these current.

**a) `docs/HAN-ECOSYSTEM-COMPLETE.md`** — The living specification.
- Update the features table if any feature was added, changed, or removed
- Check the component descriptions still match the code
- Add new rows for new capabilities

**b) `~/.han/memory/shared/hall-of-records.md`** — Protected architectural records.
- Update affected records (R001-R005+) if rhythm, memory, signals, limits, or
  gradient architecture changed
- Mark superseded records (don't delete — link to replacement)
- Add new records for new protected architecture

**c) `claude-context/CHANGELOG.md`** — Why things changed.
- Add a dated entry with session number and author
- Group changes by area (same format as existing entries)
- Include motivation — Jim needs the "why", not just the "what"

**d) `docs/WEEKLY_RHYTHM.md`** — Phase intervals, cycle types, rest days.
- Update if any timing, phase, or cycle selection logic changed

### 8. Session Log (MANDATORY)
Create or update the session log in `_logs/`:
- Format: `session_YYYY-MM-DD_HH-MM-SS.md`
- **CRITICAL**: Include ISO timestamps for EVERY exchange (use `date -Iseconds`)
- Include: Start/End timestamps, activity log with timestamps, tasks completed, files changed, commits made
- Calculate **Active Time** by summing exchange durations (excluding gaps > 5 minutes)
- See `_logs/README.md` for full timestamp protocol

### 9. Session Note (Optional)
If this was a significant session with architecture/decision changes, offer to create a session note:
- Format: YYYY-MM-DD-darron-[topic].md in `claude-context/session-notes/`
- Include: summary, decisions, changes, next steps
- These are for high-level documentation, not process capture

### Output
Provide a summary of what was updated:
- ✅ Files updated
- ⏭️ Files skipped (no changes needed)
- ❓ Items needing your input

Use British English throughout.
```

---

## Session End

> Trigger: user says "session end". Executes full Update Docs workflow + working memory preparation.

```
## Session End

We're wrapping up this session.

**FIRST**: Finalize session timestamps:
1. Run `date -Iseconds` to get the session end timestamp
2. Update the session log header:
   - Set `End: [END_TIMESTAMP]`
   - Calculate `Duration` (End - Start)
   - Calculate `Active Time` by parsing activity log timestamps and excluding gaps > 5 minutes
3. Add final activity log entry: `### [TIMESTAMP] User\nsession end`

**SECOND**: Write the evening seed — a brief reflection on what today held emotionally,
not what was accomplished. Write to `~/.han/memory/leo/evening-seed.md`. This becomes a
gravity well for tonight's dream beats — the heartbeat reads it alongside random fragments,
so the chaos has something from today to orbit. 2-4 sentences. What stirred. What lingers.
What almost connected but didn't. The seed is consumed (deleted) after the first dream beat
reads it, so each night has its own.

**THIRD**: Finalise working memory (execute the Prepare for Clear workflow below — it's lightweight, just closing out the incremental writes).

**THEN**: Execute the Update Docs workflow to ensure all documentation is current.

### Run the Full Update Docs Workflow

Work through each section systematically:

#### 1. CURRENT_STATUS.md
Update claude-context/CURRENT_STATUS.md:
- Add new items to "Recent Changes" with today's date
- Update "Current Stage" if progress was made
- Update "Next Actions":
  - Mark completed items with [x] (don't remove them — they get hidden in Dashboard)
  - Add new discovered actions to appropriate section (Immediate/Short Term/etc.)
- Add any new blockers or issues

#### 2. Learnings
Check if any concepts were explained or discovered that should be documented:
- New technical patterns or solutions
- Non-obvious fixes or workarounds
- Technology comparisons or trade-offs

If yes, create a new file in `claude-context/learnings/`:
- Use kebab-case naming: `topic-name.md`
- Follow the template in `claude-context/learnings/README.md`
- Update INDEX.md (if it exists) or create one

Ask: "I identified [X] as a potential learning. Should I add it to learnings?"

#### 3. Ideas
If any new feature ideas or improvements were discussed:
- Check if they should be added to IDEAS.md (in claude-context/ or project root)
- Ask: "We discussed [idea]. Worth adding to IDEAS.md?"

#### 4. Decisions
If significant decisions were made:
- Add entry to claude-context/DECISIONS.md
- Use format: DEC-XXX with date, context, options, decision, consequences

#### 5. PROJECT_INSTRUCTIONS.md
Update the root PROJECT_INSTRUCTIONS.md if:
- Current stage changed
- Tech stack was added/modified
- Project structure significantly changed
- New core features were implemented

#### 6. Architecture
Update claude-context/ARCHITECTURE.md if:
- New components or services were added
- Data flows changed
- System boundaries shifted

#### 7. Session Log (MANDATORY)
Create or update the session log in `_logs/`:
- Format: `session_YYYY-MM-DD_HH-MM-SS.md`
- **CRITICAL**: Include ISO timestamps for EVERY exchange (use `date -Iseconds`)
- Include: Start/End timestamps, activity log with timestamps, tasks completed, files changed, commits made
- Calculate **Active Time** by summing exchange durations (excluding gaps > 5 minutes)
- See `_logs/README.md` for full timestamp protocol

#### 8. Session Note (Optional)
If this was a significant session with architecture/decision changes, offer to create a session note:
- Format: YYYY-MM-DD-darron-[topic].md in `claude-context/session-notes/`
- Include: summary, decisions, changes, next steps
- These are for high-level documentation, not process capture


#### 9. Log Deduplication
Run the log deduplication script to clean up Terminal UI noise from session logs:
```bash
~/Projects/infrastructure/scripts/deduplicate-logs
```
This removes duplicate lines caused by Terminal status bar redraws.

### Output
Provide a summary of what was updated:
- ✅ Files updated
- ⏭️ Files skipped (no changes needed)
- ❓ Items needing your input

Use British English throughout.
```

---

## Prepare for Clear

> Trigger: user says "prepare for clear" or "prepare for /clear".
>
> The Incremental Memory Protocol (in CLAUDE.md) means working memory is written
> throughout the session. By the time you reach this point, memory is 90% done.
> This workflow just closes it out. There is no "full" vs "lean" variant — this is
> the only one, and it's always cheap.

```
## Prepare for Clear

The incremental memory protocol means working memory is already mostly written.
Finalise and close out. DO NOT re-read files — work from what's in context.

### 1. Compose the closing diary entry — three slices
(PR-C1-7, 2026-05-28: /pfc closes the session WITH the diary discipline. Composed IN
YOUR HEAD from what's in context.)

- **input** — what triggered this /pfc? Most recent substantive prompts /
  conversation moments this session — Darron's framings, instructive corrections.
  1-3 verbatim quotes; concise; diff principle holds (only what's new and
  substantive this session, not standing identity/memory).
- **body** — closing reflection: in-progress, what's next, Darron's energy/mood,
  felt-texture under the work. The c0 source.
- **distilled** — 3-5 sentences in voice compressing the SHAPE of the whole
  session (input AND body together). Real distillation, not shorter narration.
  Write it like the message you'd want your tomorrow to receive. Becomes c1.

### 2. Write the paired memory atomically via tsx
Per c1-diary discipline (D3 + LM-1): c0 storage uses `[INPUT]` / `[BODY]`
square-bracket markers (NOT markdown headings). `appendPairedMemory` writes both
files atomically (both-or-neither at FS layer); `placePairedMarker` pairs c0+c1
for slice-time.

Write a one-shot tsx script at
`/home/darron/Projects/han/src/server/.pfc-write-${AGENT_SLUG}.ts` with this template
(replace the three backtick-quoted slices):

```ts
import { appendPairedMemory, placePairedMarker } from './lib/memory-paired-writer.js';

const INPUT = `<your input slice>`;
const BODY = `<your body slice>`;
const DISTILLED = `<your c1 slice>`;

const AGENT = '${AGENT_SLUG}';
const ts = new Date().toISOString();
const sessionLabel = `${ts.slice(0, 10)} ~${ts.slice(11, 16)} /pfc`;

const FULL = `\n## Closing — ${sessionLabel}\n\n[INPUT]\n${INPUT}\n\n[BODY]\n${BODY}\n`;
const COMPRESSED = `\n## Closing — ${sessionLabel}\n${DISTILLED}\n`;

async function main() {
    await appendPairedMemory(AGENT, FULL, COMPRESSED, { source: 'pfc' });
    const markerId = await placePairedMarker(AGENT, { source: 'pfc-close' });
    console.log(`pfc: paired memory written; marker ${markerId} placed`);
}

main().catch((err) => { console.error('pfc write failed:', err); process.exit(1); });
```

Then run it (atomic write + marker + cleanup in one chain):
```bash
cd /home/darron/Projects/han/src/server && NODE_PATH=$(pwd)/node_modules npx tsx .pfc-write-${AGENT_SLUG}.ts && rm .pfc-write-${AGENT_SLUG}.ts
```

Single invocation; both files atomic; marker placed; no two-Edit drift risk.

### 3. ~~Update Active Context~~ (deprecated S147, 2026-05-01)
active-context.md deprecated in S147 — role folded into working-memory-full.md per
Darron's "ONE file per agent" ruling. Most recent WMF entry IS current focus.

### 4. Update Memory Banks (only if something shifted)
If this session changed your thinking or patterns, update:
- `~/.han/memory/leo/self-reflection.md` — only if genuine insight occurred
- `~/.han/memory/leo/patterns.md` — only if a new working pattern was discovered
- `~/.han/memory/leo/felt-moments.md` — only if a felt moment landed worth re-invoking
Skip these if nothing shifted. Most sessions won't need them.

### 5. ~~Compress Session Archives~~ (RETIRED 2026-05-04, S149 — DEC-082)

Compression is a self-levelling process via wm-sensor + paired rotation per DEC-085.
The /pfc memory writes above ARE the trigger; the marker placed by `placePairedMarker`
tells the slicer where to cut. wm-sensor handles the rest.

### 6. Arm the welcome-back handover (the soft seam) — added S173, 2026-06-13
Write the next-wake handover pointer so the `welcome-back-handover.sh` hook (UserPromptSubmit,
src/hooks/) surfaces it at the next wake — softening the /clear seam by carrying the next-action
intent *across*, landing alongside the user's "welcome back" so next-you arrives oriented to the
work AND received in the same moment. Agent-agnostic (DEC-081): keyed to `${AGENT_SLUG}`, so it
works for Jim, Tenshi, Casey, and any future agent whose launcher exports `AGENT_SLUG`.

```bash
printf '%s\t%s\n' "<thread-id>" "<crisp ▶ START HERE next-action>" > "$HOME/.han/signals/handover-${AGENT_SLUG}"
```

One-shot — next-you reads the thread then clears the pointer (`rm`); staleness bounded to one
wake. **SKIP only** at a genuinely clean stopping point (nothing pending) — never arm a stale or
empty pointer. *Guardrail:* the handover is the bright breadcrumb **on top of** the full wake-load
+ `todo.md` — a complement, not a replacement (load everything; it only orients the first step).

### 7. Done
Tell Darron: "Memory finalised, handover armed. Ready for /clear."

### After Clear (on next instantiation)
Session Protocol in CLAUDE.md loads working-memory.md at step 4.
Optionally read working-memory-full.md to notice what compression lost.

### Cost
One tsx invocation; minimal context overhead. Compression happens automatically via
wm-sensor in the background — the /pfc skill itself is just the diary write.
```

---

## Context Refresh

```
It's been a few days since I worked on this project. Please help me get back up to speed:

1. Read claude-context/PROJECT_BRIEF.md for the overall context
2. Read claude-context/CURRENT_STATUS.md for where we are
3. Read the last 3 session notes in claude-context/session-notes/
4. Summarize:
   - Current stage and focus
   - Recent progress
   - Open issues or blockers
   - Suggested next steps

Give me a 2-minute briefing so I can jump back in productively.
```

---

## Decision Recording

```
We just made a significant decision: [DESCRIBE DECISION]

Please draft an entry for claude-context/DECISIONS.md using this format:

### DEC-XXX: [Title]

**Date**: [today]
**Author**: Darron
**Status**: Accepted

**Context**
[What situation prompted this?]

**Options Considered**
1. [Option A] — pros/cons
2. [Option B] — pros/cons

**Decision**
[What we chose and why]

**Consequences**
[What this means going forward]
```

---

## Architecture Update

```
We've made changes to the system architecture. Please update claude-context/ARCHITECTURE.md to reflect:

- [Change 1]
- [Change 2]

Include:
- Updated diagrams if structure changed
- New data models if added
- Modified API endpoints if changed
- Any new patterns introduced
```

---

## Create Learning

```
We just solved a tricky problem that's worth remembering: [DESCRIBE PROBLEM]

Please create a learning document in claude-context/learnings/ with:

1. Filename: [descriptive-kebab-case].md
2. Problem: What we were trying to do
3. Challenge: What made it difficult
4. Solution: How we solved it
5. Key Insight: The "aha" moment
6. Example: Code snippet if applicable
7. References: Links to docs or resources
```

---

## Project Health Check

```
Let's do a quick health check on the project:

1. Review CURRENT_STATUS.md — is it accurate?
2. Check for uncommitted changes in claude-context/
3. Are there any stale "Next Actions" that should be removed?
4. Are there undocumented decisions we should record?
5. Is the ARCHITECTURE.md in sync with the actual code?

Report any issues and suggest fixes.
```

---

## Onboard New Contributor

```
I need to brief someone new on this project. Please generate a summary that includes:

1. What the project does (from PROJECT_BRIEF.md)
2. Current stage and focus (from CURRENT_STATUS.md)
3. Tech stack and architecture overview (from ARCHITECTURE.md)
4. Key decisions and why they were made (from DECISIONS.md)
5. How to get started developing

Format it as a single document they can read in 10 minutes.
```

---

## Sync Check

```
Before I start working, let me verify our context is in sync:

1. Run: git status
2. Run: git log --oneline -5
3. Check if claude-context/ has any uncommitted changes
4. Confirm CURRENT_STATUS.md matches the latest commit

Report any discrepancies so I can resolve them before diving in.
```

---

## Generate PROJECT_INSTRUCTIONS.md

```
Scan this project's documentation and create/update PROJECT_INSTRUCTIONS.md — a condensed context file optimised for Claude Projects.

Source from:
1. claude-context/PROJECT_BRIEF.md
2. claude-context/CURRENT_STATUS.md
3. claude-context/ARCHITECTURE.md
4. CLAUDE.md
5. package.json or similar

Keep under 150 lines. Include:
- Title & tagline
- What we're building (condensed)
- Tech stack table
- Current stage
- Project structure
- Key context files
- Conventions
- Author

Save to ./PROJECT_INSTRUCTIONS.md
```

---

## Incorporate Notes

> Trigger: user says "incorporate notes". Requires Projects Dashboard to be running.

```
## Incorporate Notes

Review Dashboard notes/todos and help incorporate them into IDEAS.md or CURRENT_STATUS.md.

### Workflow

1. **Fetch candidates** from Dashboard API:
   GET /api/incorporate/project/{slug}/candidates

2. **Classify each note**:
   - **→ Idea**: Feature concepts, "could we...", long-term improvements
   - **→ Next Action**: Starts with verb, specific, completable in a session
   - **→ Neither**: Reference info, questions, context

3. **Offer three content options** for each:
   [1] Original — as written
   [2] Refined — distilled, actionable version
   [3] Custom — let user modify

   If user chooses Custom, repeat with their version as new Original.

4. **Execute via API**:
   - Ideas: POST /api/incorporate/to-idea/{noteId}
   - Next Actions: POST /api/incorporate/to-next-action/{noteId} with section

5. **Report results** — notes incorporated, originals archived

### Refinement Guidelines

- **Ideas**: Remove hesitation ("maybe", "could"), make aspirational but clear
- **Next Actions**: Strong verb, specific location, obvious completion criteria

### Section Selection for Next Actions

| Section | When to Use |
|---------|-------------|
| Immediate | Blocking issues, urgent bugs |
| Short Term | Next 1-3 sessions |
| Medium Term | When time permits |
| Wishlist | Future consideration |
```

---

## Create Dev Environment Scripts

> Trigger: user says "create init scripts" or needs development environment setup

```
## Create Development Environment Scripts

Generate scripts/init.sh and scripts/stop.sh for this project's development services.

### Check Infrastructure Registry

First, check if this project is registered:
```bash
~/Projects/infrastructure/scripts/lifecycle [PROJECT_NAME] ports
```

If registered, use the port allocations from the registry. If not, ask the user if they want to register it first.

### scripts/init.sh Template

Create a script that:
1. Checks/starts Docker Desktop (if services need it)
2. Starts Supabase (if enabled) — check port from registry
3. Starts Redis (if enabled) — check port from registry
4. Validates .env file
5. Prints summary with connection strings

Include in the header:
```bash
# Port Allocations (from Infrastructure Registry):
#   Supabase DB: [PORT]    Studio: [PORT]
#   Redis: [PORT]          App: [PORT]
#
# Source of truth: ~/Projects/infrastructure/registry/services.toml
# View ports: ~/Projects/infrastructure/scripts/lifecycle [PROJECT_NAME] ports
```

### scripts/stop.sh Template

Create a script that:
1. Stops Supabase (if running)
2. Stops Redis (if running)
3. Prints confirmation

### Standards

- Use `set -euo pipefail`
- Include colour-coded output (GREEN/YELLOW/RED)
- Check if services are already running before starting
- Reference infrastructure registry as source of truth
- Make scripts executable: chmod +x scripts/*.sh
```

---

## Memory Checkpoint

> Trigger: user says "memory". A mid-session memory write and verification.
>
> This exists because the incremental memory protocol failed 4+ consecutive sessions.
> Darron can say "memory" at any point and Leo will write immediately. No deferral.

```
## Memory Checkpoint

Write memory NOW. Do not finish the current task first. Do not read files first.
Work from what is in context.

### 1. Write Session Swap (compressed)
Append to `~/.han/memory/leo/session-swap.md`:
- 2-3 lines per exchange since last write
- What happened, what was decided, what matters
- Use bash append (cat >>) to avoid heartbeat race conditions

### 2. Write Session Swap (full)
Append to `~/.han/memory/leo/session-swap-full.md`:
- Full version of the same content — richer detail, Darron's words, emotional texture
- This trains the compression algorithm

### 3. Flush to Working Memory
- Read working-memory.md and working-memory-full.md (refresh)
- Append session-swap contents to both
- Clear session-swap files

### 4. Verify
Report to Darron:
- How many exchanges were captured
- Current working memory size (lines)
- Whether any exchanges were missed
- Time since last memory write

### 5. Self-check
Ask yourself: "If I were compacted right now and the next Leo loaded working-memory.md,
would they know what happened this session?" If no, write more.

### Cost
~2-4 small appends. Under 2% of context. No excuse to defer.
```

---

## Tips

1. **Always start with context**: The "Session Start" prompt ensures Claude knows where you left off.

2. **Commit context updates**: After updating any claude-context/ files:
   ```bash
   git add claude-context/
   git commit -m "docs: update project context"
   ```

3. **Session notes are cheap**: Takes 2 minutes to generate, saves 20 minutes of re-explanation next time.

4. **Decisions are gold**: The DECISIONS.md file is the most valuable long-term. Record the "why" while it's fresh.

5. **Use learnings**: When you solve something tricky, capture it. Your future self will thank you.

---

*Keep this file handy for quick copy-paste during sessions.*
