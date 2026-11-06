@echo off
setlocal
where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm not found.
  exit /b 1
)
call npm uninstall --global mcp-server-msteams
if errorlevel 1 exit /b 1
echo Teams MCP uninstalled.
echo Session data was not deleted: %%APPDATA%%\teams-mcp-server
echo To purge it securely, use PowerShell: .\scripts\uninstall.ps1 -PurgeSession
echo Also remove the teams entry from your AI client MCP settings.
exit /b 0
