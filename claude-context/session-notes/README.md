# Session Notes

> Chronological log of work sessions

## Naming Convention

```
YYYY-MM-DD-author-topic.md
```

Examples:
- `2026-01-13-darron-kickoff.md`
- `2026-01-14-darron-level1-testing.md`
- `2026-01-15-darron-push-notifications.md`

## Template

Use this template for new session notes:

```markdown
# Session: [Topic]

**Date**: YYYY-MM-DD
**Author**: [Name]
**Duration**: ~[X] hours

## Summary

[2-3 sentences describing what was accomplished]

## What We Did

- [Accomplishment 1]
- [Accomplishment 2]
- [Accomplishment 3]

## Key Decisions

- **[Decision]**: [Brief reasoning]

## Code Changes

- `[file/path]` — [What changed]
- `[file/path]` — [What changed]

## Issues Encountered

- [Issue and how it was resolved]

## Next Steps

- [ ] [Next action 1]
- [ ] [Next action 2]

## Notes

[Any additional context, links, or thoughts]
```

## Purpose

Session notes serve several purposes:

1. **Continuity**: Pick up where you left off, even after days away
2. **Collaboration**: Let teammates know what changed
3. **History**: Understand why things are the way they are
4. **Debugging**: Track when issues were introduced

## Best Practices

- Write notes at the end of each significant session
- Keep them concise — bullet points are fine
- Link to relevant commits or PRs if applicable
- Include "Next Steps" so you know where to start next time

## Archiving

Old session notes can be moved to an `archive/` subfolder if the list gets long:

```
session-notes/
├── archive/
│   └── 2025/
│       └── [old notes]
├── README.md
└── [recent notes]
```

---

*A 5-minute session note saves 30 minutes of confusion later.*
