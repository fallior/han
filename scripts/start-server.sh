#!/bin/bash
# Claude Remote - Server Starter
# Simple wrapper to start the Express server

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$SCRIPT_DIR/src/server"

# Check if node_modules exists
if [[ ! -d "$SERVER_DIR/node_modules" ]]; then
    echo "Installing dependencies..."
    cd "$SERVER_DIR"
    npm install
fi

# Start server
cd "$SERVER_DIR"
exec npx tsx server.ts
