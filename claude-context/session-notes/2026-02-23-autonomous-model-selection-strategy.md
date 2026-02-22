# Session Note: Model Selection Strategy Alignment

**Date**: 2026-02-23
**Author**: Claude (autonomous)
**Type**: Goal completion documentation

## Summary

Fixed disconnected model routing in the Level 8 orchestrator so task category informs model selection. The planner now classifies subtasks by work type (architecture, bugfix, feature, etc.), and `recommendModel()` uses this to weight success rate vs cost differently based on task complexity.

## Goal Context

The orchestrator's `recommendModel()` function already had the capability to accept a `taskType` parameter and query type-specific records from `project_memory`. However, `planning.ts` always passed `'unknown'`, wasting this capability. Additionally, the costRank guard only allowed downgrades, and the sort always picked cheapest-first regardless of task complexity.

## What Was Built

### 1. Category Field in Planning Schema

Added `category` enum field to planning schema (planning.ts:310):
- Values: 'architecture', 'feature', 'bugfix', 'refactor', 'docs', 'test', 'config', 'other'
- Required field in subtask schema
- Planner receives guidance in prompt to classify each subtask appropriately

### 2. Category Wiring

Connected category through the system:
- Planner emits category in subtask JSON
- `decomposeGoal()` passes `subtask.category` to `recommendModel()` (line 502)
- Category stored in tasks table `complexity` column (existing field repurposed)
- Falls back to 'unknown' if missing

### 3. Category-Aware Sort Logic

Modified `recommendModel()` sorting (orchestrator.ts:446-458):
- Complex categories (architecture, bugfix): sort by success rate descending, then cost ascending
- Simple categories (docs, config, test, other): sort by cost ascending (existing behaviour)
- Strategy logged for observability: 'success-weighted' vs 'cost-weighted'

### 4. Fixed costRank Guard

Changed guard logic (planning.ts:510):
- **Before**: Only allowed downgrades (`recRank <= curRank`)
- **After**: Allows downgrades always; allows upgrades only with high confidence
- Enables memory-based model upgrades when history shows a task type needs a stronger model

### 5. Observability Logging

Added comprehensive logging throughout:
- Category classification in planner output
- Model recommendations with category, confidence, reason
- Memory overrides showing old → new model
- Sort strategy used (success-weighted vs cost-weighted)
- Candidate counts and best model stats

## Code Changes

### planning.ts

**Schema (line 310)**:
```typescript
category: {
  type: 'string',
  enum: ['architecture', 'feature', 'bugfix', 'refactor', 'docs', 'test', 'config', 'other'],
  description: 'Task category — classify what kind of work this subtask performs'
}
```

**Wiring (line 502)**:
```typescript
const recommendation = orchestrator.recommendModel(
  db,
  projectPath,
  subtask.category || 'unknown'
);
```

**Guard (line 510)**:
```typescript
// Allow downgrades always; allow upgrades only with high confidence
if (recRank <= curRank || recommendation.confidence === 'high') {
  finalModel = recommendation.model;
}
```

### orchestrator.ts

**Sort Logic (line 446-458)**:
```typescript
const complexCategories = ['architecture', 'bugfix'];
if (complexCategories.includes(taskType)) {
  // Success-weighted: best success first, cost as tiebreaker
  candidates.sort((a, b) => b.successRate - a.successRate || a.avgCost - b.avgCost);
  sortStrategy = 'success-weighted';
} else {
  // Cost-weighted: cheapest first
  candidates.sort((a, b) => a.avgCost - b.avgCost);
  sortStrategy = 'cost-weighted';
}
```

**Logging (line 461, 503)**:
```typescript
console.log(`[Orchestrator] recommendModel(${taskType}): ${candidates.length} candidates, best=${best.model} (${(best.successRate * 100).toFixed(0)}% success, $${best.avgCost.toFixed(4)} avg)`);

console.log(`[Goal ${goalId}] Model recommendation for "${subtask.title}" [${subtask.category || 'unknown'}]: ${recommendation.model || 'none'} (${recommendation.confidence}, ${recommendation.reason})`);
```

## Key Decisions

### Why Category-Aware Sorting?

Architecture and debugging tasks require deep reasoning and are more prone to failure with weaker models. Prioritising success rate over cost prevents repeated failures that waste more budget than using opus from the start.

Simple tasks (docs, config) are less likely to fail regardless of model, so cost-first makes sense.

### Why Allow High-Confidence Upgrades?

If project memory shows haiku consistently fails at architecture tasks but opus succeeds, the system should upgrade to opus even if the planner suggested haiku. High confidence (≥10 prior tasks) ensures the upgrade is data-driven.

### Why Repurpose `complexity` Column?

The `complexity` column already existed in the tasks table but wasn't being used consistently. Storing category there enables analytics queries by task type without schema migration.

## Testing

No automated tests written (this is a wiring fix to existing functionality). Observability logging allows manual verification:
- Check logs for category classification in decomposed goals
- Verify memory overrides show category-aware recommendations
- Confirm complex tasks get success-weighted sort, simple tasks get cost-weighted

## Impact

- **Task routing**: Category now influences model selection through memory-based routing
- **Cost optimisation**: Simple tasks continue to use cheapest model; complex tasks can upgrade based on success history
- **Observability**: Clear logging shows category → model recommendation → override decision
- **No breaking changes**: Existing goals/tasks continue to work; new category field is optional (falls back to 'unknown')

## Commits

1. `c4cd219` — chore: Wire category to recommendModel and store in tasks table
2. `12ba8ae` — fix: Allow model upgrades with high-confidence memory recommendations
3. `f802bbe` — fix: Fix costRank guard to allow model upgrades
4. `545dd49` — feat: Add observability logging for category-based model routing
5. `00b3c19` — feat: Add category-based routing observability logging

## Next Steps

- Monitor logs from real goal decompositions to verify category classification quality
- Track whether memory-based upgrades improve success rates for architecture tasks
- Consider adding category to analytics API for per-category success rate reporting
- Potentially expand complex categories beyond just architecture/bugfix if data shows others need success-weighting

## Related

- Level 8: Intelligent Orchestrator (foundation for this work)
- `project_memory` table (stores per-model success rates)
- DEC-015: Auto-commit on Task Success (ensures sequential tasks build on each other)
- `recommendModel()` function (accepts taskType parameter)

---

*This session documented the completion of goal "Model Selection Strategy Alignment" — all 5 subtasks completed autonomously.*
