# Claude Code Prompts

> Copy-paste prompts for common Claude Code tasks

---

## Session Start

```
I'm starting a new work session on Claude Remote.

Before we begin, please:
1. Check claude-context/CURRENT_STATUS.md for where we left off
2. Note any recent session-notes/ I should be aware of
3. Confirm the current level and focus
4. List any open blockers or questions

Then let me know what you see and ask what I want to focus on today.
```

---

## Session End

> Trigger: user says "session end". Executes full Update Docs workflow.

```
## Session End

We're wrapping up this session. Execute the complete Update Docs workflow to ensure all documentation is current.

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
- Include: working time, all exchanges (summarised), tasks completed, files changed, commits made
- This is MANDATORY for every session — captures the complete working process
- See `_logs/README.md` for full format

#### 8. Session Note (Optional)
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


## Context Refresh

```
It's been a few days since I worked on Claude Remote. Please help me get back up to speed:

1. Read claude-context/PROJECT_BRIEF.md for the overall context
2. Read claude-context/CURRENT_STATUS.md for where we are
3. Read the last 3 session notes in claude-context/session-notes/
4. Summarise:
   - Current level and focus
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

## Level Transition

```
We're moving from Level [X] to Level [X+1].

Please help me:
1. Update CURRENT_STATUS.md to mark Level [X] as complete
2. Update LEVELS.md status indicators
3. Create a session note documenting Level [X] completion
4. Identify the first tasks for Level [X+1]
5. Note any technical debt or cleanup from Level [X]
```

---

## Testing Session

```
Let's test the Level [X] implementation end-to-end.

Test plan:
1. Run the installation script
2. Start the server
3. Start Claude Code via claude-remote
4. Trigger a prompt
5. Verify notification received
6. Respond via web UI
7. Confirm response injected

Please guide me through each step and help troubleshoot any issues.
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

## Update Docs

> Trigger: user says "update docs"

```
## Update Documentation

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
- Include: working time, all exchanges (summarised), tasks completed, files changed, commits made
- This is MANDATORY for every session — captures the complete working process
- See `_logs/README.md` for full format

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

