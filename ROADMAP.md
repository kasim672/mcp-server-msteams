# Maintenance roadmap

This release focuses on improving the **existing** local-first Teams MCP and CLI, not extending its toolset.

## Current priorities

1. Verify attachment uploads and final submission state, without repeating a mutation.
2. Prefer HTTP-first refresh and faster first-login startup.
3. Keep npm-only install/uninstall and clear local-session removal options.
4. Protect session-state files and avoid revealing secrets in logs.
5. Improve the CLI, browser reliability, README visuals, and documentation.

## Explicitly out of scope

- Microsoft Graph API or Azure application registration.
- New MCP tools or expanded features.
- New GitHub Actions workflows.

The existing file download tool supports signed-in browser downloads from HTTPS SharePoint web links only. Graph drive-item URLs are not supported.

## Release checklist

Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` locally. Test the Windows command prompt and PowerShell helpers, and verify login and assignment workflows using a disposable Teams account. Publish npm separately: merging into GitHub does not publish a package.
