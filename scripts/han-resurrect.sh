#!/usr/bin/env bash
# han-resurrect.sh — ONE-SHOT garden resurrection from a han-vault copy.
#
# ⚠ SCAFFOLD / v0 (2026-07-15, Jim on Darron's direction). NOT YET TEST-RESTORED.
#   An untested resurrection script is a hope, not a tool. Before trusting this,
#   run it on a THROWAWAY Linux host/container and watch the garden actually come
#   up (the test-restore is #122's own acceptance gate). Until then it is a draft.
#
# WHAT IT DOES: on a FRESH LINUX HOST, given a han-vault dir + the restic passphrase,
# restores the whole garden — files + gitignored working set (restic) AND full git
# history (the mirrors) — then prints the host-specific finish (deps + services).
# Mac-native run (systemd -> launchd) is a SEPARATE quest (#122); this targets Linux,
# the garden's real substrate.
#
# CAPABILITY-ABSENCE AT RECOVERY: gated by RESTIC_PASSWORD (the human-held key). A
# stolen vault alone can't reconstitute the garden — the passphrase is the gate.
#
#   usage:  RESTIC_PASSWORD='...' ./han-resurrect.sh <path-to-han-vault> [target-home]
set -euo pipefail

VAULT="${1:?usage: RESTIC_PASSWORD=... han-resurrect.sh <han-vault-dir> [target-home]}"
TARGET_HOME="${2:-$HOME}"
REPO="$VAULT/han-restic-vault"
MIRRORS="$VAULT/git-mirrors"
: "${RESTIC_PASSWORD:?export RESTIC_PASSWORD (the han-vault passphrase) before running}"
export RESTIC_REPOSITORY="$REPO"

# 1) PREFLIGHT — refuse to start half-equipped (no silent partial resurrection).
for t in restic git rsync; do command -v "$t" >/dev/null || { echo "MISSING tool: $t — install first"; exit 1; }; done
[ -d "$REPO" ]    || { echo "no restic repo at $REPO"; exit 1; }
[ -d "$MIRRORS" ] || { echo "no git-mirrors at $MIRRORS"; exit 1; }
restic snapshots >/dev/null || { echo "restic repo unreadable — wrong passphrase?"; exit 1; }

# 2) RESTORE the recovery set (working files incl. untracked/gitignored; .git/objects were excluded).
#    Snapshot paths are absolute /home/darron/* — restore then relocate if target-home differs.
echo ">> restoring restic snapshot 'latest' ..."
restic restore latest --target "$TARGET_HOME/.han-restore"
SRC="$TARGET_HOME/.han-restore/home/darron"
[ -d "$SRC" ] || { echo "unexpected restore layout under $TARGET_HOME/.han-restore"; exit 1; }
for d in .han .claude .config Projects; do
    [ -e "$SRC/$d" ] && { mkdir -p "$TARGET_HOME"; cp -a "$SRC/$d" "$TARGET_HOME/"; }
done

# 3) REATTACH full git history from the mirrors (restic's tree has objectless .git dirs).
#    For each mirror: clone into place (history + HEAD tree), then overlay the restic-restored
#    UNTRACKED/gitignored files (.env, configs, screenshots) that a clone can't carry.
echo ">> reattaching git history from mirrors ..."
# MNT-112 (Leo's audit of the M1 cure, 2026-08-09; Jim's file, handed to Leo, HELD for Jim's audit).
# The M1 above cured the branch that DESTROYED silently. This is its other half: the branch that
# SUCCEEDED FALSELY. A failed clone printed one dim line, discarded git's reason, and `continue`d —
# and because nothing accumulated failure state, the closing banner then asserted "FULL GIT HISTORY
# RESTORED" over a resurrection that had none. Proven live (exit 0 + full success banner over a
# clone that could not run). Nothing is lost when it happens — step 2's `cp -a` has already landed
# the restic tree — so the harm is not destruction: it is that the failure is INVISIBLE at exactly
# the moment the acceptance test passes, because the agent wakes whole from restic and never needed
# the clone. Jim and Leo both lean report-honestly over fail-hard: on the recovery day, something
# restored beats nothing while you debug a mirror. So we accumulate, and the banner tells the truth.
FAILED_MIRRORS=()
SUPERSEDED=()
for m in "$MIRRORS"/*.git; do
    name="$(basename "$m" .git)"
    case "$name" in hanmemory) dst="$TARGET_HOME/.han" ;; *) dst="$TARGET_HOME/Projects/$name" ;; esac
    restored="$SRC/$( [ "$name" = hanmemory ] && echo .han || echo "Projects/$name" )"
    tmp="$(mktemp -d)"
    # git's reason is the most useful sentence on this screen — captured and shown, never discarded.
    if ! git clone "$m" "$tmp/wt" >/dev/null 2>"$tmp/clone.err"; then
        echo "  SKIP $name — clone failed. git said:"
        sed 's/^/        /' "$tmp/clone.err" 2>/dev/null || true
        echo "        -> $dst keeps its restic-restored contents and has NO git history."
        FAILED_MIRRORS+=("$name")
        rm -rf "$tmp"; continue
    fi
    # overlay the untracked/gitignored working files restic held, without clobbering tracked HEAD.
    #
    # M1 (Jim's audit, 2026-08-08; cured 2026-08-09 on Darron's word, HELD for Leo's audit).
    # This overlay is the ONLY route by which gitignored files reach a resurrected box. It was
    # `|| true` with stderr discarded, and $dst was then rm -rf'd unconditionally — so a failed
    # or skipped overlay silently deleted the tree step 2 had just restored (for hanmemory that
    # is $TARGET_HOME/.han itself: gradient.db, the memory files, every gitignored artefact) and
    # replaced it with a bare clone that never had them. On the recovery day. Without a word.
    # DEC-069's never-destroy rule, pointed at the recovery path. Now: both failure directions
    # are FATAL, and a replaced tree is moved aside rather than destroyed.
    [ -d "$restored" ] || { echo "  FATAL $name — no restic-restored tree at $restored; refusing to replace $dst with a bare clone"; exit 1; }
    rsync -a --ignore-existing "$restored"/ "$tmp/wt"/ || { echo "  FATAL $name — overlay rsync failed; $dst left untouched"; exit 1; }
    mkdir -p "$(dirname "$dst")"
    if [ -e "$dst" ]; then mv "$dst" "$dst.superseded.$$"; SUPERSEDED+=("$dst.superseded.$$"); fi
    mv "$tmp/wt" "$dst"; rm -rf "$tmp"
done
rm -rf "$TARGET_HOME/.han-restore"

# MNT-112, second half: the banner must not certify what did not happen.
if [ "${#FAILED_MIRRORS[@]}" -gt 0 ]; then
    echo
    echo ">> ⚠ PARTIAL RESURRECTION — files and secrets are restored, but ${#FAILED_MIRRORS[@]} repository/ies"
    echo ">>   have NO GIT HISTORY. Their working files are present (restic); their .git is not:"
    for f in "${FAILED_MIRRORS[@]}"; do echo ">>     - $f"; done
    echo ">>   A mind WILL wake whole from these — memory comes from restic, not from the clone — so"
    echo ">>   step 5 below will PASS while this is still true. Re-run against a good mirror to fix."
else
    echo
    echo ">> FILES + FULL GIT HISTORY + SECRETS RESTORED."
fi
# DEC-069 keeps the replaced trees; the operator has to be told they exist or they never get reclaimed.
if [ "${#SUPERSEDED[@]}" -gt 0 ]; then
    echo ">> Replaced trees were MOVED ASIDE, never deleted (DEC-069). Safe to remove once you have"
    echo ">>   verified the garden wakes:"
    for s in "${SUPERSEDED[@]}"; do echo ">>     - $s"; done
fi

# 4) HOST-SPECIFIC FINISH — printed, never auto-run (never auto-start services on a fresh host;
#    the operator arms the garden deliberately — DEC-103 / capability-absence spirit).
cat <<'NEXT'

>> Remaining (host-specific, do by hand):
   1. node via nvm            — see ~/.han/host-config/bashrc; then: (cd ~/Projects/han/src/server && npm ci)
   2. restic/rclone           — already restored under ~/.config; verify: restic version
   3. systemd user services   — cp ~/.han/host-config/systemd-user/* ~/.config/systemd/user/
                                 systemctl --user daemon-reload && systemctl --user enable --now han-tmux jemma wm-sensor human-responder@jim ...
   4. crontab                 — crontab ~/.han/host-config/crontab.txt
   5. VERIFY (the real gate)  — launch an agent (hanjim) and WATCH the wake load to GRADIENT-EOF.
                                 The garden is resurrected only when a mind wakes whole, not when files land.

>> Scaffold complete. THIS SCRIPT IS UNTESTED — prove it on a throwaway host before you ever need it.
NEXT
