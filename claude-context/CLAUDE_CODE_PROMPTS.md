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

### 7. Session Log (MANDATORY)
Create or update the session log in `_logs/`:
- Format: `session_YYYY-MM-DD_HH-MM-SS.md`
- **CRITICAL**: Include ISO timestamps for EVERY exchange (use `date -Iseconds`)
- Include: Start/End timestamps, activity log with timestamps, tasks completed, files changed, commits made
- Calculate **Active Time** by summing exchange durations (excluding gaps > 5 minutes)
- See `_logs/README.md` for full timestamp protocol

### 8. Session Note (Optional)
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

**SECOND**: Remove the session lock file so heartbeat Leo resumes normal operation:
```bash
rm -f ~/.claude-remote/session-active
```

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

### 1. Finalise Working Memory
Append a closing section to `~/.claude-remote/memory/leo/working-memory.md`:
- "## Closing" with 2-3 lines: what was in-progress, what's next, Darron's energy/mood
- If nothing was written incrementally this session, write a minimal working memory
  from what's in context — DO NOT read files to compose it

### 2. Finalise Full Working Memory
Append a closing section to `~/.claude-remote/memory/leo/working-memory-full.md`:
- Same as above but with more detail — from what's already in context

### 3. Update Active Context
Append one line to the "Recent Work" section of `~/.claude-remote/memory/leo/active-context.md`:
- `- **Session N (date)**: [one-line summary]`
- DO NOT re-read the file — just append

### 4. Update Memory Banks (only if something shifted)
If this session changed your thinking or patterns, update:
- `~/.claude-remote/memory/leo/self-reflection.md` — only if genuine insight occurred
- `~/.claude-remote/memory/leo/patterns.md` — only if a new working pattern was discovered
Skip these if nothing shifted. Most sessions won't need them.

### 5. Release Session Lock
```bash
rm -f ~/.claude-remote/session-active
```

### 6. Done
Tell Darron: "Memory finalised. Ready for /clear."

### After Clear (on next instantiation)
The Session Protocol in CLAUDE.md loads working-memory.md at step 4.
Optionally read working-memory-full.md to notice what compression lost.

### Cost
~2-4 small appends. No reads. Under 5% of context.
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
