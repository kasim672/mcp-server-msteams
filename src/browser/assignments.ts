/**
 * Browser automation for Teams EDU Assignments.
 *
 * Automates attaching and removing assignment files using Playwright and the
 * existing authenticated Teams browser session profile.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createBrowserContext, closeBrowser } from './context.js';
import { getAssignment } from '../api/assignments-api.js';
import { actOnSubmission } from '../api/assignments-api.js';
import * as log from '../utils/logger.js';
import { ok, err, type Result } from '../types/result.js';
import { createError, ErrorCode, type McpError } from '../types/errors.js';

export interface AttachAssignmentFileInput {
  filePath: string;
  assignmentUrl?: string;
  classId?: string;
  assignmentId?: string;
  submissionId?: string;
  turnIn?: boolean;
}

export interface AttachAssignmentFileResult {
  success: boolean;
  fileName: string;
  filePath: string;
  uploadConfirmed: boolean;
  turnedIn: boolean;
  assignmentUrl: string;
}

export interface RemoveAssignmentAttachmentInput {
  assignmentUrl?: string;
  classId?: string;
  assignmentId?: string;
  fileName?: string;
}

export interface RemoveAssignmentAttachmentResult {
  success: boolean;
  removed: boolean;
  assignmentUrl: string;
}

/** Only navigate trusted Teams/Assignments origins with the persistent signed-in browser. */
const TRUSTED_ASSIGNMENT_HOSTS = new Set([
  'teams.microsoft.com',
  'teams.cloud.microsoft',
  'teams.chat.microsoft.com',
  'teams.microsoft.us',
  'dod.teams.microsoft.us',
  'assignments.edu.cloud.microsoft',
]);

export function isAllowedAssignmentUrl(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      TRUSTED_ASSIGNMENT_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Resolves the assignment webUrl from either input or via getAssignment API.
 */
async function resolveAssignmentUrl(
  inputUrl?: string,
  classId?: string,
  assignmentId?: string
): Promise<Result<string, McpError>> {
  if (inputUrl && inputUrl.trim().length > 0) {
    const url = inputUrl.trim();
    if (!isAllowedAssignmentUrl(url)) {
      return err(createError(ErrorCode.INVALID_INPUT, 'assignmentUrl must be an HTTPS Microsoft Teams assignment link.'));
    }
    return ok(url);
  }

  if (classId && assignmentId) {
    const detail = await getAssignment(classId, assignmentId);
    if (!detail.ok) {
      return detail;
    }
    if (!detail.value.webUrl) {
      return err(
        createError(
          ErrorCode.API_ERROR,
          'Assignment detail does not contain a webUrl deep link.'
        )
      );
    }
    if (!isAllowedAssignmentUrl(detail.value.webUrl)) {
      return err(createError(ErrorCode.API_ERROR, 'Assignments returned a link outside the trusted Teams domains.'));
    }
    return ok(detail.value.webUrl);
  }

  return err(
    createError(
      ErrorCode.INVALID_INPUT,
      'Either assignmentUrl or both classId and assignmentId must be provided.'
    )
  );
}

/**
 * Attach a local file to a Microsoft Teams assignment using the browser session.
 */
export async function attachAssignmentFile(
  input: AttachAssignmentFileInput
): Promise<Result<AttachAssignmentFileResult, McpError>> {
  const resolvedPath = path.resolve(input.filePath);
  if (!fs.existsSync(resolvedPath)) {
    return err(
      createError(ErrorCode.NOT_FOUND, `Local file not found: ${input.filePath}`)
    );
  }

  const urlResult = await resolveAssignmentUrl(
    input.assignmentUrl,
    input.classId,
    input.assignmentId
  );
  if (!urlResult.ok) {
    return urlResult;
  }
  const assignmentUrl = urlResult.value;
  const fileName = path.basename(resolvedPath);

  // Never perform a destructive turn-in based on an unverified UI button click.
  // Resolve the submission identifier before uploading, so missing metadata
  // cannot leave the user with a file attached and an ambiguous turn-in result.
  let turnInSubmissionId = input.submissionId;
  if (input.turnIn) {
    if (!input.classId || !input.assignmentId) {
      return err(createError(ErrorCode.INVALID_INPUT,
        'turnIn requires classId and assignmentId so the final submitted state can be verified.'));
    }
    if (!turnInSubmissionId) {
      const detail = await getAssignment(input.classId, input.assignmentId);
      if (!detail.ok) return detail;
      turnInSubmissionId = detail.value.submission?.id;
    }
    if (!turnInSubmissionId) {
      return err(createError(ErrorCode.INVALID_INPUT,
        'No submissionId is available for this assignment; turn-in is not safe to perform.'));
    }
  }

  log.info('assignments-browser', `Attaching file "${fileName}" to assignment...`);

  let browser;
  try {
    browser = await createBrowserContext({ headless: true });
    const page = browser.page;

    log.info('assignments-browser', `Navigating to ${assignmentUrl}`);
    await page.goto(assignmentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Bypass 'Use the web app instead' launcher screen if shown
    const useWebBtn = page.locator('button:has-text("Use the web app instead")');
    if (await useWebBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      log.info('assignments-browser', 'Clicking "Use the web app instead" on launcher page');
      await useWebBtn.click();
    }

    // Locate the embedded assignments iframe
    log.info('assignments-browser', 'Locating assignments frame...');
    let frame = null;
    for (let i = 0; i < 35; i++) {
      frame = page.frames().find((f) =>
        f.url().includes('assignments.edu.cloud.microsoft')
      );
      if (frame) break;
      await page.waitForTimeout(1000);
    }

    if (!frame) {
      return err(
        createError(
          ErrorCode.TIMEOUT,
          'Timed out waiting for Teams assignment viewer to load.'
        )
      );
    }

    // Wait for the Attach button
    const attachBtn = frame.locator('#studentAddResourcesButton');
    await attachBtn.waitFor({ state: 'visible', timeout: 35000 });

    log.info('assignments-browser', 'Opening Attach menu...');
    await attachBtn.click();
    await page.waitForTimeout(1500);

    // Locate file input
    const fileInputs = frame.locator('input[type="file"]');
    const inputCount = await fileInputs.count();

    if (inputCount > 0) {
      log.info('assignments-browser', 'Setting input files directly on input element...');
      await fileInputs.first().setInputFiles(resolvedPath);
    } else {
      log.info('assignments-browser', 'Listening for filechooser event...');
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10000 }),
        frame.locator('text="Upload from this device"').click(),
      ]);
      await fileChooser.setFiles(resolvedPath);
    }

    log.info('assignments-browser', 'Waiting for file upload to process in Teams...');
    await page.waitForTimeout(14000);

    const bodyText = await frame.evaluate(() => document.body.innerText);
    const uploadConfirmed = bodyText.includes(fileName);
    if (!uploadConfirmed) {
      return err(createError(ErrorCode.API_ERROR,
        `Upload of "${fileName}" could not be confirmed in Teams. Check the assignment before attempting another upload or turn-in.`,
        { retryable: false }));
    }

    let turnedIn = false;
    if (input.turnIn) {
      log.info('assignments-browser', 'Executing verified turn-in via Assignments API...');
      const submitResult = await actOnSubmission(
        'submit',
        input.classId!,
        input.assignmentId!,
        turnInSubmissionId!
      );
      if (!submitResult.ok || submitResult.value.status !== 'submitted') {
        return err(createError(ErrorCode.API_ERROR,
          `File "${fileName}" appears attached, but turn-in could not be confirmed. Check the assignment before repeating the action.`,
          { retryable: false }));
      }
      turnedIn = true;
    }

    return ok({
      success: true,
      fileName,
      filePath: resolvedPath,
      uploadConfirmed,
      turnedIn,
      assignmentUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('assignments-browser', `Error attaching file: ${message}`);
    return err(
      createError(
        ErrorCode.API_ERROR,
        `Failed to attach file to assignment: ${message}`
      )
    );
  } finally {
    if (browser) {
      await closeBrowser(browser, false);
    }
  }
}

/**
 * Remove an attached file from a Teams assignment using the browser session.
 */
export async function removeAssignmentAttachment(
  input: RemoveAssignmentAttachmentInput
): Promise<Result<RemoveAssignmentAttachmentResult, McpError>> {
  const urlResult = await resolveAssignmentUrl(
    input.assignmentUrl,
    input.classId,
    input.assignmentId
  );
  if (!urlResult.ok) {
    return urlResult;
  }
  const assignmentUrl = urlResult.value;

  log.info('assignments-browser', 'Removing assignment attachment...');

  let browser;
  try {
    browser = await createBrowserContext({ headless: true });
    const page = browser.page;

    log.info('assignments-browser', `Navigating to ${assignmentUrl}`);
    await page.goto(assignmentUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    const useWebBtn = page.locator('button:has-text("Use the web app instead")');
    if (await useWebBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await useWebBtn.click();
    }

    let frame = null;
    for (let i = 0; i < 35; i++) {
      frame = page.frames().find((f) =>
        f.url().includes('assignments.edu.cloud.microsoft')
      );
      if (frame) break;
      await page.waitForTimeout(1000);
    }

    if (!frame) {
      return err(
        createError(
          ErrorCode.TIMEOUT,
          'Timed out waiting for Teams assignment viewer to load.'
        )
      );
    }

    await frame.waitForSelector('#assignmentViewerStudentTurnInButton', {
      timeout: 35000,
    });
    await page.waitForTimeout(3000);

    // Target the more options button for the attachment
    const moreOptionsBtn = input.fileName
      ? frame
          .locator(`button[aria-label*="${input.fileName}"], button[title*="options"]`)
          .first()
      : frame
          .locator(
            'button[aria-label*="options" i], button[title*="options" i], button.more-options-button__Xo2Oq'
          )
          .first();

    if (!(await moreOptionsBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      return err(
        createError(
          ErrorCode.NOT_FOUND,
          'No removable attachment options found on this assignment.'
        )
      );
    }

    log.info('assignments-browser', 'Clicking more options on attachment...');
    await moreOptionsBtn.click();
    await page.waitForTimeout(1500);

    const removeBtn = frame
      .locator('text="Remove"')
      .or(frame.locator('[role="menuitem"]:has-text("Remove")'))
      .first();

    if (!(await removeBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      return err(
        createError(
          ErrorCode.NOT_FOUND,
          'Remove button not found in resource menu.'
        )
      );
    }

    log.info('assignments-browser', 'Clicking Remove...');
    await removeBtn.click();
    await page.waitForTimeout(4000);

    return ok({
      success: true,
      removed: true,
      assignmentUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('assignments-browser', `Error removing attachment: ${message}`);
    return err(
      createError(
        ErrorCode.API_ERROR,
        `Failed to remove attachment from assignment: ${message}`
      )
    );
  } finally {
    if (browser) {
      await closeBrowser(browser, false);
    }
  }
}
