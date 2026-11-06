/**
 * Regression tests for the safety boundaries of assignment uploads.
 * All Playwright interaction is mocked; these tests never authenticate to Teams.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createBrowserContext, closeBrowser } from './context.js';
import { actOnSubmission } from '../api/assignments-api.js';
import { attachAssignmentFile } from './assignments.js';
import { ok, err } from '../types/result.js';
import { createError, ErrorCode } from '../types/errors.js';

vi.mock('./context.js', () => ({
  createBrowserContext: vi.fn(),
  closeBrowser: vi.fn(),
}));
vi.mock('../api/assignments-api.js', () => ({
  getAssignment: vi.fn(),
  actOnSubmission: vi.fn(),
}));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-mcp-assignment-test-'));
const filePath = path.join(tempDir, 'report.pdf');
fs.writeFileSync(filePath, 'test fixture');

afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

function mockBrowser(visibleText: string) {
  const fileInput = { setInputFiles: vi.fn(async () => undefined) };
  const attachButton = {
    waitFor: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
  };
  const frame = {
    url: () => 'https://assignments.edu.cloud.microsoft/viewer',
    locator: vi.fn((selector: string) => {
      if (selector === '#studentAddResourcesButton') return attachButton;
      if (selector === 'input[type="file"]') return {
        count: async () => 1,
        first: () => fileInput,
      };
      throw new Error(`Unexpected selector: ${selector}`);
    }),
    evaluate: vi.fn(async () => visibleText),
    waitForFunction: vi.fn(async () => {
      if (!visibleText.includes('report.pdf')) throw new Error('File was not found');
      return true;
    }),
  };
  const page = {
    goto: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    frames: () => [frame],
    locator: vi.fn(() => ({
      isVisible: vi.fn(async () => false),
    })),
  };
  vi.mocked(createBrowserContext).mockResolvedValue({
    page,
    context: { close: vi.fn(async () => undefined) },
  } as unknown as Awaited<ReturnType<typeof createBrowserContext>>);
  vi.mocked(closeBrowser).mockResolvedValue(undefined);
  return { page, fileInput };
}

const assignment = {
  filePath,
  assignmentUrl: 'https://teams.microsoft.com/l/assignment/test',
  classId: 'class1',
  assignmentId: 'assignment1',
  submissionId: 'submission1',
  turnIn: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('attachAssignmentFile', () => {
  it('rejects untrusted URLs without starting the browser', async () => {
    const result = await attachAssignmentFile({
      ...assignment,
      assignmentUrl: 'https://teams.microsoft.com.attacker.example/assignment',
    });
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.INVALID_INPUT } });
    expect(createBrowserContext).not.toHaveBeenCalled();
    expect(actOnSubmission).not.toHaveBeenCalled();
  });

  it('requires assignment identifiers for verifiable turn-in', async () => {
    const result = await attachAssignmentFile({
      filePath,
      assignmentUrl: assignment.assignmentUrl,
      turnIn: true,
    });
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.INVALID_INPUT } });
    expect(createBrowserContext).not.toHaveBeenCalled();
  });

  it('never turns in work when upload confirmation is absent', async () => {
    mockBrowser('No attachments visible');
    const result = await attachAssignmentFile(assignment);
    expect(result).toMatchObject({ ok: false, error: { code: ErrorCode.API_ERROR, retryable: false } });
    expect(actOnSubmission).not.toHaveBeenCalled();
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it('reports turn-in only after API verification', async () => {
    const browser = mockBrowser('Uploaded: report.pdf');
    vi.mocked(actOnSubmission).mockResolvedValue(ok({
      action: 'submit',
      submissionId: 'submission1',
      status: 'submitted',
    }));
    const result = await attachAssignmentFile(assignment);
    expect(result).toMatchObject({ ok: true, value: {
      success: true, uploadConfirmed: true, turnedIn: true,
    } });
    expect(browser.fileInput.setInputFiles).toHaveBeenCalledWith(filePath);
    expect(actOnSubmission).toHaveBeenCalledWith('submit', 'class1', 'assignment1', 'submission1');
  });

  it('does not claim success when turn-in verification fails', async () => {
    mockBrowser('Uploaded: report.pdf');
    vi.mocked(actOnSubmission).mockResolvedValue(err(createError(ErrorCode.API_ERROR, 'Unconfirmed turn-in')));
    const result = await attachAssignmentFile(assignment);
    expect(result).toMatchObject({ ok: false, error: { retryable: false } });
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });
});
