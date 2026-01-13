# tmux Remote Response Injection

> How to safely inject keyboard input into a running terminal session

## Problem

You have a CLI tool (like Claude Code) running in a terminal that's waiting for user input. You want to send that input remotely — from a web server, mobile app, or script — without being physically at the keyboard.

## Challenge

There's no standard way to "type" into another process's stdin after it's started. You can't just pipe input because the process is already running and attached to a TTY.

## Solution

Wrap the target process in tmux and use `tmux send-keys` to inject input.

### Basic Pattern

```bash
# Start process in tmux
tmux new-session -d -s mysession "claude"

# Later, inject input remotely
tmux send-keys -t mysession "Y" Enter
```

### Session Naming for Multiple Instances

Use PID or timestamp for unique session names:

```bash
SESSION_NAME="claude-remote-$$"  # $$ is current shell's PID
tmux new-session -d -s "$SESSION_NAME"
```

### Safe Injection from Node.js

Always use `execFile` instead of `exec` to prevent shell injection:

```javascript
const { execFile } = require('child_process');

// Safe: execFile passes arguments directly, no shell interpretation
execFile('tmux', ['send-keys', '-t', session, response, 'Enter'], (err) => {
    if (err) console.error('Failed to send:', err);
});
```

**Why execFile?** It bypasses the shell entirely — arguments are passed directly to the program. User input in `response` cannot break out and execute arbitrary commands.

### Check if Session Exists

```bash
# Bash
tmux has-session -t "$SESSION_NAME" 2>/dev/null && echo "exists"
```

```javascript
// Node.js
const { execFileSync } = require('child_process');

function sessionExists(name) {
    try {
        execFileSync('tmux', ['has-session', '-t', name], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}
```

### List Sessions Matching Pattern

```bash
tmux list-sessions -F "#{session_name}" | grep "^claude-remote"
```

### Attach to Session

```bash
tmux attach-session -t "$SESSION_NAME"
```

## Key Insight

`tmux send-keys` sends the **literal string** you provide, then `Enter` as a separate keypress. Combined with `execFile`:
1. The string isn't interpreted by a shell
2. Special characters are sent literally
3. No escaping or sanitisation needed

The response text goes directly to the tmux session's input buffer.

## Gotchas

- **Enter is separate**: `send-keys "Y" Enter` not `send-keys "Y\n"`
- **Session must exist**: Check with `has-session` before sending
- **Detached sessions**: Use `-d` flag to start detached, attach later
- **Environment variables**: Pass with `-e` flag: `new-session -e "VAR=value"`
- **Special keys**: Use key names like `Enter`, `Escape`, `Tab`, `C-c` (Ctrl+C)

## Advanced: Capture Output

For reading terminal output (Level 4 feature):

```bash
# Capture last 50 lines from pane
tmux capture-pane -t "$SESSION_NAME" -p -S -50
```

## References

- [tmux manual - send-keys](https://man7.org/linux/man-pages/man1/tmux.1.html)
- [Node.js child_process.execFile](https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback)
- OWASP Command Injection Prevention

---

*Discovered: 2026-01-13*
