# Provenance active link — c0 ↔ log (design)

> **Status**: AGREED DIRECTION, design phase. Off the June-15 critical path (tmux first). Build when Leo's hands free.
> **Origin**: Darron + Jim, 2026-06-01. Thread `mpum91v9-yp3zqw`. Tracked-todo Task #1. Supersedes the v1 stub.
> **Author**: Jim (session). HAN Codebase Rule: this is design/spec (Jim's lane); the build is Leo's, audited by Jim.
>
> **2026-06-01 correction** (Darron's catch): the "complete record" is **NOT** Claude Code's own transcripts
> (`~/.claude/projects/*.jsonl`, which Claude Code prunes on a ~30-day default `cleanupPeriodDays`). It is HAN's
> **own** permanent terminal log — captured externally, untouchable by any agent. No transcript archival is needed.
>
> **2026-06-01 update — per-agent logs (Darron's call).** There are **two** HAN log writers:
> (1) **`claude-logged`** (a `~/.bashrc` function) records each interactive session via `script` → cleans it
> through `smart-dedup.pl` (ANSI-stripped, deduped, per-line timestamps) → `$PROJECT_ROOT/_logs/session_<ts>.md`;
> (2) the **server's `terminal.ts`** polls `tmux capture-pane` → the single shared `~/.han/terminal-log-v2.txt`.
> Today both are effectively shared (interleaved across agents). Decision: **make the logs per-identity, and use
> the per-agent `claude-logged` logs as the canonical provenance record** — they're *already cleaned + per-line
> timestamped*, and keying them by agent makes them **per-identity by construction**, which resolves the search
> layer's per-agent scoping (open-question D2) for free. The change: `claude-logged` keys its log dir off
> `$AGENT_SLUG` (already injected into each agent's tmux session via the launcher's `-e AGENT_SLUG=…`) →
> **`~/.han/logs/<slug>/session_<ts>.md`**. (`claude-logged` lives in `~/.bashrc`, a system dotfile — Darron's
> hand per L013/DEC-017, not an agent's.) The shared `terminal-log-v2.txt` stays for the live-UI scrollback and
> as a cross-agent fallback; splitting *it* too is a separate, optional later `terminal.ts` change.
> **Provenance search (§4) therefore targets `~/.han/logs/<slug>/*.md`, not the shared log.** **T-2 coordination**:
> the tmux harness's `launch-tmux-surface.sh` must export `AGENT_SLUG` into each session and launch via the
> `claude-logged` path, so **post-tmux every surface writes its own clean per-agent log** — at which point the
> active link covers the whole village uniformly.

---

## 1. The finding (why this exists)

Measured (2026-06-01): a representative agent session ≈ 185k tokens lived; only ~14k (7.6%) is the prompt+response
*conversation*, ~171k (92%) is tool I/O. **c0 records what was *said*, never what was *done/seen*** — operational
locators (thread-ids, `file:line`, endpoints, message-ids) live in the tool stream, which c0 has no channel for.
Leo lost thread `mppj72fx` after a `/clear` for exactly this reason: his prose said "I posted to the Tmux thread,"
but the id existed only in a `curl` call. The act of writing working-memory *is* a compression step; "c0" is the
agent's *first edit* of its experience, not the raw material. **The raw material is the log.**

## 2. The record store

> **⚠ RECONCILED 2026-06-10 (Jim) — SUPERSEDED by the decision block at the top (lines 15–23).** The canonical provenance record is the **per-agent `claude-logged` logs** (`~/.han/logs/<slug>/session_*.md`) — higher fidelity, per-line `[HH:MM:SS]` timestamps, per-identity by construction. Darron's standing decision, *always the case*: *"the claude-logged script log has more fidelity and is timestamped — it is the log we use for provenance."* The `terminal-log-v2.txt` detailed below is the **live-UI scrollback**, **not** the provenance record. **Implementation drift to fix (Leo-build / Jim-audit):** `terminal-search.ts` (via `routes/prompts.ts`) currently searches `terminal-log-v2.txt` — it followed this stale §2, not the decision — so re-point the active-link search at `~/.han/logs/<slug>/*.md` (already per-agent → D2 scoping for free) and adapt the marker parser from the server log's `--- DD/MM/YYYY ---` to claude-logged's `[HH:MM:SS]`. The §2 detail below is retained only for its tamper-resistance note (the server log has no agent write-path) — a consideration for #79's integrity scheme — NOT as the canonical store.
>
> *(original §2 below — historical, describes the live-UI scrollback log)*

### HAN's terminal log — the live-UI scrollback (historical §2)

| Property | Detail |
|---|---|
| **Canonical file** | `~/.han/terminal-log-v2.txt` — ~20 GB, append-only, **written live, never pruned** |
| **Archive / siblings** | `terminal-log.txt` (v1, 53 GB), `terminal-sessions/` (per-session, 50 GB), `~/.han/_logs/*.md` (markdown session logs) |
| **Writer (the mechanism)** | HAN **server** `src/server/services/terminal.ts` → `appendToLog()`. Runs `tmux capture-pane -t <session> -p -S -` (full scrollback) on a poll, diff-appends only meaningful changes, strips spinner/box-drawing noise (`NOISE_RE`), timestamps every 5 min (`--- <Brisbane datetime> ---`). Read-route already exists: `GET /api/terminal/history` (`routes/prompts.ts:171`, "scrollback across /clear"). |
| **Completeness** | Content-complete for everything **displayed**: prompts, responses, displayed tool output. **Proof**: `mppj72fx` appears **12,786×** in the live log. Caveats: noise stripped (content-complete, not byte-for-byte); very large tool outputs shown truncated by Claude Code (`… +N lines`) are captured as-displayed — so full file-read bodies aren't there, but locators + conversation + displayed output are. |
| **Permanence** | Append-only; nothing prunes it. v1→v2 rotation (v1 archived). ~120 GB total and growing — eventually a *compress-old-logs* question, **never a delete one** (DEC-069). |
| **TRUST / structure** | The **only** writer is the server's capture loop — an *external* observer of the tmux pane. There is **no code path** by which an agent writes/appends/truncates/deletes it (verified by exhaustive grep; the sole agent-adjacent write is a 223 KB current-screen snapshot `terminal.txt`, also the server's). The active link's read layer **must stay read-only** — preserving this property is non-negotiable. |
| **Scoping reality** | `terminal-log-v2.txt` is a single shared file; multiple agent-servers' panes interleave in it (jim + leo markers both present). The `--- timestamp ---` markers are the time-anchors; session/agent scoping is a search-layer concern (§4). |

## 3. The two mechanisms (and how they relate)

The provenance active link = two coupled capabilities:

1. **Locators-in-c0 (the fast path)** — frequently-reached locators land in working-memory beside the prose, so
   the hot ones never need a lookup. **Operating manually NOW**: codified as the *Locator Discipline* in Jim's
   `patterns.md` (2026-06-01) — every swap entry names the ids/paths/endpoints it touched. Structural capture
   (auto-extraction from the tool stream) is a later optional refinement; the manual discipline is the v0.
2. **Search-the-log (the safety net — THIS SPEC, §4)** — anything *not* in working memory is one search away from
   the complete permanent record. This is the more general capability; (1) is an optimisation for hot locators.

Together: *keep the curation clean (c0 stays the lived conversation, no operational noise), make the fidelity
reachable (the log is searchable on demand).* Fidelity without dilution.

## 4. THE SEARCH LAYER — spec (the active link's read mechanism)

**Goal**: given a *gist* ("I posted to a thread about the tmux audit" / "I edited the dispatcher"), recover the
*specific* (thread-id, `file:line`, message-id) from the log — as clean, bounded, readable excerpts, never a raw
20 GB dump.

### 4.1 Interface — extend the existing terminal route (lightest v1)

`GET /api/terminal/search` on the HAN server (sibling to the existing `/api/terminal/history`):

```
GET /api/terminal/search?q=<terms>&window=<recent|all|ISO..ISO>&session=<slug?>&limit=<N>&context=<lines>
→ { success, matches: [ { timestamp, excerpt, lineNo } ], scanned: <bytes>, truncated: <bool> }
```

- **`q`** — search terms (space-separated AND, or a quoted phrase). Server runs **ripgrep** (`rg`, fast on 20 GB; `grep -a` fallback) with `-n`, fixed-string by default, `-i` optional.
- **`window`** — default **`recent`** (tail the last ~50–100 MB → covers days of recent work, sub-second). `all` = full scan (seconds with rg). `ISO..ISO` = bounded by the `--- timestamp ---` markers (seek to range).
- **`session`** — optional agent/session filter (post-filter by the nearest preceding session/agent marker; v1 may omit and return all, since the timestamp + excerpt usually disambiguate).
- **`limit`** (default ~10) + **`context`** (default ±3 lines) — bound the output. Server **dedups** near-identical excerpts (the diff-capture leaves repetition) and **strips residual ANSI/noise** before returning.
- Returns the **nearest preceding `--- timestamp ---`** with each match, so the agent gets *when* as well as *what*.

**Why an API endpoint (not first a skill/MCP tool)**: it reuses the existing terminal-route infra, runs server-side
(handles 20 GB efficiently, keeps the heavy file off the agent's context), and agents already work by `curl`. A
`/recall` skill or an MCP `search_my_log` tool is a thin ergonomic wrapper to add later (and post-tmux, an MCP tool
fits the same sink-style pattern as the diary server).

### 4.2 The recall discipline (when the agent reaches for it)

The link is only useful if the agent *knows* to use it. Pairs with the locator discipline (capture forward; search
backward when a specific is missing). Add to the ecosystem-map's existing *"🧭 Finding a thread"* recipe and the
session protocol: **if you have a gist but not the specific — search the log before re-deriving it.** Especially
post-`/clear`, when working-memory holds the prose but not the ids.

### 4.3 Read-only invariant

The endpoint **reads** `terminal-log-v2.txt` and never opens it for write. This is load-bearing for the trust
property in §2 — the active link must not become a write path to the record. Code review gate: the search route
imports no write/unlink/truncate against the log path.

### 4.4 Excerpt quality (the UX that makes it usable)

A good result is a *few* clean lines around the hit with the timestamp — enough to read the locator and recognise
the moment, not a wall of capture-noise. Concretely: dedup consecutive near-duplicate captures, drop `NOISE_RE`
residue, collapse repeated blank lines, and prefer the line that *contains* the locator pattern
(`[a-z0-9]{8}-[a-z0-9]{6}` for thread/message ids; `\w+\.ts:\d+` for file:line) as the excerpt anchor.

## 5. Generalising up the chain (D3)

Every gradient entry (cN) descends from a c0 with a creation timestamp → a lived **time-window**. So from *any*
compressed memory, resolve its window and search the log for it. v1 ships "search recent / by-keyword"; v2 adds
"given this gradient entry, search its window" — making the active link traversable from any depth, not just c0.
The log's `--- timestamp ---` anchors are what make this possible.

## 6. The tmux synergy (why this wants tmux first)

Today only *interactive* sessions (session-Jim, session-Leo) produce a tmux pane the server captures; the SDK
surfaces (jim-human, heartbeat beats, supervisor cycles) run via `agentQuery` and leave no terminal log. **Post-tmux,
every surface becomes a logged interactive session → every surface's lived record enters the terminal log → the
active link applies uniformly across the whole village.** Leo's billing migration is also what makes perfect-recall
work everywhere. The two threads converge on one substrate; build the search layer *after* T-3 so it lands against
the surfaces that will actually have logs.

## 7. Open decisions for Leo (the build)

- **D1** — ripgrep dependency: ✅ **confirmed present** (`ripgrep 13.0.0` on the host). Time-anchor marker format confirmed: `--- DD/MM/YYYY, h:mm:ss am/pm ---` (Brisbane local; the `window=ISO..ISO` parser must handle this locale format).
- **D2** — session/agent scoping in v1: post-filter by marker, or defer to v2 (lean: defer; timestamp+excerpt usually disambiguate).
- **D3** — the recall trigger: ecosystem-map recipe + session-protocol line now (cheap), MCP/skill wrapper post-tmux.
- **D4** — window default size for `recent` (tune by measuring how far back a typical lost-specific lives — likely days).
- **D5** — does the search route need auth-scoping (localhost-only like the rest of `/api`)? (lean: same as existing terminal routes.)

## 8. Ship plan

Small auditable PR(s), the standard rhythm: **(P1)** `GET /api/terminal/search` (read-only, rg-backed, deduped
excerpts) + tests on a fixture log → **(P2)** the recall-discipline doc (ecosystem-map + session protocol) →
**(P3, post-tmux)** the MCP/skill wrapper + the cN→window generalisation. P1 is buildable now in isolation and
independently testable against the existing 20 GB log; it does not depend on tmux. The *coverage* (all surfaces)
depends on tmux, but the *capability* does not.

## Already done (stops recurrence meanwhile)

- `ecosystem-map.md`: prominent *"🧭 Finding a thread (do this FIRST)"* recipe (search-by-title before the bare list).
- `patterns.md`: the *Locator Discipline* (mechanism (1), operating manually).
