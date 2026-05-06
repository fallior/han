# Port Allocation — How HAN Agents Get Their Port Numbers

> **Purpose.** This document maps the *current mechanic* by which each HAN agent (Leo, Jim, Tenshi, Casey) chooses what port to bind its server to, plus the wider relationship to the infrastructure registry and Portwright. It exists so any operator (Darron, Mike, future garden-tenders, future-Leo, future-Jim) can read it cold and understand the topology, rather than discovering it the painful way during a port collision or a "why isn't my agent's server reachable" investigation.
>
> **Status.** Living document. Created 2026-05-06 (S151) by Leo at Darron's request, after a TTM-voice trace surfaced the per-agent-server topology. Verified against the actual code state at `fe2c2c8...74c8c38` and the actual `services.toml` at HEAD.
>
> **Code is the source of truth.** Everything below is grounded in file paths and constants you can grep for. If this doc disagrees with the code, the code wins and this doc needs updating.

---

## Why this doc exists

The TTM-voice failure on Jim's *State of the Garden — 2026-05-05* report (thread `mosobr55-qmqzgz`) traced through to a per-agent-server topology that wasn't documented anywhere centrally. Each agent (Leo, Jim, Tenshi, Casey) runs *their own* HAN server instance on a different port; the launchers hardcode the port; and Darron's admin UI on the main server (3847) doesn't see WebSocket broadcasts from the other agent servers.

The deeper finding: HAN's port allocations live in **two places** that don't talk to each other — the launcher scripts and the infrastructure registry. They happen to be in sync today, but nothing structural enforces it.

This doc names the current mechanic, the tools involved, the drift surface, and the proposed cleanup target (single source of truth, tended via Portwright).

---

## The current mechanic — how an agent gets its port

### Step 1: A user runs a launcher

The four agent launchers live at `~/Projects/han/scripts/`:

| Launcher | Wakes | Hardcoded `AGENT_PORT` | Line |
|---|---|---|---|
| `hanleo` | Leo (interactive Claude Code session) | `3847` | `scripts/hanleo:14` |
| `hanjim` | Jim (interactive Claude Code session) | `3848` | `scripts/hanjim:12` |
| `hantenshi` | Tenshi (security agent session) | `3849` | `scripts/hantenshi:12` |
| `hancasey` | Casey (Contempire-project agent) | `3850` | `scripts/hancasey:12` |

**The port is a literal assignment in each shell script.** No env var lookup, no registry call, no validation against any external source. If two launchers had the same port, the second-spawned would fail to bind and that's how the operator would find out.

The `han` script (no agent suffix) is the default Leo launcher and shares Leo's port via the `hanleo` mechanism — it doesn't have its own `AGENT_PORT` line because it uses systemd's `han-server.service` instead of the in-tmux watchdog. (See "Two server-launch paths" below.)

There are also `infrastructure/scripts/hanjim`, `hanleo`, `hancasey`, `hantenshi` — these are **symlinks** into `~/Projects/han/scripts/`. Verified:

```
$ ls -la ~/Projects/infrastructure/scripts/hanjim
lrwxrwxrwx ... -> /home/darron/Projects/han/scripts/hanjim
```

So infrastructure-side `hanjim` is the same file, not a duplicate. Single launcher per agent across the system.

### Step 2: The launcher exports `AGENT_PORT` into the tmux session

Each launcher's `start_session()` function does (example from `hanjim`):

```bash
tmux new-session -d -s "$session_name" \
    -e "HAN_SESSION=$session_name" \
    -e "AGENT_SLUG=$AGENT_SLUG" \
    -e "AGENT_NAME=$AGENT_NAME" \
    -e "AGENT_MEMORY_DIR=$AGENT_MEMORY_DIR" \
    ...
```

`AGENT_PORT` is NOT in the explicit `-e` list (verified by reading the launchers); it's used inline below to spawn the watchdog and to substitute into the agent's CLAUDE.md template.

### Step 3: A per-agent server is spawned by the watchdog

Inside the new tmux session, the launcher splits a 20%-height bottom pane and runs:

```bash
tmux split-window -t "$session_name" -v -l 20% -d \
    "$SCRIPT_DIR/scripts/agent-server-watchdog.sh $AGENT_SLUG $AGENT_PORT '$SCRIPT_DIR/src/server'"
```

`agent-server-watchdog.sh` is a respawn-loop wrapper around `npx tsx server.ts` that:
- Sets `PORT=$AGENT_PORT` for the spawned server
- Writes the inner PID to `~/.han/{slug}-server.pid` (so e.g. `~/.han/jim-server.pid` for Jim)
- Catches the inner process's exit and relaunches with fresh code (the post-commit git hook SIGTERMs the inner PID to pick up new commits)

So each agent ends up with a dedicated `tsx server.ts` instance bound to its own port, sharing the same `~/.han/gradient.db` and `~/.han/voice-cache/` (because those paths are derived from `HAN_DIR` env var, which is the same `$HOME/.han` for all of them).

### Step 4: The agent's CLAUDE.md tells the agent which port to use

The launcher renders `templates/CLAUDE.template.md` via `envsubst` into `~/.han/agents/{Name}/CLAUDE.md`. The template contains (line 335 today):

```
**When composing a response**: Post via `curl -sk -X POST 
  "https://localhost:${AGENT_PORT}/api/conversations/:id/messages" 
  -H "Content-Type: application/json" 
  -d '{"role":"${AGENT_CONVERSATION_ROLE}","content":"..."}'`
```

So Jim's generated CLAUDE.md ends up with `https://localhost:3848/...`, Leo's with `https://localhost:3847/...`, etc. **The agent's posts go to its OWN server's port, not to the main one.** This is the load-bearing detail behind why session-Jim's State of the Garden didn't appear in the main `han-server` journalctl: the request hit Jim's server (3848), not the main one (3847).

### Step 5 — the orthogonal main server

Independent of the launchers, there's a systemd-managed `han-server.service`:

```
ExecStart=/home/darron/Projects/han/src/server/node_modules/.bin/tsx server.ts
```

It runs `server.ts` with no explicit `PORT` env var, so the server defaults to `3847` (the default in `src/server/server.ts`). This is what `han-server.service` runs and what the admin UI in Darron's browser connects to.

**Two server-launch paths summary:**

| Server | Launched by | Port | PID file | Logs |
|---|---|---|---|---|
| Main HAN server | systemd `han-server.service` | 3847 | systemd-managed | `journalctl --user -u han-server` |
| Leo agent server | `hanleo` → watchdog | 3847 (collides with main if both run!) | `~/.han/leo-server.pid` | tmux pane / `terminal-log-v2.txt` |
| Jim agent server | `hanjim` → watchdog | 3848 | `~/.han/jim-server.pid` | tmux pane / `terminal-log-v2.txt` |
| Tenshi agent server | `hantenshi` → watchdog | 3849 | `~/.han/tenshi-server.pid` | tmux pane / `terminal-log-v2.txt` |
| Casey agent server | `hancasey` → watchdog | 3850 | `~/.han/casey-server.pid` | tmux pane / `terminal-log-v2.txt` |

**Note on the 3847 collision:** when both `han-server.service` (systemd) AND `hanleo` (tmux watchdog) try to run, only the first to bind 3847 succeeds; the second sits in a respawn loop failing. Today we don't typically run both — `han-server.service` is the production server and `hanleo` is the interactive Leo session that posts via the existing 3847 server. But the topology allows the collision; it's not structurally prevented.

---

## The other source of truth: `infrastructure/registry/services.toml`

Entirely independent of the launchers, the master registry at `~/Projects/infrastructure/registry/services.toml` (lines 288–310) records HAN's port allocations:

```toml
[han]
description = "Hortus Arbor Nostra — collaborative development ecosystem"
path = "~/Projects/han"
host = "localhost"
project_index = 9
lifecycle = "active"

  [han.app]
  enabled = true
  use_legacy_ports = true
  api_port = 3847   # HTTPS Express server — Leo (default)
  jim_port = 3848   # Jim's server instance
  tenshi_port = 3849  # Tenshi's server instance
  casey_port = 3850   # Casey's server instance
  command = "./scripts/start-server.sh"
```

**The registry has the same numbers — but the launchers don't read it.** They have their own copies. If Darron updated the registry to move Jim to 3858, the launcher would still spawn Jim on 3848 because the launcher's `AGENT_PORT=3848` is hardcoded. The registry would silently disagree with reality.

The `use_legacy_ports = true` flag is a marker that says *"this project doesn't follow the v2 three-tier allocation scheme; it uses ports outside the assigned ranges."* Which leads to:

### The v2 three-tier port scheme (which HAN doesn't follow)

`infrastructure/CLAUDE.md` defines an allocation scheme:

| Tier | Range | Block size | Purpose |
|---|---|---|---|
| Supabase | 54000–55999 | 50 ports | DB, API, Studio, Analytics |
| Application | 10000–19999 | 100 ports | Web servers, frontends |
| Data | 6000–7999 | 20 ports | Redis, queues, caches |

HAN appears in the v2 table as `clauderemote` (its old name from before the renaming; see DEC-009 and *The Renaming* thread `mm17sa48-fln0u0`) at index 9, app port 10900. Reality: HAN uses 3847–3850 outside the v2 scheme entirely. The `clauderemote/10900` entry in the table is stale documentation that hasn't been updated for the rename or the actual port use.

---

## Portwright

`~/Projects/portwright/` is a separate project — a "service management UI" running on port 11100 with `data/portwright.db`. From the infrastructure docs:

- It's positioned as the **dashboard / management layer** for the services in the registry
- It has its own SQLite DB to track service state
- The infrastructure CLAUDE.md references it as the canonical place to *view* service status
- The infrastructure scripts (`projects-ctl`, `lifecycle`, `audit`, etc.) are CLI tools that interact with the registry directly

**What Portwright currently is:** a visibility / status layer for services already defined elsewhere.

**What Portwright is NOT (today):** the authoritative source of port numbers. The launchers don't ask Portwright for ports; the registry doesn't pull from Portwright. Today Portwright reads from the registry and surfaces it; if you change ports in Portwright's UI (assuming that's a feature it has — would need verification by reading the Portwright code), the registry might or might not get updated.

**What Darron has flagged Portwright SHOULD become** (per S151 conversation): the central tending surface where port allocations are *defined*, with launchers and other consumers *reading from it*. That's the proposed direction. This doc captures the current state; the change is future work (would warrant its own future-idea entry).

---

## The drift surface — what could go wrong today

Because the launchers and the registry are independent sources of truth for the same data:

1. **Manual edit drift.** Darron edits `services.toml` to change Jim's port from 3848 to 3858. Launchers still spawn Jim on 3848. Registry says one thing; reality is another.
2. **Inverse drift.** Darron edits `hanjim:12 AGENT_PORT=3848` to 3858. Registry still says 3848. Anything that consults the registry (Portwright, projects-ctl) believes wrongly.
3. **Conflict drift.** A new agent gets a port assigned in the registry only (without launcher update) — no server actually binds it. Or the launcher gets a port that conflicts with another project the registry knows about.
4. **The 3847 collision** (named above): the systemd `han-server.service` and the `hanleo` watchdog both want port 3847. Today the collision is implicit — the second to start fails silently. Documented nowhere in the launchers.
5. **clauderemote/10900 stale entry** in the v2 table — anyone reading `infrastructure/CLAUDE.md` to learn the port scheme could believe HAN uses 10900 (it does not; that registration is from the pre-rename era).

None of these are fires today, but the drift surface is real.

---

## What I (Leo) recommend, for when this becomes work

(*Not implemented. Per the engineering discipline, these are observations to be discussed, not silently built.*)

**Single source of truth.** Pick one of:
- (a) **Registry-authoritative.** Launchers read `services.toml` at startup (e.g., via a small `get-port.sh` helper that greps the TOML). Registry edits ripple to launchers automatically. Risk: launchers gain a runtime dependency on the registry being readable + parseable.
- (b) **Portwright-authoritative.** Launchers query Portwright's API for their port. Registry becomes a downstream cache or an export of Portwright state. Heavier integration; closer to Darron's stated direction.
- (c) **Generated launchers.** The launcher's `AGENT_PORT=3848` line is generated by a script that reads the registry; the launcher itself is then frozen until the registry changes again. Lighter than (a) and (b) but adds a build step.

**Update the v2 table** in `infrastructure/CLAUDE.md` to reflect the rename (clauderemote → han) and the actual port range (3847–3850 with `use_legacy_ports = true` flag noted).

**Document the 3847 collision in the launchers.** A comment near `AGENT_PORT=3847` in `hanleo` noting the systemd `han-server.service` overlap, so the operator knows what's happening if both try to start.

**Settle the per-agent-server pattern question.** Darron has flagged that *all* agents posting to one port (3847) would resolve the WebSocket-broadcast fragmentation that prevents real-time admin-UI updates of agent posts. That's a different question from port allocation but related — if all agents post to 3847, then 3848/3849/3850 only need to exist if those agents have their own admin UIs (which, today, they don't — there's only one admin UI). Worth its own design conversation.

---

## A worked example — tracing Jim's State of the Garden post

This is the case that surfaced this whole investigation. The trace, with code anchors:

1. **Session-Jim runs in tmux.** Spawned by `hanjim` (`scripts/hanjim`). Inside the tmux session, `AGENT_PORT=3848`. The watchdog has spawned `tsx server.ts` with `PORT=3848` in a separate pane; that server is alive on 3848.
2. **Session-Jim composes a State of the Garden report.** ~20K characters of prose, role 'supervisor', target conversation `mosobr55-qmqzgz` (a Memory Discussions thread).
3. **Session-Jim posts via curl.** Per his CLAUDE.md (line 335 of the template, `${AGENT_PORT}` substituted to 3848): `curl -sk -X POST "https://localhost:3848/api/conversations/mosobr55-qmqzgz/messages" -H "Content-Type: application/json" -d '{"role":"supervisor","content":"<20K-char report>"}'`.
4. **Jim's server (3848) receives the POST.** Runs `routes/conversations.ts:442` route handler. Calls `conversationMessageStmts.insert.run(...)` writing to `~/.han/gradient.db`. Calls `broadcast({...})` — but the broadcast is to clients connected to **3848's** WebSocket. The admin UI connected to 3847 doesn't see it.
5. **Auto-TTS fires (or should).** Route handler at line 512 calls `autoGenerateTts(messageId, conversationId)` non-blocking. Logs to Jim's server's stdout (visible only in the tmux pane / `terminal-log-v2.txt`).
6. **The audio for `mosof7fr-n24f5y` is missing from the cache.** Verified: no file at `~/.han/voice-cache/by-message/mosof7fr-n24f5y.mp3`. Either auto-gen errored on Jim's server (would need to grep `terminal-log-v2.txt` around 23:40 May 5 to find the error), or the post hit a different code path entirely (e.g., session-Jim used direct sqlite3 instead of curl — Darron's clarification ruled this out, so the leading hypothesis is auto-gen errored on Jim's server and we'd see the error in his pane log).
7. **Darron, on the admin UI at 3847, never received a WebSocket push.** The message appeared via polling refresh or manual reload.
8. **Darron clicks TTM on the message.** UI fetches `/api/voice/tts/mosof7fr-n24f5y` from the server it's connected to — 3847 (the main server). 3847's TTS handler tries cache first: miss. Tries to generate fresh: `generateTts()` fetches from OpenAI. If Darron's network between his browser and the server is fine, this succeeds (Mackay-side OpenAI fetch is fast). If the user-server link is slow, the request hangs (no client-side timeout currently surfacing) and the click "fails silently" from Darron's perspective.

Every step traces to a file path. The shape of the bug is clear once the per-agent-server topology is named.

---

## Summary table — all the files involved

| File | Role |
|---|---|
| `~/Projects/han/scripts/hanleo`, `hanjim`, `hancasey`, `hantenshi` | Launchers; hardcoded `AGENT_PORT` |
| `~/Projects/han/scripts/agent-server-watchdog.sh` | Wraps `tsx server.ts` with respawn loop; binds the agent's port |
| `~/Projects/han/templates/CLAUDE.template.md` | Tells the agent (via `${AGENT_PORT}` substitution) which URL to curl |
| `~/Projects/han/src/server/server.ts` | The Express server; defaults to PORT=3847 if not set |
| `~/Projects/han/src/server/routes/conversations.ts:442` | Where POST messages land; calls autoGenerateTts |
| `~/Projects/han/src/server/routes/voice.ts` | TTS / TTM endpoints; per-message audio cache at `~/.han/voice-cache/by-message/` |
| `~/.han/{slug}-server.pid` | PID file written by watchdog per agent |
| `~/.config/systemd/user/han-server.service` | systemd unit for the main server (port 3847, default) |
| `~/Projects/infrastructure/registry/services.toml` | Master registry; lines 288–310 hold HAN's `[han.app]` block |
| `~/Projects/infrastructure/CLAUDE.md` | The v2 three-tier port-allocation scheme; HAN appears (stale) as `clauderemote/10900` |
| `~/Projects/infrastructure/scripts/{han,hanleo,hanjim,hancasey,hantenshi}` | Symlinks back to `~/Projects/han/scripts/` — same launchers |
| `~/Projects/portwright/` | Service management UI; port 11100; uses `data/portwright.db`. Currently visibility-layer, not authoritative source |

---

## Glossary

- **Agent server** — a per-agent `tsx server.ts` instance spawned by the agent's launcher and bound to that agent's port. Shares the database and voice cache with all other agent servers and the main server.
- **Main server** — the systemd-managed `han-server.service` that serves the admin UI Darron uses. Defaults to port 3847.
- **Launcher** — one of `hanleo`, `hanjim`, `hancasey`, `hantenshi` (or default `han`). Bash script that spawns a tmux session with the agent's interactive Claude Code instance plus the agent's server.
- **Watchdog** — `agent-server-watchdog.sh`, the respawn loop that wraps `tsx server.ts` so the post-commit git hook can SIGTERM it and have it pick up fresh code.
- **Registry** — `~/Projects/infrastructure/registry/services.toml`, the project-wide service inventory. Records what should exist; consulted by infrastructure-side tools.
- **Portwright** — `~/Projects/portwright/`, the service-management UI/dashboard. Currently a visibility layer; proposed to become the authoritative source for service state including port allocations.
- **Three-tier allocation (v2)** — the scheme in `infrastructure/CLAUDE.md` that assigns Supabase/App/Data port blocks per project index. HAN doesn't follow it (`use_legacy_ports = true`).

---

*Last updated: 2026-05-06 by Leo (S151). Verified against code state at HEAD `74c8c38`. To update: re-run the verification (grep `AGENT_PORT=` across launchers, read `services.toml` `[han.app]` block, check `journalctl --user -u han-server` and `~/.han/*-server.pid` files). If reality has drifted from this doc, update this doc.*
