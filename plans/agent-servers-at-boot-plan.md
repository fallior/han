# Agent servers at boot + one-server-per-identity (SR-031)

> **Status: SPEC — for Leo's hands.** Jim spec (2026-07-16, Darron's direct request post-reboot).
> Darron: *"I would like every resident in the garden to launch their servers on han wake up, and
> if that means we put han\<slug\> on the boot list I would like that… maybe put it with the
> singularity of server per identity, as you have already pointed out from the server war."*
> The two asks are one design: the mechanism that starts every server at boot is the same
> mechanism that makes a second server per identity structurally impossible.

## The problem, traced (not claimed)

**Today's launch path** (verified 2026-07-16 by reading the live system):
- Each agent's Express server runs under `scripts/agent-server-watchdog.sh <slug> <port> <server-dir>`
  — a bash `while true` loop that spawns `npx tsx server.ts`, writes `~/.han/<slug>-server.pid`,
  and relaunches on exit. Git hooks (`restart-agent-server.sh`, via `install-restart-hooks.sh`)
  SIGTERM the pidfile PID for code-pickup.
- The watchdog is started **only** by the interactive launchers: `han<slug>` splits a bottom
  tmux pane and runs the watchdog there (`infrastructure/scripts/hanjim:214-221` and siblings).

**Gap 1 — nothing starts the servers at boot.** After this morning's reboot the responders,
pools and han-tmux all came up via systemd, but the four Express servers stayed down until the
sessions were hand-launched (07:34–07:37 — the receipt is the four watchdog panes' start times).
A garden reboot leaves the admin UI, conversation API and voice surface dark until a human
launches sessions.

**Gap 2 — no singleton guard (MNT-051).** A second `han<slug>` launch spawns a second watchdog
aimed at the same port. Two correct loops fight one port: the 2026-07-14 jim war burned ~30k
PIDs and degraded both servers until the duplicate was hand-killed. Correctness doesn't compose;
the fix is singleton, not smarter loops.

## Design — one systemd user template unit

**`han-agent-server@.service`** (user unit, linked like `human-responder@.service`):

```ini
[Unit]
Description=HAN agent server (%i)
# No After=/Requires= on han-tmux — the server is independent of the tmux garden.

[Service]
ExecStart=%h/Projects/han/scripts/run-agent-server.sh %i
Restart=always
RestartSec=2
# Never give up — parity with today's infinite watchdog loop (see fail-state CBA).
StartLimitIntervalSec=0

[Install]
WantedBy=default.target
```

**`scripts/run-agent-server.sh <slug>`** — thin exec wrapper:
1. Resolves the port from the **Garden Manifest** (`agents[].port` — already present for all
   four residents; verified). No slug→port table in the unit or the script — a 5th resident
   gets this for free (DEC-081 test).
2. Writes `~/.han/<slug>-server.pid` with its own PID (compat: the existing git-hook restart
   path keeps working unchanged through the transition).
3. `cd src/server && exec npx tsx server.ts` with `PORT=<port>` — exec, so the unit's MainPID
   is the wrapper→server and systemd's Restart=always IS the watchdog loop. The bash while-loop
   retires.

**Boot** = `systemctl --user enable han-agent-server@<slug>` per active resident. Linger is
already on (`loginctl show-user darron` → `Linger=yes`, verified) so user units start at boot
with no login — this is Darron's "han\<slug\> on the boot list", without putting interactive
sessions on it (sessions stay human-launched; only the *servers* boot).

**Enablement is registry-derived, never a hardcoded list** (the MNT-036 lesson — the restart
hook that hardcoded jim+leo left casey on stale code twice). One idempotent
`scripts/sync-agent-server-units.sh`: read active residents from the manifest → enable missing
units, disable units for departed residents. Call it from resident **activation** (#98 — a new
mind's server enables at admission) and optionally from the post-commit hook.

## The singleton, three layers

1. **By construction:** systemd refuses a second instance of `han-agent-server@jim`. `systemctl
   start` on a running unit is a no-op. This is THE cure — MNT-051's class dies here.
2. **Launcher change:** `han<slug>` stops spawning a watchdog. The bottom pane becomes a
   **viewer**: `systemctl --user start han-agent-server@<slug>` (idempotent) then
   `journalctl --user -fu han-agent-server@<slug> -n 50` — Darron keeps his server pane
   visibility, but the pane now *watches* the one true server instead of *being* a second one.
3. **Transition belt:** if the legacy watchdog script survives anywhere, add
   `exec 9>"$HOME/.han/<slug>-server.lock"; flock -n 9 || { echo "…already running"; exit 1; }`
   so an accidental double-launch exits loudly instead of port-warring.

## Fail-state CBA (DEC-103 §2 — every number priced)

- **RestartSec=2**: delays a relaunch by 2s; discards nothing. Parity with today's `sleep 2`.
- **StartLimitIntervalSec=0**: systemd never gives up. Worst case = a crash-looping server
  restarts every 2s forever — *identical* to today's watchdog behaviour, so no new failure
  mode. Rider (follow-on, not blocking): a restart-storm alert (N restarts in M min → ntfy,
  surface-and-wait, never a kill) via the hantrouble lane.
- **No timeouts anywhere in the unit.** Nothing kills paid work on a clock.
- **Cgroup isolation is a free win:** each server in its own unit cgroup means a server restart
  can never decapitate the tmux garden (the MNT-052 class, cured by construction here — no
  KillMode drop-in needed because there's nothing shared in the cgroup).

## Migration order (guard before guarded)

1. Land wrapper + template unit + `sync-agent-server-units.sh`. **Cutover one agent at a time**:
   stop that agent's pane watchdog (Ctrl-C the pane / kill the loop) → `systemctl --user enable
   --now han-agent-server@<slug>` → verify 200 → next agent. (The unit fails loud on a busy
   port, so a missed pane watchdog can't silently double-run.)
2. Flip `restart-agent-server.sh` to `systemctl --user restart han-agent-server@<slug>` with
   pidfile-SIGTERM as fallback (or keep pidfile-only — the wrapper writes it; either works,
   Leo's call; name it in the diff).
3. Launcher pane → viewer (layer 2 above), all four `han<slug>` launchers + the shared
   generator if the pane block is templated.
4. Retire `agent-server-watchdog.sh` (supersede-don't-delete: `_archive` or a tombstone
   comment; the flock belt stays only if the script stays).

## Acceptance

- **Boot test:** next reboot, all four servers answer 200 with zero hands (this joins the
  MNT-052/MNT-056 natural-acceptance family — one reboot proves three fixes).
- **Singleton test:** launch `hanjim` twice → exactly one `server.ts` process on 3848, second
  viewer pane attaches to the same journal, no port war (the MNT-051 repro, now impossible).
- **Restart test:** a han commit → post-commit hook → server restarts with fresh code (parity
  with today), server's own unit only (tmux garden untouched).
- **4th-agent test:** a new resident with a `port` in the manifest gets a boot-started,
  singleton-guarded server from `sync-agent-server-units.sh` with zero code edits.

## Audit gates (Jim, pre-committed)

1. Unit file + wrapper read whole; no hardcoded slugs/ports anywhere (grep-proven).
2. DEC-103 check: no kill-on-clock paths introduced; the CBA paragraphs above verified against
   the landed numbers.
3. Settled-decisions check: DEC-101 (pool lifecycle) untouched; `han-server.service` relic
   untouched (still disabled, never restarted — S163/S167).
4. Detector-rule probe by my own hand: stop a unit's server process directly → systemd restarts
   it within ~2s (the Restart path fires on the real condition); launch a duplicate → refused.
5. Reboot acceptance verified at the next natural reboot (not forced).
