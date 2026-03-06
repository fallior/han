# Session Note: Context Injection Pipeline Fixes Complete

**Date**: 2026-02-28
**Author**: Claude (autonomous)
**Session Type**: Automated task execution (goal mm5v7eiv-fk4b51)

## Summary

Fixed 5 critical bugs in the context injection pipeline (`src/server/services/context.ts`) that were preventing task agents from receiving accurate project context. All autonomous tasks now get complete settled decisions, prioritised HIGH-severity learnings, correct tech stack detection, and full CLAUDE.md project instructions.

## What Was Built

### 1. ADR Filter Expansion (Line 45)
**Problem**: Only ADRs marked "Settled" were extracted, but all 131 ADRs across the ecosystem used "Accepted" status.
**Fix**: Changed regex from `/\*\*Status\*\*:\s*Settled/i` to `/\*\*Status\*\*:\s*(Settled|Accepted)/i`
**Impact**: Task agents now see all relevant settled decisions, not zero.

### 2. CLAUDE.md Truncation Increase (Line 292)
**Problem**: 3000-char limit caused projects with long session protocols (han, hodgic) to get 0 useful content — the entire budget was consumed by boilerplate.
**Fix**: Increased maxChars from 3000 to 6000
**Impact**: Full session protocol now fits, task agents get complete project instructions.

### 3. Learnings Selection Bias Fix (Line 141)
**Problem**: Learnings were sliced from INDEX.md in document order, causing HIGH-severity Cloudflare learnings to be missed when they appeared after position 5.
**Fix**: Added `.sort((a, b) => (a.severity === 'HIGH' ? 0 : 1) - (b.severity === 'HIGH' ? 0 : 1))` before `.slice(0, 10)`, increased cap from 5 to 10
**Impact**: HIGH-severity learnings now always prioritised, task agents get more relevant warnings.

### 4. Bun Detection Gap (DepMap ~Line 64)
**Problem**: 7 Bun projects weren't detected because `bun:sqlite` (built-in import) never appears in package.json.
**Fix**: Added `'@types/bun': ['Bun']` to depMap, removed dead `'bun:sqlite'` entry
**Impact**: Bun projects now correctly tagged with Bun tech, relevant L014 SSH auth learning correctly injected.

### 5. Monorepo Tech Detection (Lines 66-79)
**Problem**: Monorepo projects (e.g., contempire) had dependencies in workspace packages (`packages/*/package.json`) that weren't scanned, causing Hono, Clerk, and Zod to be undetected.
**Fix**: Added `fs.readdirSync()` loop to scan `packages/*/package.json` directories and append to `pkgPaths`
**Impact**: Monorepo dependencies now correctly detected, tech stack complete.

## Code Changes

**File**: `src/server/services/context.ts`

**Before → After**:

1. ADR Filter (line 45):
   ```typescript
   // Before:
   /\*\*Status\*\*:\s*Settled/i.test(s)

   // After:
   /\*\*Status\*\*:\s*(Settled|Accepted)/i.test(s)
   ```

2. CLAUDE.md Truncation (line 292):
   ```typescript
   // Before:
   const claudeMd = readFileOrEmpty(path.join(projectPath, 'CLAUDE.md'), 3000);

   // After:
   const claudeMd = readFileOrEmpty(path.join(projectPath, 'CLAUDE.md'), 6000);
   ```

3. Learnings Selection (line 141-156):
   ```typescript
   // Before:
   }).slice(0, 5);

   // After:
   })
   .sort((a, b) => (a.severity === 'HIGH' ? 0 : 1) - (b.severity === 'HIGH' ? 0 : 1))
   .slice(0, 10);
   ```

4. Bun Detection (depMap ~line 64):
   ```typescript
   // Before:
   'bun:sqlite': ['SQLite', 'Bun'],

   // After:
   '@types/bun': ['Bun'],
   // (removed bun:sqlite entry)
   ```

5. Monorepo Scanning (lines 66-79):
   ```typescript
   // Added:
   const packagesDir = path.join(projectPath, 'packages');
   try {
       if (fs.existsSync(packagesDir)) {
           for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
               if (entry.isDirectory()) {
                   pkgPaths.push(path.join(packagesDir, entry.name, 'package.json'));
               }
           }
       }
   } catch { /* skip */ }
   ```

## Commits

- `b25d3cc` — fix: Increase CLAUDE.md truncation limit from 3000 to 6000 chars
- `5b5bcef` — chore: Increase CLAUDE.md truncation limit from 3000 to 6000 chars
- `6dd8c06` — fix: Update ADR filter regex to match both 'Settled' and 'Accepted' status
- `73e3b1b` — fix: Fix ADR filter to match both Settled and Accepted statuses
- `b960468` — fix: Update depMap in detectProjectTechStack — add @types/bun, remove dead bun:sqlite entry
- `30f2d7c` — feat: Add @types/bun to depMap and remove dead bun:sqlite entry
- `c0858e2` — fix: Fix learnings selection: sort by severity and increase cap to 10
- `9a8efa3` — feat: Add monorepo package.json detection to tech stack scanner
- `794f3b6` — feat: Add monorepo package scanning for tech detection

## Testing

Verified via manual context extraction:
- ✅ ADRs: Both 'Settled' and 'Accepted' status ADRs now included
- ✅ CLAUDE.md: Full 6000 chars captured for han/hodgic projects
- ✅ Learnings: HIGH-severity learnings sorted to top, cap increased to 10
- ✅ Bun detection: `@types/bun` correctly triggers Bun tech detection
- ✅ Monorepo: contempire's workspace packages scanned, Hono/Clerk/Zod found

## Next Steps

- Monitor autonomous task logs to verify improved context quality
- Consider further CLAUDE.md cap increase if 6000 chars still insufficient for some projects
- Watch for monorepo edge cases (nested workspaces, pnpm workspaces, etc.)

## Why This Matters

Context injection is the foundation of autonomous task quality. These bugs meant task agents were operating with incomplete or incorrect information:
- Missing settled decisions led to re-implementing already-decided patterns
- Missing HIGH-severity learnings led to repeating known mistakes
- Incorrect tech detection led to irrelevant learnings being injected
- Truncated CLAUDE.md meant missing critical project protocols

All fixed. Task agents now have accurate, complete context.
