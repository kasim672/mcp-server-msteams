#!/usr/bin/env sh
# Remove the globally installed package; optionally purge this user's local session.
set -eu
if ! command -v npm >/dev/null 2>&1; then
  echo 'npm is missing.' >&2
  exit 1
fi
npm uninstall --global mcp-server-msteams
config_dir="${HOME:?}/.teams-mcp-server"
case "${1:-}" in
  '') printf 'Session retained at %s\n' "$config_dir"; printf '%s\n' 'Pass --purge-session to remove it too.' ;;
  --purge-session) if [ -d "$config_dir" ]; then rm -rf -- "$config_dir"; fi
    printf '%s\n' 'Local Teams MCP session data deleted.' ;;
  *) printf '%s\n' 'Usage: sh scripts/uninstall.sh [--purge-session]' >&2; exit 2 ;;
esac
printf '%s\n' 'Remove the teams entry from your AI client MCP configuration if present.'
