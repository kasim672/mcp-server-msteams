#!/usr/bin/env sh
# Install from npm. Does not require a repository clone or Azure tools.
set -eu
if ! command -v npm >/dev/null 2>&1; then
  echo 'npm is missing; install Node.js first.' >&2
  exit 1
fi
npm install --global mcp-server-msteams
printf '%s\n' 'Teams MCP installed. Run: msteams login'
printf '%s\n' 'MCP client command: npx -y mcp-server-msteams@latest'
