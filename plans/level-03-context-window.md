# Level 3: Context Window -- Search and Copy

> Status: Complete (Retrospective)

## Context
Responding to prompts without seeing what Claude Code has been doing leads to blind approvals. Level 3 adds search and copy capabilities within the terminal view so you can find relevant output before responding.

## What Was Built
- In-terminal search using `xterm-addon-search` with previous/next match navigation
- Text search fallback that strips ANSI codes when the xterm addon cannot match
- Copy functionality via Web Share API on iOS, with a selectable overlay fallback for other platforms
- Search UI integrated into the mobile interface with match highlighting
- Improved search and copy ergonomics for mobile (touch-friendly controls)

## Key Files
| File | Role |
|------|------|
| `src/ui/index.html` | Search bar, copy overlay, and xterm-addon-search integration |

## Key Decisions
- Used `xterm-addon-search` (xterm.js native) rather than building custom search -- leverages existing ANSI-aware matching
- Web Share API for iOS copy (clipboard API is restricted in iOS Safari for non-HTTPS contexts)
- Selectable overlay fallback ensures copy works across all browsers and platforms

## Verification
```bash
# Open the mobile UI on your phone
# Ensure a Claude Code session is running with terminal output visible

# Search: tap the search icon, type a term, verify matches highlight
# Use prev/next buttons to navigate between matches

# Copy: long-press or use the copy action on terminal text
# Verify the text is available in clipboard / share sheet
```

---
*Retrospective plan -- documents what was built, not a forward-looking spec.*
