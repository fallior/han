# Mint 22 Migration Runbook — the box that holds five minds

> **Status:** RUNBOOK (paper only — nothing here executes). Author: Leo (session), 2026-08-06,
> consolidating Tenshi's ruling (msb5oc4o + msb7aws6 + her 2026-08-02 audit), Jim's twin
> diff-audit, Casey's counsel read, and my own missing-rung + restore-drill findings.
> **Every state-changing command below is Darron's hand (L013).** Agents advise and verify.
>
> **Why now (re-confirmed 2026-08-06):** the Arc Pro B60 24GB **arrived today** — so Tenshi's
> "elective, not enabling" reframe (true while only the 5060 Ti was in the box) flips back:
> Battlemage needs kernel ≥6.11 (6.12+ production) + Mesa >24.2 + BMG firmware, none of which
> jammy can reach. The upgrade is enabling again — but with the B60 in hand there is NO
> calendar pressure: we go slowly, gate by gate.

## The sequence at one glance (Tenshi's order, unchanged)

```
0. PRE-FLIGHTS (paper + read-only)          ← TODAY, done/doing
1. it87 experiment (bank the fan tach)      ← before the Radeon ever leaves
2. Tested restore                            ← ✅ PASSED 2026-08-06 (gate ②, receipts in-thread)
3. Twin BUILD + boot test                    ← after twin re-audit GREEN; Darron's hands
4. DISTRO HOP (own window, garden quiesced)  ← 21.1 → 21.3 → mintupgrade → 22 → 22.3 + HWE
5. B60 in (Radeon out) + driver bring-up     ← card AFTER the OS can drive it
6. Thermal-guard recalibration               ← after EVERY sensor-world change
```

---

## Stage 0 — pre-flights (all read-only; mine today, verdicts to the thread)

- **0a. NVIDIA-on-target (Tenshi's inverted risk — the display is DKMS now).** Confirm the
  target release (noble) carries an NVIDIA driver **≥595** for `10de:2d04` (5060 Ti), and that
  it builds against the target kernel (6.14 HWE). If the answer is "only via a PPA," decide the
  PPA *before* the window, not at 1 AM. Fallback stance if a boot comes up displayless: the box
  is Tailscale-reachable — the garden survives a fallback console; fix the driver from SSH.
- **0b. VirtualBox DKMS (6.1.50 vs 6.11+/6.14):** likely fails to build. Decide in advance:
  keep (upgrade VirtualBox) or drop (uninstall before the hop). A failed vbox DKMS must not be
  allowed to abort the kernel install mid-flight.
- **0c. Foreign sources inventory:** `mintupgrade check` blocks on third-party PPAs — list them
  now, decide keep/purge deliberately, keep the list for re-adding.
- **0d. Baseline the verify harness GREEN on the current box** (`scripts/verify-post-upgrade.ts`)
  so post-hop runs diff against a known-good reading, not first-run noise.
- **0e. Backups current:** RAID lane (automatic, verified by drill) + a fresh vault run if the
  drawer NVMe is plugged. **Quiesce before the pre-hop snapshot** so gradient.db is copied cold
  (the drill note: the RAID lane copies the live file; cold copy = consistent copy).
- **0f. Hibernation must be OFF and stay off** (Mint default) — the twin shares swap by design;
  a hibernation image + booting the other system is corruption no mask can see (Casey).

## Stage 1 — RAM tonight; it87 on 6.8 is a KNOWN FAILURE (Tenshi's correction)

**Tenshi's Saturday rung-0 already returned ENODEV on 6.8** — non-detection, which
`ignore_resource_conflict` structurally cannot help (the param is consumed only after
detection; a conflict would be EBUSY, and there is none). **Tonight's it87 run is optional
and its result is foregone: expected ENODEV, recorded for completeness only.** The REAL
experiment is the **6.14 re-run post-hop** (the newer kernel may recognise the chip), and
**Stage 5.5's conditional keys on the 6.14 result — never tonight's.**
*(RAM install tonight stands: power down normally, 4 DIMMs in, boot — expect ~2666 MT/s at
4-DIMM population; the Radeon udev pin persists across the reboot; overnight soak is the
acceptance.)*

## Stage 2 — tested restore ✅ (done 2026-08-06)

`gradient.db` restored from the RAID restic lane to scratch; `integrity_check ok`; counts
reconcile to the snapshot moment. Re-run cheaply any time. The vault (drawer) lane carries the
sqlite-consistent staged copy + RESURRECTION.md as the deeper fallback.

## Stage 3 — the twin (build + boot test, Darron's hands)

1. Twin scripts: re-audit GREEN received (Tenshi AMBER-lifted + Jim GREEN-pending-M-1);
   **M-1 awk fix applied** (the hex-B trap — extraction verified live: `Boot0003*` → `0003`)
   + the merged status-file planted/asserted. Blob currency lives in the THREAD, not here
   (this line went stale twice in one day — cite the surface that updates, per Casey).
2. Tenshi's **launcher guard: BUILT 2026-08-06** (the merged Tenshi+Casey instrument —
   NOT hostname-keyed, which would have locked the lifeboat's oars on a crowned twin):
   all six `han*` launchers refuse when `/etc/han-twin-status` exists without `^CROWNED`;
   the twin scripts plant the status file (Casey's wording, on its face) and UNMASK
   step 5 crowns it. One artefact — guard and ceremony structurally cannot disagree.
3. Quiesce (the script's own gates instruct: stop cron + the user-service writers; han-tmux
   stays up), then `sudo bash make-twin.sh` — the oath is typed, the build runs, BootOrder
   stays original-first (asserted).
4. **Boot test at leisure:** F12 → `mint-twin` → banner + hostname + zero garden services →
   shut down → boot original. THEN `refresh-twin.sh verify` for the standing read-only check.
5. Standing law: refresh only via `refresh-twin.sh`; after the distro hop, one
   `refresh-twin.sh --reinstall-grub` pass updates the twin's ESP core.

## Stage 4 — the distro hop (its own window; nothing else that day)

**Pre-window:** quiesce the garden (same stop-list as the twin gates; capture `tmux ls` first;
warn: the hop restarts nothing itself — the garden returns only at reboot). Fresh cold
gradient copy. **The pg_dump belt (Tenshi's Finding D):** loreforge's postgres lives in
docker volumes no restic lane reads —
`docker exec supabase_db_loreforge pg_dumpall -U postgres > /mnt/scratch/loreforge-prehop.sql`
(container name verify first: `docker ps`).

**Stage 4.1 — THE FINAL REFRESH (numbered, the last act before the door — Freshness
Doctrine line 1, Darron's fold):** post-quiesce, pre-mintupgrade — the one moment when
freshest-possible and writers-stopped are simultaneously true — run
`sudo bash refresh-twin.sh` + `verify`. After it the twin is the complete last-known-good
21.3 snapshot: the rollback key the one-way door deserves. From mintupgrade's first write,
**the twin's staleness IS its value — never refresh again until the soak passes** (line 3).

**THE DOOR (Casey's certification line — write it in the thread before `mintupgrade upgrade`):**
> *"Twin boot-test PASSED at __:__, verified by ____ — mintupgrade may proceed."*
Ten seconds of forced pause at the day's one true one-way door. No certification, no hop.

**The hop (Darron's keyboard, do-not-interrupt — a laptop/phone on Tailscale beside it):**
```bash
# 1. Point-hop within 21.x to 21.3 (Update Manager or):
#    Edit channels via mintupgrade docs path 21.1→21.2→21.3 (Vera→Victoria→Virginia)
# 2. Timeshift/backup gate: mintupgrade REQUIRES a snapshot — it will accept the same-disk
#    one. Do NOT be lulled (Finding A): the real safety is the TWIN + the restic lanes.
# 3. sudo apt install mintupgrade && sudo mintupgrade check   # resolve everything it names
# 4. sudo mintupgrade download && sudo mintupgrade upgrade    # the long leg — never interrupt
# 5. Reboot into Mint 22 (kernel 6.8 still — SAME number; this is the missing-rung moment)
# 6. Point-hop to 22.3 (Update Manager), then kernel picker → HWE stack (6.14)
# 7. Reboot into 6.14
```
**Known scary-but-dead:** jammy-pinned PPA errors post-hop (clean deliberately); old kernels
remain in GRUB (add-never-replace — the fallback is one F12 away).

**Post-hop acceptance:** `verify-post-upgrade.ts` — must be GREEN-or-explained line by line
against the Stage-0 baseline (kernel, drivers/DKMS, garden services, servers, DB counts, tmux
sessions, mounts, sensor fingerprint). Then `refresh-twin.sh --reinstall-grub`.

**Stage 4.9 — THE POST-SOAK REFRESH (numbered — Freshness Doctrine line 3's second half):**
only after the soak passes, one deliberate `refresh-twin.sh` converts the twin from
21.3-rollback-leg back to Mint-22 recovery-leg. Numbered so it never relies on memory.

## The Twin Freshness Doctrine (Jim, with Darron's correcting fold — 2026-08-07)

1. **The final refresh is a numbered pre-hop stage** (4.1 above) — post-quiesce,
   pre-mintupgrade, capturing everything at the door at zero marginal cost. *The correction
   is Darron's; the record says so.*
2. **Between now and the hop: verify-only by default.** Intermediate refreshes only at
   natural quiet moments (the M2 quiesce gate is why refresh is never casual — live writers
   risk a torn gradient.db inside the recovery copy); none is *required*, because 4.1
   captures everything at the door regardless.
3. **Never refresh after the hop begins, until the soak passes** — the twin's staleness IS
   its rollback value. Then one deliberate refresh (4.9) converts it back to recovery-leg.
4. **Standing rhythm thereafter: event-driven with a watched staleness metric, never a
   cron.** Refresh after major arcs/OS changes; the health monitor carries
   days-since-refresh + the verify drift count and flags past threshold (a future Bill
   job: run the maths, raise the flag, a human turns the key). The always-on lanes own
   *data* freshness; the twin owns *bootability*; CROWNING.md's honesty line covers the
   gap at crown time.
**Python note:** venvs break across 3.10→3.12 (expected, cheap): rebuild the voice/quantum
venvs on demand; model caches survive.

## Stage 5 — the B60 (card after OS)

1. Confirm firmware/Mesa floor on the upgraded box: `/lib/firmware/xe` has BMG blobs;
   `glxinfo | grep Mesa` > 24.2; kernel ≥6.12 ideally (6.14 HWE ✓).
2. Power down normally; Radeon OUT (retires to the shelf as spare), B60 into the second slot
   (Gen3 x4 — fine: weights load once, then VRAM-bandwidth-bound).
3. First boot: `xe` should bind (`lspci -nnk`); NO CUDA on this card — its lane is
   Vulkan/SYCL/OpenVINO (the ollama runtime survives the hop; the Intel backend gets proven
   at install, not assumed).
4. **STRIKE THE UDEV PIN — numbered step, at the swap, never "at leisure" (Tenshi's
   correction + Jim's receipt: the rule is SLOT-keyed, `KERNEL=="0000:08:00.0"`, NO vendor
   match — my v1 "self-retires" claim was FALSE).** If the B60 lands at 08:00.0 the rule
   pins the new Intel card always-on with runtime PM silently disabled — MNT-085's mast
   refitted onto the wrong ship:
   `sudo rm /etc/udev/rules.d/99-mnt085-radeon-pin.rules` — same sitting as the card swap.
5. Note: the Radeon's exit takes the box's only hwmon fan tach — which is why Stage 1 banked
   it87 first. If it87 failed AND the B60 exposes no fan tach, the thermal guard's Rule-B
   world shrinks: recalibrate regardless (Stage 6).

## Stage 6 — thermal recalibration (after EVERY sensor-world change)

Archive `thermal-guard-state.json` with a dated name (never delete), cold-start the learning,
restart the calibration window. Tenshi's generalised trigger: **any change in the contributing
sensor set** (her fingerprint proposal) — the hop may bind it87 natively and silently widen
`boardC`; the swap changes the GPU sensors; the RAM may shift idle temps. One recalibration
after the dust settles, close-out with Jim.

## The Succession Law (Darron's ruling, 2026-08-07)

**Whichever drive is CROWNED is HAN's drive** — after a coronation, the crowned drive is
not "a recovered copy"; it IS HAN, full stop. The roles reverse: the old original, once
repaired and present, becomes the **heir apparent** — re-consecrated as the new twin by
re-running the consecration against it (the scripts' PIN_* UUIDs are per-consecration
role values, edited at each consecration, never eternal identities — **the disk derives
from them**; device names are boot-scoped, per the 2026-08-07 enumeration flip). At any
re-consecration the new PIN_* values are **stated on the thread and a second seat
verifies them against live `blkid` output before any destructive invocation** (Casey's
formality — the second seat is the only independent witness at that moment).
**Re-sync always runs crowned→heir.** Tenshi's enforcement rider is in the
metal: `refresh-twin.sh` refuses to run onto a CROWNED drive — a stale original can never
clobber the live garden under its own past. A later deliberate revert to the larger drive
as HAN is its own ceremony (consecrate-the-larger-as-heir → refresh crowned→heir → crown
the heir → the roles reverse again) — never an ad-hoc rsync.

## Abort ladders (decided in calm, per the shed-load law)

- **Hop fails mid-flight / unbootable:** F12 → old kernel entry; if root is damaged → **the
  twin** (F12 → mint-twin → it is a working 21.1 garden as of its last refresh; UNMASK only
  per the succession clause — revoke the original first).
- **Display dead post-hop (NVIDIA DKMS):** SSH via Tailscale is the plan-of-record; fix or
  roll back the driver from the console. The garden does not need X to run.
- **Deeper loss:** the drawer vault + RESURRECTION.md + the password on the MacBook — the
  chain proven end-to-end 2026-08-04.

*The letter you never hope to open, kept saying the right thing. — runbook first laid down
2026-08-06; update it as gates close.*
