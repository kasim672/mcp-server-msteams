import { describe, expect, it } from 'vitest';
import { isAllowedSharePointFileUrl } from './browser-files-api.js';

describe('browser-only file URL validation', () => {
  it.each([
    'https://tenant.sharepoint.com/sites/course/Shared%20Documents/lesson.pdf',
    'https://college-my.sharepoint.com/personal/student/Documents/a.pdf',
  ])('accepts SharePoint HTTPS URLs', url => {
    expect(isAllowedSharePointFileUrl(url)).toBe(true);
  });

  it.each([
    'https://graph.microsoft.com/v1.0/me/drive',
    'http://tenant.sharepoint.com/file.pdf',
    'https://tenant.sharepoint.com.attacker.example/file.pdf',
    'https://user:pass@tenant.sharepoint.com/file.pdf',
    'file:///tmp/test.pdf',
    'https://example.com/file.pdf',
  ])('rejects non-SharePoint or untrusted URLs', url => {
    expect(isAllowedSharePointFileUrl(url)).toBe(false);
  });
});
