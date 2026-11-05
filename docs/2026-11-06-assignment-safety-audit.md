# Teams MCP assignment and security audit — 2026-11-06

**Scope:** static review of `main` code at `dad9921` and the first draft safety patch in PR #1. The default branch advanced to `c870a14` during this review. This is *not* a runtime penetration test, an end-to-end Teams EDU test, or a verified full dependency audit.

**Status:** PR #1 is draft, unmerged. The repository's GitHub Actions API returned zero workflow runs. GitHub Issues are disabled (GitHub API HTTP 410), so this document tracks the follow-ups until issue tracking is enabled.

## Findings

| Priority | Location | Finding | Action |
|---|---|---|---|
| P0 reliability | `src/browser/assignments.ts` | `success: true` could be returned when the UI did not show the file; previous turn-in UI click could set `turnedIn: true` without a state check | PR #1 blocks unconfirmed UI uploads and uses the API's verified submit action; needs integration validation |
| P1 security | `src/browser/assignments.ts` / `src/tools/assignment-tools.ts` | User/API-provided assignment URLs could navigate a persistent signed-in browser to arbitrary origins | PR #1 restricts the navigation to trusted HTTPS Teams/Assignments hosts |
| P1 reliability | `src/browser/assignments.ts` | A matching filename anywhere in page text is not proof of a newly attached file in the student's working submission | Query submission resource list after upload, compare exact resource to intended file, poll for propagation |
| P1 data integrity | `src/browser/assignments.ts` | Attachment removal uses a broad `title*="options"` fallback, even with a filename; deletion is not checked afterward | Scope menu to exact attachment row/resource ID; verify removal via API before claiming success |
| P1 reliability | `src/api/assignments-api.ts` | One immediate GET verifies submit/unsubmit; asynchronous transitions can return stale status | Poll with bounded wait after *one* POST. Never replay a mutation automatically |
| P1 test/deployment | `.github/workflows/ci.yml` | Workflow exists but GitHub reports zero runs, including after opening the draft PR | Enable/verify Actions and make tests, lint, typecheck and build pass on Linux, with Windows checks |
| P2 security | `src/auth/crypto.ts` and browser profiles | Secret key is derived from hostname and username plus a hardcoded salt; browser SSO profile also holds session material | Evaluate OS keychain/DPAPI-based encryption, safe migration and permissions; no secrets in logs |
| P2 maintenance | `README.md`, `src/cli.ts` | The project is distributed as CLI + MCP and uses multiple undocumented/internal Microsoft APIs, risking version-dependent breakage | Maintain provider adapters, accurate API caveats, support matrix, explicit troubleshooting |

## Unresolved implementation risks

1. **Upload verification:** PR #1 prevents a false-positive result when the filename is entirely absent from page text, but filename presence alone is still too weak. An older or teacher-provided item with the same name could match. Promote backend resource verification to the highest-priority follow-up before relying on automatic turn-in.
2. **Submission transitions:** Microsoft's public Graph documentation notes that submit/unsubmit operations are asynchronous and should be polled. Even if the current private EDU endpoint usually updates immediately, a bounded polling strategy is more resilient:
   - https://learn.microsoft.com/en-us/graph/submissions-status-transition
   - https://learn.microsoft.com/en-us/graph/api/educationsubmission-submit?view=graph-rest-1.0
3. **Graph vs internal APIs:** The project intentionally uses Teams internal chat/assignments services and borrowed session credentials to avoid Azure app registration. The Microsoft Graph education API offers documented alternatives, but delegated `EduAssignments.ReadWrite` permission and tenant approval may be required. Evaluate a supported Graph path alongside the existing local-first approach, not as an untested drop-in replacement.
   - https://learn.microsoft.com/en-us/graph/api/educationsubmission-post-resources?view=graph-rest-1.0

## Required validation before merge

- `npm ci`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- Windows PowerShell CLI: login, status, list assignments, attach, read working resources, submit once, read resulting status, unsubmit once, remove exact attachment.
- Use a dedicated **disposable** Teams EDU assignment for the browser workflows. Do not risk graded work.
- Confirm no leaked cookies, MSAL tokens or Authorization headers in diagnostic logs.
- Verify that the draft PR includes the current default-branch changes before merge.

## Suggested implementation order

1. Resource-level upload verification and exact attachment removal.
2. Asynchronous submission-state polling and no duplicate-mutation tests.
3. CI activation, Windows checks and opt-in live EDU test.
4. OS credential storage and API-provider support design.

GitHub Issues can be enabled under repository **Settings → General → Features → Issues**; split these findings into tracked issues when enabled.
