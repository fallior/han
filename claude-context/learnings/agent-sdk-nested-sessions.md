# Learning: Agent SDK Nested Session Detection

> When spawning Claude Code via the Agent SDK from within a running Claude Code session, the subprocess detects the existing session and exits with code 1.

## Problem

The Claude Agent SDK spawns a `claude` subprocess. When your server process is running inside (or was launched from) a Claude Code session, the environment contains the `CLAUDECODE` variable. The spawned subprocess detects this and refuses to start:

```
Error: Claude Code cannot be launched inside another Claude Code session.
Nested sessions share runtime resources and will crash all active sessions.
To bypass this check, unset the CLAUDECODE environment variable.
```

This manifests as: `Error: Claude Code process exited with code 1` with no further detail from the SDK.

## Solution

Pass a clean environment to the SDK's `env` option with the `CLAUDECODE` variable removed:

```javascript
const cleanEnv = { ...process.env };
delete cleanEnv.CLAUDECODE;

const q = agentQuery({
    prompt: task.description,
    options: {
        env: cleanEnv,
        // ... other options
    }
});
```

## Why This Works

The `CLAUDECODE` environment variable is set by Claude Code to mark the process tree. Removing it from the spawned process's environment lets it start as a fresh, independent session.

## When This Applies

- Running the Agent SDK from a server that was started inside a `claude-remote` tmux session
- Any scenario where `process.env.CLAUDECODE` is set and you want to spawn a new Claude Code instance
- The `claude -p` pipe mode has the same issue — use `env -u CLAUDECODE claude -p` from the shell

## Tags

#agent-sdk #claude-code #environment #nested-sessions

## Date

2026-02-15
