#!/bin/bash
# verify-release-tag.sh <tag> — SEC-01 step-0 of the update flow (DEC-102 Ring 1).
#
# Verifies a release tag's SSH signature against the garden's PINNED release root, then
# resolves the tag to its EXACT commit hash (never a moveable ref — the TOCTOU rider).
# `han update` (P3) calls this before any checkout; on ANY failure it must not proceed.
#
# THE PIN LIVES OUTSIDE THE UPDATE CHANNEL: $HAN_HOME/credentials/release-allowed-signers,
# instantiated at genesis from the engine's seeds/release-allowed-signers and NEVER read
# from the working tree — a poisoned tag must not be able to alter the root that verifies
# it (the chicken-and-egg SEC-01 closes). Rotation per DEC-102 rider 1: routine =
# old-key-signs-new (a signed release updates the pin); compromise recovery = out-of-band
# hand-delivered pin, by construction.
#
# Output on success: the tag's exact commit hash on stdout (the ONLY thing checkout may use).
# Exit codes: 0 verified · 1 usage/pin missing (fail-closed) · 2 signature rejected.
set -euo pipefail

TAG="${1:-}"
[ -n "$TAG" ] || { echo "usage: verify-release-tag.sh <tag> [repo-dir]" >&2; exit 1; }

HAN_HOME="${HAN_HOME:-$HOME/.han}"
PIN="$HAN_HOME/credentials/release-allowed-signers"
# Optional arg2 (P3b): the repo whose tag is verified — defaults to the engine repo this
# script lives in. han-update passes its target repo explicitly (scratch proofs, and any
# future non-self layout); the PIN stays $HAN_HOME-resolved either way, outside every repo.
REPO_DIR="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# Fail-closed: no pinned root, no verification, no update. (Bootstrap: instantiate the pin
# from seeds/release-allowed-signers at genesis — a deliberate act, not an auto-copy here.)
if [ ! -s "$PIN" ]; then
    echo "ABORT: pinned release root missing/empty at $PIN — refusing to verify (fail-closed)." >&2
    echo "  Bootstrap: install the garden-release pubkey there at genesis (seeds/release-allowed-signers)." >&2
    exit 1
fi

# The signature check: git verifies the tag against ONLY the pinned signers file.
if ! git -C "$REPO_DIR" -c gpg.ssh.allowedSignersFile="$PIN" tag -v "$TAG" >&2; then
    echo "ABORT: tag '$TAG' signature verification FAILED against the pinned release root." >&2
    exit 2
fi

# Resolve to the EXACT commit object — the only thing a checkout may consume.
git -C "$REPO_DIR" rev-parse "refs/tags/$TAG^{commit}"
