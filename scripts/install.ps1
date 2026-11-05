# Install the published MCP package using npm only. No Azure CLI or Graph setup.
$ErrorActionPreference = 'Stop'
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'npm was not found. Install Node.js 20.19+ or 22.12+ and retry.'
}
& npm.cmd install --global mcp-server-msteams
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'Teams MCP installed. Run: msteams login  |  msteams status' -ForegroundColor Green
Write-Host 'For an MCP client configure: npx -y mcp-server-msteams@latest'
