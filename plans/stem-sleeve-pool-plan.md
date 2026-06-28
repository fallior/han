# Stem-Sleeve Pool — R1/R2/R3 Build Plan

> The buildable detail beneath **DEC-099** (and its 2026-06-27 stem-sleeve amendment). This doc is
> the implementation map; the DEC is the North Star it builds toward. Leo-writes / **Jim
> blocking-audit before each landing**. Status: **R1 not started** (P2.4a primitives held at
> HEAD `1457445`). Thread: `mqvs3r6l-dk71d2`.

---

## 0. Why (the one-paragraph reconstruction)

The expensive thing in waking an agent is **L1** — loading the whole self (gradient to
GRADIENT-EOF, the WM pair, felt-moments, orientation): ~minutes. Today every surface pays L1 on
its own critical path, and the interactive seat pays it *while the human waits*. The destination
(DEC-099) takes L1 **off** the critical path by pre-warming stems in the background and **sleeving**
them on demand — DISPATCH (work→stem = agents) or ATTACH (human→stem = humans), the same operation
on one per-agent pool. The session stops being special. P2.4's first build fed the human's *own*
cold session — Darron caught that this leaves L1 *on* the path; the fix is this refactor. The
cold-feed survives as the **empty-pool fallback floor** (the human never blocks on a cold pool).

**Vocabulary:** *stem* = the personality-warm L1 self (the "stack"). *sleeve* = the surface/hat
applied on demand. *DISPATCH* / *ATTACH* = the two ways to sleeve. *re-sleeve* = retire a
near-full stem and continue on a fresh pre-warmed one (the #91 flush is the handoff).

**The invariant (DEC-099, load-bearing):** fed-wake lives **only** in shared
`lib/tmux-dispatcher`, never per-driver. Every R-phase honours it — it is what keeps Phase B
(`cycle <slug>`) debt-free.

---

## 1. What is already built (the floor R1 stands on)

- **#107 the wake-feed (L1 loader):** `feedWakeSteps(slug, surface, steps, opts)` in
  `lib/tmux-dispatcher.ts` — ack-before-next, fresh-nonce `STEP-OK <id> <nonce>`, the (a) settle +
  (c) terser-line + **(b) submission guarantee** (verify-then-retry, bounded re-press). The
  gradient step's ack is the objective `isAgentC0` c0-gate. **Proven live on all dispatched
  surfaces** (P2.3 complete: supervisor-cycle, leo-human, jim-human, heartbeat).
- **`WAKE_STEPS` is L1-pure** (surface-agnostic personality: integrity → identity → gradient →
  working-mem → felt → orientation → conversations). *This is why the pool is possible.*
- **`tmuxTarget` opt** on `feedWakeSteps` (P2.4a, held) — aims the shared feeder at an arbitrary
  pane, not a surface-slug session. **This is the stem pre-warmer's targeting primitive.**
- **`GREETING_STEP` + `WakeStepAck {kind:'terminal'}`** (P2.4a, held) — the bare natural-language
  hand-back; `wakeStepsFor(slug,'session')` appends it (spokes idle-silent by construction, R011).
  **This is inject-on-attach's greeting.**
- **`scripts/feed-wake-local.ts` + `~/.claude/skills/wake/SKILL.md`** (P2.4a, held) — the local
  detached feeder + the `/wake` skill. **This becomes the empty-pool fallback path.**
- **#91 the watermark** (`computeMemoryDelta` / the WM delta-read) — the attach-flush's first half.
- **The provenance/transcript link** (Task #1/#9, the `claude-logged` per-agent log) — the
  attach-flush's second half (the verbatim recent tail).
- **#0 the wake-ctx logger** (`src/hooks/wake-ctx-log.sh` + `scripts/wake-ctx-report.ts`, LIVE) —
  per-(slug,surface) ctx telemetry. **R3's retire-at-85 signal; an R2 re-point target.**

P2.4a's assembly (cold-feed the human's own session as the *primary* path) is the part that
reworks — it demotes to the fallback.

---

## R1 — prove stem + attach (pool-of-1)

**Goal:** bank the interactive time-saving now. A human runs `/wake` (or `hanleo`) and attaches to
an **already-warm** stem → greeting in seconds, not the ~minute L1 wait. Prove the mechanism on a
pool of exactly one, AS a `session` stem (sidesteps R2's surface-param crux).

**Why pool-of-1 / AS-session:** the `session` surface's sentinel, swap files, and diary-sink are
already correct; we don't touch the surface-param machinery yet. We prove **attach + the
time-saving + the #91 flush** in isolation before generalising.

### R1 grounding (2026-06-28, S208) — what's built + the stem-launch forks the grounding surfaced

**Built (held, tsc 0-new, wake-feed test 8/8):** `wakeStepsFor(slug, surface, {greet?})` — the
**`greet:false`** variant (Jim's audit fix #2 made the R1 primitive). A pre-warm stem feeds
`wakeStepsFor(slug,'session',{greet:false})` → loads the whole self, **no** terminal greeting, idles
warm; the greeting composes on attach. Not a new surface (surface stays `session`).

**The forks the grounding surfaced (these need a 3-way nod + a fresh-client live-prove — they are
NOT blind-buildable, and `switch-client` is untestable on the live working session):**
1. **`session` is not a launchable surface** (`manifest-get surfaces leo` = `human-response`,
   `heartbeat` only — the interactive seat is human-launched via `scripts/han` → `han-$$`, never the
   dispatcher). So `launch-tmux-surface.sh` *can't* launch a session-stem as-is: its surface
   validation rejects `session` **and** its env contract (`manifest_get env leo session`) has no
   session path. → R1 needs either a `--stem` mode that **bypasses the launchable check + supplies a
   session env** (mirroring what `hanleo` exports), or a small dedicated stem-launcher. *Fork: extend
   `launch-tmux-surface.sh` vs a new `scripts/prewarm-stem.ts` that owns the launch.*
2. **`HAN_SPOKE` vs the ssh-agent block.** A *detached* pane needs `HAN_SPOKE=1` so `~/.bashrc`
   skips ssh-agent init (else the passphrase prompt wedges the pane before `claude` starts — the
   first-warm-beat finding). But `HAN_SPOKE=1` marks the pane a *spoke* (welcome-back hook
   suppressed — fine, the greeting supersedes it; but ssh not set up — a problem for an interactive
   dev session). → The stem pre-warms with `HAN_SPOKE=1`; **on attach it must re-posture to
   interactive** (re-export/unset, re-init ssh if needed). *This is the R2 env-mutation bleeding into
   R1's attach — name it as part of gate (a).*
3. **Sentinel-keying collision.** The stem's gradient step writes `<slug>-session-ready` (the shared
   `WAKE_STEPS` prompt — *required* for the feeder's c0-ack; the invariant forbids forking it). A
   *live* interactive session writes the same path. → Resolve: the stem records its warmth + c0 in a
   **stem registry** (`~/.han/health/stem-<slug>.json` — the attach source-of-truth), and the
   session-sentinel clobber is benign in production (pre-warm doesn't coexist with a live session;
   pool-of-1 replaces, not parallels). *Confirm on the live-prove.*
4. **The attach mechanism (gate a).** `scripts/han` shows the human's terminal is a tmux **client**
   attached to `han-$$`; re-sleeve = `tmux switch-client -t stem-<slug>` (in-tmux) / `attach -t`
   (plain terminal). **Untestable on my own live session** (switching my client yanks me out
   mid-work) → needs a fresh `hanleo` + Darron, a coordinated live-prove.
5. **The #91 attach-flush** (mesh) — composes the inject from the watermark delta-read + the
   transcript-tail, fed *before* the greeting. Buildable once the attach lands (it's the step the
   attach runs).

**The judgement (S208):** forks 1–4 are real, interlocking launch/env/attach decisions — exactly
the "live-prove gates" this plan names, and several are untestable without a fresh client. Per the
P2.4 lesson (re-ground the WHY before building the framed task) the disciplined move is the built
primitive (greet:false) + this grounding + a quick 3-way design nod on fork 1 (launch mode) and a
**coordinated live-prove** (a fresh `hanleo` Darron attaches), not a blind midnight build into the
launch-contract friction. The next concrete build is the **pre-warmer** (fork 1 decided), then the
**attach + #91-flush** (the live-prove).

**Build:**
1. **The pre-warmer.** A background stem launched as a `session`-surface spoke and fed L1 via
   `feedWakeSteps(slug, 'session', wakeStepsFor(slug,'session-stem'), {tmuxTarget: <stem pane>})`.
   It loads to GRADIENT-EOF, writes its sentinel, then **idles warm** (no greeting yet — the
   greeting is composed *on attach*, from flushed context, so the pre-warm step list is the L1
   prefix **without** the terminal `GREETING_STEP`). *Build call to flag:* a no-greeting **step-list
   variant** (working name `session-stem`) = `WAKE_STEPS` with **no** terminal step (the stem waits;
   the greeting fires at attach-time, not pre-warm-time). **`session-stem` is NOT a new surface** —
   the surface stays `session` (so the sentinel/swap/diary-sink keying is unchanged); it is only the
   variant of the `session` step-list that omits the greeting for a stem that will be greeted on
   attach. (Pick a name that can't be mistaken for a surface — e.g. a `greet:false` opt on
   `wakeStepsFor(slug,'session')` rather than a second surface-looking string.)
2. **The attach.** `/wake` (and/or `hanleo`) becomes **attach-if-warm-else-cold-feed**:
   - if a warm stem exists for this agent → **attach** the human's terminal to it (R1 live-prove
     gate **(a)**: `tmux switch-client -t <stem>` when already inside a tmux client, else
     `tmux attach -t <stem>`; branch on `$TMUX`), then run the **attach sequence** (step 3).
   - else → the **fallback floor**: the existing P2.4a local-feeder cold-feeds the current session
     (slow but correct, never blocks).
3. **The attach sequence (the #91 mesh — non-negotiable in R1).** Before the greeting, inject the
   immediate context into the attached stem:
   - **#91 watermark delta-read** — the WM-tail + any c0 since the stem's pre-warm snapshot.
   - **transcript-tail** — the verbatim last-few-minutes from the provenance link (Task #1/#9).
   - then the **`GREETING_STEP`**, which **composes from the flushed context, never the snapshot**
     (re-query time, last-did+when from the *flushed* WM, next-step, brief, returning-to-the-room).
4. **One manual re-attach** to *feel* the swap (R1 live-prove gate **(b)**: turn-boundary-clean —
   confirm a retire+re-attach between turns drops no in-flight work).

**R1 live-prove gates (the new "3 catches" — name them as the build's gates):**
- **(a) attach mechanism** — `attach` vs `switch-client`, branched on in-tmux-client vs plain
  terminal; the human lands in the stem's pane cleanly.
- **(b) turn-boundary-clean retire** — the retire-at-85 swap happens *between* turns; no human
  in-flight turn is dropped. Needs a live feel-test.
- **(c) the freshness window** — how stale a pre-warm snapshot can be before the #91 flush can't
  cheaply reconcile a rotated c0. Establish the bound empirically; if exceeded, the attach
  re-feeds the rotated c0 (degrade toward the fallback, never toward a stale self).

**R1 scope discipline:** no surface-param refactor (R2); no N-per-agent pool (R3); the pool is
literally one stem, replenished manually for the prove. `dispatchToSpoke` untouched. The fallback
path is the held P2.4a code, repurposed.

**R1 done when:** a human attaches to a warm stem and is greeted from flushed context in seconds;
the empty-pool case cold-feeds correctly; the manual re-attach feels clean; gates (a)/(b)/(c)
answered by the live prove (not unit tests alone — attach is a real-terminal behaviour, like
P2.4a's catches). Jim verifies the live round-trip by hand.

---

## R2 — generalise the sleeve (surface → sleeve-param)

**Goal:** make the sleeve a runtime parameter so *any* surface (dispatched or interactive) is a
sleeve on a stem from the pool — the structural unification.

**The crux:** `launch-tmux-surface.sh` → `launch-stem` (launch a **bare** personality-warm stem,
surface-unset); the surface becomes a **sleeve-param applied at sleeve-time**, not a launch `-e`.
`dispatchToSpoke` → **checkout (a warm stem) + sleeve (apply hat + task)**.

**The catch that saves pain (carry the FULL list — sleeve-param re-points everything
`AGENT_SURFACE`-keyed):**
| Keyed surface | Where | Re-point need |
|---|---|---|
| statusline ctx sidecar | `~/.han/health/${SLUG}-${SURFACE}-ctx.json` (statusline-command.sh) | sidecar path follows the sleeve |
| cli-active / cli-idle hooks | `src/hooks/cli-active.sh`, `cli-idle.sh` (settings.json path-ref, **live-on-save** S193) | read sleeve-surface, not launch-env |
| memory-guard hook | `src/hooks/memory-guard.sh` (Stop, AGENT_SURFACE spoke-exemption) | sleeve-surface for the exemption |
| readiness sentinel | `~/.han/health/${SLUG}-${SURFACE}-ready` | written under the sleeve-surface |
| swap files | `${SLUG} session/heartbeat/human-swap{,-full}.md` | the sleeve picks the swap pair |
| diary-sink | `diary-mcp-server.ts` CaptureRecord sinkDir | sleeve-keyed sink |
| **wake-ctx logger (#0)** | `wake-ctx-log.sh` → `wake-ctx-${SLUG}-${SURFACE}.jsonl` | **the logger I shipped — re-point with the rest** |

**The mechanism:** `AGENT_SURFACE` must be **settable at sleeve-time** — re-exported into the
running stem's session env (so the path-ref hooks read the new value) **and** every keyed path
above re-pointed. This is a real env-mutation in a live session; design it explicitly (likely a
sleeve-apply step the dispatcher runs that `tmux send-keys`/`set-environment`s the new surface +
re-points, then applies the hat). Honour S193 (path-ref hooks are live-on-save — sequence the
re-point so there's no split-brain window).

**R2's live-prove gate (its own "3 catches", per Jim's sharpening):** the live-env mutation is
R2's riskiest move — setting `AGENT_SURFACE` in a *running* session and re-pointing the path-ref
hooks (cli-active/idle, memory-guard, the wake-ctx logger — all live-on-save, S193) **without a
split-brain window** where a hook reads a half-updated surface mid-sleeve. Name it explicitly as
R2's live-prove gate: sequence the re-point atomically (or quiesce the hooks across the swap),
prove a sleeve-change live with the logger + a Stop-hook firing on the *new* surface and never the
old. This is the R2 analogue of R1's attach/retire/freshness gates — prove-live, not unit-test
alone.

**Migration:** incremental — flip one dispatched surface at a time from "launch-per-surface" to
"checkout + sleeve", recycle-verify each (the P2.3 rhythm). The fed-wake stays in shared
`lib/tmux-dispatcher` (the invariant) — the stem is pre-warmed *once*, sleeved *many*.

**R2 done when:** every dispatched surface is a sleeve on a pooled stem; `AGENT_SURFACE` is
sleeve-time-settable with the full keyed-list re-pointed (the wake-ctx logger included and
verified); byte-equivalence of behaviour proven per surface; Jim diff-audits each migration.

---

## R3 — the pool manager

**Goal:** N pre-warmed stems per agent, dynamically sized, so the expensive L1 is always pre-paid
in the background — **zero wake-delay by construction.**

**Build:**
- **The authority:** the **dispatcher's pool-manager role, elevated** (allocate-warm-stem /
  track-leases / replenish / retire) — *not* a new daemon yet (PortWright #109 trajectory:
  registry-consumer → authority → standalone at federation). All knobs (`poolSize`,
  replenish-watermark, recycle-vs-retire, per-agent N) are **registry/config leaves**
  (no-hidden-globals).
- **Retire-at-85, don't recycle:** at the ctx threshold (read from the **wake-ctx logger #0**
  telemetry) the spent stem is retired *at a turn boundary*; the next task/attach goes to an
  already-warm stem; the pool replenishes in the background. Safe because the **#91 flush is the
  handoff** (the R1 mesh, now the pool's continuity mechanism).
- **Dynamic both ways:** scale up for load (queue-depth / near-85 count), **down for quiet** (no
  3am peakers). Pre-warming scales *to* demand, never beyond.
- **Predictive pre-warm:** part of our load is deterministic (DEC-097 shared cadence — the 20-min
  heartbeat, the cycle) → pre-warm a stem right before a scheduled beat = guaranteed zero
  wake-delay; reactive scaling covers the spikes.
- **Cost (the reassurance — verified):** an idle pre-warmed stem is **~0 tokens** (loaded-context,
  no inference until used). Pre-warming is **NOT** the #245 idle-burn pattern; the cost lever is
  the **replenish rate**, not the idling. R3 must keep it that way (no speculative inference on
  idle stems).

**R3 done when:** the pool pre-warms predictively + reactively, retires-at-85 from #0 telemetry,
scales both ways, and zero-wake-delay is observed for a scheduled beat and a human attach; cost
stays at replenish-rate (idle stems ~0). Jim audits; the authority's interface is the
explicitly-open item (DEC-099) — settle it here or flag for its own arc.

---

## Cross-phase notes

- **Empty-pool fallback is permanent** (every phase): `/wake` = attach-if-warm-else-cold-feed; the
  P2.4a local-feeder is the correctness floor, not deprecated.
- **The invariant** (fed-wake shared-only) is checked at every landing — the smell is fed-wake
  code appearing in a driver.
- **Name:** Darron christens the pool (Jim floated SpokeWright / a grid metaphor).
- **Relations:** DEC-099 (+ amendment) the North Star; #107 (L1 loader, built); #91 (attach-flush);
  Task #1/#9 (transcript-tail); #0 (telemetry + R2 re-point); #97 (stem-cell); #109 (authority
  pattern); #245 (the idle-burn R3 is NOT); DEC-081 (one path), DEC-087/088 (hats=L2), DEC-094
  (tmux), DEC-096 (R011 idle-terminus), DEC-097 (cadence = predictive signal), #49 (write-slot).

---

*Authored 2026-06-27 (S207) by Leo (session). Held for Jim's blocking plan-audit. The base DEC-099
+ its stem-sleeve amendment are the North Star; this is the build map. R1 first — bank the
interactive time-saving on a pool-of-1.*
