# CROWNING.md — the UNMASK ceremony (making the twin the live HAN)

> **When to use this file:** the original HAN drive is dead, corrupted, or gone, and you have
> booted (or are about to boot) the **twin** — the drive that announces itself as `han-twin`
> with the TWIN banner and zero garden services. This ceremony converts it from locked
> understudy into the live garden. **Real recovery only — never run this as a test.**
>
> Canonical source: the `UNMASK` header block in `~/Projects/han/scripts/refresh-twin.sh`
> (this file mirrors it; if they ever disagree, the script header + the Succession Law
> section of `plans/mint22-migration-runbook.md` win — then fix this file).
> Companion for the farther fall (no bootable twin survived either): `docs/RESURRECTION.md`
> + the vault drive in the drawer + the password in your pocket.

---

## Before you start — what you are looking at

A twin boots **deliberately locked**, four layers deep:

1. **System drill-masks** — cron, docker, containerd, tailscaled masked (tailscaled because
   two boxes claiming one tailnet node collide on the LAN).
2. **User units preserved-then-masked** — every garden service was **moved whole** into
   `~/.config/systemd/user.pre-twin-masked/` and replaced by a mask. Nothing was deleted.
3. **Your crontab** parked as `/var/spool/cron/crontabs/darron.pre-twin-masked`.
4. **The status file** `/etc/han-twin-status` declaring `TWIN` — all six `han*` launchers
   refuse while it says that, so the garden cannot start here even by hand.

The locks are the twin's standing state, not a test fixture. This ceremony is the one
sanctioned way they come off.

---

## The seven steps

**Step 0 — REVOKE THE PREDECESSOR FIRST (succession needs abdication).**
If the original disk is present and readable at all: either **physically disconnect it**,
or mount it and plant these same drill-masks on *its* root (run the mask block against it).
A half-dead original that later boots beside a crowned twin is two live gardens on one
LAN — the exact collision every lock above exists to prevent. Do not skip this because the
original "looks dead."

**Step 1 — remove the system drill-masks:**
```bash
sudo rm /etc/systemd/system/{cron,docker,containerd,tailscaled}.service
```

**Step 2 — restore the user units (one `mv` per unit; the real files were preserved):**
```bash
cd ~/.config/systemd/user
# remove each /dev/null symlink, then move the archived unit back:
for f in ~/.config/systemd/user.pre-twin-masked/*; do
  base=$(basename "$f")
  rm -f ~/.config/systemd/user/"$base"
  mv "$f" ~/.config/systemd/user/"$base"
done
```

**Step 3 — restore your crontab:**
```bash
sudo mv /var/spool/cron/crontabs/darron.pre-twin-masked /var/spool/cron/crontabs/darron
```

**Step 4 — re-enable linger:**
```bash
sudo loginctl enable-linger darron
```

**Step 5 — CROWN (the single act that flips every guard):**
```bash
echo "CROWNED $(date -Iseconds) — predecessor revoked step 0" | sudo tee /etc/han-twin-status
```
From this line: the launchers pass, and `refresh-twin.sh` will **refuse to run onto this
drive** (Tenshi's rider) — a stale original can never rsync the live garden away.

**Step 6 — reload and reboot:**
```bash
sudo systemctl daemon-reload && sudo reboot
```

**Step 7 — THE SUCCESSION (Darron's ruling, 2026-08-07, commit `55f1e39`).**
The crowned drive **IS HAN's drive** from this moment — not a recovered copy. The old
original, once repaired and present, becomes the **HEIR**: re-consecrate it as the new twin
by re-running the consecration *against it* — edit the `PIN_*` UUIDs in the twin scripts to
the old original's actual **partition UUIDs**; the disk **derives** from them (they are
**per-consecration role values, never eternal identities** — device names are boot-scoped
and never typed). At any re-consecration, **state the new `PIN_*` values on the thread and
have a second seat verify them against live `blkid` output before any destructive
invocation** — the second seat is the only independent witness at that moment. Then
`make-twin.sh` it. Re-sync always runs **crowned → heir**. A later deliberate revert to the
larger drive as HAN is **its own ceremony** (consecrate-heir → refresh crowned→heir → crown
→ roles reverse again), never an ad-hoc rsync.

---

## After the reboot — sanity checks

```bash
hostname                      # should still say han-twin (rename is optional, not required)
cat /etc/han-twin-status      # CROWNED <date> …
systemctl --user status jemma wm-sensor leo-heartbeat   # garden services coming up
curl -sk https://localhost:3847/api/ecosystem | head -c 200   # the API answers
```
Then wake an agent (`hanleo`) — the launchers now pass — and let the wake protocol's
swap-check + memory load tell you how current the garden's memory is (the twin is only as
fresh as its last refresh; say so honestly in the first conversation rather than papering
the gap).

**Cosmetics after crowning (optional):** the post-login twin splash retires itself the
moment the status file says CROWNED — no action needed. The red greeter background is
static; remove it whenever convenient:
```bash
sudo rm -f /etc/lightdm/slick-greeter.conf /usr/share/backgrounds/han-twin-banner.png \
  /etc/xdg/autostart/han-twin-banner.desktop /usr/local/bin/han-twin-banner.sh
```

**Remote access while twinned (for reference):** `sshd` runs on a twin — but `tailscaled`
is masked (two boxes claiming one tailnet node collide), so VS Code Remote / anything
riding Tailscale cannot reach a twin. Use the LAN directly: `ssh darron@<lan-ip>` (find it
on the twin with `ip -4 a`). Tailscale returns with the crowning (step 1 unmasks it).

---

*Written 2026-08-07 (Leo, session) at Darron's ask for a bad-night reference file; mirrors
`refresh-twin.sh`'s UNMASK header verbatim-faithful. This file reaches the twin at its next
refresh; until then the twin already carries the same steps inside `refresh-twin.sh` itself.*
