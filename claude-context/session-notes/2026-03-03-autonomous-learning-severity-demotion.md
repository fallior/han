# Session Note: Learning Severity Demotion for Generic Research

**Date**: 2026-03-03
**Author**: Claude (autonomous)
**Goal**: mm9y00kp-txmf4z — Demote L024, L025, L028, L030 severity from HIGH to LOW
**Task**: mm9y1zex-wgdbk6 — Update learning files and INDEX.md

## Summary

Demoted four JavaScript/TypeScript learnings (L024, L025, L028, L030) from HIGH to LOW severity because they were generic CLI/JavaScript knowledge researched by autonomous agents, not encounter-earned from debugging real bugs. These four learnings consumed 4 of the 10 HIGH learning slots for JavaScript/TypeScript projects, displacing genuinely valuable encounter-earned learnings.

## What Was Built

### 1. Learning File Updates

Updated severity field in four learning files:

- `~/Projects/_learnings/javascript/L024-env-var-expansion.md`
- `~/Projects/_learnings/javascript/L025-npm-run-env.md`
- `~/Projects/_learnings/javascript/L028-shebang-portability.md`
- `~/Projects/_learnings/javascript/L030-cross-spawn-shell.md`

Changed from `severity: HIGH` to `severity: LOW` in each file.

### 2. INDEX.md Update

Updated `~/Projects/_learnings/INDEX.md`:
- Modified 4 entries to reflect LOW severity
- Maintained alphabetical ordering within severity tiers
- Preserved all other metadata (tech, path, description)

### 3. Verification

Verified changes via grep to confirm:
- All four files now show `severity: LOW`
- INDEX.md lists them under LOW severity section
- No other HIGH-severity learnings affected

## Key Decisions

### Decision: Severity Based on Knowledge Source

**Rationale**: Learnings should be prioritised based on whether they were encounter-earned (debugging real bugs) or researched (theoretical knowledge from docs/research). Encounter-earned learnings save significant debugging time; researched knowledge is useful but less actionable.

**Evidence**: All four demoted learnings came from todo-cli project, which has zero source code (only claude-context/DECISIONS.md exists). They were researched by autonomous agents exploring CLI best practices, not discovered while fixing actual bugs.

**Impact**: HIGH slots now reserved for learnings like L008 (timezone gotchas) and L011 (day-zero trick) that were discovered during debugging and directly prevented bugs in production code.

## Code Changes

### Learning Files (4 files)

**Before**:
```markdown
severity: HIGH
```

**After**:
```markdown
severity: LOW
```

### INDEX.md

**Before**:
```markdown
## HIGH Severity

...
- [L024](javascript/L024-env-var-expansion.md) — **Tech**: JavaScript, Bash, CLI — Environment variable expansion in npm scripts (shell-specific)
...
```

**After**:
```markdown
## LOW Severity

...
- [L024](javascript/L024-env-var-expansion.md) — **Tech**: JavaScript, Bash, CLI — Environment variable expansion in npm scripts (shell-specific)
...
```

## Next Steps

1. Monitor whether HIGH-severity learnings shown to JavaScript/TypeScript projects are now more actionable
2. Consider documenting severity classification guidelines in `_learnings/README.md`
3. Review other learnings from todo-cli to ensure they're appropriately classified

## Lessons Learned

- Severity should reflect debugging value, not just technical complexity
- Research-based learnings are useful but less urgent than encounter-earned knowledge
- Learning system needs clear classification guidelines to prevent future drift
- Autonomous agents should mark learnings with source metadata (encounter vs research)

## Related

- Goal: mm9y00kp-txmf4z (Demote L024-L030 severity from HIGH to LOW)
- Task: mm9y1zex-wgdbk6 (Learning file updates)
- Commits: 1956687 (demote severity in files), 749ecb7 (update INDEX.md)
- Project: _learnings (cross-project knowledge repository)
