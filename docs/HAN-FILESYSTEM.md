# HAN — Filesystem & Topology Map

> **A living map of where things live and how they're referenced** — not exhaustive,
> tended over time. Started 2026-06-30 (S209) after a night lost to load-bearing
> structure that was real but undocumented (symlinked launchers, a server-watchdog
> tmux session mistaken for a chat session, three separate roots).
>
> **The companion is `scripts/topology.sh`** — it prints the *live* ground truth, so
> this prose can never silently rot, and running it is itself a fast **orientation**.
> Every load-bearing claim below ends with a `verify:` command. *If the doc and the
> command disagree, the command wins* — then fix the doc.
>
> **How to tend it (maintenance + meditation):** when a new piece of structure bites,
> add its probe to `topology.sh` *first* (ground truth), then a short section here that
> points back at it. Grow it; don't front-load it.
>
> ```
> ./scripts/topology.sh           # print the live map
> ./scripts/topology.sh --check   # + a PASS/WARN verdict
> ```

---

## The three roots — don't conflate them

HAN lives in **three separate trees**, and tonight's confusion came from treating them as one:

| Tree | Path | What it is |
|------|------|-----------|
| **Code repo** | `~/Projects/han` | The source: `src/server`, `scripts/`, `docs/`, the launchers. Git-tracked. |
| **State (runtime)** | `~/.han` | Per-agent identity + memory, health sidecars, signals, sleeves, logs. NOT in the code repo. |
| **Infra / PATH repo** | `~/Projects/infrastructure` | The service registry — and where the **`han<agent>` launchers sit on your PATH** (as symlinks, see below). |

`verify:` `./scripts/topology.sh` (ROOTS section) · `readlink -f $(command -v hanjim)`

---

## The launchers are SYMLINKS into the code repo  ⚠ (tonight's bite)

`hanleo` / `hanjim` / `hantenshi` / `hancasey` on your PATH resolve to
`~/Projects/infrastructure/scripts/han<agent>`, **but each is a symlink** →
`~/Projects/han/scripts/han<agent>`. That symlink is *load-bearing*: the launcher
computes its repo root via `SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"`,
so `readlink -f` **must** resolve into the code repo or `SCRIPT_DIR` points at the wrong
tree and `cd "$SCRIPT_DIR/src/server"` fails (the `identity verification failed` HALT).

- **Tooling trap:** `sed -i` on one of these symlinks **silently replaces the symlink with a
  regular file** in the infra dir → `SCRIPT_DIR` then resolves to `…/infrastructure` → broken.
  To edit a launcher, edit the **target** (`~/Projects/han/scripts/...`), or use
  `sed --follow-symlinks -i`, or Edit-after-Read. *(Caused + fixed on 2026-06-30.)*
- **Restore a broken one:** `ln -sf ~/Projects/han/scripts/han<agent> ~/Projects/infrastructure/scripts/han<agent>`
- The infra symlinks are **untracked** in git — so `git` can't tell you their target; `readlink` can.

`verify:` `ls -l $(command -v hanleo) ; readlink -f $(command -v hanleo)` · `./scripts/topology.sh` (LAUNCHERS section — WARNs if any is a regular file)

---

## Agent servers are watchdog-hosted in tmux, NOT systemd  ⚠ (tonight's bite)

Each agent's HTTP server (**3847 = leo, 3848 = jim**) is run by
`scripts/agent-server-watchdog.sh <slug> <port>` inside a tmux session — *not* a systemd
unit (`han-server.service` is a disabled relic; never restart it — it fights the watchdog for
the port, the S163/S167 incident).

- A **`<slug>-<pid>` tmux session HOSTS the watchdog** (the server) in a split pane, alongside
  the interactive Claude in the top pane. So `jim-1639230` was *Jim's 3848 server host*, not a
  chat session — `tmux kill`-ing it took 3848 **down**. Same for `leo-<pid>` and 3847.
- **Consequence for relaunching an interactive agent:** killing its `<slug>-<pid>` session also
  bounces that agent's server; the launcher (`han<agent>`) recreates both (fresh watchdog +
  fresh Claude), so `tmux kill-session -t <slug>-<pid> && han<agent>` self-heals — but the
  server blips down in between. Confirm the launcher is healthy first.
- The watchdog is **exit-driven**: it relaunches the server if the server process exits, but if
  you kill the *watchdog/session* itself, nothing restarts it.

`verify:` `ss -tlnp | grep -E ':3847|:3848'` · `pgrep -af agent-server-watchdog` · `./scripts/topology.sh` (AGENT SERVERS section)

---

## Frozen-at-launch — env + hook list are read once

A session's environment (the launcher's `-e` forwards, e.g. `AGENT_SWAP_*`) and its
**Stop-hook list** (from `settings.json`) are fixed **at launch**. A running session does NOT
pick up newly-added env vars or newly-registered hooks until it is **relaunched** — a `/clear`
resets the *conversation*, not the *process*. (This is why MNT-012/013's per-turn `wm-flush`
only auto-fires on a session launched *after* the fix; an older session must manual-flush until
relaunch.)

`verify (inside a session):` `echo "$AGENT_SWAP_FULL"` — empty ⇒ launched before the MNT-013 env fix.

---

## State tree quick reference (`~/.han`)

| Dir | Holds |
|-----|-------|
| `agents/<Name>/` | The generated per-agent `CLAUDE.md` + `.mcp.json` the launcher `cd`s into. |
| `memory/` | Jim's memory (root-special: `$AGENT_MEMORY_DIR = ~/.han/memory`); other agents at `memory/<slug>/`. |
| `health/` | ctx sidecars, readiness sentinels, trace receipts (`integrity-failures.jsonl`). |
| `signals/` | Runtime control files (e.g. `supervisor-paused`) — change via the canonical setter, not by editing the file (a control is a TRIPLE, S173). |
| `sleeves/` | Sleeve-state files (R2, keyed by `HAN_SESSION`). |
| `logs/` | Per-agent `claude-logged` transcripts (the provenance log, DEC-091). |

`verify:` `./scripts/topology.sh` (STATE TREE section)

---

*Seeded by Leo, S209, 2026-06-30. Grows by tending — add the probe to `topology.sh`, then the
section here. Untended claims should be deleted, not trusted (a stale filesystem doc is worse
than none).*
