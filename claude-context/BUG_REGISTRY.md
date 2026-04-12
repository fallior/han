# Bug Registry

> Potential bugs and anomalies observed but not yet investigated.
> Tenshi or another agent can pick these up for deeper analysis.

## Format

Each entry: ID, severity, summary, context, and who should look at it.

Severity: **critical** (data loss risk), **moderate** (functional impact), **low** (cosmetic or minor), **investigate** (anomaly, unclear impact).

---

## BUG-001: Orphan server process survives child kill

- **Severity**: investigate
- **Observed**: S121, 2026-04-12
- **Observer**: Leo + Darron
- **Summary**: When `pkill -f "tsx server.ts"` kills the child process (the one holding the port), the parent `nohup` process survives as an orphan. The new server can bind to :3847 because the listener is gone, but the old parent PID lingers until manually killed.
- **Context**: Server was started via `nohup npx tsx server.ts > /tmp/han-server.log 2>&1 &`. The `npx` spawns `sh -c tsx server.ts` which spawns the actual `node` process. `pkill` matches and kills the node process, but the `nohup`/`npx` parent stays alive.
- **Reproduction**: Start server with `nohup npx tsx server.ts &`, then `pkill -f "tsx server.ts"`, then `ps aux | grep tsx` — parent still present.
- **Impact**: Orphan processes accumulate. No functional impact (port is released) but messy. Could eventually consume PID space or confuse monitoring.
- **Possible fix**: Kill the process group instead of individual matches, or use the PID file at `~/.han/server.pid` to kill the whole tree. `start-server.sh` may already handle this better.
- **Second occurrence (same session, S121)**: After `kill -9` to clear old processes, started a new server via `nohup npx tsx server.ts &`. The new server's PID file mechanism detected a prior instance (from earlier in the session), sent SIGTERM to it, but the old PIDs (1272933, 1272944) were resistant to regular `kill` — survived multiple attempts, only died to `kill -9`. Then the new server itself received SIGTERM and shut down (visible in logs: `[Server] SIGTERM received — shutting down`). A *second* `nohup` start was needed to get a stable server. The PID file cleanup logic may be sending SIGTERM too broadly, or the new process is inheriting/receiving the signal meant for the old one.
- **Additional evidence**: The server log shows `[han-server] Previous instance running (PID 1790318) — sending SIGTERM` followed by `[han-server] Previous instance (PID 1790318) shut down gracefully` — but then the server itself also received SIGTERM and died. Suggests the signal propagation is hitting the new process too, or the PID file is stale from a process that already died.
- **Assigned to**: Tenshi
