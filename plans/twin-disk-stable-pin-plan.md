# Twin disk stable-pin plan — derive the disk, never name it (MNT-097 follow-on)

> **Status:** PLAN, held for Jim's blocking audit (Darron's word, 2026-08-07 ~9:36 PM: "do the
> proper cure now... plan it and Jim will audit it and we'll build it"). Tenshi's eye welcome —
> the enumeration flip is her find. Author: Leo (session), 2026-08-07.
> **Thread:** msb5c2tb (Battlemage readiness). **Relates:** MNT-097, the Succession Law
> (runbook + both script headers), Jim N3 (same-disk belt), the 2026-08-07 enumeration flip.

## The problem, one paragraph

NVMe enumeration is not stable across boots (proven live today: the original root was
`nvme0n1p2` at the 13:22 boot and `nvme1n1p2` at the 14:14 boot). Both twin scripts pin
`TARGET_DISK="/dev/nvme1n1"` — a **boot-scoped name doing a stable identity's job**. Tonight:
`refresh-twin.sh` (ALL modes — verify, refresh, and Stage 4's required `--reinstall-grub`)
dies at the `case "$TWIN_DEV" in "$TARGET_DISK"*)` belt because `blkid -L twin` resolves to
`nvme0n1p3`. Fail-closed (the right polarity, no damage possible) — but the hop's post-step
would refuse, and `make-twin.sh` re-runs would refuse the same way at its UUID pins. Every
refusal invites a hand-edit under pressure, which is exactly where wrong-disk mistakes live.

## The invariants (what the old belts actually protected — kept, made enumeration-proof)

1. **make-twin consecrates only THE pinned disk** — today via partition-UUID pins checked at a
   hardcoded name. Invariant stays; the name goes.
2. **refresh/verify operate only on a genuine twin**: twin root + twin ESP on ONE physical
   disk (Jim N3), which is NOT the disk carrying the live root, with no label ambiguity.
3. **Succession doctrine**: pins are per-consecration ROLE values. This plan *simplifies* the
   doctrine — one fewer constant to edit at a re-consecration (the disk derives from the pins).

## Design: derive-then-verify (names computed from stable IDs, never typed)

**Shared helper (both scripts, ~4 lines):**
```bash
parent_disk() {  # partition device -> its physical disk, enumeration-proof
  local pk; pk=$(lsblk -no pkname "$1" 2>/dev/null | head -1)
  [ -n "$pk" ] && printf '/dev/%s\n' "$pk"
}
```

**make-twin.sh:** delete the `TARGET_DISK` literal; derive it from the surviving pin:
```bash
SWAP_DEV=$(readlink -f "/dev/disk/by-uuid/$PIN_SWAP_UUID") || die "pinned swap UUID not present — not the consecrated disk's boot?"
TARGET_DISK=$(parent_disk "$SWAP_DEV")                      || die "cannot derive target disk from pinned swap"
```
Derivation uses `PIN_SWAP_UUID` (p1 — the partition the build KEEPS; `PIN_SCRATCH_UUID` is
consumed, so a post-crash manual retry can still derive). Every existing UUID pin assert
stays byte-identical — they become belts over a derivation instead of gates over a guess.
`${TARGET_DISK}p1` etc. construction unchanged (nvme `p`-suffix naming stays an accepted
bound — the script is box-pinned by design; noted, not generalised).

**refresh-twin.sh:** delete the `TARGET_DISK` constant (used ONLY in the two case-belts);
replace the belts with the real invariants:
```bash
# Uniqueness — refuse ambiguity (the launcher-guard pattern): exactly one 'twin', one 'TWINESP'.
[ "$(blkid -t LABEL=twin -o device | wc -l)" = 1 ]    || die "label 'twin' is ambiguous — refusing."
[ "$(blkid -t LABEL=TWINESP -o device | wc -l)" = 1 ] || die "label 'TWINESP' is ambiguous — refusing."
TWIN_DISK=$(parent_disk "$TWIN_DEV")      || die "cannot derive twin's disk"
ESP_DISK=$(parent_disk "$TWIN_ESP_DEV")   || die "cannot derive twin ESP's disk"
LIVE_DISK=$(parent_disk "$(findmnt -no SOURCE /)") || die "cannot derive live root's disk"
[ "$TWIN_DISK" = "$ESP_DISK" ]  || die "twin root and ESP on different disks — not a consecrated twin (N3)."
[ "$TWIN_DISK" != "$LIVE_DISK" ] || die "twin label resolves to the LIVE disk — refusing (the enumeration lesson)."
# Cross-check: the twin-esp PARTLABEL and the TWINESP fs-label must be the same partition.
[ "$(readlink -f /dev/disk/by-partlabel/twin-esp 2>/dev/null)" = "$(readlink -f "$TWIN_ESP_DEV")" ] \
  || die "partlabel twin-esp and label TWINESP disagree — refusing ambiguity."
```
This is *stronger* than the old belt: the old one accepted any partition on `nvme1n1`
(whatever that name pointed at that boot); the new one demands internal consistency the
original box cannot accidentally satisfy and a USB stray cannot fake without carrying
matched labels + partlabel on one non-live disk.

**Doctrine text (headers + runbook Succession Law + CROWNING.md step 7):** re-consecration
now edits the `PIN_*`/`HOST_ROOT_UUID` values only — the disk derives. One fewer role value;
the paragraph shrinks.

## Acceptance (the flip is live — we can prove the cure tonight, read-only)

1. `bash -n` both scripts.
2. **`sudo bash refresh-twin.sh verify` on THIS boot** (Darron's hand, read-only mode):
   currently dies at the unexpected-disk gate; post-fix it must PASS its asserts and report
   drift — on the exact enumeration that broke it. The bug's own boot is the test rig.
3. Negative check (paper): confirm by reading that a hypothetical second `twin` label makes
   the uniqueness gate die (the gate is a `wc -l` — trivially auditable).
4. Blobs posted for re-hash; Jim's diff-audit is the land gate.

## Scope & sequencing

- **Files:** `scripts/make-twin.sh`, `scripts/refresh-twin.sh` (+ the three doctrine texts:
  both headers ride the same diff; `plans/mint22-migration-runbook.md` + `docs/CROWNING.md`
  one-line updates). Nothing else.
- **Base:** the GREEN'd `8f063381`/`ccdcc29e` bytes (splash blocks remain stashed; they
  re-apply AFTER this lands — two clean diffs, no interleave).
- **Gate:** must land before Stage 4's post-hop `--reinstall-grub`. Fallback if the audit
  can't land tonight: the declared-hand one-line role-value edit stays available (already
  in-thread).
- **DEC check:** Succession Law honoured (simplified, not altered — pins stay role values);
  DEC-103 (fail-closed polarity preserved and strengthened); L013 (verify step is Darron's
  hand); no settled decision touched.
