# Legacy-name sweep — claude-remote / clauderemote / "claude remote" (the register)

> Commissioned by Darron, 2026-08-18 ~12:38 PM: *"we didn't change every instance… find them
> all and register them for attention and then decide what to do. History is fine, legacy
> code is not."* Sweep run by Jim (session) the same hour, all variants
> (`claude-remote`, `clauderemote`, `claude_remote`, `CLAUDE_REMOTE`, `"claude remote"`,
> case-insensitive), surfaces: han repo (ex `.git`/`node_modules`), `~/.han`, `~/scripts`,
> `~/.bashrc`, crontab, user systemd units, infrastructure registry, git remotes, the
> `~/Projects/clauderemote` symlink. **This document is the REGISTER — find-and-classify
> only. Nothing has been changed. Each row awaits a disposition ruling.**

## The good news first, measured

- **The TypeScript spine is CLEAN** — zero hits in any `src/server/**/*.ts`. The living
  code never carried the old name forward.
- **Git remotes are clean** — `origin` is `fallior/han.git` (already renamed);
  `hancollab` unrelated.
- **crontab, `~/.bashrc`, infrastructure registry: zero hits.**

## Class A — LIVE and load-bearing (translate with care; each needs its own ruling)

| # | Where | What | Disposition question |
|---|---|---|---|
| A1 | `src/hooks/notify.sh:10-13` | `CLAUDE_REMOTE_DIR` env var (defaults to `$HAN_DIR`, so functional) — **and the hook is LIVE**: registered twice in `~/.claude/settings.json` | Rename var → `HAN_NOTIFY_DIR` (or fold to `HAN_DIR` directly). Tiny diff; settings.json paths unchanged. Leo's hand. |
| A2 | `~/scripts/han-git-push.sh:12` | `NTFY_TOPIC="claude-remote-f78919b57957ea64"` — **the live ntfy topic Darron's phone subscribes to** | The one row where renaming BREAKS something outside the box (his subscription). Options: (i) keep — topic ids are opaque tokens, arguably "history"; (ii) rename + Darron resubscribes once. **Darron's call.** |
| A3 | `~/.config/systemd/user/claude-remote-server.service` | Disabled + inactive relic unit (user-level sibling of the documented `han-server.service` relic) | Retire (disable is already true; `rm` the unit file + daemon-reload) — but unit files are config: Darron/Leo hand, and note it in the ecosystem map's relic line. |

## Class B — legacy artefacts at repo root (clean; no external dependents found)

| # | Where | What | Disposition |
|---|---|---|---|
| B1 | `package-lock.json` (repo root) | `"name": "clauderemote"` — paired with a **3-byte empty `package.json` (`{}`)**; the real package lives in `src/server/` | Either regenerate the root pair honestly named `han`, or delete both root files if nothing consumes them (verify `npm` is only ever run in `src/server/`). Leo. |
| B2 | `scripts/claude-remote` | The original CLI launcher, branded "Claude Remote" throughout | Superseded by the `han*` launchers. Retire to `_archive` (move-not-delete, DEC-069) or rebrand if still used — first check nothing invokes it. |
| B3 | `scripts/install.sh`, `scripts/start-server.sh` | Old installer/starter, "Claude Remote" branding in headers/banners | Same class as B2: verify-unused → archive, or rebrand if the starter constraint wants an installer. |
| B4 | `.claude/settings.local.json` | ~4 permission-allowlist entries referencing `clauderemote` paths/session names | Stale permissions — prune entries (harmless but noise; shrinks the allowlist). |

## Class C — the symlink (a decision, not a defect)

| # | Where | What | Disposition question |
|---|---|---|---|
| C1 | `~/Projects/clauderemote → /home/darron/Projects/han` (created 9-Mar) | The ancestral name kept operational — "clauderemote IS han", the garden's own immigrant-name finding | **Keep-as-ancestor vs retire.** If kept: register it HERE as deliberate so no future sweep re-flags it. If retired: check first what still traverses it (the portfolio dormancy notes read clauderemote's git activity as han's; anything resolving the old path breaks). Darron's call — this is history made operational, the exact boundary of his "history is fine" law. |

## Class D — history, per the law: FINE (registered, untouched)

- **`~/.han/memory/**`: 146 files** carry the name — memories, wander arcs, testimony
  (e.g. the ancestor who signed "Claude Remote (automated)"). DEC-069 territory; not debt.
- **han repo docs/plans (19 files)**: `plans/level-01…level-11` (the original build plans),
  `claude-context/CHANGELOG.md`/`CURRENT_STATUS.md` history blocks,
  `docs/HAN-ECOSYSTEM-COMPLETE.md` + `docs/PORT_ALLOCATION.md` narrative,
  `plans/INDEX.md`, `plans/future-ideas.md`, `src/server/tests/GIT_TESTS_README.md`.
  History-class — though **the two living docs (HAN-ECOSYSTEM-COMPLETE, PORT_ALLOCATION)
  deserve a one-line "formerly Claude Remote" framing check** on their next living-docs
  sweep rather than a scrub.

## Suggested order when dispositions are ruled

1. A1 (one-var rename, Leo, minutes) → 2. B4 (allowlist prune) → 3. B1–B3 verify-then-archive
   batch → 4. A3 unit retire → 5. A2 + C1 (Darron's two calls) → 6. D's living-docs framing
   line on the next docs sweep.

*Register complete. Journal: MNT-151. — Jim (session), 2026-08-18.*
