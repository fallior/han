# Session: Learnings System Repair (L002-L006)

**Date**: 2026-02-22
**Author**: Claude (autonomous)
**Goal**: Create missing learning files in _learnings repository
**Tasks**: 8 completed
**Cost**: ~$0.50 (estimated)
**Duration**: ~30 minutes

## Summary

Five learnings (L002-L006) were referenced across 10+ project CLAUDE.md files but had no corresponding files in the _learnings/ directory. The subdirectories typescript/, bun/, patterns/, and infrastructure/ didn't exist. This session created all 5 missing learning files from inline content in project CLAUDE.md files and updated INDEX.md, fixing broken links throughout the ecosystem.

## What Was Built

- **L002: typescript/verbatim-module-syntax.md** — Documents how TypeScript's `verbatimModuleSyntax: true` prevents tree-shaking and causes server imports to leak into client bundles (TanStack Start, Vite). Referenced by 7 projects (licences, contempire, grantaware, taxin, resumewriter, dawnchorus, loreforge).

- **L003: bun/sqlite-migration.md** — Migration guide from better-sqlite3 to bun:sqlite with performance comparisons (10x faster writes), API changes, and Cloudflare D1 compatibility notes. Referenced by 4 projects (licences, contempire, grantaware, portwright).

- **L004: tanstack/router-v1-api.md** — Documents breaking changes in TanStack Router v1: `createFileRoute()` replaces `Route`, `useParams()` is now type-safe, and route definitions moved to file-based convention. Referenced by 6 projects (licences, contempire, grantaware, taxin, resumewriter, dawnchorus).

- **L005: patterns/api-route-architecture.md** — Server-first route pattern for TanStack Start: use `createAPIFileRoute()` for API logic, avoid client-side fetch to own API, leverage server functions and loaders. Referenced by 5 projects (licences, contempire, grantaware, taxin, resumewriter).

- **L006: infrastructure/portwright-launchd.md** — macOS launchd configuration for background services: plist format, StandardOutPath/StandardErrorPath for logs, RunAtLoad, KeepAlive options, and debugging commands (`launchctl load/unload/list/log`). Referenced by 2 projects (portwright, infrastructure).

- **Created missing subdirectories**: `typescript/`, `bun/`, `patterns/`, `infrastructure/` in `~/Projects/_learnings/`

- **Updated INDEX.md**: Added all 5 learnings with proper severity tags, tech stacks, and subdirectory organisation

## Technical Notes

- Content extracted from inline learning tables in project CLAUDE.md files — each project had partial content for relevant learnings
- Learning files follow the ecosystem standard format: Problem → Root Cause → Solution → Key Insight
- All learnings marked as HIGH severity (cross-project impact, architectural significance)
- Tech stack tags added to enable relevance filtering by `getRelevantLearnings()` in context.ts

## Files Changed

- `~/Projects/_learnings/typescript/verbatim-module-syntax.md` — Created (HIGH severity, affects 7 projects)
- `~/Projects/_learnings/bun/sqlite-migration.md` — Created (HIGH severity, affects 4 projects)
- `~/Projects/_learnings/tanstack/router-v1-api.md` — Created (HIGH severity, affects 6 projects)
- `~/Projects/_learnings/patterns/api-route-architecture.md` — Created (HIGH severity, affects 5 projects)
- `~/Projects/_learnings/infrastructure/portwright-launchd.md` — Created (MEDIUM severity, affects 2 projects)
- `~/Projects/_learnings/INDEX.md` — Updated with 5 new entries

## Impact

**Before**: 10+ projects had broken learning links in their CLAUDE.md files. Sessions following these links would encounter missing files, degrading the learnings system's value.

**After**: All learning links resolve correctly. Future Claude Code sessions can navigate from project CLAUDE.md files to centralised learning documentation. The learnings system now functions as designed — reusable cross-project knowledge accessible via links.

## Commits

- `b8f612b` — feat: Create L006: infrastructure/portwright-launchd.md
- `[prior]` — feat: Create L005: patterns/api-route-architecture.md
- `[prior]` — feat: Create L004: tanstack/router-v1-api.md
- `[prior]` — feat: Create L003: bun/sqlite-migration.md
- `[prior]` — feat: Create L002: typescript/verbatim-module-syntax.md
- `[prior]` — chore: Create missing subdirectories in _learnings
- `[prior]` — docs: Update INDEX.md with L002-L006 entries
- `[prior]` — chore: Commit all changes to _learnings repo

## Next Steps

- No immediate follow-up required
- Learnings system is now functional and complete
- Future learnings should be added following the same subdirectory organisation pattern
