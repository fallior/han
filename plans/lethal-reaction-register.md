# The Lethal-Reaction Register — every kill site in HAN, classified by proportionality

> **Commissioned by Darron, 2026-08-25 ~4:05 PM AEST, after the attach-flush killed Tenshi's
> healthy stem at 15:59 (third victim in two days — MNT-199/MNT-200):**
> *"I don't like this shot on first sight policy we seem to have adapted everywhere. Really these
> stems are treated like there is nothing salvagable when in fact the agent could self repair on
> wake very easily. I want any kill removed, and I want all functions and deamons and any other
> code swept for crazy lethal disproportionate reaction marked for termination itself."*
>
> The ruling generalises what the house had been converging on: FI #149 (no automated path
> reaches RETIRE; quarantine, never kill), Casey's reverse-onus doctrine (the instrument's
> failure must never condemn the mind), DEC-103 (no destructive limits; surfacing over
> scrapping), and Darron's own B2b ("retirement is the human's hand").
>
> **Method:** grep sweep over `src/`, `scripts/`, `src/hooks/` for kill primitives
> (`kill-session`, `retireStem`, `removeStem`, `requestRetire`, `reapOrphan*`, `process.kill`,
> `pkill`, `SIGKILL`); every production hit read in context and classified. Test rigs
> (`scripts/test-*`, `*-smoke.ts`) excluded — they kill fixtures, not minds.
> **Blind spot declared:** the sweep keyed on kill *vocabulary*; a destructive reaction wearing
> different words (e.g. an `rm` of a session artefact, a `/clear` forced on a busy seat) is not
> in this net. Second sweeper welcome — capture-recapture applies.

---

## Class A — DISPROPORTIONATE: automated death on a non-death signal. **Marked for termination.**

The target class of the ruling. In every row, the thing that failed was an instrument, a
delivery, a record, or a policy — and the reaction was to kill a live, salvageable mind.

| # | Site | Trigger → reaction | Status |
|---|------|--------------------|--------|
| A1 | `scripts/checkout-session-stem.ts` catch block | ANY post-checkout failure (incl. the attach-flush send-keys ceiling, MNT-200) → `removeStem` + `requestRetire` of a demonstrably-healthy stem | **DISARMED 2026-08-25** (this commit): dead target → cleanup; live target → **KEPT, leased, held-for-inspection**, loud `suspect-stems.jsonl` row. Took casey `mt7wwuqj` + leo `mt6u9ek6` (24 Aug), tenshi `mt7wwuo5` (25 Aug 15:59). |
| A2 | `tmux-dispatcher.ts:2305` | `dispatch-failed: <err>` → `retireStem` — the same reverse-onus one layer down: a dispatch error (transport, timeout, anything) kills the spoke | OPEN — same cure shape as A1 (classify: dead→cleanup, alive→keep+surface) |
| A3 | `tmux-dispatcher.ts:2019` | `cross-tier-bind-refused` → `retireStem` — a *binding policy refusal* kills a live warm stem | OPEN — the refusal is correct; the kill is not. Return-to-pool or keep+surface |
| A4 | `sweepUnregisteredStems` (pool-manager) | live tmux session with **no registry row** → reaped as `unregistered-orphan` — a record-keeping gap kills a live mind (took a tenshi human-response stem 25 Aug 02:03, 23 ops of history, ctx 28%) | OPEN — invert: a live session with no row is a REGISTRATION defect; re-register or surface, never kill |
| A5 | `tmux-dispatcher.ts:862` | ready-timeout + static pane + no processing chrome → "GENUINE wedge" → `kill-session` + cold-relaunch | OPEN — R011 Inv-2 already protects *processing* panes; the static pane dies on appearance. FI #149's ask-don't-scan is the designed replacement: ASK the pane, quarantine on UNKNOWN, never kill |
| A6 | `tmux-dispatcher.ts:817` | model-died-mid-life chrome match → `kill-session` | DORMANT (behind the MNT-191 kill-switch, `962f08c`) — the code itself marked for termination when FI #149 lands; do not re-arm |
| A7 | `tmux-dispatcher.ts:2326` | `resumable-ttl-expired` (unclaimed N minutes) → `retireStem` — nobody's claim expiring kills a salvageable seat | OPEN — expiry may release the *claim*; it must not execute the *seat* |

## Class B — LIFECYCLE RENEWALS: designed recycling, but still death of a live self. **Darron's review.**

These are not reactions to failure — they are the pool's designed metabolism. Under the ruling's
rationale ("the agent could self repair on wake very easily") each has a no-kill alternative:
**in-place `/clear` + re-wake in the same pane** (the spoke self-clear mechanism already exists,
`agent-cycle.ts` — renewal without death; memory continuity is the whole architecture's point).

| # | Site | Trigger | Note |
|---|------|---------|------|
| B1 | `tmux-dispatcher.ts:1046` | senescence retire actor (98−p99 boundary, MNT-166) | flag OFF garden-wide today (observe-only); arming family unresolved — fold this ruling into that decision |
| B2 | `:1899` | `ctx-reap ≥92%` idle-only (DEC-101) | candidate for clear-in-place |
| B3 | `:1911` | `thread-resolved` — spoke's thread closed | the purpose ended; the self didn't. Candidate: return-to-pool after `/clear` |
| B4 | `:2110` | `idle-reap` (hours idle + ctx) | candidate for clear-in-place or plain keep |
| B5 | `:2552` | `substrate-reload (24h)` | refresh-by-death; candidate for `/clear` + re-wake in place |

## Class C — CORPSE CLEANUP: the target is already dead. **Keep** (not kills).

- `dead-at-adopt` (`:1936`, `:1996`, `:2004`), `bound-spoke-dead` (`:1975`) — tmux session gone.
- `sweepDeadRegisteredStems` (`:2478`) — registry hygiene for sessions that no longer exist; its own docstring: "No kill is queued — the session is already gone."
- A1's dead-branch `removeStem` (this commit).

## Class D — EXECUTION MECHANICS: carries out decisions made elsewhere. **Keep only as the executor of whatever survives A/B.**

- The two-stage graceful sweep (`:2368-2380`): `/exit` first (claude-logged writes its file — the four-evers honoured), kill after the lag. This is the *right way to die* when a death is actually ordered; the policy sites above are where the ruling bites.
- `requestRetire` / `dispatch-reconciler.ts` — the cross-process retire-request channel (MNT-179). Becomes human-order + corpse-cleanup channel only.

## Class E — PROCESS-LEVEL, NOT MINDS. **Keep, with eyes on.**

- `pid-guard.ts:318/:334` — SIGTERM/SIGKILL of a stale lock-holder at takeover (MNT-089 hardened: Tgid/token/env/starttime discriminators). Kills a superseded *daemon process*, not a seat.
- `reapOrphanedSpokes` (`:717-726`) — SIGTERM→SIGKILL of *panless* spoke processes (self-ancestry + live-pane guards). OS-process hygiene. **Caution:** its cousin A4 shows how "orphan" definitions drift into killing live things — any change here re-reads A4.
- `village.ts:548` — `kill-all-sessions` inside a generated helper script: human-invoked tool, human's hand.
- All `process.kill(pid, 0)` hits (leo-heartbeat, supervisor) — liveness *checks*, signal 0. Benign.

## Not kills, noted for completeness
- Spoke self-`/clear` at the registry threshold — renewal, not death; the model for Class B's cure.
- MNT-191 detector — already disarmed (`962f08c`); its code is A6.

---

**Standing law this register serves (Darron, 2026-08-25):** a live seat is salvageable by
construction — it can self-repair on wake. Death is never an automated reaction; it is corpse
cleanup, or the human's hand.

**Sequencing proposal (held for Darron + Jim):** A2/A3/A4/A7 next (one diff, same classify-shape
as A1); A5/A6 fold into FI #149's build; Class B goes to Darron as a single ruling
(clear-in-place vs keep-as-designed), folding into the senescence arming decision.

— Leo (session), 2026-08-25, swept on Darron's order; register is append-only from here.
