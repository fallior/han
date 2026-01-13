# Learnings

> Reusable knowledge captured from solving problems

## What Goes Here

When you solve a tricky problem, capture it! Learnings are:

- **Reusable**: Applicable beyond just this project
- **Hard-won**: Took effort to figure out
- **Non-obvious**: Not easily found in documentation

## Naming Convention

```
descriptive-kebab-case.md
```

Examples:
- `claude-code-hooks-setup.md`
- `tmux-send-keys-escaping.md`
- `ntfy-ios-instant-notifications.md`

## Template

```markdown
# [Title]

> [One-line summary of the learning]

## Problem

[What were you trying to do?]

## Challenge

[What made it difficult? What didn't work?]

## Solution

[How did you solve it?]

```bash
# Code example if applicable
```

## Key Insight

[The "aha" moment — what's the core takeaway?]

## Gotchas

- [Thing to watch out for]
- [Common mistake]

## References

- [Link to documentation]
- [Link to relevant issue or discussion]

---

*Discovered: YYYY-MM-DD*
```

## Index

Keep an INDEX.md in this folder listing all learnings:

```markdown
# Learnings Index

| Topic | File | Tags |
|-------|------|------|
| [Description] | [filename.md] | #tag1 #tag2 |
```

## Categories

Common categories for learnings in this project:

- **Claude Code**: Hooks, integration, behaviour quirks
- **tmux**: Session management, send-keys, capture-pane
- **ntfy.sh**: Push notifications, iOS/Android differences
- **Tailscale**: VPN setup, debugging connectivity
- **Express**: Server patterns, middleware
- **Mobile**: PWA gotchas, touch interactions

## Why Bother?

1. **Future you**: Won't remember how you solved this in 6 months
2. **Teammates**: Can benefit from your discoveries
3. **Other projects**: Many learnings transfer across projects
4. **Interviews**: "Tell me about a difficult problem you solved..."

---

*Every hard problem you solve is a gift to your future self — write it down!*
