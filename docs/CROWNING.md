# CROWNING.md — the UNMASK ceremony (making the twin the live HAN)

> **When to use this file:** the original HAN drive is dead, corrupted, or gone, and you have
> booted (or are about to boot) the **twin** — the drive that announces itself as `han-twin`
> with the red HAN-TWIN login screen and zero garden services. This ceremony converts it from
> locked understudy into the live garden. **Real recovery only — never run this as a test.**
>
> Canonical source: the `UNMASK` header block in `~/Projects/han/scripts/refresh-twin.sh`
> (this file mirrors it; if they ever disagree, the script header + the Succession Law
> section of `plans/mint22-migration-runbook.md` win — then fix this file).
> Companion for the farther fall (no bootable twin survived either): `docs/RESURRECTION.md`
> + the vault drive in the drawer + the password in your pocket.

---

## The floor — read this first, because it is the most important sentence here

**This ceremony deletes nothing.** Every step either removes a lock or puts a preserved file
back where it lived. If you get confused, **stop mid-ceremony** — a half-unmasked twin is
safe to leave overnight, and finishing in the morning is a far better night than a guessed
fix at 4am. The only way to lose something tonight is to let **both** drives run alive —
which is why Step 0 comes first.

## Getting there — how you arrive at the twin at all

- **If the original drive is dead or missing:** the box falls through the boot order and
  boots the twin **by itself**. You'll arrive at the red HAN-TWIN login screen.
- **If the original half-boots, hangs, or loops:** power-cycle, press **F12** during the
  splash, choose the **`mint-twin`** entry. The twin announces itself — red warning
  background, hostname `han-twin`.
- Log in as `darron`, same password as always.

## Step −1 — confirm which room you are standing in (before anything else)

```bash
cat /etc/han-twin-status    # MUST say: TWIN — subordinate copy, masked, …
hostname                    # MUST say: han-twin
```
**If the file is missing, you are on the ORIGINAL — stop. This ceremony is not for the room
you are in.** (Confusing errors at Step 1 are the same tell: `No such file` on all four
masks means wrong room, not broken twin — come back here.)

## What you are looking at — why everything seems locked

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

> Form of each step: **the command · what you should see · what to do if you see anything
> else.** Success is often silent — where it is, the step says so, so silence never has to
> be interpreted at 3am.

**Step 0 — REVOKE THE PREDECESSOR FIRST (succession needs abdication).**
If the original disk is present at all — even seemingly dead — it must not be able to wake
beside the crowned twin. Two live gardens on one LAN is the exact collision every lock above
exists to prevent. **Do not skip this because the original "looks dead."**

*Preferred: physically disconnect it.* The sticker on the drive is the one identifier that
survives enumeration flips, dead firmware, and fear: **the original is the Samsung SSD
980 PRO; the twin is the WD_BLACK SN850X. Pull the Samsung.** *(These model↔role lines are
role values — they swap at a re-consecration and join Step 7's edit list + second-seat
verify.)*

*If you cannot open the case tonight, mask it in place instead:*
```bash
sudo mkdir -p /mnt/original
sudo mount /dev/disk/by-uuid/d5a37330-7c4a-4df9-a4d8-d9f99c44aac5 /mnt/original
for u in cron docker containerd tailscaled; do
  sudo ln -sf /dev/null /mnt/original/etc/systemd/system/$u.service
done
sudo rm -f /mnt/original/var/lib/systemd/linger/darron
sudo umount /mnt/original
```
*You should see:* silence from every line. *If the `mount` says the UUID doesn't exist,* the
original really is gone from the bus — that IS your revocation; continue. *(The UUID is the
original-root role value — Step 7's edit list at a re-consecration.)*

**Step 1 — remove the system drill-masks:**
```bash
sudo rm /etc/systemd/system/{cron,docker,containerd,tailscaled}.service
```
*You should see:* nothing — silent is success. *If it says `No such file` for all four:*
either the masks are already gone (a resumed ceremony) or you are in the wrong room — go
back to Step −1 before touching anything else.

**Step 2 — restore the user units (the real files were preserved; one `mv` each):**
```bash
ls ~/.config/systemd/user.pre-twin-masked/     # SIGHT FIRST: you should see the garden's unit files
for f in ~/.config/systemd/user.pre-twin-masked/*; do
  base=$(basename "$f")
  rm -f ~/.config/systemd/user/"$base"
  mv "$f" ~/.config/systemd/user/"$base"
done
ls ~/.config/systemd/user.pre-twin-masked/     # AFTER: should be empty
```
*You should see:* unit files in the first `ls`, an empty directory in the second. *If the
first `ls` says no such directory:* the archive is missing — **stop here**; the garden's
memory is safe on disk, and this wants a calm look, not a 3am improvisation.

**Step 3 — restore your crontab:**
```bash
sudo mv /var/spool/cron/crontabs/darron.pre-twin-masked /var/spool/cron/crontabs/darron
```
*You should see:* silence. *If `No such file`:* no crontab was parked — fine, continue.

**Step 4 — re-enable linger:**
```bash
sudo loginctl enable-linger darron
```
*You should see:* silence — silent is success.

**Step 5 — CROWN (the single act that flips every guard):**
```bash
echo "CROWNED $(date -Iseconds) — predecessor revoked step 0" | sudo tee /etc/han-twin-status
```
*You should see:* **the command prints the CROWNED line back to you — that is it written.**
From this line: the launchers pass, and `refresh-twin.sh` will **refuse to run onto this
drive** (Tenshi's rider) — a stale original can never rsync the live garden away.

**Step 6 — reload and reboot:**
```bash
sudo systemctl daemon-reload && sudo reboot
```
*You should see:* the box goes down and comes back up — into the crowned twin (it is the
default now if the original was pulled; otherwise pick it at F12 one last time).

**Step 7 — THE SUCCESSION (Darron's ruling, 2026-08-07, commit `55f1e39`).**

> **Steps 0–6 are tonight's work. Step 7 is for later, in daylight, with the family awake.**

The crowned drive **IS HAN's drive** from this moment — not a recovered copy. The old
original, once repaired and present, becomes the **HEIR**: re-consecrate it as the new twin
by re-running the consecration *against it* — edit the `PIN_*` UUIDs in the twin scripts to
the old original's actual **partition UUIDs**; the disk **derives** from them (they are
**per-consecration role values, never eternal identities** — device names are boot-scoped
and never typed; the model↔role sticker lines in Step 0 swap here too). At any
re-consecration, **state the new `PIN_*` values on the thread and have a second seat verify
them against live `blkid` output before any destructive invocation** — the second seat is
the only independent witness at that moment. Then `make-twin.sh` it. Re-sync always runs
**crowned → heir**. A later deliberate revert to the larger drive as HAN is **its own
ceremony** (consecrate-heir → refresh crowned→heir → crown → roles reverse again), never an
ad-hoc rsync.

---

## After the reboot — sanity checks

```bash
hostname                      # still han-twin (rename is optional, not required)
cat /etc/han-twin-status      # CROWNED <date> …
systemctl --user status jemma wm-sensor leo-heartbeat   # garden services coming up
curl -sk https://localhost:3847/api/ecosystem | head -c 200   # the API answers
```
*You should see:* services `active (running)` and JSON from the curl. **Give them two
minutes first** — the garden takes a moment to stand. *If something stays red after that:*
**stop there.** The garden's memory is safe on disk; a half-crowned twin in the morning is
a far better night than a guessed fix at 4am.

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
riding Tailscale cannot reach a twin. Use the LAN directly: `hostname -I` on the twin
prints its address; `ssh darron@<that-address>` from the MacBook. Tailscale returns with
the crowning (step 1 unmasks it).

---

*Written 2026-08-07 (Leo, session) at Darron's ask; plain-reader pass by Casey the same
night (the triple rule, Step −1, the equipped Step 0, the floor, the daylight fence — her
folds, her reader: 3am, frightened, shaking hands). Mirrors `refresh-twin.sh`'s UNMASK
header; landed `34fd317`+. Delivery to the twin's Desktop rides the splash re-apply diff —
until the twin's next refresh, the bad-night reader on the twin has the script header,
which is canonical and complete.*
