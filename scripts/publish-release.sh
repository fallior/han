#!/bin/bash
# publish-release.sh <tag> [repo-dir] — the ONLY sanctioned way a release reaches the mirror
# (P3c, SEC-12 ceremony-MANDATORY freshness; DEC-102 Ring 1; docs/release-key-ceremony.md).
#
# THE STRUCTURAL GUARANTEE (Tenshi's P3b routing): a release WITHOUT a co-signed freshness
# is a silent detection-loss for every downstream garden — one forgotten signing and the
# anti-withholding detector goes dark with nobody noticing. So forgetting is made IMPOSSIBLE
# rather than discouraged: this script REFUSES to push a tag unless
#   1. the tag itself verifies against the pinned release root (Ring 1), AND
#   2. freshness.json exists at the branch tip, its latest_version NAMES THIS TAG, its
#      expiry is in the future, AND its detached signature verifies against the SAME root.
# Only then does the tag (and the branch carrying freshness) leave the box. A checklist
# line can be skipped; an exit-1 cannot.
#
# Exit codes: 0 published · 1 refused (any gate) — nothing is ever partially pushed: the
# gates all run BEFORE the first push.
set -euo pipefail

TAG="${1:-}"
[ -n "$TAG" ] || { echo "usage: publish-release.sh <tag> [repo-dir]" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${2:-$(cd "$SCRIPT_DIR/.." && pwd)}"
HAN_HOME="${HAN_HOME:-$HOME/.han}"
PIN="$HAN_HOME/credentials/release-allowed-signers"

fail() { echo "REFUSED: $*" >&2; exit 1; }

# ── gate 1: the tag verifies against the pinned root (Ring 1 — never publish what a garden
# would reject; verify-release-tag.sh is the same verifier han update runs at step 0) ──────
"$SCRIPT_DIR/verify-release-tag.sh" "$TAG" "$REPO_DIR" > /dev/null \
    || fail "tag '$TAG' does not verify against the pinned release root — sign the tag first (the ceremony's step 3)"

# ── gate 2: co-signed freshness naming THIS tag (SEC-12 sign-at-ceremony, MANDATORY) ──────
FRESH="$REPO_DIR/freshness.json"
SIG="$REPO_DIR/freshness.json.sig"
[ -s "$FRESH" ] || fail "freshness.json missing — a release publishes WITH its freshness, one deliberate act (the ceremony's step 2)"
[ -s "$SIG" ]   || fail "freshness.json.sig missing — freshness must be SIGNED by the garden-release key (the ceremony's step 2)"

LATEST=$(python3 -c "import json,sys; print(json.load(open('$FRESH'))['latest_version'])" 2>/dev/null) \
    || fail "freshness.json unparseable"
[ "$LATEST" = "$TAG" ] || fail "freshness latest_version '$LATEST' does not name this tag '$TAG' — re-sign freshness for THIS release"

EXPIRES=$(python3 -c "import json; print(json.load(open('$FRESH'))['expires_at'])" 2>/dev/null) \
    || fail "freshness.json has no expires_at"
python3 -c "
import json, sys
from datetime import datetime, timezone
exp = datetime.fromisoformat('$EXPIRES'.replace('Z', '+00:00'))
sys.exit(0 if exp > datetime.now(timezone.utc) else 1)
" || fail "freshness expires_at '$EXPIRES' is already in the past — a dead-on-arrival detector protects nobody (F2: set expiry GENEROUS against the real cadence)"

# The signature check, byte-exact over the file (the diff you sign is bytes — the gitRaw lesson).
ssh-keygen -Y verify -f "$PIN" -I han-release -n file -s "$SIG" < "$FRESH" > /dev/null 2>&1 \
    || fail "freshness.json signature does not verify against the pinned root — re-sign with the garden-release key"

# ── gates passed → publish (branch first so freshness rides with/ahead of the tag) ────────
echo "gates passed: tag verified + freshness co-signed for $TAG (expires $EXPIRES)"
git -C "$REPO_DIR" push origin HEAD
git -C "$REPO_DIR" push origin "refs/tags/$TAG"
echo "PUBLISHED: $TAG + co-signed freshness (SEC-12 anti-withholding detection live for downstream gardens)"
