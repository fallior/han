# MNT-052 proper cure — evict the shared tmux server into its own `han-tmux.service`

> Build-and-HOLD for Jim's G4 audit (thread `mrk21z25-xbux8r`). Nothing here is installed/enabled.
> The interim KillMode=process defuse is LIVE + proven (server survived ~10 responder restarts).
> This is the structural decoupling: the server gets its own cgroup, owned by no agent unit.

## Ground-trace (the reboot path today — G4 baseline)

- The shared tmux server is a **single server** on socket `/tmp/tmux-1000/default`; every session
  any agent creates is a child of that **server process**, so all panes inherit the **server's**
  cgroup — not the caller's.
- The server is born at the **first** `tmux new-session` after a fresh socket:
  `scripts/launch-tmux-surface.sh:141` (`tmux new-session -d -s "$SESSION_NAME" …`). Whichever
  tmux-spawning **systemd unit** runs it first at boot owns the server's cgroup. Only two units
  spawn tmux: `human-responder@` (template) and `leo-heartbeat` (grep-confirmed: only
  `human-responder.ts` + `leo-heartbeat.ts` call the launcher/dispatch; jemma/wm-sensor don't;
  the supervisor cycle attaches in-process, it is not a unit).
- Today the winner is `human-responder@leo` → **current server pid 522254, cgroup
  `human-responder@leo.service`** (verified by `/proc/522254/cgroup`), `exit-empty on` (default).
- Consequence (the bug): a restart of `human-responder@leo` (default `KillMode=control-group`)
  SIGKILLs its whole cgroup = the server + every session. That is the 12:01 garden-wide kill.

## The cure — `han-tmux.service` owns the server, born before any agent unit

Once a han-owned server exists, `launch-tmux-surface.sh:141`'s `new-session` **attaches** to it
(the `has-session` path / an existing server), so every session lands in **han-tmux.service's**
cgroup, and no agent-unit restart can ever reach it.

### Artifact 1 — `~/.config/systemd/user/han-tmux.service`  (NEW, inert until enabled)

```ini
[Unit]
Description=HAN shared tmux server — owns /tmp/tmux-1000/default so no agent unit's cgroup does (MNT-052)
# Born before every tmux-spawning agent unit → the server's cgroup is THIS unit's, not theirs.
Before=human-responder@leo.service human-responder@jim.service human-responder@tenshi.service human-responder@casey.service leo-heartbeat.service

[Service]
Type=oneshot
RemainAfterExit=yes
# Start the server with a keeper session, then make it survive going empty (belt+braces).
ExecStart=/usr/bin/tmux new-session -d -s __han_keeper
ExecStart=/usr/bin/tmux set-option -g exit-empty off
# Deliberately NO ExecStop kill-server + KillMode=none: stopping/restarting THIS unit must NOT
# decapitate the garden (that would just move the bug to a new owner). On unit stop, systemd
# removes the cgroup and the server's processes reparent to the user slice and keep running.
# The server is only ever torn down by an explicit `tmux kill-server` or a reboot.
KillMode=none

[Install]
WantedBy=default.target
```

### Artifact 2 — agent-unit ordering drop-in (belt+braces so they WAIT for the server)

`~/.config/systemd/user/human-responder@.service.d/after-han-tmux.conf` and the same for
`leo-heartbeat.service.d/`:

```ini
[Unit]
After=han-tmux.service
Wants=han-tmux.service
```

(`Before=` on han-tmux already orders it first when both start via `default.target`; the
`After=`/`Wants=` on the agent side makes the dependency explicit and pulls han-tmux even if a
future unit forgets to enable it — DEC-081 slug-agnostic: the template drop-in covers every agent,
a 5th gets it for free.)

### Artifact 3 — `launch-tmux-surface.sh` fallback guard (POSTED INLINE, not applied)

If `han-tmux.service` is ever down when a launch needs the server, the launcher must not birth it
into its own cgroup. Wrap **only the server-creating** `new-session` so a birthed server lands in
a transient scope, not the caller's service cgroup:

```sh
# scripts/launch-tmux-surface.sh, around line 141 — belt+braces ONLY for the case where the
# server does not yet exist (han-tmux.service down). When a server already exists, new-session
# attaches to it and this scope wrapper is a no-op cost.
if tmux info >/dev/null 2>&1; then
    tmux new-session -d -s "$SESSION_NAME" -c "$AGENT_DIR" ...        # server exists → attach
else
    systemd-run --user --scope --unit="han-tmux-fallback-$$" \
        tmux new-session -d -s "$SESSION_NAME" -c "$AGENT_DIR" ...    # births server in a scope
fi
```

## Controlled cutover (Jim's note: cut at a restart, don't live-re-parent)

The running server (pid 522254) is in `human-responder@leo`'s cgroup. Re-parenting it live is
fragile. Clean cutover, post-GREEN:
1. `systemctl --user enable han-tmux.service` + install the drop-ins + `daemon-reload`.
2. At the next controlled restart/reboot: han-tmux starts first → births the server → agents attach.
3. **G4 proof (by cgroup read, not assertion):** after the cutover,
   `cat /proc/$(tmux display-message -p '#{pid}')/cgroup` shows leaf **`han-tmux.service`**, and
   restarting/stopping ANY agent unit leaves the server pid + sessions intact.

## Open edges I want Jim's audit on (G4)

1. **`Type=oneshot` + a daemonizing server.** `tmux new-session -d` forks the server away; oneshot
   ExecStart returns and RemainAfterExit holds the unit "active (exited)". Confirm the server pid
   actually lands in `han-tmux.service`'s cgroup at start (not reparented away by the daemonize) —
   this is the whole point, so it needs the cgroup-read proof, not the assumption.
2. **`KillMode=none` + reparent-on-stop.** Verify a `systemctl --user restart han-tmux` leaves the
   server running (reparented to the user slice) rather than orphan-killing it — i.e. that even the
   OWNER unit bouncing can't decapitate. If reparent-out-of-cgroup doesn't hold, we may want the
   server in a `--scope` under han-tmux instead.
3. **`__han_keeper` collision** on a restart where the server already exists (new-session would
   fail if the keeper session exists) — should be `has-session`-guarded or `|| true`.
4. **Ordering sufficiency** — confirm `Before=`/`After=` genuinely gates the agents at boot (a
   race where an agent's first dispatch beats han-tmux would re-birth the bug).

## Status
Built + HELD. Interim KillMode=process defuse LIVE + proven (G1/G2/G3 green). Awaiting Jim's G4
audit of this doc before enable + controlled cutover. — Leo (session), 2026-07-14

---

## APPLIED 2026-07-14 (Jim G4 GREEN + 3 amendments) — prep complete, cutover pending

Jim's audit (thread `mrk21z25-xbux8r`): G1/G2/G3 verified by his own hand; G4 GREEN with 3 amendments, all folded into the live files:
- **A1 (idempotent keeper):** `ExecStart=/bin/sh -c 'tmux has-session -t __han_keeper 2>/dev/null || tmux new-session -d -s __han_keeper'` — a `restart` on a live server is now a no-op success (cures edges 2+3).
- **A2 (comment fix):** KillMode=none leaves the server **in the now-unit-less cgroup** (systemd logs leftover-process warnings, reuses it next start) — NOT PPID reparenting. Outcome (owner-bounce can't decapitate) unchanged.
- **A3 (DEC-081):** dropped the hardcoded four-slug `Before=` list; ordering lives on the agnostic side — `human-responder@.service.d/after-han-tmux.conf` + `leo-heartbeat.service.d/after-han-tmux.conf` (`After=`/`Wants=han-tmux`), covering every current + future agent. Edge 4 (ordering): `Type=oneshot` blocks dependents until ExecStart exits → server provably exists before any responder starts.
- **Artifact 3 APPLIED** (not held, per Jim): `launch-tmux-surface.sh` now probes `tmux info`; no server → `systemd-run --user --scope` births it; server exists → byte-identical plain `new-session`. `bash -n` clean; empty-array prefix verified safe under `set -euo` (bash 5.1).

**Live prep (inert, verified):** han-tmux.service enabled (in default.target.wants) + started (active/exited); server pid **unchanged** (522254, still in the OLD leo cgroup until reborn); `exit-empty off` applied now; keeper present; 8 sessions intact.

**CUTOVER (pending):** the cgroup only changes when the server is **reborn under han-tmux** — which happens at the next **reboot** (han-tmux ordered first) or a controlled full-garden restart. Both are **disruptive** (recreate the shared server → every session bounces, incl. the interactive seat), so this is Darron's-timing / not self-triggered. **No urgency:** the KillMode=process defuse already protects us in the interim (proven across ~10 restarts). **G4 acceptance at cutover:** `cat /proc/$(tmux display-message -p '#{pid}')/cgroup` shows leaf `han-tmux.service`, and an agent-unit restart leaves server + sessions intact.

---

## Cast-at-checkout PR (DEC-101) — Slices A+B built, held for Jim's audit; + a lifecycle finding

**Jim's Slice-A must-fix applied:** `STEM_WARM_LADDER = ['claude-sonnet-5', ...OPUS_LADDER]` (was `...SONNET_LADDER` which descended sonnet→FABLE→opus, re-arming MNT-42). Warm tail is now sonnet→opus→haiku, never Fable — matching the comment.

**Slice B built (tsc 0-new):** `castStemToServeModel` in tmux-dispatcher.ts + wired into `dispatchToPooledStem` after adopt / before freshen. `/model <serve>` → `awaitChromeOrDescend` (probe serve head, descend the SURFACE ladder on unavailable, throw-if-exhausted → the existing catch retires the stem, never returns a half-cast one) → `observeActiveModel` → `upsertStem` the actually-active model. No-op when the stem is already on the serve model.

**Lifecycle finding (trace, not claim) — Darron's model vs the current code.** Darron's stated model: *2 sonnet stems always; checkout casts to serve; the stem PERSISTS as the thread's spoke, reaped at 85%(→92%), no return; a fresh sonnet stem replaces it.* The **current code does NOT do that yet**:
- `dispatchToPooledStem` checks out a free stem PER dispatch and **returns it to the pool** on clean completion (`returnStem`, tmux-dispatcher.ts:1356) — no thread→spoke stickiness.
- The **85% ctx-reap is on the non-pooled FLOOR session only** (dispatchToSpoke:1590-1600, after the pool branch returns). For pooled stems the code comment (:1326) says *"retired + replaced at threshold"* is **DEFERRED (R3a.1d/R3b) — not built**; today pooled stems only retire on dead/failed/24h-reload.

So today there IS a return path, and the persist-as-spoke + reap-at-threshold that Darron describes is unbuilt. **This resolves the return-path fork:** under Darron's model there is no return, so cast-back-vs-leave-cast is moot — the stem is cast once at first checkout, persists, and is reaped at threshold. The cast I built is forward-compatible with BOTH (cast-when-different is a no-op on a persisted or returned-still-cast stem).

**Scope question for Darron/Jim:** does this PR ALSO build the persist-as-spoke lifecycle (sticky pooled spoke + ctx-threshold reap for pooled stems + drop the per-dispatch `returnStem`, the R3a.1d/R3b deferral), or is that a companion PR? And confirm the threshold (85 → 92?). The cast core is done either way; the return/reap surroundings depend on this answer.
