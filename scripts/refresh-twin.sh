#!/usr/bin/env bash
# refresh-twin.sh — bring the bootable twin up to date WITHOUT un-twinning it
#
# THE REFRESH TRAP (why this script exists — my twin-review, msb5c2tb):
# a bare `rsync / -> twin` CLOBBERS the twin's fstab with the ORIGINAL's identity —
# the twin silently becomes a mirror that boots back into the original, and nobody
# would check until the drill that needed it. Refresh is therefore ONE SCRIPTED ACT:
# rsync + re-twin-isation, never separable. Run BY DARRON'S HAND with sudo:
#   sudo bash ~/Projects/han/scripts/refresh-twin.sh                  # refresh
#   sudo bash ~/Projects/han/scripts/refresh-twin.sh verify           # read-only check
#   sudo bash ~/Projects/han/scripts/refresh-twin.sh --reinstall-grub # after a distro/kernel hop
#
# AUDIT FOLD 2026-08-06 (Leo, from the three-chair audits of 2026-08-02):
#   Casey F2   — rsync --exclude=/boot/grub/grub.cfg (no --delete-excluded): the twin's
#                cfg keeps its OWN identity through the whole copy; the crash window
#                leaves a stale-but-twin-aimed twin, never an armed trap. (Jim N1's
#                header line kept below as the belt.)
#   Jim M2/M3, Tenshi B1/B3, F4, N3, n3 — as in make-twin.sh (shared gates + masks).
#   Tenshi n4  — --reinstall-grub mode: after a distro upgrade the ESP's GRUB core is
#                stale while grub.cfg regenerates newer; this leg re-installs both
#                (named entry + --removable) and restores BootOrder (M1).
#   MNT-087    — 'verify' mode: the viability test the twin never had. Read-only:
#                mounts the twin, runs every post-assert, reports rsync drift count.
#                Run it on a schedule or before any planned boot test.
#
# N1 (Jim): a refresh that dies mid-flight MUST be re-run to completion before any
# twin boot — the post-asserts only certify a COMPLETED pass.
#
# UNMASK (REAL-RECOVERY-ONLY — not part of any refresh):
#   Booted INTO the twin during a genuine recovery, to make it the live garden:
#     0. REVOKE THE PREDECESSOR FIRST (Casey F3 — succession needs abdication):
#        if the original disk is present and readable, mount it and plant these same
#        drill-masks on IT (run the mask block against its root) — or physically
#        disconnect it. A half-dead original that later boots is two live gardens
#        on one LAN: the exact collision the masks exist to prevent.
#     1. sudo rm /etc/systemd/system/{cron,docker,containerd,tailscaled}.service
#     2. restore ~/.config/systemd/user units: the REAL files are archived in
#        ~/.config/systemd/user.pre-twin-masked/ — remove each /dev/null symlink and
#        mv the archived unit back (preserve-then-mask, so this is one mv per unit).
#     3. sudo mv /var/spool/cron/crontabs/darron.pre-twin-masked /var/spool/cron/crontabs/darron
#     4. sudo loginctl enable-linger darron
#     5. CROWN — rewrite the status file so the launchers pass and the record shows it:
#          echo "CROWNED $(date -Iseconds) — predecessor revoked step 0" | sudo tee /etc/han-twin-status
#     6. sudo systemctl daemon-reload && reboot
#   Do this ONLY when the original is truly lost or masked/disconnected.

set -euo pipefail

TARGET_DISK="/dev/nvme1n1"
HOST_ROOT_UUID="d5a37330-7c4a-4df9-a4d8-d9f99c44aac5"   # must be what we run FROM
PIN_SWAP_UUID="56a75d81-f033-4f06-b189-c29bb6963c37"
TWIN_HOSTNAME="han-twin"
TWIN_MNT="/mnt/twin"
MODE="${1:-refresh}"

log() { printf '\n\033[1;36m[refresh-twin]\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m[refresh-twin] FATAL:\033[0m %s\n' "$*" >&2; exit 1; }

# ── Preflight ──
[ "$(id -u)" = 0 ] || die "run with sudo (Darron's hand)."
case "$MODE" in refresh|verify|--reinstall-grub) ;; *) die "usage: refresh-twin.sh [refresh|verify|--reinstall-grub]";; esac
CUR_ROOT_UUID=$(findmnt -no UUID /) || die "cannot read root UUID"
[ "$CUR_ROOT_UUID" = "$HOST_ROOT_UUID" ] || die "running root is not the original — NEVER refresh from the twin."

# Find the twin by its LABEL (partition numbers may shift; the label is the pin).
TWIN_DEV=$(blkid -L twin) || die "no partition labelled 'twin' — has make-twin.sh run?"
TWIN_ESP_DEV=$(blkid -L TWINESP 2>/dev/null || blkid -t LABEL=TWINESP -o device | head -1) || die "twin ESP not found"
case "$TWIN_DEV" in "$TARGET_DISK"*) ;; *) die "twin label found on unexpected disk: $TWIN_DEV";; esac
# N3 (Jim): the ESP must sit on the pinned disk too.
case "$TWIN_ESP_DEV" in "$TARGET_DISK"*) ;; *) die "twin ESP on unexpected disk: $TWIN_ESP_DEV";; esac

USERHOME="$TWIN_MNT/home/darron"

run_asserts() {
  TWIN_UUID_A=$(blkid -s UUID -o value "$TWIN_DEV")
  grep -q "UUID=${TWIN_UUID_A}" "$TWIN_MNT/etc/fstab"               || die "assert: twin fstab lost its own root UUID"
  grep -q "root=UUID=${TWIN_UUID_A}" "$TWIN_MNT/boot/grub/grub.cfg" || die "assert: twin grub.cfg re-aimed at the original (THE TRAP) — do not boot it"
  [ "$(cat "$TWIN_MNT/etc/hostname")" = "$TWIN_HOSTNAME" ]          || die "assert: twin hostname lost"
  [ -L "$TWIN_MNT/etc/systemd/system/cron.service" ]                || die "assert: cron mask lost"
  [ -L "$TWIN_MNT/etc/systemd/system/tailscaled.service" ]          || die "assert: tailscaled mask lost"
  if [ -d "$USERHOME/.config/systemd/user" ]; then
    UNMASKED=$(find "$USERHOME/.config/systemd/user" -maxdepth 1 \( -name '*.service' -o -name '*.timer' \) ! -lname /dev/null | head -1)
    [ -z "$UNMASKED" ] || die "assert: user unit not masked: $UNMASKED"
    [ -n "$(ls -A "$USERHOME/.config/systemd/user.pre-twin-masked" 2>/dev/null)" ] || die "assert: user.pre-twin-masked archive is EMPTY"
  fi
  [ ! -f "$TWIN_MNT/var/lib/systemd/linger/darron" ]                || die "assert: linger present on twin"
  grep -q "^TWIN\|^CROWNED" "$TWIN_MNT/etc/han-twin-status" 2>/dev/null || die "assert: han-twin-status missing/ambiguous (the launcher guard would refuse ambiguity — so do we)"
}

# ── VERIFY MODE (MNT-087's viability test — read-only, run anytime) ──
if [ "$MODE" = "verify" ]; then
  mkdir -p "$TWIN_MNT"
  mountpoint -q "$TWIN_MNT" || mount -o ro "$TWIN_DEV" "$TWIN_MNT"
  MOUNTED_EFI=0
  if ! mountpoint -q "$TWIN_MNT/boot/efi"; then mount -o ro "$TWIN_ESP_DEV" "$TWIN_MNT/boot/efi" && MOUNTED_EFI=1; fi
  run_asserts
  log "asserts PASS. Measuring drift (dry-run, no writes)..."
  set +e
  DRIFT=$(rsync -aHAXxn --delete --out-format='%n' \
    --exclude=/proc/ --exclude=/sys/ --exclude=/dev/ --exclude=/run/ \
    --exclude=/tmp/ --exclude=/mnt/ --exclude=/media/ --exclude=/lost+found \
    --exclude=/swapfile --exclude=/boot/efi/ --exclude=/boot/grub/grub.cfg \
    --exclude=/etc/fstab --exclude=/etc/hostname --exclude=/etc/hosts \
    --exclude='/home/darron/.config/systemd/user*' \
    / "$TWIN_MNT"/ 2>/dev/null | wc -l)
  set -e
  [ "$MOUNTED_EFI" = 1 ] && umount "$TWIN_MNT/boot/efi"
  umount "$TWIN_MNT"
  log "VERIFY PASS — the twin is a twin. Drift vs live root: ${DRIFT} paths (refresh when it matters)."
  exit 0
fi

# ── Quiesce gates — same law as the build: a moving source makes a torn copy ──
systemctl is-active --quiet cron && die "cron is running — stop it first: sudo systemctl stop cron (restart after)."
GARDEN_ACTIVE=$(runuser -u darron -- env XDG_RUNTIME_DIR=/run/user/1000 \
  systemctl --user list-units --state=active --plain --no-legend \
  'jemma.service' 'wm-sensor.service' '*-heartbeat.service' 'human-responder@*.service' \
  2>/dev/null | awk '{print $1}' | tr '\n' ' ' || true)
[ -z "${GARDEN_ACTIVE// /}" ] || die "garden writers active: ${GARDEN_ACTIVE} — stop them first (as darron):
  systemctl --user stop jemma wm-sensor leo-heartbeat tenshi-heartbeat casey-heartbeat 'human-responder@*'
  (restart after; leave han-tmux UP — warm stems hold R011)"
BUSY=$(find /home/darron/.han/signals -maxdepth 1 -name 'cli-busy-*' -mmin -5 2>/dev/null | head -1 || true)
[ -z "$BUSY" ] || die "an agent seat is mid-turn ($BUSY, fresher than 5 min) — let it finish, then re-run."

mkdir -p "$TWIN_MNT"
mountpoint -q "$TWIN_MNT" || mount "$TWIN_DEV" "$TWIN_MNT"
TWIN_UUID=$(blkid -s UUID -o value "$TWIN_DEV")
TWIN_ESP_UUID=$(blkid -s UUID -o value "$TWIN_ESP_DEV")

# Sanity: the mounted thing must LOOK like a twin (twin fstab backup present).
[ -f "$TWIN_MNT/etc/fstab.pre-twin.bak" ] || [ -f "$TWIN_MNT/etc/profile.d/00-twin-banner.sh" ] \
  || die "target does not look like a built twin — refusing."

# M1: capture BootOrder before any grub-install this run might do.
BOOT_ORDER_BEFORE=$(efibootmgr | awk -F': ' '/^BootOrder/{print $2}')

log "refreshing twin content (rsync, deletions mirrored, grub.cfg protected)..."
# Casey F2: --exclude=/boot/grub/grub.cfg + no --delete-excluded → the twin's cfg is
# untouchable by the copy; regenerated in its own name by the chroot below.
set +e
rsync -aHAXx --delete --info=progress2 \
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

# ── RE-TWIN-ISE (the half a bare rsync destroys — every time, same act) ──
log "re-applying twin identity (fstab, hostname, masks, banner)..."
cat > "$TWIN_MNT/etc/fstab" <<FSTAB
# fstab — ${TWIN_HOSTNAME} (regenerated by refresh-twin.sh $(date -Iseconds))
UUID=${TWIN_UUID}      /          ext4  errors=remount-ro  0 1
UUID=${TWIN_ESP_UUID}  /boot/efi  vfat  umask=0077         0 1
UUID=${PIN_SWAP_UUID}  none       swap  sw                 0 0
FSTAB
echo "$TWIN_HOSTNAME" > "$TWIN_MNT/etc/hostname"
sed -i "s/$(cat /etc/hostname)/${TWIN_HOSTNAME}/g" "$TWIN_MNT/etc/hosts"
for unit in cron docker containerd tailscaled; do
  ln -sf /dev/null "$TWIN_MNT/etc/systemd/system/${unit}.service"
done
# Preserve-then-mask (M3/B3/F1): the rsync above re-imported the original's REAL unit
# files (and --delete removed the previous archive) — so archive THIS pass's copies
# fresh, then mask. Fail-loud per unit (MNT-087).
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
if [ -f "$TWIN_MNT/var/spool/cron/crontabs/darron" ]; then
  mv "$TWIN_MNT/var/spool/cron/crontabs/darron" "$TWIN_MNT/var/spool/cron/crontabs/darron.pre-twin-masked"
fi
cat > "$TWIN_MNT/etc/han-twin-status" <<STATUS
TWIN — subordinate copy, masked, not crowned; refreshed $(date -Iseconds) from $(cat /etc/hostname); see msb5c2tb
STATUS
cat > "$TWIN_MNT/etc/profile.d/00-twin-banner.sh" <<'BANNER'
echo "==============================================="
echo "  THIS IS han-twin — THE BOOTABLE TWIN."
echo "  Garden services are MASKED here by design."
echo "  Real recovery: see refresh-twin.sh UNMASK notes."
echo "==============================================="
BANNER

log "regenerating the twin's grub from ITS OWN chroot..."
mountpoint -q "$TWIN_MNT/boot/efi" || mount "$TWIN_ESP_DEV" "$TWIN_MNT/boot/efi"
for fs in dev dev/pts proc sys sys/firmware/efi/efivars run; do
  mount --bind "/$fs" "$TWIN_MNT/$fs" 2>/dev/null || true
done
if [ "$MODE" = "--reinstall-grub" ]; then
  # Tenshi n4: after a distro/kernel hop the ESP's GRUB core is stale — reinstall both.
  chroot "$TWIN_MNT" grub-install --target=x86_64-efi --efi-directory=/boot/efi \
    --bootloader-id=mint-twin --recheck
  chroot "$TWIN_MNT" grub-install --target=x86_64-efi --efi-directory=/boot/efi --removable
fi
chroot "$TWIN_MNT" update-grub
for fs in run sys/firmware/efi/efivars sys proc dev/pts dev; do
  umount "$TWIN_MNT/$fs" 2>/dev/null || true
done

# M1: if a grub-install ran, restore the original-first boot order and assert.
if [ "$MODE" = "--reinstall-grub" ] && [ -n "$BOOT_ORDER_BEFORE" ]; then
  TWIN_BOOTNUM=$(efibootmgr | awk '/mint-twin/{sub(/^Boot/,"",$1); sub(/\*$/,"",$1); print $1; exit}')
  if [ -n "$TWIN_BOOTNUM" ]; then
    case ",$BOOT_ORDER_BEFORE," in
      *",$TWIN_BOOTNUM,"*) NEW_ORDER="$BOOT_ORDER_BEFORE" ;;
      *)                   NEW_ORDER="${BOOT_ORDER_BEFORE},${TWIN_BOOTNUM}" ;;
    esac
    efibootmgr -o "$NEW_ORDER" >/dev/null
  fi
  ORDER_NOW=$(efibootmgr | awk -F': ' '/^BootOrder/{print $2}')
  [ "${ORDER_NOW%%,*}" = "${BOOT_ORDER_BEFORE%%,*}" ] || die "assert: BootOrder default changed (${ORDER_NOW}) — restore ${BOOT_ORDER_BEFORE} by hand."
fi

# ── Post-asserts: the twin must still be a TWIN after the refresh ──
run_asserts
umount "$TWIN_MNT/boot/efi" 2>/dev/null || true
umount "$TWIN_MNT"

log "DONE. Twin refreshed and still itself. Restart cron: sudo systemctl start cron"
log "  and (as darron): systemctl --user start jemma wm-sensor leo-heartbeat tenshi-heartbeat casey-heartbeat"
