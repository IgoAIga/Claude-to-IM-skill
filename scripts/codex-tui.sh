#!/usr/bin/env bash
# codex-tui.sh — Attach TUI to the running Discord bridge's Codex session.
#
# Usage:
#   ./codex-tui.sh              # auto-detect from saved ws-url
#   ./codex-tui.sh 9100         # explicit port
#   CTI_CODEX_WS_PORT=9100 ./codex-tui.sh
#
# The bridge writes its WebSocket URL to ~/.codex/bridge/ws-url on startup.
# This script reads that file (or builds the URL from the port argument)
# and runs `codex resume --remote <ws-url>`.

set -euo pipefail

WS_URL_FILE="$HOME/.codex/bridge/ws-url"

# Determine WebSocket URL
if [[ -n "${1:-}" ]]; then
  WS_URL="ws://127.0.0.1:$1"
elif [[ -f "$WS_URL_FILE" ]]; then
  WS_URL="$(cat "$WS_URL_FILE")"
elif [[ -n "${CTI_CODEX_WS_PORT:-}" ]]; then
  WS_URL="ws://127.0.0.1:$CTI_CODEX_WS_PORT"
else
  WS_URL="ws://127.0.0.1:9100"
fi

echo "Connecting TUI to: $WS_URL"
echo "(Press Ctrl+C to detach without stopping the bridge)"
echo ""

exec codex resume --remote "$WS_URL" --dangerously-bypass-approvals-and-sandbox
