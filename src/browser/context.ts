/**
 * Playwright browser context management.
 * Creates and manages browser contexts with session persistence.
 *
 * Uses the system's installed Chrome, Edge, or Brave browser rather than downloading
 * Playwright's bundled Chromium. This significantly reduces install size.
 *
 * All modes (headless and visible) use a persistent browser profile stored at
 * ~/.teams-mcp-server/browser-profile/. This means:
 * - Microsoft session cookies persist across launches (longer-lived than MSAL tokens)
 * - Headless token refresh can silently re-authenticate using the profile's session
 * - Visible login retains extensions (e.g. Bitwarden) and form autofill data
 * - No need for storageState temp files or encrypted session restoration for browser use
 */

import { chromium, type BrowserContext, type Page } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ensureConfigDir,
  CONFIG_DIR,
  writeSessionState,
} from '../auth/session-store.js';
import { clearRegionCache } from '../utils/auth-guards.js';
import * as log from '../utils/logger.js';

export interface BrowserManager {
  context: BrowserContext;
  page: Page;
}

export interface ResolvedBrowserConfig {
  channel?: 'msedge' | 'chrome' | 'chromium';
  executablePath?: string;
  name: string;
}

/**
 * Directory for the persistent browser profile.
 * This is a dedicated Chrome/Edge/Brave profile within the config dir, so extensions
 * and form autofill data persist across login sessions
 * without conflicting with the user's running browser instance.
 *
 * Both headless and visible modes share this profile, so Microsoft's long-lived
 * session cookies enable silent headless re-authentication without user interaction.
 */
const BROWSER_PROFILE_DIR = path.join(CONFIG_DIR, 'browser-profile');

/**
 * Path to the Chromium SingletonLock file.
 * This file prevents multiple processes from using the same profile.
 */
const SINGLETON_LOCK_PATH = path.join(BROWSER_PROFILE_DIR, 'SingletonLock');

/**
 * Checks if a process with the given PID is running.
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cleans up stale SingletonLock files left by crashed browser sessions.
 */
function cleanupStaleSingletonLock(): boolean {
  if (!fs.existsSync(SINGLETON_LOCK_PATH)) {
    return false;
  }

  try {
    const linkTarget = fs.readlinkSync(SINGLETON_LOCK_PATH);
    const pidMatch = linkTarget.match(/-(\d+)$/);

    if (pidMatch) {
      const pid = parseInt(pidMatch[1], 10);
      if (isProcessRunning(pid)) {
        return false;
      }
      log.info('browser', `Removing stale SingletonLock (PID ${pid} not running)`);
      fs.unlinkSync(SINGLETON_LOCK_PATH);
      return true;
    }
  } catch {
    try {
      const stats = fs.lstatSync(SINGLETON_LOCK_PATH);
      const ageMs = Date.now() - stats.mtimeMs;
      const oneHourMs = 60 * 60 * 1000;

      if (ageMs > oneHourMs) {
        log.info('browser', `Removing old SingletonLock (${Math.round(ageMs / 60000)} minutes old)`);
        fs.unlinkSync(SINGLETON_LOCK_PATH);
        return true;
      }
    } catch {
      // Ignore
    }
  }

  return false;
}

/**
 * Searches for Brave browser installation on Windows, Linux, and macOS.
 */
export function findBravePath(): string | undefined {
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local');
    candidates.push(
      path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
    );
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
  } else {
    // Linux
    const home = os.homedir();
    candidates.push(
      '/usr/bin/brave-browser',
      '/usr/bin/brave',
      '/snap/bin/brave',
      '/usr/local/bin/brave-browser',
      '/var/lib/flatpak/exports/bin/com.brave.Browser',
      path.join(home, '.local/share/flatpak/exports/bin/com.brave.Browser')
    );
  }
  return candidates.find((p) => fs.existsSync(p));
}

/**
 * Searches for known browser installations on Linux across deb/rpm, flatpak, snap, and /opt.
 */
export function findLinuxBrowserPath(): { executablePath: string; name: string } | undefined {
  const home = os.homedir();
  const candidates = [
    { name: 'Google Chrome', path: '/usr/bin/google-chrome' },
    { name: 'Google Chrome', path: '/usr/bin/google-chrome-stable' },
    { name: 'Google Chrome', path: '/opt/google/chrome/chrome' },
    { name: 'Google Chrome', path: '/opt/google/chrome/google-chrome' },
    { name: 'Brave Browser', path: '/usr/bin/brave-browser' },
    { name: 'Brave Browser', path: '/usr/bin/brave' },
    { name: 'Brave Browser', path: '/snap/bin/brave' },
    { name: 'Brave Browser', path: '/var/lib/flatpak/exports/bin/com.brave.Browser' },
    { name: 'Brave Browser', path: path.join(home, '.local/share/flatpak/exports/bin/com.brave.Browser') },
    { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge' },
    { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge-stable' },
    { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge-beta' },
    { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge-dev' },
    { name: 'Microsoft Edge', path: '/opt/microsoft/msedge/msedge' },
    { name: 'Chromium', path: '/usr/bin/chromium-browser' },
    { name: 'Chromium', path: '/usr/bin/chromium' },
    { name: 'Chromium', path: '/snap/bin/chromium' },
    { name: 'Chromium', path: '/var/lib/flatpak/exports/bin/org.chromium.Chromium' },
    { name: 'Chromium', path: path.join(home, '.local/share/flatpak/exports/bin/org.chromium.Chromium') },
  ];
  const found = candidates.find((c) => fs.existsSync(c.path));
  return found ? { executablePath: found.path, name: found.name } : undefined;
}

/**
 * Resolves browser launch settings based on environment, platform, and installed browsers.
 * Supports:
 * - TEAMS_BROWSER_PATH env var (custom executable on Windows or Linux)
 * - TEAMS_BROWSER env var ('brave', 'chrome', 'edge', 'chromium')
 * - Automatic discovery: Brave -> Chrome -> Edge on Linux, Edge -> Chrome -> Brave on Windows
 */
export function getBrowserLaunchConfig(): ResolvedBrowserConfig {
  if (process.env.TEAMS_BROWSER_PATH && fs.existsSync(process.env.TEAMS_BROWSER_PATH)) {
    return {
      executablePath: process.env.TEAMS_BROWSER_PATH,
      name: `Custom (${path.basename(process.env.TEAMS_BROWSER_PATH)})`,
    };
  }

  const requested = process.env.TEAMS_BROWSER?.toLowerCase();

  if (requested === 'brave') {
    const bravePath = findBravePath();
    if (bravePath) {
      return { executablePath: bravePath, name: 'Brave Browser' };
    }
    log.warn('browser', 'Brave requested via TEAMS_BROWSER, but not found at standard paths. Falling back to default.');
  } else if (requested === 'chrome') {
    return { channel: 'chrome', name: 'Google Chrome' };
  } else if (requested === 'edge' || requested === 'msedge') {
    return { channel: 'msedge', name: 'Microsoft Edge' };
  } else if (requested === 'chromium') {
    return { channel: 'chromium', name: 'Chromium' };
  }

  // Auto-discovery
  if (process.platform === 'win32') {
    return { channel: 'msedge', name: 'Microsoft Edge' };
  } else if (process.platform === 'darwin') {
    return { channel: 'chrome', name: 'Google Chrome' };
  } else {
    // Linux
    const linuxFound = findLinuxBrowserPath();
    if (linuxFound) {
      return { executablePath: linuxFound.executablePath, name: linuxFound.name };
    }
    return { channel: 'chrome', name: 'Google Chrome' };
  }
}

/**
 * Creates a browser context using a persistent profile.
 *
 * Uses the system's installed Chrome, Edge, or Brave browser rather than downloading
 * Playwright's bundled Chromium (~180MB savings).
 *
 * @param options.headless - Run without a visible window (default: true)
 * @returns Browser manager with context and page
 */
export async function createBrowserContext(
  { headless = true }: { headless?: boolean } = {}
): Promise<BrowserManager> {
  ensureConfigDir();

  const browserConfig = getBrowserLaunchConfig();
  log.info('browser', `Launching ${browserConfig.name} (${browserConfig.executablePath || browserConfig.channel})`);

  cleanupStaleSingletonLock();

  // On Linux, if visible mode requested without an active display server, fallback to headless gracefully
  let effectiveHeadless = headless;
  if (process.platform === 'linux' && !headless && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    log.warn('browser', 'No DISPLAY or WAYLAND_DISPLAY found on Linux; launching in headless mode.');
    effectiveHeadless = true;
  }

  const launchBrowser = async (config: ResolvedBrowserConfig): Promise<BrowserManager> => {
    const args: string[] = [
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
    ];
    if (process.platform === 'linux' && (process.getuid?.() === 0 || process.env.CONTAINER || process.env.DOCKER)) {
      args.push('--no-sandbox', '--disable-setuid-sandbox');
    }

    const launchOptions: {
      headless: boolean;
      viewport: { width: number; height: number };
      acceptDownloads: boolean;
      channel?: 'msedge' | 'chrome' | 'chromium';
      executablePath?: string;
      args: string[];
    } = {
      headless: effectiveHeadless,
      viewport: { width: 1280, height: 800 },
      acceptDownloads: false,
      args,
    };

    if (config.executablePath) {
      launchOptions.executablePath = config.executablePath;
    } else if (config.channel) {
      launchOptions.channel = config.channel;
    }

    const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, launchOptions);
    const page = context.pages()[0] ?? (await context.newPage());

    return { context, page };
  };

  try {
    return await launchBrowser(browserConfig);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Profile lock recovery
    if (errorMessage.includes('ProcessSingleton') || errorMessage.includes('SingletonLock')) {
      log.warn('browser', 'Profile lock detected, attempting to clean up and retry...');
      try {
        if (fs.existsSync(SINGLETON_LOCK_PATH)) {
          fs.unlinkSync(SINGLETON_LOCK_PATH);
          log.info('browser', 'Removed SingletonLock file, retrying browser launch...');
          return await launchBrowser(browserConfig);
        }
      } catch (cleanupError) {
        log.error(
          'browser',
          `Failed to clean up SingletonLock: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
        );
      }
    }

    // Fallback attempt: if Brave or custom executable failed, try standard channels
    if (browserConfig.executablePath) {
      log.warn('browser', `Failed to launch via executablePath, attempting fallback channel...`);
      try {
        const fallbackConfig: ResolvedBrowserConfig = {
          channel: process.platform === 'win32' ? 'msedge' : 'chrome',
          name: process.platform === 'win32' ? 'Microsoft Edge' : 'Google Chrome',
        };
        return await launchBrowser(fallbackConfig);
      } catch {
        // Second fallback on Linux: try chromium channel if chrome is missing
        if (process.platform === 'linux') {
          try {
            return await launchBrowser({ channel: 'chromium', name: 'Chromium' });
          } catch {
            // Fallback also failed, proceed to throw original error
          }
        }
      }
    }

    const installHint =
      process.platform === 'win32'
        ? 'Edge should be pre-installed on Windows. Or install Brave/Chrome.'
        : 'Install Google Chrome, Brave (brave-browser), or Chromium on Linux (e.g. sudo apt install chromium-browser).';

    throw new Error(
      `Could not launch ${browserConfig.name}. ${installHint}\n\n` +
      `Original error: ${errorMessage}`
    );
  }
}

/**
 * Saves the current browser context's session state.
 */
export async function saveSessionState(context: BrowserContext): Promise<void> {
  const state = await context.storageState();
  writeSessionState(state);
  clearRegionCache();
}

/**
 * Closes the browser context and optionally saves session state.
 */
export async function closeBrowser(
  manager: BrowserManager,
  saveSession: boolean = true
): Promise<void> {
  if (saveSession) {
    await saveSessionState(manager.context);
  }
  await manager.context.close();
}
