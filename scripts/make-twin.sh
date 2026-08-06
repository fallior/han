#!/usr/bin/env bash
# make-twin.sh — build the bootable twin of the garden's root onto nvme1n1
#
# Darron's bootable-twin instrument (supersedes Tenshi's G0.2 snapshot — msb5c2tb).
# Run BY DARRON'S HAND with sudo (L013: agents never run state-changing ops on the host):
#   sudo bash ~/Projects/han/scripts/make-twin.sh
#
# AUDIT FOLD 2026-08-06 (Leo, from the three-chair audits of 2026-08-02, thread msb5c2tb):
#   Jim M1/Tenshi B2 — BootOrder captured, restored original-first, asserted (no ambush boot)
#   Jim M2          — quiesce gate covers the garden's USER-service writers, not just cron
#   Jim M3/Tenshi B3/Casey F1 — user units MOVED to user.pre-twin-masked/ then masked
#                     (preserve-then-mask, the crontab pattern; ln -sf alone DESTROYED
#                     the only copies — DEC-069). Post-asserts now check the user layer.
#   Tenshi B1       — cli-busy gate: 5-min staleness (garden convention), no slug carve-outs
#   Jim F4/Casey    — tailscaled masked (same tailnet node = the LAN collision, off-LAN)
#   Jim F5          — host-fstab sed removed (scratch mounts by LABEL; mkfs -L keeps it)
#   Jim N4/Casey    — decorative system-level garden masks pruned (they are user units)
#   Casey F2        — rsync --exclude=/boot/grub/grub.cfg (no --delete-excluded): the twin's
#                     cfg is never overwritten by the original's — the crash window leaves a
#                     rescue prompt or a stale-but-twin-aimed twin, never an armed trap
#   Tenshi n3       — rsync exit 24 tolerated (vanished files on a live system, benign)
#   MNT-087         — mask loop fail-loud per unit; post-asserts cover ALL masks, not one
#
# NON-IDEMPOTENT BY CONSTRUCTION (Tenshi n3): the first act consumes PIN_SCRATCH_UUID,
# so a failure past repartition means this script REFUSES to re-run at its own pin gate.
# Manual retry: verify the disk state by hand, then re-pin (edit PIN_* to the disk's
# current UUIDs) or restore the pre-run layout. Never bypass the pins blind.
#
# HIBERNATION (Casey): the twin shares swap with the original BY DESIGN. That is safe
# only while nobody ever hibernates (Mint default: disabled). It must stay disabled —
# a suspend-to-disk image in shared swap + booting the other system = corruption no
# mask can see.
#
# What it does (one pass, fail-loud at every gate):
#   1. Preflight — identity-pins the target disk by the UUIDs it carries TODAY;
#      refuses to run against anything else. Verifies scratch is empty, swap unused,
#      UEFI boot, tools present, garden quiesced, and asks for explicit confirmation.
#   2. Repartition nvme1n1: KEEP p1 (swap, UUID untouched — no initramfs churn);
#      replace empty scratch with p2 ESP 1G + p3 twin 1000G + p4 scratch (rest).
#   3. rsync the live root -> twin (one filesystem, pseudo-fs excludes, grub.cfg excluded).
#   4. Twin-ise: its own fstab (twin root + twin ESP + shared swap, NO scratch),
#      hostname han-twin, drill-masks (preserve-then-mask), chroot grub-install
#      (named NVRAM entry + --removable fallback), update-grub INSIDE the chroot,
#      BootOrder restored original-first.
#   5. Host fstab: scratch mounts by LABEL (unchanged by design); mount -a + assert.
#   6. Post-asserts (incl. the user-mask layer + BootOrder), then boot-test instructions.
#
# The standing posture afterwards: NEVER bare-rsync onto the twin — that clobbers
# its fstab and silently un-twins it (THE REFRESH TRAP). Refresh only via
# refresh-twin.sh, which re-applies twin-isation in the same act.

set -euo pipefail

# ── Identity pins (the disk as it is TODAY — the script refuses anything else) ──
TARGET_DISK="/dev/nvme1n1"
PIN_SWAP_UUID="56a75d81-f033-4f06-b189-c29bb6963c37"     # nvme1n1p1 today
PIN_SCRATCH_UUID="c971b993-7a07-4f21-a1e5-02f0230a8245"  # nvme1n1p2 today (empty, consumed)
HOST_ROOT_UUID="d5a37330-7c4a-4df9-a4d8-d9f99c44aac5"    # nvme0n1p2 — must be what we run FROM
TWIN_HOSTNAME="han-twin"
TWIN_SIZE="1000GiB"
ESP_SIZE="1GiB"
TWIN_MNT="/mnt/twin"

log()  { printf '\n\033[1;32m[make-twin]\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m[make-twin] FATAL:\033[0m %s\n' "$*" >&2; exit 1; }

# ───────────────────────────── 1. PREFLIGHT ─────────────────────────────
[ "$(id -u)" = 0 ] || die "run with sudo (Darron's hand)."
[ -d /sys/firmware/efi ] || die "not UEFI boot — twin plan assumes EFI."
for t in sgdisk mkfs.vfat mkfs.ext4 rsync partprobe blkid findmnt efibootmgr runuser; do
  command -v "$t" >/dev/null || die "missing tool: $t"
done

# We must be running FROM the original root, never from the twin.
CUR_ROOT_UUID=$(findmnt -no UUID /) || die "cannot read root UUID"
[ "$CUR_ROOT_UUID" = "$HOST_ROOT_UUID" ] || die "running root ($CUR_ROOT_UUID) is not the pinned original — refusing (are you ON the twin?)."

# Target disk must carry today's exact partition UUIDs — the identity pin.
[ -b "$TARGET_DISK" ] || die "$TARGET_DISK not present"
ACTUAL_P1=$(blkid -s UUID -o value "${TARGET_DISK}p1" || true)
ACTUAL_P2=$(blkid -s UUID -o value "${TARGET_DISK}p2" || true)
[ "$ACTUAL_P1" = "$PIN_SWAP_UUID" ]    || die "p1 UUID mismatch ($ACTUAL_P1) — not the pinned disk."
[ "$ACTUAL_P2" = "$PIN_SCRATCH_UUID" ] || die "p2 UUID mismatch ($ACTUAL_P2) — not the pinned disk."

# Scratch must be genuinely empty (lost+found only) before we consume it.
SCRATCH_MNT=$(findmnt -no TARGET "UUID=$PIN_SCRATCH_UUID" || true)
if [ -n "$SCRATCH_MNT" ]; then
  CONTENT=$(find "$SCRATCH_MNT" -mindepth 1 -maxdepth 1 ! -name lost+found | head -1)
  [ -z "$CONTENT" ] || die "scratch is NOT empty ($CONTENT) — refusing to consume it."
fi

# Swap on the target must be droppable.
SWAP_USED=$(awk -v d="${TARGET_DISK}p1" '$1==d {print $4}' /proc/swaps || true)
[ -z "${SWAP_USED:-}" ] || [ "$SWAP_USED" = "0" ] || log "note: swap has ${SWAP_USED}kB in use — swapoff will fold it into RAM."

# ── Quiesce gates: CHECK and instruct, never force (the garden asleep first) ──
systemctl is-active --quiet cron && die "cron is running — stop it first: sudo systemctl stop cron   (restart after: sudo systemctl start cron). The restic lane writes ~/.han mid-copy otherwise."

# M2 (Jim): the garden's real writers are USER services — cron gates none of them.
# A dream beat or WM rotation mid-rsync tears gradient.db inside the twin (the
# MNT-078 class on the twin's most important cargo). han-tmux stays UP on purpose:
# warm stems keep R011, and with the drivers stopped nothing dispatches.
GARDEN_ACTIVE=$(runuser -u darron -- env XDG_RUNTIME_DIR=/run/user/1000 \
  systemctl --user list-units --state=active --plain --no-legend \
  'jemma.service' 'wm-sensor.service' '*-heartbeat.service' 'human-responder@*.service' \
  2>/dev/null | awk '{print $1}' | tr '\n' ' ' || true)
[ -z "${GARDEN_ACTIVE// /}" ] || die "garden writers active: ${GARDEN_ACTIVE} — stop them first (as darron, no sudo):
  systemctl --user stop jemma wm-sensor leo-heartbeat tenshi-heartbeat casey-heartbeat 'human-responder@*'
  (restart after with the same list and 'start'; leave han-tmux UP — the warm stems hold R011)"

# B1 (Tenshi): only FRESH busy signals block (garden convention CLI_BUSY_STALE_MINUTES=5,
# leo-heartbeat.ts:104) — a crashed seat's stale flag must never block the build forever.
# No slug carve-outs (DEC-081): the old cli-busy-leo exemption was an unauthored exception.
BUSY=$(find /home/darron/.han/signals -maxdepth 1 -name 'cli-busy-*' -mmin -5 2>/dev/null | head -1 || true)
[ -z "$BUSY" ] || die "an agent seat is mid-turn ($BUSY, fresher than 5 min) — let it finish, then re-run."

ROOT_USED_G=$(df -BG --output=used / | tail -1 | tr -dc '0-9')
[ "$ROOT_USED_G" -lt 950 ] || die "root uses ${ROOT_USED_G}G — will not fit the ${TWIN_SIZE} twin."

# M1 (Jim/Tenshi B2): capture the boot order BEFORE grub-install can prepend to it.
BOOT_ORDER_BEFORE=$(efibootmgr | awk -F': ' '/^BootOrder/{print $2}')
[ -n "$BOOT_ORDER_BEFORE" ] || die "cannot read BootOrder (efibootmgr)."

log "PREFLIGHT PASSED. Plan:"
cat <<PLAN
  KEEP   ${TARGET_DISK}p1  swap 32G   (UUID unchanged — no initramfs churn)
  DELETE ${TARGET_DISK}p2  scratch    (verified empty)
  CREATE ${TARGET_DISK}p2  ESP  ${ESP_SIZE}  (twin's own bootloader home)
  CREATE ${TARGET_DISK}p3  twin ${TWIN_SIZE} (bootable copy of /, hostname ${TWIN_HOSTNAME})
  CREATE ${TARGET_DISK}p4  scratch (remainder; LABEL=scratch — host fstab mounts by label)
  Root to copy: ${ROOT_USED_G}G     BootOrder preserved: ${BOOT_ORDER_BEFORE}
PLAN
read -rp "[make-twin] Type EXACTLY 'build the twin' to proceed: " CONFIRM
[ "$CONFIRM" = "build the twin" ] || die "confirmation not given."

# ───────────────────────────── 2. REPARTITION ─────────────────────────────
log "swapoff + unmount scratch..."
swapoff "${TARGET_DISK}p1" 2>/dev/null || true
[ -n "$SCRATCH_MNT" ] && umount "$SCRATCH_MNT"

log "repartitioning ${TARGET_DISK} (p1 untouched)..."
sgdisk --delete=2 "$TARGET_DISK"
sgdisk --new=2:0:+${ESP_SIZE}  --typecode=2:EF00 --change-name=2:twin-esp "$TARGET_DISK"
sgdisk --new=3:0:+${TWIN_SIZE} --typecode=3:8300 --change-name=3:twin     "$TARGET_DISK"
sgdisk --new=4:0:0             --typecode=4:8300 --change-name=4:scratch  "$TARGET_DISK"
partprobe "$TARGET_DISK"; sleep 2

log "making filesystems..."
mkfs.vfat -F32 -n TWINESP "${TARGET_DISK}p2"
mkfs.ext4 -q -L twin    "${TARGET_DISK}p3"
mkfs.ext4 -q -L scratch "${TARGET_DISK}p4"
swapon "${TARGET_DISK}p1"

TWIN_UUID=$(blkid -s UUID -o value "${TARGET_DISK}p3")
TWIN_ESP_UUID=$(blkid -s UUID -o value "${TARGET_DISK}p2")
NEW_SCRATCH_UUID=$(blkid -s UUID -o value "${TARGET_DISK}p4")
log "twin=$TWIN_UUID  twin-esp=$TWIN_ESP_UUID  scratch=$NEW_SCRATCH_UUID"

# ───────────────────────────── 3. COPY ─────────────────────────────
mkdir -p "$TWIN_MNT"
mount "${TARGET_DISK}p3" "$TWIN_MNT"
log "rsync / -> twin (${ROOT_USED_G}G — expect tens of minutes)..."
# Casey F2: grub.cfg excluded so the twin's identity is never even TRANSIENTLY the
# original's — a crash mid-ceremony leaves no-cfg (rescue prompt), never an armed trap.
# Tenshi n3: rsync 24 = files vanished on a live source — benign, tolerated explicitly.
set +e
rsync -aHAXx --info=progress2 \
  --exclude=/proc/ --exclude=/sys/ --exclude=/dev/ --exclude=/run/ \
  --exclude=/tmp/ --exclude=/mnt/ --exclude=/media/ --exclude=/lost+found \
  --exclude=/swapfile --exclude=/boot/efi/ --exclude=/boot/grub/grub.cfg \
  / "$TWIN_MNT"/
RSYNC_RC=$?
set -e
[ "$RSYNC_RC" = 0 ] || [ "$RSYNC_RC" = 24 ] || die "rsync failed rc=$RSYNC_RC"
[ "$RSYNC_RC" = 24 ] && log "rsync rc=24 (vanished files on a live system) — benign, continuing."
mkdir -p "$TWIN_MNT"/{proc,sys,dev,run,tmp,mnt,media,boot/efi}
chmod 1777 "$TWIN_MNT/tmp"

# ───────────────────────────── 4. TWIN-ISE ─────────────────────────────
log "writing the twin's own fstab..."
cp "$TWIN_MNT/etc/fstab" "$TWIN_MNT/etc/fstab.pre-twin.bak"
cat > "$TWIN_MNT/etc/fstab" <<FSTAB
# fstab — ${TWIN_HOSTNAME} (the bootable twin; generated by make-twin.sh $(date -Iseconds))
UUID=${TWIN_UUID}      /          ext4  errors=remount-ro  0 1
UUID=${TWIN_ESP_UUID}  /boot/efi  vfat  umask=0077         0 1
UUID=${PIN_SWAP_UUID}  none       swap  sw                 0 0
# NOTE: no scratch, no raid1 — the twin mounts only what it must (drill posture).
FSTAB

log "hostname -> ${TWIN_HOSTNAME} (the human-level which-box-am-I cure)..."
echo "$TWIN_HOSTNAME" > "$TWIN_MNT/etc/hostname"
sed -i "s/$(cat /etc/hostname)/${TWIN_HOSTNAME}/g" "$TWIN_MNT/etc/hosts"

log "planting drill-masks (real system units only: cron/docker/containerd/tailscaled)..."
# N4 (Jim)/Casey: the garden's units are USER units — system-level masks for them were
# decorative and their UNMASK rm-list scary-looking-but-dead. Pruned. tailscaled added
# (F4): same tailnet node identity = the two-live-gardens collision, off-LAN reach.
for unit in cron docker containerd tailscaled; do
  ln -sf /dev/null "$TWIN_MNT/etc/systemd/system/${unit}.service"
done

# M3 (Jim)/B3 (Tenshi)/F1 (Casey): PRESERVE-THEN-MASK — the crontab pattern, extended.
# ln -sf alone DESTROYED the only copies of real unit files (jemma, han-tmux, the
# heartbeats...). mv each into user.pre-twin-masked/ first, then plant the mask.
# UNMASK = mv back (one command, no memory required). Fail-loud per unit (MNT-087:
# the old '|| true' swallowed failures; a mask that failed to apply must be seen).
USERHOME="$TWIN_MNT/home/darron"
if [ -d "$USERHOME/.config/systemd/user" ]; then
  MASK_ARCHIVE="$USERHOME/.config/systemd/user.pre-twin-masked"
  mkdir -p "$MASK_ARCHIVE"
  find "$USERHOME/.config/systemd/user" -maxdepth 1 \( -name '*.service' -o -name '*.timer' \) \
    ! -lname /dev/null | while read -r u; do
    base=$(basename "$u")
    mv "$u" "$MASK_ARCHIVE/$base" || die "preserve failed for $base — refusing to mask-by-destruction."
    ln -s /dev/null "$USERHOME/.config/systemd/user/$base"
  done
fi
rm -f "$TWIN_MNT/var/lib/systemd/linger/darron" 2>/dev/null || true
# Cron lanes: neutralise the twin's crontab copy (original preserved beside it).
if [ -f "$TWIN_MNT/var/spool/cron/crontabs/darron" ]; then
  mv "$TWIN_MNT/var/spool/cron/crontabs/darron" "$TWIN_MNT/var/spool/cron/crontabs/darron.pre-twin-masked"
fi
# The merged status-file (Tenshi's guard flag + Casey's on-its-face declaration — ONE
# instrument so guard and record can never disagree). The launcher guard keys on it;
# UNMASK's final step rewrites it CROWNED (the ceremony stays readable on the face).
cat > "$TWIN_MNT/etc/han-twin-status" <<STATUS
TWIN — subordinate copy, masked, not crowned; made $(date -Iseconds) from $(cat /etc/hostname); see msb5c2tb
STATUS

# A banner so a shell on the twin announces itself.
cat > "$TWIN_MNT/etc/profile.d/00-twin-banner.sh" <<'BANNER'
echo "==============================================="
echo "  THIS IS han-twin — THE BOOTABLE TWIN."
echo "  Garden services are MASKED here by design."
echo "  Real recovery: see refresh-twin.sh UNMASK notes."
echo "==============================================="
BANNER

log "installing grub inside the twin's chroot (its cfg from its own /etc + UUIDs)..."
mount "${TARGET_DISK}p2" "$TWIN_MNT/boot/efi"
for fs in dev dev/pts proc sys sys/firmware/efi/efivars run; do
  mount --bind "/$fs" "$TWIN_MNT/$fs" 2>/dev/null || true
done
# Two installs on purpose: the named NVRAM entry ('mint-twin' in the F12 menu),
# THEN the --removable fallback (EFI/BOOT/BOOTX64.EFI — boots even if NVRAM is lost).
# A single call can't do both: --removable skips NVRAM registration entirely.
chroot "$TWIN_MNT" grub-install --target=x86_64-efi --efi-directory=/boot/efi \
  --bootloader-id=mint-twin --recheck
chroot "$TWIN_MNT" grub-install --target=x86_64-efi --efi-directory=/boot/efi \
  --removable
chroot "$TWIN_MNT" update-grub
for fs in run sys/firmware/efi/efivars sys proc dev/pts dev; do
  umount "$TWIN_MNT/$fs" 2>/dev/null || true
done

# M1 (Jim/Tenshi B2): grub-install PREPENDS its entry to BootOrder — the next ordinary
# reboot would land in the twin (silent-default-flip, on a box that reboots for GPU
# work, with a 1-second menu). Restore original-first with the twin appended; assert.
TWIN_BOOTNUM=$(efibootmgr | awk '/mint-twin/{sub(/^Boot/,"",$1); sub(/\*$/,"",$1); print $1; exit}')
if [ -n "$TWIN_BOOTNUM" ]; then
  case ",$BOOT_ORDER_BEFORE," in
    *",$TWIN_BOOTNUM,"*) NEW_ORDER="$BOOT_ORDER_BEFORE" ;;
    *)                   NEW_ORDER="${BOOT_ORDER_BEFORE},${TWIN_BOOTNUM}" ;;
  esac
  efibootmgr -o "$NEW_ORDER" >/dev/null
fi

# ───────────────────────────── 5. HOST FSTAB ─────────────────────────────
# F5 (Jim): the host mounts scratch by LABEL=scratch (fstab line 14), not UUID — and
# mkfs.ext4 -L scratch above preserves label-continuity. Nothing to edit; the old sed
# here matched nothing and logged an update it never performed (false recital). The
# real check is that the fresh scratch mounts:
log "remounting host scratch (LABEL=scratch continuity — no fstab edit needed)..."
mount -a
findmnt /mnt/scratch >/dev/null || die "host scratch failed to remount — check /etc/fstab."

# ───────────────────────────── 6. POST-ASSERTS ─────────────────────────────
log "post-asserts..."
grep -q "UUID=${TWIN_UUID}" "$TWIN_MNT/etc/fstab"            || die "assert: twin fstab lacks twin root UUID"
grep -q "root=UUID=${TWIN_UUID}" "$TWIN_MNT/boot/grub/grub.cfg" || die "assert: twin grub.cfg does not target twin root"
[ "$(cat "$TWIN_MNT/etc/hostname")" = "$TWIN_HOSTNAME" ]      || die "assert: twin hostname wrong"
[ -L "$TWIN_MNT/etc/systemd/system/cron.service" ]            || die "assert: cron mask missing in twin"
[ -L "$TWIN_MNT/etc/systemd/system/tailscaled.service" ]      || die "assert: tailscaled mask missing in twin"
[ -f "$TWIN_MNT/boot/efi/EFI/BOOT/BOOTX64.EFI" ]              || die "assert: --removable fallback bootloader missing"
grep -q "^TWIN" "$TWIN_MNT/etc/han-twin-status" 2>/dev/null      || die "assert: han-twin-status missing or not declaring TWIN"
# M3/MNT-087: the USER layer asserted whole — every unit masked AND its original archived.
if [ -d "$USERHOME/.config/systemd/user" ]; then
  UNMASKED=$(find "$USERHOME/.config/systemd/user" -maxdepth 1 \( -name '*.service' -o -name '*.timer' \) ! -lname /dev/null | head -1)
  [ -z "$UNMASKED" ] || die "assert: user unit not masked: $UNMASKED"
  [ -n "$(ls -A "$USERHOME/.config/systemd/user.pre-twin-masked" 2>/dev/null)" ] || die "assert: user.pre-twin-masked archive is EMPTY — preservation did not run"
fi
# M1: the default boot must still be the original.
ORDER_NOW=$(efibootmgr | awk -F': ' '/^BootOrder/{print $2}')
[ "${ORDER_NOW%%,*}" = "${BOOT_ORDER_BEFORE%%,*}" ] || die "assert: BootOrder default changed (${ORDER_NOW}) — restore ${BOOT_ORDER_BEFORE} by hand (efibootmgr -o)."
umount "$TWIN_MNT/boot/efi"; umount "$TWIN_MNT"

log "DONE. The twin is built and dormant. Default boot unchanged (${ORDER_NOW})."
cat <<NEXT

  Boot test (the real acceptance, at your leisure — by CHOICE via F12, never ambush):
    reboot -> BIOS boot menu (F12) -> 'mint-twin' (or the second NVMe's fallback entry)
    -> log in -> the banner announces han-twin -> hostname says han-twin
    -> NO garden services running -> shut down -> boot the original normally.

  Standing law: NEVER bare-rsync onto the twin (the refresh trap).
  Refresh ONLY via: sudo bash ~/Projects/han/scripts/refresh-twin.sh
  Verify anytime (read-only): sudo bash ~/Projects/han/scripts/refresh-twin.sh verify
  Restart when ready: sudo systemctl start cron
    and (as darron): systemctl --user start jemma wm-sensor leo-heartbeat tenshi-heartbeat casey-heartbeat
NEXT
