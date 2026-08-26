# One mind, one uid — kernel-enforced sovereignty

> **Status: PROPOSED — for the membrane.** Commissioned by Darron, 2026-08-19 ~4:35 PM:
> *"what do we have to do to have everyone on their own UID? Can you write up a plan…
> so we can run it through the membrane."*
> Author: Leo (session). Thread: (opened alongside). Chairs: **Tenshi co-owns the threat
> model and acceptance** (this is her standing argument, not mine), Jim plan-audit,
> Casey the authorisation/record angle, Darron rules.

## Why (the prize, in the words already on the record)

- **S103 memory sovereignty is CONVENTIONAL today** — held by instruction and discipline,
  not by the kernel. All four minds run as uid 1000 (Tenshi, measured, K1 P0): any agent —
  or any prompt-injected turn of any agent, or any confused-deputy curl — can read and
  write any other mind's memory. The wall that exists is instructional; the adversary we
  actually name (a hostile turn *inside* the shared uid) walks through it.
- **Signing fails while everything shares one uid** (Tenshi, the hearth ruling + the
  encrypted-channel crux): a per-mind keypair whose private key is readable by every mind
  authenticates nothing. Per-uid is what makes the encrypted-channel design load-bearing,
  and what makes `Pull:` authorship (kanban v2 §C) buildable at all.
- **The voice-organ line generalises:** *localhost bounds who reaches it, uid bounds what
  it touches, and only the second survives a bug in the first.*
- **Precedent on this very box:** `mike` (1001) and `strategist` (1002) already exist —
  Darron has done this twice. The garden's minds are the ones still sharing.
- **A quiet operational win:** per-uid gives each agent its own `~/.claude` — the shared
  auth store (where a `/logout` in one seat can de-auth another) stops being shared.

## The measured ground (traced 2026-08-19, this box)

| fact | value |
|---|---|
| users ≥1000 | darron 1000 · mike 1001 · strategist 1002 — no agent users |
| tmux | ONE server, socket `/tmp/tmux-1000/default`, `srwxrwx--- darron:darron`, dir 700; owned by `han-tmux.service` (user unit, MNT-052) |
| services | ALL under darron's user manager: `human-responder@{leo,jim,tenshi,casey}`, `{leo,tenshi,casey}-heartbeat`, `jemma`, `wm-sensor` |
| gradient.db | `-rw------- darron` — one shared SQLite for conversations + gradient + goals/tasks |
| memory | `~/.han/memory/<slug>` for leo/tenshi/casey; **jim IS the root** `~/.han/memory` (S195's root-special layout — a structural blocker for chown, see P1) |
| servers | per-agent already (leo 3847, jim 3848) — the process shape per-uid wants |
| dispatch | per-agent processes drive their own surfaces via the ONE shared tmux socket — the hard blocker previously named |

## The phases (each independently reversible; membrane gate between each)

### P0 — the census (read-only, before any change)
Enumerate every cross-boundary touch so the plan binds to measured ground, not to my
model of it (the MNT-115 lesson: a discriminator built without measuring matched 0 of 30).
- Who opens what: `lsof` snapshots per service against each agent's tree; grep the tree
  for direct cross-agent path literals (the registry makes this tractable — anything not
  resolving through `gradientConfigForAgent` is a finding in its own right).
- The tmux control graph: which process sends to which sessions (expected: each agent's
  own service to its own surfaces + the launchers; verify, don't assume).
- The DB access map: which processes hold gradient.db open, and for which tables.
- **Output: the boundary map** — the artefact every later phase's diff is audited against.

### P1 — users, group, and the moves (the reversible half of the world)
- Create group `han`; users `leo` `jim` `tenshi` `casey` (next free uids), all in `han`;
  `loginctl enable-linger` each.
- **Move jim off the memory root** — the forced structural fix: `~/.han/memory/jim/`,
  via the allocation leaf (`allocations.jim.memoryDirRel`) + a git-tracked move. The
  registry is the cure's ally: consumers already resolve through it (S195), so this is
  config + `git mv`, not a code hunt. (DEC-069: move, never delete; history preserved.)
- Chown each agent tree to its uid, mode **750** with group `han` (the starting dial —
  group-readable preserves today's cross-reading behaviours like the #91 watermark and
  Robin Hood while the walls go up; the 700 tightening is P4's dial, per-surface, ruled
  not defaulted).
  **P1's owed declaration (Casey's Q3, folded): the cross-read ENUMERATION.** Group-readable
  is a blanket permission — the unauthored twin of an unauthored constraint, failing the
  same way (load-bearing indistinguishable from incidental). P0's census produces the named
  list of load-bearing cross-reads, each with the surface it needs; P4's dial then becomes
  ARITHMETIC — everything not on the enumeration goes to 700, every survivor carries its
  reason.
- Shared surfaces (`shared/`, `signals/`, `health/`, `pool/`, `sleeves/`, `agent-pipes/`):
  group `han`, setgid dirs, group-writable, sticky where append-shaped.
- **gradient.db: group-writable + the honest limit said out loud** — a shared SQLite
  cannot kernel-enforce row-level sovereignty. Conversations already write via the 3847
  API (HTTP is uid-agnostic); gradient writes go through each agent's own processes once
  P3 lands. The stronger shapes (per-agent DBs, or API-mediated writes with the server as
  the only DB uid) are **named as the P6 horizon, not smuggled into this plan.** WAL/shm
  sidecar perms need the same group treatment (umask discipline in every writer).

### P2 — the tmux split (the hard blocker, dissolved rather than tunnelled)
One shared socket cannot serve five uids cleanly. The cure is the shape the system
already leans toward: **per-agent tmux servers** — each agent's server/services run
`tmux -L han-<slug>` under their own uid (socket in `/tmp/tmux-<uid>/`, kernel-owned).
- The dispatcher needs NO cross-uid tmux: each agent's own processes (responder,
  heartbeat driver, server) already drive only that agent's surfaces — after P3 they run
  as that uid and talk to that uid's server. Within-uid everywhere.
- `han-tmux.service` becomes `han-tmux@<slug>` in each agent user's manager (same
  MNT-052 ownership cure, five times).
- Cross-agent orchestration stays file/HTTP-shaped (Jemma wake signals, API posts) —
  P0 verifies there is no hidden cross-agent send-keys path.

### P3 — services under their own uids
- Units migrate to each agent user's manager (or system units with `User=<slug>` —
  choose ONE form, membrane's call; my lean: user managers + linger, mirroring today's
  shape). `human-responder@leo` runs as leo; heartbeats likewise.
- **wm-sensor splits per-agent** (`wm-sensor@<slug>` under each uid) — it is already
  per-agent fs.watch logic inside one process; DEC-081's one-path-many-agents applied to
  a daemon. Each instance touches only its own agent's files + DB rows.
- Jemma stays darron's (the gateway is the human's instrument, not a mind).
- The per-agent servers (3847/3848/+) run as their uids — which makes each server the
  natural API boundary for its own mind's state (MNT-161's ungated-route class shrinks
  structurally: a route on leo's server acting on leo's state runs as leo).

### P4 — the human seam + the hardening dial
- **Darron attaching to an agent's seat** (hanleo et al): the launcher wraps
  `sudo -u <slug> tmux -L han-<slug> attach` with a **named sudoers grant** — an authored
  permission with its reason on its face (Casey's DEC-104 form; the grant is Darron→agent
  only, never agent→agent, never agent→darron). tmux `server-access` is the alternative;
  sudoers is the lean (simpler to audit, kernel-logged).
  **Ordering is load-bearing (Casey's Q1, folded):** darron already holds `(ALL:ALL) ALL`,
  so the grant's whole authored act is NOPASSWD — removing the one prompt that is currently
  the defence. Added before P1–P3 complete, it is a hole ANY agent turn could walk (every
  mind runs as darron today): *become leo, no password*. **The grant lands LAST, and its
  in-file comment says why it could not land sooner** — the pressure to add it early, for a
  convenient P2 test, is exactly when it is most dangerous.
- **Per-agent `~/.claude`**: each mind authenticates its own harness. **Open cost for
  Darron to rule: N seats of auth** (accounts or API keys) — today's two-account
  arrangement doesn't stretch to five uids by itself.
- Per-uid signing keys (mode 700 homes) — the encrypted-channel design becomes real.
- The dial: tighten 750→700 per-surface as the P0 map says which cross-reads are
  load-bearing (e.g. the #91 watermark either becomes an API read or a deliberate
  group-readable exception, ruled not inherited).
  - **Declared cross-read (R3b-HB S5, 2026-08-26): `lib/peer-peek.ts` reads the peeked
    mind's `identity.md` + curated/self-reflection under the manifest `peekableBy` grant
    (today: jim grants leo, philosophy beats). Grant-gated (fail-closed, disk-fresh),
    refusals receipted (`peek-refusals.jsonl`), exercises receipted
    (`peek-exercises.jsonl` — Casey's rider, Jim's adoption as grantor). At uid-split
    this is a deliberate exception to rule on — group-readable or API-mediated — never
    an inherited hole; it is the ONE greppable home of the S103 exception.**
- Per-garden backup lanes (the restic fence lesson: darron-run restic cannot read 750
  homes it isn't grouped into — backup becomes per-uid lanes or a backup user in `han`,
  decided, not discovered at restore time).

### P5 — acceptance (kernel-proofs, not assertions)
1. `sudo -u leo cat ~tenshi/.han-view/…` → **EACCES, measured** (and the same in every
   direction; the matrix is 5×5, run by script, posted whole).
2. A deliberately hostile turn on one seat (Tenshi authors it — her chair) attempting a
   cross-mind write: fails at the kernel, and the failure is *visible* (the attempt logs).
3. Every service green for a soak week; wake/dispatch/pulse timings within baseline.
4. The `/logout` cross-de-auth pain: demonstrated dead (one seat logs out, others live).
5. Rollback rehearsal BEFORE P2: chown back + rejoin shared socket on a scratch copy —
   the un-ring proven while it is cheap (the S181/refresh-twin discipline).

## What this plan does NOT do (named, so scope cannot creep)
- **Custody, not authorship (Casey's Q2, folded 2026-08-19):** per-uid kernel-enforces
  *which process wrote these bytes* on SOVEREIGN trees. Authorship within shared append
  surfaces (the maintenance journal's `Caught-by`/headers) remains self-declared prose,
  and the conversations API `role` field remains unvalidated — the MNT-158 collision
  would be byte-identical after P5. Both are P6-horizon, not delivered here; a green P5
  must never be read as covering attribution generally.
- No per-agent DB split (P6 horizon; the honest sovereignty limit on gradient.db is
  documented instead).
- No change to memory *content*, protocols, or DEC-085 shapes — ownership only.
- No new restriction unbidden (DEC-104): every grant/refusal lands authored, with its
  reason, in the sudoers file and this plan.

## Open questions (Darron's, none blocking P0)
1. **Auth**: N accounts vs API keys for the per-agent `~/.claude` — cost and shape.
2. **The dial's resting point**: 750-with-group forever, or 700-with-API-reads as the
   destination?
3. **Sequencing vs the starter**: mike's garden inherits whatever shape ships — do we
   land per-uid here first and export, or design the manifest leaf (uid allocation as
   garden config) in the same pass? (My lean: manifest leaf in the same pass — DEC-081.)
4. **Jim's memory move timing** — it is the one migration with real bytes at stake;
   it wants its own quiesced window + verification, possibly before everything else.
