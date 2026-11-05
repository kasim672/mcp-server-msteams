/**
 * Local Teams file download through the existing authenticated browser.
 *
 * No Graph token, app registration, admin consent, or extra sign-in is used.
 * For safety, only direct HTTPS SharePoint links are accepted. File viewer
 * pages that provide no download action return a clear error.
 */
import { createReadStream, constants as fsConstants } from 'node:fs';
import { copyFile, stat } from 'node:fs/promises';
import { isAbsolute, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createBrowserContext, closeBrowser } from '../browser/context.js';
import { type Result, ok, err } from '../types/result.js';
import { ErrorCode, createError } from '../types/errors.js';

const SHAREPOINT_HOST = /^[a-z0-9-]+\.sharepoint(?:-mil)?\.(?:com|us|de|cn)$/i;

export interface DownloadedFile {
  name: string;
  outputPath: string;
  size: number;
  contentType: string;
  sha256: string;
}

export function isAllowedSharePointFileUrl(candidate: string): boolean {
  try {
    const u = new URL(candidate);
    return u.protocol === 'https:' && !u.username && !u.password &&
      !u.port && SHAREPOINT_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Browser-mediated download using the same Teams user session.
 * The file is never overwritten and is not transmitted to any other service.
 * Complex SharePoint viewers may require a manual download if the browser
 * cannot find a Download control.
 */
export async function downloadFile(url: string, outputPath: string): Promise<Result<DownloadedFile>> {
  if (!isAllowedSharePointFileUrl(url)) {
    return err(createError(ErrorCode.INVALID_INPUT,
      'Only an HTTPS SharePoint file URL is supported for browser download (no Graph drive-item URLs).'));
  }
  if (!isAbsolute(outputPath)) {
    return err(createError(ErrorCode.INVALID_INPUT, 'outputPath must be an absolute local path'));
  }
  let manager: Awaited<ReturnType<typeof createBrowserContext>> | undefined;
  try {
    manager = await createBrowserContext({ headless: true });
    const page = manager.page;
    const incoming = page.waitForEvent('download', { timeout: 30000 });

    // Direct links can trigger a download before navigation completes. A
    // cancelled navigation in this one case is expected.
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (error) {
      if (!/ERR_ABORTED|Download is starting/i.test(String(error))) throw error;
    }

    const button = page.getByRole('button', { name: /^download(?: file)?$/i }).first();
    if (await button.isVisible({ timeout: 1200 }).catch(() => false)) {
      await button.click();
    }
    const download = await incoming;
    const failure = await download.failure();
    if (failure) {
      return err(createError(ErrorCode.API_ERROR, `Browser download failed: ${failure}`, { retryable: false }));
    }
    const localTemp = await download.path();
    const file = await stat(localTemp);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(localTemp)) {
      hash.update(chunk);
    }
    // COPYFILE_EXCL is atomic with respect to existing destination files.
    await copyFile(localTemp, outputPath, fsConstants.COPYFILE_EXCL);
    return ok({
      name: basename(download.suggestedFilename()),
      outputPath,
      size: file.size,
      contentType: 'application/octet-stream',
      sha256: hash.digest('hex'),
    });
  } catch (error) {
    return err(createError(ErrorCode.API_ERROR,
      `Unable to download this file via Teams browser: ${error instanceof Error ? error.message : String(error)}. Try opening the SharePoint link in your browser.`,
      { retryable: false }));
  } finally {
    if (manager) await closeBrowser(manager, false).catch(() => {});
  }
}
