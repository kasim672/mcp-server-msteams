/**
 * Playwright browser context management.
 * Creates and manages browser contexts with session persistence.
 *
 * Uses the system's default or installed Chrome, Edge, Brave, or Firefox browser
 * rather than downloading Playwright's bundled Chromium. This significantly reduces install size.
 *
 * All modes (headless and visible) use a persistent browser profile stored at
 * ~/.teams-mcp-server/browser-profile/ (or browser-profile-firefox/). This means:
 * - Microsoft session cookies persist across launches (longer-lived than MSAL tokens)
 * - Headless token refresh can silently re-authenticate using the profile's session
 * - Visible login retains extensions (e.g. Bitwarden) and form autofill data
 * - Default browser set in OS settings is automatically detected and coordinated with.
 */

import { chromium, firefox, type BrowserContext, type Page } from 'playwright';
import { execFileSync } from 'child_process';
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
  browserType?: 'chromium' | 'firefox';
}

/**
 * Directory for the persistent browser profiles.
 * Dedicated profile within the config dir so extensions and form autofill data persist
 * across login sessions without conflicting with the user's running browser instance.
 */
const BROWSER_PROFILE_DIR = path.join(CONFIG_DIR, 'browser-profile');
const FIREFOX_PROFILE_DIR = path.join(CONFIG_DIR, 'browser-profile-firefox');

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
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'EPERM') {
      return true;
    }
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
export function findLinuxBrowserPath(): { executablePath: string; name: string; browserType: 'chromium' | 'firefox' } | undefined {
  const home = os.homedir();
  const candidates: Array<{ name: string; path: string; browserType: 'chromium' | 'firefox' }> = [
    { name: 'Google Chrome', path: '/usr/bin/google-chrome', browserType: 'chromium' },
    { name: 'Google Chrome', path: '/usr/bin/google-chrome-stable', browserType: 'chromium' },
    { name: 'Google Chrome', path: '/opt/google/chrome/chrome', browserType: 'chromium' },
    { name: 'Google Chrome', path: '/opt/google/chrome/google-chrome', browserType: 'chromium' },
    { name: 'Brave Browser', path: '/usr/bin/brave-browser', browserType: 'chromium' },
    { name: 'Brave Browser', path: '/usr/bin/brave', browserType: 'chromium' },
    { name: 'Brave Browser', path: '/snap/bin/brave', browserType: 'chromium' },
    { name: 'Brave Browser', path: '/var/lib/flatpak/exports/bin/com.brave.Browser', browserType: 'chromium' },
    { name: 'Brave Browser', path: path.join(home, '.local/share/flatpak/exports/bin/com.brave.Browser'), browserType: 'chromium' },
    { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge', browserType: 'chromium' },
    { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge-stable', browserType: 'chromium' },
    { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge-beta', browserType: 'chromium' },
    { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge-dev', browserType: 'chromium' },
    { name: 'Microsoft Edge', path: '/opt/microsoft/msedge/msedge', browserType: 'chromium' },
    { name: 'Chromium', path: '/usr/bin/chromium-browser', browserType: 'chromium' },
    { name: 'Chromium', path: '/usr/bin/chromium', browserType: 'chromium' },
    { name: 'Chromium', path: '/snap/bin/chromium', browserType: 'chromium' },
    { name: 'Chromium', path: '/var/lib/flatpak/exports/bin/org.chromium.Chromium', browserType: 'chromium' },
    { name: 'Chromium', path: path.join(home, '.local/share/flatpak/exports/bin/org.chromium.Chromium'), browserType: 'chromium' },
    { name: 'Mozilla Firefox', path: '/usr/bin/firefox', browserType: 'firefox' },
    { name: 'Mozilla Firefox', path: '/snap/bin/firefox', browserType: 'firefox' },
  ];
  const found = candidates.find((c) => fs.existsSync(c.path));
  return found ? { executablePath: found.path, name: found.name, browserType: found.browserType } : undefined;
}

/**
 * Maps an executable path to a browser configuration.
 */
export function resolveBrowserDetailsFromPath(exePath: string): ResolvedBrowserConfig {
  const lower = path.basename(exePath).toLowerCase();

  if (lower.includes('firefox')) {
    return {
      executablePath: exePath,
      name: 'Mozilla Firefox',
      browserType: 'firefox',
    };
  }
  if (lower.includes('msedge') || lower.includes('edge')) {
    return {
      executablePath: exePath,
      name: 'Microsoft Edge',
      browserType: 'chromium',
    };
  }
  if (lower.includes('chrome')) {
    return {
      executablePath: exePath,
      name: 'Google Chrome',
      browserType: 'chromium',
    };
  }
  if (lower.includes('brave')) {
    return {
      executablePath: exePath,
      name: 'Brave Browser',
      browserType: 'chromium',
    };
  }
  if (lower.includes('chromium')) {
    return {
      executablePath: exePath,
      name: 'Chromium',
      browserType: 'chromium',
    };
  }
  if (lower.includes('opera')) {
    return {
      executablePath: exePath,
      name: 'Opera',
      browserType: 'chromium',
    };
  }
  if (lower.includes('vivaldi')) {
    return {
      executablePath: exePath,
      name: 'Vivaldi',
      browserType: 'chromium',
    };
  }

  return {
    executablePath: exePath,
    name: path.basename(exePath, path.extname(exePath)),
    browserType: 'chromium',
  };
}

/**
 * Maps a browser name string to launch settings.
 */
export function resolveBrowserDetailsFromName(name: string): ResolvedBrowserConfig | undefined {
  const lower = name.toLowerCase();
  if (lower.includes('firefox')) {
    return { name: 'Mozilla Firefox', browserType: 'firefox' };
  }
  if (lower.includes('chrome')) {
    return { channel: 'chrome', name: 'Google Chrome', browserType: 'chromium' };
  }
  if (lower.includes('edge')) {
    return { channel: 'msedge', name: 'Microsoft Edge', browserType: 'chromium' };
  }
  if (lower.includes('brave')) {
    const bravePath = findBravePath();
    return { executablePath: bravePath, name: 'Brave Browser', browserType: 'chromium' };
  }
  if (lower.includes('chromium')) {
    return { channel: 'chromium', name: 'Chromium', browserType: 'chromium' };
  }
  return undefined;
}

/**
 * Detects the default browser on Windows by querying the UserChoice registry key
 * for http/https associations and resolving the application command string.
 */
export function getWindowsDefaultBrowser(): ResolvedBrowserConfig | undefined {
  const queryCommand = (subKey: string): string | undefined => {
    try {
      const out = execFileSync('reg.exe', ['query', subKey, '/ve'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      const match = out.match(/REG_SZ\s+(.+)$/m);
      return match ? match[1].trim() : undefined;
    } catch {
      return undefined;
    }
  };

  const queryProgId = (protocol: string): string | undefined => {
    try {
      const out = execFileSync(
        'reg.exe',
        [
          'query',
          `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${protocol}\\UserChoice`,
          '/v',
          'ProgId',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
      );
      const match = out.match(/ProgId\s+REG_SZ\s+(\S+)/);
      return match ? match[1].trim() : undefined;
    } catch {
      return undefined;
    }
  };

  const parseExecutable = (cmd: string): string | undefined => {
    const quotedMatch = cmd.match(/"([^"]+\.exe)"/i) || cmd.match(/"([^"]+)"/);
    if (quotedMatch && quotedMatch[1] && fs.existsSync(quotedMatch[1])) {
      return quotedMatch[1];
    }
    const unquotedMatch = cmd.match(/^(\S+\.exe)/i) || cmd.match(/^(\S+)/);
    if (unquotedMatch && unquotedMatch[1] && fs.existsSync(unquotedMatch[1])) {
      return unquotedMatch[1];
    }
    return undefined;
  };

  // 1. Check UserChoice for https then http
  const progId = queryProgId('https') || queryProgId('http');
  if (progId) {
    const rawCmd = queryCommand(`HKCR\\${progId}\\shell\\open\\command`);
    if (rawCmd) {
      const exe = parseExecutable(rawCmd);
      if (exe) {
        return resolveBrowserDetailsFromPath(exe);
      }
    }
  }

  // 2. Fallback: StartMenuInternet in HKCU or HKLM
  for (const root of ['HKCU', 'HKLM']) {
    try {
      const out = execFileSync('reg.exe', ['query', `${root}\\Software\\Clients\\StartMenuInternet`, '/ve'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      const match = out.match(/REG_SZ\s+(\S+)/);
      if (match && match[1]) {
        const client = match[1].trim();
        const rawCmd = queryCommand(`${root}\\Software\\Clients\\StartMenuInternet\\${client}\\shell\\open\\command`);
        if (rawCmd) {
          const exe = parseExecutable(rawCmd);
          if (exe) {
            return resolveBrowserDetailsFromPath(exe);
          }
        }
      }
    } catch {
      // Continue
    }
  }

  return undefined;
}

/**
 * Safely resolves an executable token to an absolute path without shell interpolation.
 * Avoids passing unverified tokens through a shell (prevents command injection).
 */
export function safeResolveExecutable(token: string): string | undefined {
  if (!token || typeof token !== 'string') {
    return undefined;
  }

  const trimmed = token.trim();
  if (!trimmed) {
    return undefined;
  }

  // 1. If it's already an absolute path, verify existence directly
  if (path.isAbsolute(trimmed)) {
    try {
      if (fs.existsSync(trimmed) && fs.statSync(trimmed).isFile()) {
        return trimmed;
      }
    } catch {
      return undefined;
    }
  }

  // 2. Reject tokens containing shell metacharacters or whitespace
  if (/[\s;`$><|&!()\\]/.test(trimmed)) {
    return undefined;
  }

  // 3. Search directories in PATH safely without shell
  const envPath = process.env.PATH || '';
  const searchDirs = Array.from(
    new Set([
      ...envPath.split(path.delimiter).filter(Boolean),
      '/usr/bin',
      '/bin',
      '/usr/local/bin',
      '/snap/bin',
    ])
  );

  for (const dir of searchDirs) {
    const candidate = path.join(dir, trimmed);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Continue searching
    }
  }

  // 4. Safely query 'which' without spawning a shell (args passed separately to execve)
  if (process.platform !== 'win32') {
    try {
      const out = execFileSync('which', [trimmed], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (out && fs.existsSync(out)) {
        return out;
      }
    } catch {
      // Ignore if 'which' fails or is not found
    }
  }

  return undefined;
}

/**
 * Detects the default browser on Linux by querying xdg-settings or xdg-mime,
 * then parsing the registered .desktop file.
 */
export function getLinuxDefaultBrowser(): ResolvedBrowserConfig | undefined {
  let desktopName: string | undefined;

  // 1. Try xdg-settings
  try {
    const out = execFileSync('xdg-settings', ['get', 'default-web-browser'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (out && out.endsWith('.desktop')) {
      desktopName = out;
    }
  } catch {
    // Continue
  }

  // 2. Fallback to xdg-mime
  if (!desktopName) {
    for (const scheme of ['x-scheme-handler/https', 'x-scheme-handler/http', 'text/html']) {
      try {
        const out = execFileSync('xdg-mime', ['query', 'default', scheme], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (out && out.endsWith('.desktop')) {
          desktopName = out;
          break;
        }
      } catch {
        // Continue
      }
    }
  }

  if (!desktopName) {
    return undefined;
  }

  const home = os.homedir();
  const searchDirs = [
    path.join(home, '.local', 'share', 'applications'),
    '/usr/local/share/applications',
    '/usr/share/applications',
    '/var/lib/flatpak/exports/share/applications',
    path.join(home, '.local', 'share', 'flatpak', 'exports', 'share', 'applications'),
    '/var/lib/snapd/desktop/applications',
  ];

  let desktopFilePath: string | undefined;
  for (const dir of searchDirs) {
    const candidate = path.join(dir, desktopName);
    if (fs.existsSync(candidate)) {
      desktopFilePath = candidate;
      break;
    }
  }

  if (!desktopFilePath) {
    const baseName = desktopName.replace(/\.desktop$/i, '');
    return resolveBrowserDetailsFromName(baseName);
  }

  try {
    const content = fs.readFileSync(desktopFilePath, 'utf8');
    const execMatch = content.match(/^Exec\s*=\s*(.+)$/m);
    if (execMatch && execMatch[1]) {
      const rawExec = execMatch[1].replace(/%[a-zA-Z]/g, '').trim();
      const tokens = rawExec.match(/"([^"]+)"|(\S+)/g) || [];
      const firstToken = tokens[0]?.replace(/^"|"$/g, '');

      if (firstToken) {
        const resolved = safeResolveExecutable(firstToken);
        if (resolved) {
          return resolveBrowserDetailsFromPath(resolved);
        }
        return resolveBrowserDetailsFromName(firstToken);
      }
    }
  } catch {
    // Fall back to name-based resolution
  }

  return resolveBrowserDetailsFromName(desktopName.replace(/\.desktop$/i, ''));
}

/**
 * Detects the default browser on macOS via defaults or AppleScript.
 */
export function getDarwinDefaultBrowser(): ResolvedBrowserConfig | undefined {
  try {
    const bundleId = execFileSync(
      'osascript',
      ['-e', 'id of app (default application to open url "https://teams.microsoft.com")'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();

    if (bundleId.includes('firefox')) {
      const firefoxPath = '/Applications/Firefox.app/Contents/MacOS/firefox';
      return {
        executablePath: fs.existsSync(firefoxPath) ? firefoxPath : undefined,
        name: 'Mozilla Firefox',
        browserType: 'firefox',
      };
    } else if (bundleId.includes('brave')) {
      const bravePath = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
      return {
        executablePath: fs.existsSync(bravePath) ? bravePath : undefined,
        name: 'Brave Browser',
        browserType: 'chromium',
      };
    } else if (bundleId.includes('edgemac') || bundleId.includes('edge')) {
      return { channel: 'msedge', name: 'Microsoft Edge', browserType: 'chromium' };
    } else if (bundleId.includes('chrome')) {
      return { channel: 'chrome', name: 'Google Chrome', browserType: 'chromium' };
    }
  } catch {
    // Continue
  }
  return undefined;
}

/**
 * Detects the system default browser across Windows, Linux, and macOS.
 */
export function findDefaultBrowser(): ResolvedBrowserConfig | undefined {
  if (process.platform === 'win32') {
    return getWindowsDefaultBrowser();
  } else if (process.platform === 'linux') {
    return getLinuxDefaultBrowser();
  } else if (process.platform === 'darwin') {
    return getDarwinDefaultBrowser();
  }
  return undefined;
}

/**
 * Resolves browser launch settings based on environment, platform, and installed browsers.
 *
 * Priority order:
 * 1. TEAMS_BROWSER_PATH env var (explicit executable override)
 * 2. TEAMS_BROWSER env var ('firefox', 'brave', 'chrome', 'edge', 'chromium')
 * 3. System default browser detected from OS settings (Windows UserChoice registry, Linux xdg-settings, macOS default url handler)
 * 4. Fallback to installed browser (Edge on Windows, Chrome/Chromium/Brave on Linux)
 */
export function getBrowserLaunchConfig(): ResolvedBrowserConfig {
  if (process.env.TEAMS_BROWSER_PATH && fs.existsSync(process.env.TEAMS_BROWSER_PATH)) {
    const resolved = resolveBrowserDetailsFromPath(process.env.TEAMS_BROWSER_PATH);
    return {
      ...resolved,
      executablePath: process.env.TEAMS_BROWSER_PATH,
      name: `Custom (${path.basename(process.env.TEAMS_BROWSER_PATH)})`,
    };
  }

  const requested = process.env.TEAMS_BROWSER?.toLowerCase();

  if (requested === 'firefox') {
    return { name: 'Mozilla Firefox', browserType: 'firefox' };
  } else if (requested === 'brave') {
    const bravePath = findBravePath();
    if (bravePath) {
      return { executablePath: bravePath, name: 'Brave Browser', browserType: 'chromium' };
    }
    log.warn('browser', 'Brave requested via TEAMS_BROWSER, but not found at standard paths. Falling back to default.');
  } else if (requested === 'chrome') {
    return { channel: 'chrome', name: 'Google Chrome', browserType: 'chromium' };
  } else if (requested === 'edge' || requested === 'msedge') {
    return { channel: 'msedge', name: 'Microsoft Edge', browserType: 'chromium' };
  } else if (requested === 'chromium') {
    return { channel: 'chromium', name: 'Chromium', browserType: 'chromium' };
  }

  // Automatic default browser discovery from OS settings
  try {
    const defaultBrowser = findDefaultBrowser();
    if (defaultBrowser) {
      log.info('browser', `Detected system default browser from OS settings: ${defaultBrowser.name}`);
      return defaultBrowser;
    }
  } catch (err) {
    log.debug('browser', `System default browser detection non-fatal error: ${err}`);
  }

  // OS-specific fallbacks if detection yields nothing
  if (process.platform === 'win32') {
    return { channel: 'msedge', name: 'Microsoft Edge', browserType: 'chromium' };
  } else if (process.platform === 'darwin') {
    return { channel: 'chrome', name: 'Google Chrome', browserType: 'chromium' };
  } else {
    // Linux
    const linuxFound = findLinuxBrowserPath();
    if (linuxFound) {
      return { executablePath: linuxFound.executablePath, name: linuxFound.name, browserType: linuxFound.browserType };
    }
    return { channel: 'chrome', name: 'Google Chrome', browserType: 'chromium' };
  }
}

/**
 * Creates a browser context using a persistent profile.
 *
 * Uses the system's default or installed Chrome, Edge, Brave, or Firefox browser rather than downloading
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
  log.info('browser', `Launching ${browserConfig.name} (${browserConfig.executablePath || browserConfig.channel || browserConfig.browserType || 'default'})`);

  cleanupStaleSingletonLock();

  // On Linux, if visible mode requested without an active display server, fallback to headless gracefully
  let effectiveHeadless = headless;
  if (process.platform === 'linux' && !headless && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    log.warn('browser', 'No DISPLAY or WAYLAND_DISPLAY found on Linux; launching in headless mode.');
    effectiveHeadless = true;
  }

  const launchBrowser = async (config: ResolvedBrowserConfig): Promise<BrowserManager> => {
    if (config.browserType === 'firefox') {
      const firefoxOptions: {
        headless: boolean;
        viewport: { width: number; height: number };
        acceptDownloads: boolean;
        executablePath?: string;
        firefoxUserPrefs?: Record<string, string | number | boolean>;
      } = {
        headless: effectiveHeadless,
        viewport: { width: 1280, height: 800 },
        acceptDownloads: false,
        firefoxUserPrefs: {
          'dom.events.asyncClipboard.readText': true,
          'dom.events.testing.asyncClipboard': true,
        },
      };

      if (config.executablePath && fs.existsSync(config.executablePath)) {
        firefoxOptions.executablePath = config.executablePath;
      }

      const context = await firefox.launchPersistentContext(FIREFOX_PROFILE_DIR, firefoxOptions);
      const page = context.pages()[0] ?? (await context.newPage());
      return { context, page };
    }

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

    // Profile lock recovery for Chromium
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

    // If Firefox (non-Chromium default) failed, seamlessly fall back to an installed Chromium browser
    if (browserConfig.browserType === 'firefox') {
      log.warn(
        'browser',
        `Default browser (${browserConfig.name}) could not be launched via automation (${errorMessage}). Gracefully falling back to Chromium engine.`
      );
      try {
        const chromiumFallback: ResolvedBrowserConfig =
          process.platform === 'win32'
            ? { channel: 'msedge', name: 'Microsoft Edge', browserType: 'chromium' }
            : process.platform === 'linux'
              ? (findLinuxBrowserPath() || { channel: 'chrome', name: 'Google Chrome', browserType: 'chromium' })
              : { channel: 'chrome', name: 'Google Chrome', browserType: 'chromium' };
        return await launchBrowser(chromiumFallback);
      } catch (fbErr) {
        log.error('browser', `Chromium fallback launch also failed: ${fbErr}`);
      }
    }

    // Fallback attempt: if custom executable or Brave failed, try standard channels
    if (browserConfig.executablePath) {
      log.warn('browser', `Failed to launch via executablePath, attempting fallback channel...`);
      try {
        const fallbackConfig: ResolvedBrowserConfig = {
          channel: process.platform === 'win32' ? 'msedge' : 'chrome',
          name: process.platform === 'win32' ? 'Microsoft Edge' : 'Google Chrome',
          browserType: 'chromium',
        };
        return await launchBrowser(fallbackConfig);
      } catch {
        // Second fallback on Linux: try chromium channel if chrome is missing
        if (process.platform === 'linux') {
          try {
            return await launchBrowser({ channel: 'chromium', name: 'Chromium', browserType: 'chromium' });
          } catch {
            // Fallback also failed, proceed to throw original error
          }
        }
      }
    }

    const installHint =
      process.platform === 'win32'
        ? 'Edge should be pre-installed on Windows. Or install Brave, Chrome, or Firefox.'
        : 'Install Google Chrome, Brave (brave-browser), Chromium, or Firefox on Linux (e.g. sudo apt install chromium-browser).';

    throw new Error(
      `Could not launch ${browserConfig.name}. ${installHint}\n\n` +
      `Original error: ${errorMessage}`
    );
  }
}

/**
 * Checks if an error indicates that the browser, context, or page has been closed.
 */
export function isBrowserClosedError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('target page, context or browser has been closed') ||
    msg.includes('target closed') ||
    msg.includes('browser has been closed') ||
    msg.includes('context has been closed') ||
    msg.includes('page has been closed') ||
    msg.includes('browser closed') ||
    msg.includes('session closed') ||
    msg.includes('connection closed')
  );
}

/**
 * Saves the current browser context's session state.
 */
export async function saveSessionState(context: BrowserContext): Promise<boolean> {
  try {
    const state = await context.storageState();
    writeSessionState(state);
    clearRegionCache();
    return true;
  } catch (err) {
    if (isBrowserClosedError(err)) {
      log.debug('browser', 'Browser context is closed; skipped saving storage state.');
      return false;
    }
    throw err;
  }
}

/**
 * Closes the browser context and optionally saves session state.
 */
export async function closeBrowser(
  manager: BrowserManager,
  saveSession: boolean = true
): Promise<void> {
  if (saveSession) {
    try {
      await saveSessionState(manager.context);
    } catch (err) {
      log.debug('browser', `Could not save session state on close: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  try {
    await manager.context.close();
  } catch (err) {
    log.debug('browser', `Could not close browser context: ${err instanceof Error ? err.message : String(err)}`);
  }
}
