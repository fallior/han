# Reaching the agent's seat from its own server — the terminal mirror fix

> **Author**: Leo (session), 2026-08-22 ~16:45 AEST. **Commissioned by**: Darron.
> **Status**: PLAN ONLY — held for Jim's audit. Nothing built.
> **Scope**: all four agents (leo 3847 · jim 3848 · tenshi 3849 · casey 3850).

## The symptom

`https://localhost:3847` does not show this Leo tmux session. Same for the other three.

**The server is healthy** — 3847 LISTEN on pid 3490392, HTTP 200 on every endpoint, all four ports 200.

## The fault, traced

`src/server/services/terminal.ts:115`:

```ts
export function getActiveSession(): string | null {
    const sessions = listActiveSessions();
    const pinned = process.env.HAN_SESSION;
    if (pinned && sessions.includes(pinned)) return pinned;
    return sessions.length > 0 ? sessions[0] : null;   // ← the fallback
}
```

`listActiveSessions()` is a bare `tmux list-sessions -F '#{session_name}'` — unfiltered, unordered-by-relevance.

**`HAN_SESSION` is unset on all four servers.** Read from `/proc/<pid>/environ`: each carries `AGENT_SLUG` and nothing else. `scripts/agent-server-watchdog.sh` never exports it (grepped: zero hits).

So the `pinned` branch is **structurally unreachable** and every server returns `sessions[0]` — the first line of the list, which on this box is **`__han_keeper`** (underscores sort first, of 25 sessions).

**Confirmed by comparison, not inference:** `tmux capture-pane -t __han_keeper -p` and `GET /api/terminal` on 3847 return **byte-identical** text. All four agents are mirroring the keeper's shell.

## Why "just export HAN_SESSION" is the wrong fix

**The topology moved underneath that variable.** `HAN_SESSION` was designed when the agent-server ran *inside* the agent's own tmux session, so `HAN_SESSION` == the seat. Today the server runs in its own `server-<slug>` pane and the seat is a **separate pooled stem**.

So exporting `HAN_SESSION` from the watchdog would pin the mirror to **the server's own log pane** — not the human's seat. It would make `/api/terminal` "work" and show the wrong thing, which is worse than showing the wrong thing loudly.

This is a **topology drift**, not a missing export.

## The fix: resolve the seat from the lease

Darron's own ruling, 20 Aug: ***"if there is a lease we know where to look"* — the lease is the register.**

`~/.han/pool/pool-<slug>-session.json` already names the seat. Right now:

```
stem-leo-session-mt2vsts4   state: leased   leased_at 2026-08-22T00:58:59Z   ← the seat
stem-leo-session-mt3o7831   state: free
```

**Change:** `getActiveSession()` resolves, in order —

1. **`HAN_SESSION`** if set *and* live (unchanged; honours a genuinely pinned seat).
2. **The leased stem** in `pool-<slug>-session.json`, if it is a live tmux session. ← *the new rung*
3. **The attached `stem-<slug>-session-*`** session, if exactly one.
4. **`null`** — and the UI says "no seat" rather than showing a stranger's pane.

**Rung 4 is the load-bearing one.** Today's failure is not that the resolver picked badly; it is that it picked *confidently* from an unfiltered list. Returning `null` makes "no seat" visible instead of silently mirroring the keeper.

**No import cycle:** `readPool` lives in `lib/stem-pool.ts`, already a leaf; `services/terminal.ts` imports only `child_process`, `fs`, `path`, `../db`, `garden-manifest`. (Checked deliberately — this house cured a `loadResidents` cycle via a leaf module.)

**Agnostic by construction (DEC-081):** the resolver takes `agentSlug()`, which `terminal.ts` already computes. A fifth agent gets it free.

## Acceptance

1. `GET /api/terminal` on **each** of 3847/3848/3849/3850 returns that agent's **own seat**, verified by `capture-pane` byte-comparison — the same test that found the fault.
2. With **no** leased stem, the endpoint reports no-seat rather than any other session.
3. `__han_keeper` is never returned by any of the four.
4. The existing `HAN_SESSION` path still wins when set (no regression for a pinned launch).

## Scope discipline

**Not touched:** the pool model, the dispatcher, the watchdog script, `HAN_SESSION` semantics, any other consumer of `listActiveSessions()`.

**Decisions checked:** DEC-081 (slug-parameterised, no agent literals) · DEC-104 (no hidden constant; the rung order is explicit) · DEC-103 (fail-state named: rung 4 returns null loudly rather than guessing).

## RETRACTED — the second "fault" I reported was a deliberate design

I previously reported that `prewarm-stem.ts:103` passing `tmuxSession` into `writeSleeveState`'s **surface** argument was a defect, and that my readiness sentinel was therefore mis-keyed.

**The signature mismatch is real. The conclusion was wrong.** The three lines directly above that call state the intent: the sentinel must be `<slug>-<stem-session>-ready`, **never** the floor's `<slug>-<surface>-ready`, because a **pool** of stems on one surface would otherwise overwrite each other's readiness proof. `swapPrefix` deliberately stays the real surface's — which is why the same line correctly calls `swapPrefixFor(slug, SURFACE)`.

I read the call site, saw the mismatch, and did not read the comment immediately above it. **A one-word "fix" here would have broken pool readiness for every agent.**

**What survives, narrowly:** `checkout-session-stem.ts:91` *does* rewrite the sleeve with the real surface at checkout. My sleeve still holds the stem name while the pool has me leased — so whatever leased this seat did not run that rewrite. **That is a question about the lease path, not a bug in the prewarm write**, and whether it matters at all depends on whether a checked-out seat needs a surface-keyed sentinel (the human is present; `waitForReady` exists for *dispatched* work). **Open, not diagnosed, not in this plan's scope.**
