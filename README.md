<div align="center">

<img src="assets/banner.jpg" alt="mcp-server-msteams Banner" width="100%" />

# Microsoft Teams MCP Server &amp; CLI

**Seamless AI Assistant Integration, EDU Assignment Automation &amp; Standalone CLI for Microsoft Teams**

[![CI](https://github.com/kasim672/mcp-server-msteams/actions/workflows/ci.yml/badge.svg)](https://github.com/kasim672/mcp-server-msteams/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/mcp-server-msteams.svg)](https://www.npmjs.com/package/mcp-server-msteams)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)
[![Linux Supported](https://img.shields.io/badge/Linux-Ubuntu%20%7C%20Debian%20%7C%20Fedora%20%7C%20Arch-orange.svg)](#linux-dual-boot--setup-guide)
[![Windows Supported](https://img.shields.io/badge/Windows-10%20%7C%2011-blue.svg)](#windows-setup-guide)

<br/>

<img src="assets/features-overview.svg" alt="Feature Overview" width="100%" />

</div>

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
  - [Instant Run via NPX](#instant-run-via-npx)
  - [MCP Client Configuration (Claude Desktop, Cursor, Windsurf, Zed)](#mcp-client-configuration)
- [Architecture &amp; Design](#architecture--design)
- [Live Terminal CLI](#live-terminal-cli)
- [Complete Tool Catalog](#complete-tool-catalog)
  - [1. Authentication &amp; Session](#1-authentication--session)
  - [2. EDU Assignments Automation](#2-edu-assignments-automation)
  - [3. Messaging &amp; Conversations](#3-messaging--conversations)
  - [4. Search &amp; Discovery](#4-search--discovery)
  - [5. Files, Meetings &amp; Transcripts](#5-files-meetings--transcripts)
  - [6. People &amp; Directory](#6-people--directory)
- [Linux Dual-Boot &amp; Setup Guide](#linux-dual-boot--setup-guide)
  - [Prerequisites &amp; Browser Installation](#prerequisites--browser-installation)
  - [Cloning &amp; Local Verification](#cloning--local-verification)
  - [Environment Variables](#environment-variables)
- [Windows Setup Guide](#windows-setup-guide)
- [Step-by-Step Assignment Workflow](#step-by-step-assignment-workflow)
- [Development &amp; Testing](#development--testing)
- [Publishing to NPM](#publishing-to-npm)
- [Security &amp; Privacy](#security--privacy)
- [Troubleshooting &amp; FAQ](#troubleshooting--faq)
- [License](#license)

---

## Overview

**`mcp-server-msteams`** gives Large Language Models (Claude, GPT, Gemini, DeepSeek) and developers programmatic, real-time access to Microsoft Teams. 

### Why Choose `mcp-server-msteams`?

- 🚀 **Zero Azure Setup**: No Azure App Registrations, no IT admin consent, and no custom API permissions required. Simply sign in using your existing standard Teams account.
- ⚡ **Silent 1-Second HTTP Refresh**: Automatically extracts and refreshes MSAL OAuth tokens via fast HTTPS endpoints in the background. The browser only opens for the initial login or when session cookies completely expire.
- 🎓 **First-Class EDU Assignments**: Automate listing coursework, downloading assignments briefs, attaching local submissions (`.pdf`, `.docx`, `.zip`), and executing turn-in / unsubmit actions.
- 🐧 **Full Linux &amp; Windows Parity**: Native cross-platform engine auto-detects Google Chrome, Brave, Microsoft Edge, and Chromium across distributions without hardcoded OS paths.
- 🛡️ **End-to-End Local Security**: Session tokens are encrypted on disk with **AES-256-GCM** using machine-derived cryptographic keys. Your credentials never touch third-party servers.
- 🛠️ **Dual Interface**: Includes both an **MCP stdio server** for AI clients and the standalone **`msteams` CLI** for bash/zsh/PowerShell scripts.

---

## Quick Start

### Instant Run via NPX

Run the CLI via NPX without installing anything locally:

```bash
# Check status and current connection
npx -y -p mcp-server-msteams msteams status

# Sign in to your Microsoft Teams account (opens browser once)
npx -y -p mcp-server-msteams msteams teams_login
```

### MCP Client Configuration

Add `mcp-server-msteams` to your AI client configuration file:

#### Claude Desktop
Add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/.config/Claude/claude_desktop_config.json` (Linux/macOS):

```json
{
  "mcpServers": {
    "teams": {
      "command": "npx",
      "args": ["-y", "mcp-server-msteams@latest"]
    }
  }
}
```

#### Cursor &amp; Windsurf
Add to your project's `.cursor/mcp.json` or global MCP settings:

```json
{
  "mcpServers": {
    "teams": {
      "command": "npx",
      "args": ["-y", "mcp-server-msteams@latest"]
    }
  }
}
```

#### Local Clone Execution (Recommended for Active Development)
If you are developing or testing locally:

```json
{
  "mcpServers": {
    "teams": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server-msteams/dist/index.js"]
    }
  }
}
```

---

## Architecture &amp; Design

<div align="center">
  <img src="assets/architecture.svg" alt="Architecture Diagram" width="100%" />
</div>

1. **Protocol Layer**: Standard JSON-RPC 2.0 over standard I/O (MCP specification compliant).
2. **Session Engine**:
   - Stores session state in `~/.teams-mcp-server/` (Linux/macOS) or `%APPDATA%\teams-mcp-server\` (Windows).
   - Local token database encrypted with authenticated **AES-256-GCM**.
   - Persistent browser profile preserves Microsoft SSO cookies, allowing silent headless re-authentication.
3. **Multi-Service Cloud Gateway**:
   - **ChatSvc (`chatsvcagg.teams.microsoft.com`)**: Real-time messaging, channels, direct chats, reactions.
   - **Substrate (`substrate.office.com`)**: Microsoft 365 natural language search, Outlook emails, people graph.
   - **Assignments (`assignments.edu.cloud.microsoft`)**: Coursework data, submission deadlines, rubrics.
   - **Graph API (`graph.microsoft.com`)**: OneDrive files, SharePoint document libraries, meeting transcripts.

---

## Live Terminal CLI

The server bundles the `msteams` command-line interface with 100% feature parity to the MCP tools:

<div align="center">
  <img src="assets/terminal-preview.svg" alt="Terminal Preview" width="100%" />
</div>

Install globally via npm for instant system-wide access:

```bash
npm install -g mcp-server-msteams

# List all available commands
msteams --help

# Check status
msteams status

# List active coursework
msteams teams_list_assignments --status active
```

---

## Complete Tool Catalog

`mcp-server-msteams` exposes **30+ Zod-validated tools** across 6 domains:

### 1. Authentication &amp; Session

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `teams_status` | *(None)* | Check authentication status, tenant details, and token validity across all services. |
| `teams_login` | *(None)* | Opens a visible browser window for Microsoft Teams login. Auto-closes upon success. |

### 2. EDU Assignments Automation

> **Note**: Designed for education tenants (schools, universities, colleges).

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `teams_list_assignments` | `status` (`active` \| `completed` \| `all`) | List all coursework assignments with due dates, grades, and current state. |
| `teams_get_assignment` | `classId`, `assignmentId` | Get detailed assignment instructions, attached files, rubrics, and submission status. |
| `teams_attach_file` | `filePath`, `classId`*, `assignmentId`*, `turnIn` (bool) | **Upload and attach a local file** directly to an assignment submission via Playwright automation, with optional instant turn-in. |
| `teams_remove_attachment` | `fileName`*, `classId`*, `assignmentId`* | Remove an uploaded attachment from a working submission. |
| `teams_submission_action` | `action` (`submit` \| `unsubmit` \| `view`), `classId`, `assignmentId`, `submissionId` | Turn in an assignment, undo turn-in, or mark as viewed. |

### 3. Messaging &amp; Conversations

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `teams_send_message` | `chatId`, `content` | Send a new message (supports Markdown tables and formatting). |
| `teams_get_chat` | `chatId`, `pageSize` | Read messages and conversation history from a 1:1, group, or meeting chat. |
| `teams_get_unread` | `limit` | Fetch all unread chats, channels, and mentions. |
| `teams_list_chats` | `pageSize` | List recent conversations with participant details and last message snippet. |
| `teams_get_thread` | `channelId`, `messageId` | Fetch all replies in a specific channel conversation thread. |
| `teams_edit_message` | `chatId`, `messageId`, `content` | Edit the text content of a previously sent message. |
| `teams_delete_message` | `chatId`, `messageId` | Delete a message sent by your user. |
| `teams_mark_read` | `chatId`, `messageId` | Update server-side read receipt state. |
| `teams_wait_for_reply` | `chatId`, `timeoutMs` | Efficient long-polling for incoming responses from peers. |

### 4. Search &amp; Discovery

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `teams_search` | `query`, `pageSize` | Semantic natural language search across messages, chats, and channels. |
| `teams_search_email` | `query`, `pageSize` | Search your Exchange/Outlook inbox and sent mail from Teams context. |
| `teams_search_people` | `query`, `limit` | Search institutional directory for colleagues, professors, and classmates. |

### 5. Files, Meetings &amp; Transcripts

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `teams_get_shared_files` | `chatId` | List files shared within a conversation with download URLs. |
| `teams_download_file` | `fileUrl`, `outputPath` | Securely download SharePoint, OneDrive, or assignment files to local disk. |
| `teams_get_meetings` | `startTime`*, `endTime`* | Retrieve upcoming and past calendar events and Teams meetings. |
| `teams_get_transcript` | `meetingId` | Download automated meeting transcripts with speaker timestamps. |

### 6. People &amp; Directory

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `teams_get_me` | *(None)* | Get profile details, tenant ID, and email of the logged-in user. |
| `teams_get_person` | `userId` | Look up detailed job title, department, and contact info for a person. |
| `teams_get_frequent_contacts`| `limit` | Get the list of contacts you interact with most frequently. |
| `teams_add_reaction` | `chatId`, `messageId`, `reactionType` | React to a message (`like`, `heart`, `laugh`, `surprised`, `sad`, `angry`). |
| `teams_remove_reaction` | `chatId`, `messageId`, `reactionType` | Remove a previously added reaction. |

---

## Linux Dual-Boot &amp; Setup Guide

If you are using Linux (Ubuntu, Debian, Fedora, Arch, Manjaro, Pop!_OS) or switching from a dual-boot setup, `mcp-server-msteams` is tested and verified to work out-of-the-box.

### Prerequisites &amp; Browser Installation

Ensure you have **Node.js >= 20** and one supported browser:

#### 1. Install Node.js 20+
```bash
# Ubuntu / Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# Fedora
sudo dnf install -y nodejs git

# Arch Linux
sudo pacman -S nodejs npm git
```

#### 2. Install a Browser
`mcp-server-msteams` uses your system browser, saving ~180MB of bundled browser downloads. Install any of the following:

```bash
# Option A: Google Chrome (Ubuntu / Debian)
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install -y ./google-chrome-stable_current_amd64.deb

# Option B: Brave Browser (Ubuntu / Debian)
sudo curl -fsSLo /usr/share/keyrings/brave-browser-archive-keyring.gpg https://brave-browser-apt-release.s3.brave.com/brave-browser-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/brave-browser-archive-keyring.gpg] https://brave-browser-apt-release.s3.brave.com/ stable main" | sudo tee /etc/apt/sources.list.d/brave-browser-release.list
sudo apt update && sudo apt install -y brave-browser

# Option C: Chromium (Ubuntu / Debian)
sudo apt install -y chromium-browser

# Option D: Microsoft Edge (Ubuntu / Debian)
curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > microsoft.gpg
sudo install -o root -g root -m 644 microsoft.gpg /etc/apt/trusted.gpg.d/
sudo sh -c 'echo "deb [arch=amd64] https://packages.microsoft.com/repos/edge stable main" > /etc/apt/sources.list.d/microsoft-edge-dev.list'
sudo apt update && sudo apt install -y microsoft-edge-stable
```

### Cloning &amp; Local Verification

```bash
# 1. Clone your private standalone repository
git clone https://github.com/kasim672/mcp-server-msteams.git
cd mcp-server-msteams

# 2. Install dependencies
npm install

# 3. Build TypeScript code
npm run build

# 4. Run the entire test suite (559 tests)
npm test

# 5. Perform initial login (opens browser window)
npx tsx src/cli.ts teams_login

# 6. Verify authentication status
npx tsx src/cli.ts teams_status
```

### Environment Variables

Configure optional overrides in your `~/.bashrc` or `~/.zshrc`:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `TEAMS_BROWSER` | Explicitly choose browser engine (`brave`, `chrome`, `edge`, `chromium`). | `export TEAMS_BROWSER=brave` |
| `TEAMS_BROWSER_PATH`| Absolute path to custom browser executable. | `export TEAMS_BROWSER_PATH=/usr/bin/google-chrome` |
| `LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`). | `export LOG_LEVEL=debug` |

---

## Windows Setup Guide

1. Ensure **Node.js >= 20** is installed from [nodejs.org](https://nodejs.org/).
2. Microsoft Edge is pre-installed on Windows 10/11 and is automatically detected. Brave and Google Chrome are also supported.
3. In PowerShell or Command Prompt:

```powershell
git clone https://github.com/kasim672/mcp-server-msteams.git
cd mcp-server-msteams
npm install
npm run build
npm test
```

4. Session data on Windows is stored in `%APPDATA%\teams-mcp-server\`.

---

## Step-by-Step Assignment Workflow

Here is how an AI assistant or student automates coursework using `mcp-server-msteams`:

### Step 1: Check Coursework Deadlines
```bash
msteams teams_list_assignments --status active
```
*Output returns all pending homework, modules, quizzes, and due dates across your enrolled classes.*

### Step 2: Read Detailed Instructions &amp; Download Attachments
```bash
msteams teams_get_assignment --classId "19:abc...tacx" --assignmentId "a8f3b..."
```
*Returns teacher rubrics, point scales, and resource download URLs. Use `teams_download_file` to fetch reference slides or templates.*

### Step 3: Attach Local Submission File
```bash
# Attach file and optionally turn in immediately:
msteams teams_attach_file \
  --classId "19:abc...tacx" \
  --assignmentId "a8f3b..." \
  --filePath "/home/kasim/Documents/Assignment3_Report.pdf" \
  --turnIn
```
*Playwright launches headless Chromium, navigates directly to the student portal, uploads the file, verifies the attachment DOM element, and triggers the Turn In button.*

### Step 4: Undo Turn-In or Remove Attachment (If needed)
```bash
# Undo turn-in:
msteams teams_submission_action --action unsubmit --classId "19:abc..." --assignmentId "a8f3b..." --submissionId "sub_01..."

# Remove attachment:
msteams teams_remove_attachment --classId "19:abc..." --assignmentId "a8f3b..." --fileName "Assignment3_Report.pdf"
```

---

## Development &amp; Testing

### Running Tests
The project features a comprehensive Vitest test suite covering all APIs, MSAL token refresh flows, parsers, and tool schemas:

```bash
# Run all unit tests once
npm test

# Run tests in watch mode
npm run test:watch

# Run code coverage report
npm run test:coverage
```

### Static Analysis
```bash
# TypeScript type checking
npm run typecheck

# Code linting
npm run lint
```

---

## Publishing to NPM

When you are ready to make `mcp-server-msteams` publicly installable worldwide:

```bash
# 1. Log in to your npm account
npm login

# 2. Verify tarball contents before uploading
npm pack --dry-run

# 3. Publish to npm registry
npm publish
```

Once published, anyone can use it instantly:
```bash
npx -y -p mcp-server-msteams msteams status
```

---

## Security &amp; Privacy

- **No Third-Party Cloud Relays**: Every request communicates directly from your machine to Microsoft's official servers (`*.microsoft.com`, `*.office.com`).
- **Encrypted Local Storage**: Cached tokens and session states are encrypted with **AES-256-GCM** using local machine salt and hardware-derived keys.
- **Owner-Only File Permissions**: On Linux and macOS, the session directory is created with `0o700` (`rwx------`) and files with `0o600` (`rw-------`).
- **No Credential Escalation**: The server operates strictly within the permissions of your logged-in Microsoft Teams account.

---

## Troubleshooting &amp; FAQ

### Q: Browser fails to launch on Linux with "Missing $DISPLAY"?
`mcp-server-msteams` automatically detects headless Linux terminal environments and switches to headless mode. For the initial login (`teams_login`), ensure you are running in a desktop GUI environment (GNOME, KDE, XFCE, Sway) or pass an X11 forwarding session (`ssh -X`).

### Q: "SingletonLock" error when starting browser?
If a browser session crashed unexpectedly, Chromium may leave behind a lock file. `mcp-server-msteams` automatically detects and clears stale `SingletonLock` files older than your running process. If needed, you can delete it manually:
```bash
rm -f ~/.teams-mcp-server/browser-profile/SingletonLock
```

### Q: How do I completely reset my login session?
Delete the local configuration folder and run `teams_login` again:
```bash
# Linux / macOS
rm -rf ~/.teams-mcp-server

# Windows (PowerShell)
Remove-Item -Recurse -Force "$env:APPDATA\teams-mcp-server"
```

---

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

Developed and maintained by **Kasim Ghanchi** ([@kasim672](https://github.com/kasim672)).
