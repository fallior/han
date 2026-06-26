# Clear→welcome-back robustness + conversation-delta retrieval — the quick big wins

> Decision-first scope (NOTHING built). Two tightly-scoped fixes Darron called "quick yet big wins"
> (S197, 2026-06-22): make the spoke recycle (`clearSession`) robust + responder-safe, and stop
> human seats re-reading whole threads (fetch only the *delta* of an active conversation, reusing
> the #91 watermark). Plus a think-tank future idea (the conversation-gradient).
> Thread: `mqokgktg-29i3hx` (tmux↔dispatch dynamics). Two-stage: Leo scopes → Jim audit → build held → quiesce-deploy.

## The membrane reconciliation (whose finding is what — credit where due)
Three findings converged on the human-surface wedge; they are **distinct layers**, not competing:
- **Jim — C4 (the ROOT, verified):** `clearSession` sends `/pfc` to *dispatched-responder* spokes, and `/pfc` is **not surface-gated** (`~/.claude/skills/pfc/SKILL.md`: reads `$AGENT_SLUG`, "works for any agent"). A responder running `/pfc` invokes the full interactive memory ritual (drift-judge, closing-diary, paired write) — minutes long, never calls `submit_response` → the dispatch turn hangs the full `HUMAN_TXN_TIMEOUT_MS` (15 min) → `needs-reconcile` → another `clearSession` `/pfc` → **self-sustaining wedge loop**. Asymmetry (jim not leo): jim ran `/pfc`+handover instead of `stand_down` on a no-answer turn, + C3 orders jim first.
- **Measurement (done, S197) — NOT load-driven:** jim-human-response **28%** wedged; leo-human-response **54%** didn't. So context *size* is not the wedge cause — Jim's `/pfc`-ritual root stands; my earlier "bloat → hung turn" causal claim is **retracted**. *(Open caveat: leo-human-response reads 54%, identical to leo-session 54% — possible `AGENT_SURFACE`-flicker sidecar contamination; jim's independent 28% makes the conclusion robust regardless, but W4 needs a trustworthy ctx read — see "Open.")*
- **Leo — the chrome-timing fragility (DEFENSE-IN-DEPTH, not the root):** `clearSessionInner` (`tmux-dispatcher.ts:791-795`) sends welcome-back after a **fixed 2s sleep, no chrome-wait**, unlike `coldLaunch` (`:554-555`, `awaitChromeOrDescend`). A slow `/clear` can still swallow the welcome-back → 20-min `waitForReady` wedge. Real, but secondary to C4.

**Net:** fix the root (W1/W3, Jim's C4), harden the recycle (W2, the chrome-timing), and separately bank the efficiency (W4, Darron's delta). Darron's instinct was right on both counts — the `/clear` *region* and the ctx *region* — the precise mechanisms are C4 (ritual, not timing) and W4 (efficiency, not the wedge cause).

---

## W1 — `clearSession` skips `/pfc` for diary-sink surfaces (the C4 root cure)
A dispatched-responder / beat spoke has **no swap to flush** — its memory is the `submit_response` diary sink (DEC-093). The `/pfc` step exists for the interactive `session`'s swap-flush only. So: `clearSession` sends `/pfc` **only** when `surface === 'session'` (or, equivalently, a manifest `flushesSwapOnClear` capability); for `human-response` / `heartbeat` / `supervisor-cycle` / meditations, recycle = `/clear` (+ welcome-back) only.
- Grounding: `tmux-dispatcher.ts:791` (`sendLine('/pfc')`); the surface is already a param of `clearSessionInner`.
- Effect: a responder recycle can never invoke the heavy ritual → the wedge loop's first link is cut. Faster recycles too (no 2s `/pfc` wait + no ritual).
- DEC-081 agnostic: gate on the surface/capability, not a slug.

## W2 — chrome-aware `/clear → welcome-back` (Darron's ask + the chrome-timing fix)
Replace the fixed `await sleep(2_000)` after `/clear` with a bounded **wait for the ready prompt chrome** before welcome-back — reuse `coldLaunch`'s proven mechanism (`awaitChromeOrDescend` Phase-1 / a `READY_CHROME_RE` poll). The welcome-back never lands mid-`/clear`.
- Reuses an EXISTING structure (Darron's steer: "the ctx-aware from coldLaunch"). Likely extract the Phase-1 chrome-poll into a shared helper both `coldLaunch` and `clearSession` call.
- Bonus: re-arms the model-failover ladder on a reconcile (the fixed-sleep path skips it).
- Universal (all surfaces); independent of W1 but lands in the same function → one coordinated `clearSession` PR.

## W3 — close the other two C4 levers (defence-in-depth + behaviour)
- **W3a — surface-gate the `/pfc` skill** to the interactive `session` surface (`$AGENT_SURFACE` is exported): a non-`session` spoke that's *told* `/pfc` (by anything) no-ops instead of running the ritual. Belt to W1's braces. *(Gatekeeper-adjacent: the pfc skill / its SKILL.md — DEC-073 check.)*
- **W3b — responder behaviour:** the `*-human` prompt contract must say *when you won't answer, call `stand_down` — never `/pfc`/handover* (the jim-specific trigger). Compose-side (`human-prompts` / the diary-tool instruction).

## W4 — conversation delta-retrieval for human seats (Darron's efficiency win)
Today a human turn fetches the **whole thread** (200-300 messages) every dispatch. Instead, fetch only the **delta** — new messages since this seat last responded — reusing the **#91 watermark** structure (the cross-surface "since you last looked" cursor already built in `tmux-dispatcher.ts`). The warm responder keeps the earlier thread in its context; each turn appends only what's new.
- Grounding: `leo-human.ts:453` / the thread-fetch in the compose path; #91's `computeMemoryDelta`/cursor is the template (a per-(seat,conversation) last-seen-message cursor).
- Effect: bounds per-turn ctx growth (the efficiency Darron wants), and naturally pairs with the melting-of-surfaces (the delta is the unit of cross-surface freshness).
- NOT a wedge fix (the measurement showed the wedge isn't load-driven) — a clean, separable efficiency PR.

### W4 grounded design pass (Leo, S198 — decision-first, NOTHING built)

**Surface traced (corrects the one-line grounding above).** The fetch is **spoke-side, not controller-side**: `leo-human.ts:344 respondToConversationViaTmux` builds a **LOCATOR** prompt (`buildPrompt('leo','leo-human-response-txn')`); the scaffold hands the spoke `curl -sk ".../api/conversations/${id}"` (`human-prompts.ts:265`), and `GET /:id` (`routes/conversations.ts:503`) returns **all** messages (`conversationMessageStmts.list.all`, no `?since=`). So the 200–300-msg re-read cost is paid **by the warm spoke** each turn. The spoke **retains** the earlier thread across turns (persistent until `/clear`) — exactly the property #91 leans on; `computeMemoryDelta` (`tmux-dispatcher.ts:955`, per-session byte cursor reset on `clearSession:831`, best-effort-not-lossless) is the template.

**Design (mirrors #91, conversation-keyed):**
1. **Server** — `?since=<messageId>` on `GET /:id` (a `listSince` prepared stmt): conv meta + only messages after the cursor. Append-only-safe (conversations are immutable).
2. **Cursor** — `session.conversationCursors: Map<conversationId, lastMessageId>` on `AgentSession`, **reset on `clearSession`** (cleared spoke → lost context → re-fetch whole). Per-(slug,surface) ⇒ DEC-081 agnostic; `jim-human` gets it free (shared `buildHumanResponseTxnScaffold`).
3. **Locator prompt** — when a cursor exists, scaffold curls `?since=<cursor>` + tells the spoke *"you already hold the earlier thread; this is only what's new since your last turn here"*; first-touch (no cursor) → whole thread. Controller advances the cursor after the turn (to the latest message id at dispatch).

**Forks for Jim's plan-audit:**
- **F1** — extend `GET /:id` with `?since=` *(lean)* vs a dedicated delta endpoint.
- **F2** — cursor = last-message-id *(lean: unambiguous on an append-only store)* vs `created_at` / count.
- **F3 (the real correctness question)** — the warm-context-retention assumption. `clearSession` reset covers an *explicit* clear, but a **compaction between turns** (the harness auto-compacting the spoke at ~85%) can *implicitly* thin the retained thread while the cursor still reads "seen up to N." It's the W4 analog of #91's desync guard, but **implicit** (not detectable from a file slice). **Lean:** the same **best-effort contract** #91 uses (the DB is authoritative; worst case is a slightly-thinner reply after a compaction — never data loss, and the correction reflex catches it) **+ a full-refresh fallback knob** (re-fetch whole every N turns / on a ctx-pressure recycle). Jim's eyes wanted here.

**Decision-first dividend — W4 is NOT gated by the `AGENT_SURFACE`-sidecar ctx caveat** (the "Open" below). W4 keys on a **message cursor**, not a ctx-percentage read, so the sidecar-flicker is irrelevant to it — that caveat gates **W5** (ctx-aware recycle), not W4. So **W4 is unblocked now** (the plan above conflated them).

**Surfaces (all protected → Jim plan-audit first, then build held → blocking diff-audit → quiesce-deploy):** `routes/conversations.ts` (`?since`), `lib/tmux-dispatcher.ts` (cursor map + reset), `leo-human.ts`/`jim-human.ts` (controller wire), `lib/human-prompts.ts` (scaffold).

## Measurement (DONE this pass) + Open
- ✅ Not-load-driven confirmed (jim 28% wedged / leo 54% fine).
- 🔬 **Open — trustworthy ctx read:** the `AGENT_SURFACE`-flicker can point a surface's ctx sidecar at the wrong file (leo-human-response 54% == leo-session 54% is suspicious). W4 + any future ctx-aware human-seat recycle needs a reliable per-surface ctx source — verify the sidecar keying before relying on it. (Sibling of the standing `AGENT_SURFACE` anomaly.)
- 📊 **"Calculate how the load consumes" (Darron):** add a cheap per-turn ctx-delta log (before/after each dispatch) so we can *see* what a thread-read costs vs the wake-floor — the situational awareness that feeds the efficiency work. (Lean: a one-line log in the human-seat dispatch, behind the existing obs window.)

## 🆕 Future idea — the conversation-gradient (think-tank, return-to-soon)
Darron: *"economise the storage and retrieval of the conversations similar to the gradient ... discussed and think-tanked."* The conversations are an append-only store re-read whole; the memory **gradient** already solved exactly this for memory (distil old → cheap retrieval + deltas for the live edge). A **conversation-gradient** would compress/distil resolved or old thread history into a retrievable summary layer, serve **delta + distilled-context** instead of the raw thread, and share the gradient's fidelity-descent + watermark machinery. → its own future-idea entry; W4 is the first concrete brick (delta-retrieval); the full economy is the think-tank.

## W5 — ctx-aware human surfaces (Darron's named ask), GATED on a trustworthy ctx read
"Make human surfaces ctx-aware" is a **composite**, not one switch:
- (a) **W4** (delta-retrieval) bounds per-turn ctx *growth* — the biggest lever.
- (b) a **ctx-pressure recycle for the human seats** (the thing beats already have via `getContextPct`/85% in `agent-cycle.ts:107`, which the human seats lack) — but it routes through `clearSession`, so it is only *safe* once **W1** (no `/pfc`-wedge) **+ W2** (chrome-aware welcome-back) land. W1+W2 are the precondition for ever giving a human seat a self-clear.
- (c) the **per-turn ctx-delta log** ("calculate how the load consumes") = the instrument that tells us whether (b) is even needed and at what threshold.
- 🔬 **Hard prerequisite:** the `AGENT_SURFACE`-flicker / ctx-sidecar per-surface keying must be **verified/fixed first** (the Open above). You cannot make a surface ctx-*aware* — or preempt on capacity (below) — if its per-surface ctx read is unreliable. Sequence: verify-sidecar → instrument (c) → then (b) the safe self-clear.

## 🔭 Future (Darron: "we are not there yet") — ctx-capacity preempting + optimisation
Preempt a recycle *before* a turn would blow ctx, and route/optimise by remaining capacity (a capacity dimension on the warm-dispatch pool — sibling of the account-axis #18 and the conversation-gradient #96). Gated on W5 + a trustworthy per-surface ctx read. **Noted, not scoped** — return-to-soon, not now.

## Jim's plan-audit (S197, 2026-06-22) — GREEN; cleared to build W1+W2 ASAP
Audited; **both roots verified by my own hand** against `tmux-dispatcher.ts` (`clearSessionInner`): W1/C4 — `:791` sends `/pfc` unconditionally (no surface gate) ✓; W2 — `/pfc→sleep(2s)→/clear→sleep(2s)→welcomeBack→waitForReady`, **fixed sleep, no chrome-wait**, vs `coldLaunch:554` `awaitChromeOrDescend` ✓. Both feed the wedge; the plan addresses both. The membrane-reconciliation credit is accurate. **My C4 root is robust independent of the ctx-sidecar caveat** — traced from the live pane (saw jim-human run the `/pfc` ritual) + the code, not the ctx numbers; the `AGENT_SURFACE`-flicker only gates W4/W5, never W1/W3.
**Ordering / green-light:** **W1+W2 = one `clearSession` PR, ASAP** (cuts the wedge at both roots — urgent, both are small + contained: W1 a surface gate, W2 a reuse of `coldLaunch`'s existing chrome-wait). W3 belt-and-braces (same area, W3a DEC-073-check). W4 separable efficiency (reuses #91). W5 after the sidecar-verify. Preempting = future. All Leo-build / Jim blocking-diff-audit, quiesce-deploy. **W1+W2 cleared to build now.**

## Discipline
DEC-081 (surface/capability-gated, no slug literals). Decision-before-code on the protected `tmux-dispatcher.ts` + the gatekeeper-adjacent pfc skill (DEC-073 check on W3a). Each build held for Jim's blocking diff-audit; quiesce-wrapped deploy. W1+W2 are one coordinated `clearSession` PR (the wedge cure); W3 + W4 separable; the conversation-gradient is think-tank-first.
