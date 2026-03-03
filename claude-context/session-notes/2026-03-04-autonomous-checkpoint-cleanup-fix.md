# Session Note: Fix cleanupCheckpoint() Data Loss Bug

**Date:** 2026-03-04
**Author:** Claude (autonomous)
**Goal:** mmb5a7zu-r65gaq
**Tasks:** 3 completed (mmb5br94-7tkvvu, mmb5br95-tg2syg, mmb5br95-02igc6)
**Cost:** $0.61 (Sonnet $0.17, Haiku $0.44)

## Summary

Fixed critical data loss bug in `cleanupCheckpoint()` that was destroying Leo's pre-existing uncommitted work. The function was using `git stash drop` after task completion, which deleted the stashed changes. Changed to `git stash pop` with proper conflict handling, ensuring user work is always restored or preserved for manual resolution.

## Problem

When autonomous tasks ran with Leo's uncommitted work present:

1. `createCheckpoint()` correctly stashed the work before task execution
2. Task made changes and committed them
3. `cleanupCheckpoint()` used `git stash drop` to "clean up"
4. **Leo's pre-existing work was permanently lost**

This violated the fundamental principle: checkpoints exist to preserve user state, not destroy it.

## What Was Built

### 1. Core Fix in `git.ts:296-343`

Changed stash cleanup strategy from drop to pop:

**Before (line 248):**
```typescript
execFileSync('git', ['stash', 'drop', match[1]], {
    cwd: projectPath,
    stdio: 'ignore'
});
```

**After (lines 321-335):**
```typescript
try {
    // Pop applies the stash and removes it from stash list
    execFileSync('git', ['stash', 'pop', match[1]], {
        cwd: projectPath,
        stdio: 'ignore'
    });
    console.log(`[Git] Cleaned up checkpoint stash: ${checkpointRef}`);
} catch (err: any) {
    // Pop failed: merge conflict between task commits and user's stashed changes
    // Leave stash in place — user must resolve manually to preserve data
    console.warn(`[Git] Stash pop had conflicts — leaving stash in place for manual resolution`);
}
```

**Key behavior changes:**
- `git stash pop` restores changes AND removes stash (when successful)
- If pop fails due to merge conflict, stash remains in stash list
- Conflict markers left in working tree for manual resolution
- Zero data loss in all scenarios

### 2. Documentation Block

Added comprehensive 29-line documentation block (lines 265-295) explaining:
- Checkpoint cleanup strategy for both branch and stash types
- When conflicts occur and how to resolve them
- Step-by-step manual resolution instructions
- Data loss prevention rationale

### 3. Test Suite (`src/server/tests/git.test.ts`)

Created 12 test cases covering:
- **Test 1**: Stash pop success (clean restore)
- **Test 2**: Stash pop conflict (preserves stash)
- **Test 3**: Branch cleanup (delete only)
- **Tests 4-5**: No-op cases (null ref, type='none')
- **Tests 6-12**: Edge cases and error scenarios

All tests use real git commands against temporary repositories to verify actual behavior, not mocked logic.

### 4. Architecture Documentation

Updated `claude-context/ARCHITECTURE.md` section "Git Checkpoint Behavior" to document:
- Stash-type cleanup uses `git stash pop`
- Conflict resolution workflow
- Data loss prevention guarantee

## Key Decisions

### Why `git stash pop` Instead of Drop

**Options considered:**
1. **Keep using `git stash drop`** — Simple but destroys user work
2. **Use `git stash apply` then drop on success** — Complex, easy to mess up
3. **Use `git stash pop`** — Single command, atomic, leaves stash on conflict ✅

**Decision:** `git stash pop` is the correct primitive. It's atomic: either the pop succeeds (restores + removes stash) or it fails (leaves stash intact). This matches exactly what we need.

### Conflict Handling Strategy

**When conflicts occur:**
- Working tree has conflict markers
- Stash remains in `git stash list`
- Log warning but don't fail the task
- User manually resolves later

**Why not auto-resolve?**
- Can't programmatically choose "theirs" or "ours" — context-dependent
- Auto-keeping task's version discards user work (defeats purpose of checkpoint)
- Auto-keeping user's version discards task work (defeats purpose of task)
- Manual resolution is the only safe choice

## Files Changed

| File | Type | Lines | Purpose |
|------|------|-------|---------|
| `src/server/services/git.ts` | Modified | +29/-6 | Core fix + documentation |
| `src/server/tests/git.test.ts` | Created | +412 | Test suite (12 cases) |
| `claude-context/ARCHITECTURE.md` | Modified | +15 | Document cleanup behavior |

## Verification

Verified the fix with:
1. **Unit tests**: 12/12 passing
2. **Conflict scenario test**: Stash preserved when pop fails
3. **Success scenario test**: Changes restored, stash removed
4. **No-op scenarios**: Early return for null/none cases

## Next Steps

None — fix is complete and verified. The cleanupCheckpoint() function now correctly:
- Restores user work via `git stash pop`
- Preserves stash on conflict for manual resolution
- Deletes branches (they don't have this problem)
- Logs appropriate messages for all scenarios

## Impact

**Before this fix:**
- Leo's uncommitted work was lost after every autonomous task
- No way to recover (stash was dropped)
- Violated fundamental checkpoint guarantee

**After this fix:**
- User work always restored or preserved
- Conflicts handled gracefully
- Zero data loss in all scenarios
- Checkpoint system works as originally intended

## Cost Breakdown

- **mmb5br94-7tkvvu** (Fix implementation): $0.17 (Sonnet)
- **mmb5br95-tg2syg** (Documentation): $0.44 (Haiku)
- **mmb5br95-02igc6** (Test suite): $0.00 (no LLM, tests written during documentation phase)

**Total:** $0.61
