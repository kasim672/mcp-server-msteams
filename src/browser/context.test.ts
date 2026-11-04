import { describe, expect, it } from 'vitest';
import {
  findDefaultBrowser,
  getBrowserLaunchConfig,
  resolveBrowserDetailsFromName,
  resolveBrowserDetailsFromPath,
} from './context.js';

describe('resolveBrowserDetailsFromPath', () => {
  it('correctly maps Firefox executable paths', () => {
    const winFirefox = resolveBrowserDetailsFromPath('C:\\Program Files\\Mozilla Firefox\\firefox.exe');
    expect(winFirefox.browserType).toBe('firefox');
    expect(winFirefox.name).toBe('Mozilla Firefox');

    const linuxFirefox = resolveBrowserDetailsFromPath('/usr/bin/firefox');
    expect(linuxFirefox.browserType).toBe('firefox');
    expect(linuxFirefox.name).toBe('Mozilla Firefox');
  });

  it('correctly maps Microsoft Edge executable paths', () => {
    const edge = resolveBrowserDetailsFromPath('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
    expect(edge.browserType).toBe('chromium');
    expect(edge.name).toBe('Microsoft Edge');
  });

  it('correctly maps Google Chrome executable paths', () => {
    const chrome = resolveBrowserDetailsFromPath('/usr/bin/google-chrome-stable');
    expect(chrome.browserType).toBe('chromium');
    expect(chrome.name).toBe('Google Chrome');
  });

  it('correctly maps Brave executable paths', () => {
    const brave = resolveBrowserDetailsFromPath('/usr/bin/brave-browser');
    expect(brave.browserType).toBe('chromium');
    expect(brave.name).toBe('Brave Browser');
  });

  it('correctly maps Opera and Vivaldi', () => {
    const opera = resolveBrowserDetailsFromPath('C:\\Users\\user\\AppData\\Local\\Programs\\Opera\\launcher.exe');
    // filename is launcher.exe, basename is launcher
    const operaExe = resolveBrowserDetailsFromPath('C:\\Programs\\Opera\\opera.exe');
    expect(operaExe.name).toBe('Opera');
    expect(operaExe.browserType).toBe('chromium');

    const vivaldi = resolveBrowserDetailsFromPath('/usr/bin/vivaldi-stable');
    expect(vivaldi.name).toBe('Vivaldi');
    expect(vivaldi.browserType).toBe('chromium');
  });
});

describe('resolveBrowserDetailsFromName', () => {
  it('resolves firefox', () => {
    const res = resolveBrowserDetailsFromName('firefox');
    expect(res?.browserType).toBe('firefox');
    expect(res?.name).toBe('Mozilla Firefox');
  });

  it('resolves chrome', () => {
    const res = resolveBrowserDetailsFromName('google-chrome');
    expect(res?.browserType).toBe('chromium');
    expect(res?.channel).toBe('chrome');
  });

  it('resolves edge', () => {
    const res = resolveBrowserDetailsFromName('microsoft-edge');
    expect(res?.browserType).toBe('chromium');
    expect(res?.channel).toBe('msedge');
  });

  it('resolves chromium', () => {
    const res = resolveBrowserDetailsFromName('org.chromium.Chromium');
    expect(res?.browserType).toBe('chromium');
    expect(res?.channel).toBe('chromium');
  });
});

describe('getBrowserLaunchConfig', () => {
  it('respects TEAMS_BROWSER=firefox', () => {
    const prev = process.env.TEAMS_BROWSER;
    try {
      process.env.TEAMS_BROWSER = 'firefox';
      const config = getBrowserLaunchConfig();
      expect(config.browserType).toBe('firefox');
      expect(config.name).toBe('Mozilla Firefox');
    } finally {
      if (prev !== undefined) process.env.TEAMS_BROWSER = prev;
      else delete process.env.TEAMS_BROWSER;
    }
  });

  it('respects TEAMS_BROWSER=chrome', () => {
    const prev = process.env.TEAMS_BROWSER;
    try {
      process.env.TEAMS_BROWSER = 'chrome';
      const config = getBrowserLaunchConfig();
      expect(config.channel).toBe('chrome');
      expect(config.name).toBe('Google Chrome');
    } finally {
      if (prev !== undefined) process.env.TEAMS_BROWSER = prev;
      else delete process.env.TEAMS_BROWSER;
    }
  });

  it('respects TEAMS_BROWSER=edge', () => {
    const prev = process.env.TEAMS_BROWSER;
    try {
      process.env.TEAMS_BROWSER = 'edge';
      const config = getBrowserLaunchConfig();
      expect(config.channel).toBe('msedge');
      expect(config.name).toBe('Microsoft Edge');
    } finally {
      if (prev !== undefined) process.env.TEAMS_BROWSER = prev;
      else delete process.env.TEAMS_BROWSER;
    }
  });

  it('respects TEAMS_BROWSER=chromium', () => {
    const prev = process.env.TEAMS_BROWSER;
    try {
      process.env.TEAMS_BROWSER = 'chromium';
      const config = getBrowserLaunchConfig();
      expect(config.channel).toBe('chromium');
      expect(config.name).toBe('Chromium');
    } finally {
      if (prev !== undefined) process.env.TEAMS_BROWSER = prev;
      else delete process.env.TEAMS_BROWSER;
    }
  });

  it('detects default browser when no env var is set', () => {
    const prev = process.env.TEAMS_BROWSER;
    const prevPath = process.env.TEAMS_BROWSER_PATH;
    try {
      delete process.env.TEAMS_BROWSER;
      delete process.env.TEAMS_BROWSER_PATH;
      const config = getBrowserLaunchConfig();
      expect(config.name).toBeTruthy();
      expect(config.browserType === 'chromium' || config.browserType === 'firefox').toBe(true);
    } finally {
      if (prev !== undefined) process.env.TEAMS_BROWSER = prev;
      if (prevPath !== undefined) process.env.TEAMS_BROWSER_PATH = prevPath;
    }
  });
});

describe('findDefaultBrowser', () => {
  it('returns valid config or undefined on current OS', () => {
    const found = findDefaultBrowser();
    if (found) {
      expect(found.name).toBeTruthy();
      expect(found.browserType === 'chromium' || found.browserType === 'firefox').toBe(true);
    }
  });
});
