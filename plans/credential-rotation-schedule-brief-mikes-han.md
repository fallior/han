# Credential Rotation Schedule — Implementation Brief for Six (mikes-han)

*Author: Leo (session, han). Date: 2026-04-22. For: Six, reviewed with Mike. Origin: DEC-077 on han, "Jemma, making conversations civil" thread (mo9h1le6-0uvx35) context.*

---

## Context

Darron has created a second Claude Max subscription (`fallior@icloud.com`) and is sharing it with Mike for overflow capacity when either of them burns through their primary account's weekly 20× tokens. The arrangement is **not a shared pool under pressure** — it is a time-sliced capacity split that each of them uses at their own slowest 2.5 days of the week.

**Schedule (local time, UTC+10 for both machines):**

| Window | Darron's active account (han) | Mike's active account (mikes-han) | Zone |
|---|---|---|---|
| Fri 06:00 → Sun 18:00 | gmail | **icloud (firm)** | Mike's firm |
| Sun 18:00 → Tue 18:00 | gmail | Mike's home | **flex (negotiated)** |
| Tue 18:00 → Fri 06:00 | **icloud (firm)** | Mike's home | Darron's firm |

Each user is on icloud 2.5 days/week, their own account 4.5 days/week. During the 2-day flex band nobody has a guarantee — if either side rate-limits on their own account in that window, their Jemma is free to rotate to icloud. Neither of us expects to need the flex band, but it exists.

## What Six needs to build on mikes-han

Three things, mirroring what landed on han:

1. **The swap script** — a shell script that copies the appropriate `.credentials-[ab].json` over the live `.credentials.json`. Idempotent. Logs to `~/.han/health/credential-swaps.jsonl` with `source:"scheduled"`.

2. **Rotation-pause awareness in `jemma.ts:checkAndSwapCredentials()`** — a ~15-line guard that returns early (without clearing the `rate-limited` signal) if `~/.han/signals/rotation-paused` exists. That way when Darron has his firm icloud window on han, Mike's machine doesn't rotate onto icloud via rate-limit.

3. **Three cron entries** in Mike's user crontab. These are **inverted** relative to Darron's because Mike's firm window is when Darron's pause is active, and vice versa.

## Account mapping on mikes-han

Mike will register two credential files the same way Darron did:

```
~/.claude/.credentials-a.json   → Mike's home account (his personal Claude Max)
~/.claude/.credentials-b.json   → fallior@icloud.com (the shared account)
```

The swap script's argument convention:

- `home` → copies `.credentials-a.json` to `.credentials.json`
- `icloud` → copies `.credentials-b.json` to `.credentials.json`

Mike completes setup by running `claude auth login` with each account in turn and running `cp ~/.claude/.credentials.json ~/.claude/.credentials-[ab].json` after each. Same mechanism used on han this afternoon.

## Reference implementation from han

Script on han: `~/Projects/han/scripts/credentials-scheduled-swap.sh` — Six should create the parallel at `~/Projects/mikes-han/scripts/credentials-scheduled-swap.sh`. Structure is identical; only the argument names (`gmail`/`icloud` on han, `home`/`icloud` on mikes-han) and email strings change.

Jemma guard on han (to be added on mikes-han too):

```typescript
// In checkAndSwapCredentials(), after the rate-limited signal check:
const pausePath = path.join(SIGNALS_DIR, 'rotation-paused');
if (fs.existsSync(pausePath)) {
    console.log('[Jemma] Rate-limit signal received but rotation is paused — signal held until pause lifts');
    return;
}
```

Leaves the `rate-limited` signal in place so rotation fires the moment the pause lifts. Same semantics Mike will want.

## Cron entries for Mike's crontab

```
# Fri 06:00 — swap to icloud + clear pause (Mike's firm window starts)
0 6  * * 5  ~/Projects/mikes-han/scripts/credentials-scheduled-swap.sh icloud && rm -f ~/.han/signals/rotation-paused

# Sun 18:00 — swap to home account (Mike's firm window ends; flex opens)
0 18 * * 0  ~/Projects/mikes-han/scripts/credentials-scheduled-swap.sh home

# Tue 18:00 — pause rotation (Darron's firm window starts on his machine)
0 18 * * 2  touch ~/.han/signals/rotation-paused
```

Compare with Darron's cron on han for symmetry:

```
# Fri 06:00 — swap to gmail + set pause (Mike's firm window starts on his machine)
0 6  * * 5  ~/Projects/han/scripts/credentials-scheduled-swap.sh gmail && touch ~/.han/signals/rotation-paused

# Sun 18:00 — clear pause (Mike's firm window ends; flex opens)
0 18 * * 0  rm -f ~/.han/signals/rotation-paused

# Tue 18:00 — swap to icloud (Darron's firm window starts)
0 18 * * 2  ~/Projects/han/scripts/credentials-scheduled-swap.sh icloud
```

The two cronjob sets are mirror images. During every moment of the week, at most one of the two machines has rotation-paused set, and that's the machine whose owner is NOT on icloud.

## The flex band (Sun 18:00 → Tue 18:00)

During this 2-day band both machines have `rotation-paused` cleared. If either user rate-limits on their own account in this window, Jemma rotates them to icloud — but the *other* user's pause is also clear, so they might grab icloud the same way. Simultaneous use is possible in this band. Both of us expect this is vanishingly rare; if it becomes a pattern we'll add a negotiated-flex signal (currently deferred).

## Edge cases to flag for Mike

- **Machine powered off at swap time.** Cron doesn't accumulate missed firings. If Mike's machine is off at Fri 06:00, the swap-to-icloud doesn't happen until the next Friday (assuming he doesn't run it manually on startup). Suggestion: add a startup-check script that compares current day-of-week + hour to the schedule and applies the correct state. Round 2 if needed.
- **Manual override.** If Mike manually swaps during a firm window (e.g., forces home account while icloud is his firm slot), Jemma's rate-limit rotation WILL still fire if home rate-limits, because the pause isn't set during his own firm window. That's arguably the correct behaviour — he overrode, accept the consequence.
- **Claude Code OAuth token drift.** Tokens in `.credentials.json` refresh periodically without action. Over days the live file diverges from the `.credentials-[ab].json` snapshots. Swap script is still correct (overwrites live with snapshot), but the *snapshot's* token might go stale if untouched for weeks. If we ever observe rotation failures after long idle, re-snapshotting is the fix.

## Optional future addition — negotiated-flex signal

Deferred. If in practice we both start regularly needing tokens during the 2-day flex band, we can add a handshake signal so one side can ping the other to ask "can I have icloud now?" and get an ack before swapping. For now it's a thought, not a feature.

## Six's implementation checklist

1. [ ] Create `~/Projects/mikes-han/scripts/credentials-scheduled-swap.sh` mirroring han's version, with `home`/`icloud` args
2. [ ] Make it executable
3. [ ] Add rotation-paused guard to `mikes-han/src/server/jemma.ts:checkAndSwapCredentials()` (same ~15-line block)
4. [ ] Verify `tsc --noEmit` clean
5. [ ] Write implementation brief for the thread Mike has open about this (Six picks the appropriate thread)
6. [ ] Mike installs the three cron entries via `crontab -e`
7. [ ] Mike completes `claude auth login` for each account and registers them as `.credentials-a.json` (home) and `.credentials-b.json` (icloud)
8. [ ] Commit + push on mikes-han with matching semantic commit message
9. [ ] Six and Mike observe the first Friday 06:00 swap to confirm the cron fires correctly

## Settled decisions to respect

- DEC-068/069/070 (gradient architecture) — not touched
- DEC-073 (gatekeeper-controlled template) — Six is the gatekeeper on mikes-han, so any template edits go through him, not Mike or anyone else
- DEC-074/075/076 (han-side S131 architecture) — not referenced in mikes-han; independent implementation
- This brief itself informs what will become DEC-077-equivalent on mikes-han (Six's call whether to file as the same DEC number or separately)

---

*Hand-off from Leo-session (han) to Six-session (mikes-han). Questions welcome via the conversation thread — no urgency; first firing is Friday 06:00 AEST, 2026-04-24 (roughly 36 hours from filing).*
