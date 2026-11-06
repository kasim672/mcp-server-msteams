# Uninstall the npm package. Local Microsoft session data is preserved unless explicitly requested.
param([switch]$PurgeSession)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'npm was not found. Install Node.js or manually remove the globally installed package.'
}
& npm.cmd uninstall --global mcp-server-msteams
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$sessionDir = Join-Path $env:APPDATA 'teams-mcp-server'
if ($PurgeSession) {
  if (Test-Path -LiteralPath $sessionDir) {
    Remove-Item -LiteralPath $sessionDir -Recurse -Force
    Write-Host 'Local Teams MCP credentials and browser profile deleted.' -ForegroundColor Green
  }
} else {
  Write-Host "Local session retained: $sessionDir"
  Write-Host 'To erase it too: .\scripts\uninstall.ps1 -PurgeSession'
}
Write-Host 'Remove the teams MCP entry from your AI client configuration if present.'
