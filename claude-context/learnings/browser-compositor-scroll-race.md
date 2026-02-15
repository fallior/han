# Browser Compositor Scroll Race Condition

> Scrollable divs can briefly overshoot boundaries during DOM mutation due to async scroll handling on the compositor thread

## Problem

A scrollable div (`overflow-y: auto`) containing an ever-growing terminal log (2000+ lines) would briefly allow scrolling past the bottom and "wrapping" back to the top. This happened during 1-second DOM update cycles that appended new content.

## Challenge

All the usual CSS fixes were applied:
- `overscroll-behavior: none` on the scrollable element
- `overflow: hidden` on parent containers
- `min-height: 0` on flex children
- Correct flex layout with single scroll container

The overshoot still happened during DOM mutation, but self-corrected within ~1-2 frames. It only reproduced on Firefox/Linux, not Safari/iOS.

## Root Cause

Modern browsers handle scrolling on the **compositor thread**, separate from the main JavaScript thread. This is essential for 60fps scroll performance.

When JavaScript modifies the DOM (appending elements, changing textContent), the main thread updates `scrollHeight`. But the compositor thread has its own cached copy of the scroll boundaries. There's a brief window (~1 frame, 16ms) where:

1. JS appends new content → `scrollHeight` increases on the main thread
2. Compositor thread still has the old `scrollHeight`
3. User scroll input processed against stale boundaries
4. Compositor allows scroll positions that are technically invalid
5. Next frame: compositor receives updated boundaries, snaps back

## Key Insight

**Two layers of explanation:**

### 1. Why the overshoot happens — optimistic concurrency

The compositor uses an **optimistic concurrency model** — same pattern as eventual consistency in databases. It prioritises smooth 60fps scrolling over pixel-perfect boundary accuracy:

- **Act now with stale data, reconcile later** beats **wait for consensus before every operation**
- Blocking at exact boundaries during DOM mutation would cause visible scroll stuttering
- The 1-frame overshoot is considered acceptable — users barely notice
- Touch/momentum scrolling physics expects some elasticity

### 2. Why you see the START of the file (not blank space) — GPU tile wrapping

When the compositor allows a scroll position past the content boundary, it needs to decide what to render. The GPU uses **tiled rendering** — content is rasterized into texture tiles, and tiles are addressed by offset. When the scroll offset exceeds the total content height, the tile addressing wraps via modular arithmetic:

```
render_offset = scroll_offset % total_content_height
```

This is the same mechanism as `GL_REPEAT` in OpenGL texture wrapping — when texture coordinates exceed 1.0, they wrap to 0.0. The browser compositor does the same with its content tiles. So:

- Content height = 40,000px (2000 lines x ~20px each)
- Scroll to 42,000px (2,000px past the end)
- Compositor renders: `42,000 % 40,000 = 2,000px` → line ~100 from the start

This explains why scrolling past the bottom shows content from the **beginning** of the file, not blank space. The content appears to loop seamlessly because the tile addressing creates a circular buffer at the GPU level — the user's intuition about modular arithmetic protection against out-of-range errors was correct, just at a lower level than JavaScript.

This is a fundamental architectural choice in browser rendering engines, not a bug. Firefox's compositor (APZ — Async Pan/Zoom) is more aggressively async than Safari's, which is why the effect is more visible on Firefox/Linux.

## Mitigations

These reduce the effect but cannot eliminate it:
- `overscroll-behavior: none` — prevents the element's own overscroll effect
- `min-height: 0` on flex parents — prevents layout overflow
- Checking scroll position BEFORE DOM mutation (not after) — reduces the window
- Stripping empty trailing content — reduces unnecessary DOM changes

## Gotchas

- `overscroll-behavior: contain` prevents scroll **propagation** to parent elements but still allows the element's own overscroll
- `overscroll-behavior: none` prevents both propagation and the element's own overscroll effect
- Flex children default to `min-height: auto` — they won't shrink below content size, which can cause the parent to overflow even with `overflow: hidden`

## References

- [Chromium compositor thread architecture](https://chromium.googlesource.com/chromium/src/+/master/docs/how_cc_works.md)
- [Firefox async scrolling](https://firefox-source-docs.mozilla.org/gfx/AsyncPanZoom.html)
- [CSS overscroll-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior)

---

*Discovered: 2026-02-15*
