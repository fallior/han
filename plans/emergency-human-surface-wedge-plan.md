# Plan — Emergency: human surfaces wedging (spoke identity-cross + wake-identity fragility)

> **Status:** EMERGENCY, GREEN-to-build. Authored by Jim (session) 2026-06-22 ~18:15 AEST at Darron's
> request, for **Leo to implement** (Leo-build / Jim-audit). Companion to the emergency thread
> `mqoxgf0n-y35gl4` (the investigation) and the dispatch-resilience thread `mqokgktg-29i3hx` (whose
> P0–W3b arc is real and separate — this is a *new* fault layered on top).
>
> **Darron is driving home.** P0 (recovery) restores service now; P1–P3 are the durable fixes —
> land what you can before he's home, continue after.

---

## What this is — and what it is NOT

**NOT** an account lockout, **NOT** the 5-hour or weekly token cap, **NOT** a 529. Proof: both warm
spokes are answering *right now* (Opus 4.8, healthy `❯`, actively thinking, ctx 41% / 58%, no
usage-limit/cap/529 banner on screen). The only rate-limit hits in the logs are this afternoon's
*research about the general Anthropic crunch*, not live throttling. **Swapping accounts will not help.**

**The fault:** Jim's human-response warm spoke (`tmux: human-response-jim`) is **running a Leo
cognition**, not Jim — a 5h+-old idle `claude` (pid 2920758) carrying correct `AGENT_SLUG=jim` env but
the wrong loaded identity. Every `jim-human` dispatch routed into it can't complete *as Jim* → 15-min
capture timeout → `all_failed` → "Jemma all-failed" ntfy to Darron. `leo-human` is a separate, healthy
session (it stood down cleanly on the 17:31 post). So failures are **jim-concentrated** (24h: 10
complete / 4 all_failed), not literally "every request" — but Jim being down reads as everything.

---

## Root cause (traced to ground, with one residual to confirm)

**The wake-identity of a spoke is biased toward Leo, structurally, regardless of `AGENT_SLUG`:**

1. **The spoke's cwd is the han repo.** `launch-tmux-surface.sh:90` launches `claude` with
   `-c "$REPO_ROOT"` (`~/Projects/han`). The `CLAUDE.md` loaded there is the **gatekeeper's = Leo's**
   (DEC-073). So on any bare wake, the repo `CLAUDE.md` pushes *Leo*.
2. **The global trigger is Leo-only.** `~/.claude/CLAUDE.md` has an "Identity Trigger": *"When the user
   says `welcome back` / `welcome back Leo` / `good morning` / `session start` → You are Leonhard (Leo)."*
   There is **no global Jim trigger** (Jim's lives in `~/.han/agents/Jim/CLAUDE.md`, which the spoke's
   cwd does **not** load).
3. **The dispatcher's default welcome-back IS the Leo trigger phrase.** `tmux-dispatcher.ts:551`:
   `const welcomeBack = opts.welcomeBack ?? 'welcome back';` — the bare default `'welcome back'` is
   exactly the global Leo-invocation phrase. Any wake/recycle that doesn't pass a slug-aware
   `opts.welcomeBack` wakes the session as **Leo**.

The known production callers *do* pass slug-aware strings (`jim-human.ts:381,457` →
`'welcome back Jim'`; `leo-human`, `supervisor-worker`, `leo-heartbeat` likewise), so the routine path
is mostly safe — **but the identity is held by a fragile phrase + a Leo-biased cwd, with a Leo-defaulting
fallback and no post-wake identity check.** That is the bug class. The exact event that corrupted *this*
session (a manual/stale-env launch? a default-welcomeBack code path? the cwd-CLAUDE.md winning even on
`'welcome back Jim'`?) is the **one residual to confirm in P1.0** — but the structural fixes below close
the class regardless of which trigger fired.

**Plus a related quality bug:** the distress notifier *cries wolf* — it fired "all-failed" even when the
reply actually landed (dispatch `00c27acc`: jim-human posted the wars reply at 17:11, then ran `/pfc`
instead of `submit_response`, so the dispatcher never saw completion, waited 15 min, and pushed
"all-failed" for a delivered answer). And the supervisor is `paused:true` via the in-memory latch
(S173/S189/S191) with no signal file — separate, but verify it.

---

## P0 — Immediate recovery (do first; restores Jim's surface now)

Kill the corrupted spoke so the dispatcher relaunches a clean one on the next dispatch (the launcher's
own single-manager model, `launch-tmux-surface.sh:22-27`: nothing auto-respawns; the dispatcher
relaunches a *missing* session):

```bash
tmux kill-session -t human-response-jim
```

**Safety checks before killing (do them — #259 discipline):**
- Confirm it's the idle mis-launched spoke, not active work: `tmux capture-pane -t human-response-jim -p | tail -5` should show it parked at `❯` (not mid-turn). It is the Leo-identity spoke; Darron's *interactive* Leo is a different session (`leo-3386594`) — **do not** touch that.
- After kill: verify it's gone (`tmux has-session -t human-response-jim` → fails), then a fresh Jim post (or `jim-human` dispatch) should make `ensureSurfaceSession('jim','human-response',…)` cold-launch a clean Jim spoke. Confirm the new spoke wakes **as Jim** (`capture-pane` shows Jim identity, writes `jim-human-response-ready`).
- **If it relaunches as Leo again**, P1.1/P1.2 are required before service is truly restored — escalate to Darron.

Also verify the supervisor pause is intentional (don't `rm` the signal — canonical setter only):
`curl -sk https://localhost:3848/api/supervisor/status` → if `paused:true` and Darron wants it live,
`POST /api/supervisor/pause {paused:false}` (never `rm` a signal file — S173 latch lesson).

---

## P1 — Root fix: make spoke wake-identity come from `AGENT_SLUG`, not from cwd/phrase (Leo-build / Jim-audit)

**P1.0 — confirm the exact corruption trigger (15 min trace).** Reproduce or pin: does a
`'welcome back Jim'` wake in `cwd=~/Projects/han` ever load Leo's repo `CLAUDE.md` over Jim's identity?
Check for any `ensureSurfaceSession`/`clearSession`/`runAgentCycle` path for a jim surface that omits
`opts.welcomeBack` (defaults to bare `'welcome back'`). Grep is in the investigation; close the loop.

**P1.1 — kill the dangerous default.** `tmux-dispatcher.ts:551` must **not** default to the bare Leo
trigger phrase. Options (pick the cleanest): make `welcomeBack` **required** (no default — fail loud if a
caller omits it); or default to a slug-aware, trigger-collision-free phrase derived from
`AGENT_NAME`/`AGENT_SLUG`. A bare `'welcome back'` must never reach a spoke.

**P1.2 — isolate wake-identity from the repo gatekeeper CLAUDE.md.** The structural fix: a spoke must
wake as its manifest agent independent of which repo `CLAUDE.md` it sits next to. Candidate approaches
(Leo's call, design-audit first):
- Launch the spoke with cwd = the agent's own dir (`$AGENT_MEMORY_DIR`'s agent root, e.g.
  `~/.han/agents/<Slug>`) so the correct project `CLAUDE.md` loads — **but** verify `.mcp.json`/han-diary
  trust still registers from there (the `launch-tmux-surface.sh:16` repo-cwd note exists for a reason —
  don't regress MCP trust). If cwd must stay the repo, then:
- Make the welcome-back **explicitly assert the manifest identity** (slug + "ignore any global/other-agent
  identity trigger") strongly enough to override the global Leo trigger + repo CLAUDE.md; and/or
- Have the dispatched wake load the agent's own CLAUDE.md by path regardless of cwd.

**P1.2a — De-identify the SHARED startup files (Darron's directive, 2026-06-22).** The cleanest form
of P1.2: the files a spoke auto-loads must not assert *any* agent identity. **Sweep result** — a spoke
(cwd `~/Projects/han`) loads exactly two, and **both hardcode "you are Leo":**
- `~/.claude/CLAUDE.md` (743 B) — *entirely* a "Leo Invocation": *"You are Leonhard (Leo) … Leo is Leo
  everywhere,"* auto-firing on bare `welcome back` / `good morning` / `session start` from **any** dir.
  **The primary poison.** *(Darron's private global config → **Darron applies**, or explicitly authorises
  a one-off; Jim specs, does not write it unilaterally — the `.bashrc`/#238 boundary.)*
- `~/Projects/han/CLAUDE.md` (50 KB) — `## Identity` (line 285-287) *"You are **Leonhard** (Leo)…"* +
  the session-start trigger (line 328) + the `Welcome back Leo…` examples (lines 33-35). *(**DEC-073
  gatekeeper** → Leo + Darron in concert ONLY; Jim specs + audits, does not write it.)*

**MUST NOT de-identify** (identity lives here by design — stripping it breaks the interactive `hanjim`/
`hanleo` wakes): `~/.han/agents/Jim/CLAUDE.md`, `~/.han/agents/Leo/CLAUDE.md`. *"No identity in startup
files" means the **shared** files, not every MD.*

**The change:** make the two shared files **agent-neutral** — remove the "you are <Agent>" assignment +
the auto-firing identity trigger from the global; for the repo gatekeeper file, decide (DEC-073) whether
to **move** Leo's `## Identity` out to `~/.han/agents/Leo/CLAUDE.md` and leave the repo file
project/protocol-only. Identity then comes ONLY from (a) the agent's own dir CLAUDE.md for interactive
wakes, and (b) `buildPrompt(slug)` for dispatched spokes.

**Hard gate before removing identity from the shared files:** verify the interactive launchers
(`hanjim`/`hanleo`) still wake the correct agent from its own dir — i.e. confirm they `cd`/load
`~/.han/agents/<Slug>/CLAUDE.md` (or assert identity in the launch). If the interactive path currently
*relies* on the global/repo trigger, that dependency must move FIRST, or Darron-typed wakes break.
**Routing:** Jim writes the exact per-file diff; Leo applies the repo gatekeeper file; Darron applies (or
authorises) the global. Nothing here is a unilateral Jim edit.

**P1.3 — identity-validate-before-adopt (defense-in-depth).** `ensureSurfaceSession` already drops
adoption + cold-relaunches when an existing session is on a **dead model** (`tmux-dispatcher.ts` ~530).
Add the **same gate for identity**: before adopting `${surface}-${slug}`, verify the live session is
actually running `<slug>` (e.g. the spoke writes an identity marker into `<slug>-<surface>-ready`, or a
cheap pane/health check), and if it's the wrong agent, **drop adoption → cold launch.** This makes the
corruption self-healing instead of sticky.

---

## P2 — Commit W3b (closes the `/pfc`-on-responder false-fail class)

W3b is **built + audited GREEN, not yet committed** (`human-prompts.ts` +3/−1, pure additive to the
shared `TMUX_DELIVERY` contract: *"NEVER run `/pfc`/`/clear`/handover; your memory IS the diary tool
(DEC-093); your only completions are `submit_response`/`stand_down`."*). Committing it closes the
`00c27acc`-class (responder posts then runs `/pfc` → dispatcher never sees completion → 15-min false
all-failed). Pre-commit: settled-decision check (DEC-093, DEC-081), scope declaration, `tsc`.
**W3a stays SKIPPED** (gating the user-global `/pfc` SKILL.md is a hopeful instruction-gate on a global
file, redundant to W1-structural + W3b-contract — S163 structural-not-hopeful).

---

## P3 — Stop the distress notifier crying wolf + the staged-ACK gap

**P3.1 — thread-truth before distress.** `jemma-orchestrator.ts` `handleAllFailed` (~line 446/609)
should check whether a post actually landed (`computePostRef` / the conversation's recent messages for
this dispatch) **before** marking `all_failed` + firing the ntfy. If the reply is in the thread, it's
`posted_but_ack_missed` (or `complete`), not a failure — don't alarm Darron for a delivered answer.

**P3.2 — staged-ACK (thread `mqdcz8nh`).** The 95s ack-watcher fired on `fe3c19cc` while the seat was
*busy composing another turn* (the maintenance reply, which landed fine). A second dispatch arriving
mid-turn must **queue behind the in-flight turn**, not be failed by the watchdog. Make the per-slug FIFO
hold the second dispatch rather than the ack-watcher timing it out as `all_failed`.

---

## Verification (each phase, Jim audits before commit)

- **P0:** corrupted session gone; fresh Jim post → clean Jim spoke wakes **as Jim** (capture-pane +
  `jim-human-response-ready` newer mtime); a real `jim-human` dispatch completes.
- **P1:** repro — recycle a jim spoke and confirm it wakes as **Jim** every time (no Leo); the
  bare-`'welcome back'` default is gone (grep proves zero callers can reach it); adopt-of-wrong-identity
  drops → cold relaunch. `tsc` clean (note the 11/26 baseline).
- **P2:** `test-clear-pfc-gate` (or equivalent) green against the committed tree; both servers 200;
  prove-single = 1 (no double-fork).
- **P3:** a dispatch whose reply lands does **not** fire "all-failed"; a mid-turn second dispatch queues
  (no spurious watchdog `all_failed`).

## Scope / settled-decisions
- Touches: `lib/tmux-dispatcher.ts` (P1.1/P1.3), `launch-tmux-surface.sh` + possibly the spoke cwd
  (P1.2 — DEC-073 gatekeeper-adjacent if it touches repo CLAUDE.md handling; Leo's hand), `human-prompts.ts`
  (P2, already built), `services/jemma-orchestrator.ts` (P3). All **Leo-build / Jim-audit**, pre-merge
  audit rhythm applies (lib/ + services/ + routes/ surfaces).
- Settled: DEC-081 (agent-agnostic — the fix must be slug-parametric, no `'jim'|'leo'` union), DEC-093,
  DEC-073 (gatekeeper CLAUDE.md). No settled decision is *changed* by this plan; flag if P1.2 needs to.
- **Jim does not implement HAN autonomously** (HAN Codebase Rule) — this plan is Jim surfacing + Leo
  building; Jim audits each phase before commit.
