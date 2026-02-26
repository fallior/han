#!/bin/bash
# Claude Remote - CLI Idle Signal (Stop hook)
# Signals that Opus has finished processing — heartbeat Leo can resume.
rm -f ~/.claude-remote/signals/cli-active
