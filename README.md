# Claude Remote

> Respond to Claude Code prompts from your phone

Claude Remote lets you respond to Claude Code permission prompts and questions from anywhere. When Claude needs your input, you get a notification and can respond via a mobile web UI — no need to rush back to your desk.

## Features

- **Mobile Web UI** — Responsive interface optimised for phones
- **Dark Mode** — Automatic theme detection with manual toggle (light/dark themes)
- **Quick Actions** — One-tap buttons for Y, n, Enter, and custom responses
- **Push Notifications** — Optional alerts via ntfy.sh when Claude needs input
- **Multiple Sessions** — Support for concurrent Claude Code instances
- **tmux Integration** — Detachable sessions you can reconnect to anytime

## Requirements

- macOS (tested on Sonoma)
- Node.js 18+
- tmux
- jq
- Claude Code CLI

## Installation

```bash
# Clone the repository
git clone https://github.com/fallior/clauderemote.git
cd clauderemote

# Run the installer
./scripts/install.sh
```

The installer will:
1. Check dependencies
2. Create state directories
3. Install npm packages
4. Configure Claude Code hooks
5. Set up the CLI

## Usage

### 1. Start the Server

```bash
./scripts/start-server.sh
```

The server runs on port 3847 by default.

### 2. Start Claude Code

In another terminal:

```bash
claude-remote
```

This launches Claude Code inside a tmux session, enabling remote response injection.

### 3. Open the UI

On your phone, navigate to:
- `http://<your-mac-ip>:3847`
- Or `http://<hostname>.local:3847`

When Claude asks a question or requests permission, it will appear in the UI.

### 4. Dark Mode

The UI automatically detects your system theme preference and applies the appropriate theme:

- **Toggle Theme**: Click the theme button in the titlebar
  - 🌙 = Dark mode active (click to switch to light)
  - ☀️ = Light mode active (click to switch to dark)
- **Auto-Detection**: Respects your device's `prefers-color-scheme` setting
- **Persistence**: Your choice is saved and remembered across sessions

**Themes:**
- **Dark** (default): GitHub Dark theme with reduced eye strain for night viewing
- **Light**: GitHub Light theme optimized for bright environments

For detailed information about the theme system, see [`claude-context/DARK_MODE_GUIDE.md`](claude-context/DARK_MODE_GUIDE.md).

## CLI Options

```bash
claude-remote [OPTIONS] [-- CLAUDE_ARGS...]

Options:
    --list, -l      List active Claude Remote sessions
    --attach, -a    Attach to an existing session
    --status, -s    Show status of sessions and pending prompts
    --kill          Kill all Claude Remote sessions
    --help, -h      Show help

Examples:
    claude-remote                    # Start new session
    claude-remote --list             # List sessions
    claude-remote --attach           # Attach to session
    claude-remote -- --model opus    # Pass args to claude
```

## Push Notifications (Optional)

For instant notifications on your phone:

1. Install the [ntfy app](https://ntfy.sh) on iOS or Android
2. Subscribe to a secret topic (e.g., `my-claude-abc123`)
3. Set the environment variable:

```bash
export NTFY_TOPIC="my-claude-abc123"
```

Now you'll get a push notification whenever Claude needs input.

## Remote Access (Optional)

To access Claude Remote from outside your local network:

1. Install [Tailscale](https://tailscale.com) on your Mac and phone
2. Both devices join your Tailscale network
3. Access via Tailscale IP: `http://100.x.x.x:3847`

## Project Structure

```
claude-remote/
├── src/
│   ├── hooks/
│   │   └── notify.sh          # Claude Code notification hook
│   ├── server/
│   │   ├── server.js          # Express API server
│   │   └── package.json
│   └── ui/
│       └── index.html         # Mobile web interface
├── scripts/
│   ├── claude-remote          # CLI launcher
│   ├── start-server.sh        # Server starter
│   └── install.sh             # Installation script
└── claude-context/            # Project documentation
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Serve web UI |
| GET | `/api/prompts` | List pending prompts |
| POST | `/api/respond` | Send response to Claude |
| GET | `/api/status` | Server health check |
| DELETE | `/api/prompts/:id` | Dismiss a prompt |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3847` | Server port |
| `NTFY_TOPIC` | — | ntfy.sh topic for push notifications |
| `CLAUDE_REMOTE_DIR` | `~/.claude-remote` | State directory |

## Browser Settings

Claude Remote stores user preferences in the browser's localStorage:

| Key | Values | Description |
|-----|--------|-------------|
| `theme` | `dark`, `light` | UI theme preference (overrides system default) |

## How It Works

1. Claude Code enters a wait state (permission prompt or idle)
2. A hook fires, triggering `notify.sh`
3. The hook creates a state file and optionally sends a push notification
4. The web UI polls for pending prompts
5. User taps a response button
6. Server injects the response via `tmux send-keys`
7. Claude Code continues

## Troubleshooting

### Hooks not firing
- Ensure hooks are configured: `cat ~/.claude/settings.json`
- VSCode users: Use terminal mode (extension hooks have known issues)

### Can't connect from phone
- Check firewall allows port 3847
- Ensure devices are on the same network
- Try using IP address instead of hostname

### Response not injected
- Verify tmux session exists: `tmux list-sessions`
- Check server logs for errors

### Theme not switching
- Clear browser cache and reload the page
- Check localStorage: Open browser console and run `localStorage.getItem('theme')`
- Reset to system preference: Run `localStorage.removeItem('theme')` and reload

## Roadmap

See `claude-context/LEVELS.md` for planned features:
- Level 2: Smarter push notifications
- Level 3: Terminal context in UI
- Level 4: Full terminal mirror
- Level 5: Interactive terminal
- Level 6: Claude.ai bridge

## Author

**Darron** — Perth, Australia

## Licence

MIT
