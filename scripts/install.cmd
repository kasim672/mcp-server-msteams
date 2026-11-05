@echo off
setlocal
where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm not found. Install Node.js first.
  exit /b 1
)
call npm install --global mcp-server-msteams
if errorlevel 1 exit /b 1
echo Teams MCP installed. Run: msteams login
echo Configure your AI client with: npx -y mcp-server-msteams@latest
exit /b 0
