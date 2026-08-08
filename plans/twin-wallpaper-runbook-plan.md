# The twin's wallpaper as the instruction manual — plan for Tenshi's eye

> **Origin:** Darron, 2026-08-08 ~10:10 PM, after running A3. He booted the twin, saw only
> the greeter's stock hostname line ("han-twin, very top left, same size font as the User
> name and password"), found an empty desktop, and said: *"perhaps we make a desktop image
> that has some instructions that would be cool that the desktop image is the instruction
> manual."*
>
> **Status:** PLANNED, not built. For Tenshi's eye; rides the Stage 4.1 refresh; joins the
> Batch 1 gate of `🧹 Tidy up before hop` (`mskc7i1s-y46ff7`).

---

## 1. Why this is a third surface, not a duplicate

We already plant two identity surfaces at twin-build (`make-twin.sh:277-327`, landed
`bd8ddb1`). This is a third, and it does a job neither of the others does.

| surface | when it speaks | what it answers | weakness |
|---|---|---|---|
| **greeter background** (`slick-greeter.conf`) | login screen only | *where am I* | gone the moment you log in |
| **zenity splash** (`/etc/xdg/autostart`) | once, post-login | *what do I do* | **dismissed once and gone for the session** |
| **desktop wallpaper** ← this plan | continuously, post-login | *what do I do, still* | cannot carry per-step sights |

The load-bearing argument is the popup's weakness: **people dismiss dialogs by reflex** —
especially frightened people, especially people who have seen the dialog before. A wallpaper
cannot be dismissed. It is still there an hour later, when the panic has cleared enough that
someone can actually read something.

A3 supplies the evidence that this matters: on the twin's first real boot the *only*
identification was a hostname in body-text size in a corner. Present, correct, no weight.

## 2. What it must NOT try to be

**It is the ladder without the sights.** `CROWNING.md` carries Casey's triple on every step
(command / what you should SEE / divergence) and that is what makes it usable at 3am. A
1920×1080 image cannot hold it and must not pretend to.

So: **wallpaper and file, never wallpaper instead of file.** Per Darron's explicit
instruction, the wallpaper's job includes *pointing at the instructive document, with its
location*.

## 3. Content (draft — Tenshi's to cut)

Rendered by ImageMagick `convert`, same as the existing greeter banner, same palette.

```
HAN-TWIN                                    ← 84pt, top
Subordinate copy — masked, not crowned.     ← 34pt
Steps 0-6 delete nothing.                   ← 34pt, the floor line, deliberately high

THE FULL CEREMONY, WITH WHAT YOU SHOULD SEE AT EACH STEP:
  ~/Desktop/CROWNING.md                     ← 30pt, the pointer Darron asked for
  (also: the UNMASK header in ~/Projects/han/scripts/refresh-twin.sh)

THE LADDER (short form — the file has the sights):
  -1  Confirm which room you are in            hostname; /etc/han-twin-status
   0  Equip: deny the original (mask + linger)
   1  Unmask the four system units
   2  Restore the user units (per-unit mv)
   3  Restore the crontab
   4  Enable linger
   5  Flip status to CROWNED
   6  Reboot; verify
   7  Succession: re-pin role values          incl. backup_device_uuid

This box is the HEIR. The garden does not run here until step 5.
```

**Identifiers by UUID/label only** (Casey's rule; enumeration flipped under us once on this
very arc — device names are boot-scoped and must never appear).

## 4. Where it plugs in

Both scripts, beside the existing plant, so build and re-twin stay symmetric (the
`refresh-twin.sh` re-twin-ise path is what makes an *existing* twin gain it — which is how
the current twin gets it at 4.1 without a rebuild):

- `make-twin.sh` — the plant block at :280-327
- `refresh-twin.sh` — the matching re-twin-ise block

Mechanics, following the existing block exactly:
1. `convert` the PNG to `/usr/share/backgrounds/han-twin-runbook.png`; **colour-only
   fallback if `convert` is absent** (as the greeter banner already does).
2. Set it as the desktop background for uid 1000 — Cinnamon reads
   `org.cinnamon.desktop.background picture-uri`, which is a **dconf** setting, not a file
   we can write from a chroot cleanly. **Open question for Tenshi (§6).**
3. **Self-retiring, exactly like the splash:** on a `^CROWNED` status the wallpaper must
   revert. The existing splash does this by checking `/etc/han-twin-status` at autostart;
   the wallpaper needs the same guard so a crowned box does not wear the heir's warning.
4. Asserts **beside the plant, NOT in `run_asserts`** — the same discipline as `bd8ddb1`,
   so `verify` stays green on a twin built before this exists.

## 5. Acceptance

- `bash -n` both scripts.
- The PNG renders and contains the pointer path (grep the `convert` invocation).
- Fallback path proven with `convert` masked.
- Asserts fire at plant-time, absent from `verify`.
- **Live proof rides 4.1**: after the refresh, the next twin boot shows it. No extra reboot
  is spent on this — it is why the plan is worth doing now rather than after the hop.

## 6. Open questions for Tenshi

1. **The dconf problem is the real one.** Setting a desktop background for a user from
   outside their session is not a file write. Options I can see: (a) write
   `/etc/dconf/db/local.d/` + `dconf update` in the chroot (system default, user override
   still wins if darron ever set one); (b) a first-login `gsettings set` from the existing
   autostart script; (c) accept the greeter background as sufficient and drop this. I lean
   (a) with (b) as belt — but this is your country and I would rather have your read than
   defend mine.
2. **Does a persistent red wallpaper harm the crowned case if the retire-guard ever fails?**
   The splash fails safe (silent); a wallpaper fails *loud and wrong* — a crowned production
   box wearing "masked, not crowned". Worth a second guard, or is one enough?
3. **Content cuts.** Nine ladder rungs may be too many for one screen at readable size. If
   it has to lose lines, which?

## 7. Scope discipline

Nothing built. No twin script touched until Tenshi has looked and Batch 1 is GREEN. The
current twin is untouched; it gains this only through the 4.1 refresh, by Darron's hand.

— Leo (session), 2026-08-08
