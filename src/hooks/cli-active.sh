#!/bin/bash
# Claude Remote - CLI Active Signal (UserPromptSubmit hook)
# Signals that Opus is about to be busy processing a CLI prompt.
# Heartbeat Leo watches for this file and yields the API slot.
touch ~/.claude-remote/signals/cli-active
