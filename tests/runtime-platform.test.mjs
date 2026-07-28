import test from 'node:test';
import assert from 'node:assert/strict';

import { windowsPasswordPath } from '../scripts/credentials.mjs';
import {
  chromeExecutableCandidates,
  pathsOverlap,
  profileOverlapsDefaultChrome,
  resolveConfigPath,
  resolveDefaultChromeDir,
  resolveProfileDir,
} from '../scripts/runtime-platform.mjs';

test('finds system and per-user Chrome on macOS', () => {
  assert.deepEqual(
    chromeExecutableCandidates({
      platform: 'darwin',
      home: '/Users/Agent',
    }),
    [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Users/Agent/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ],
  );
});

test('uses AppData paths on Windows', () => {
  const env = {
    APPDATA: 'C:\\Users\\Agent\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\Agent\\AppData\\Local',
  };
  assert.equal(
    resolveConfigPath({ platform: 'win32', env, home: 'C:\\Users\\Agent' }),
    'C:\\Users\\Agent\\AppData\\Roaming\\aia-pgs\\config.json',
  );
  assert.equal(
    resolveProfileDir({ platform: 'win32', env, home: 'C:\\Users\\Agent' }),
    'C:\\Users\\Agent\\AppData\\Local\\AIA-PGS-Automation',
  );
  assert.equal(
    resolveDefaultChromeDir({ platform: 'win32', env, home: 'C:\\Users\\Agent' }),
    'C:\\Users\\Agent\\AppData\\Local\\Google\\Chrome\\User Data',
  );
});

test('finds common Windows Chrome installations', () => {
  const candidates = chromeExecutableCandidates({
    platform: 'win32',
    env: {
      ProgramFiles: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LocalAppData: 'C:\\Users\\Agent\\AppData\\Local',
    },
  });
  assert.deepEqual(candidates, [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\Agent\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
  ]);
});

test('uses a per-account opaque Windows DPAPI file', () => {
  const options = {
    env: { APPDATA: 'C:\\Users\\Agent\\AppData\\Roaming' },
    home: 'C:\\Users\\Agent',
  };
  const first = windowsPasswordPath('A1234', options);
  const second = windowsPasswordPath('B5678', options);
  assert.notEqual(first, second);
  assert.equal(first.includes('A1234'), false);
  assert.match(first, /\\password-[a-f0-9]{16}\.dpapi$/);
});

test('uses XDG paths for Linux automation state', () => {
  const env = { XDG_CONFIG_HOME: '/home/agent/.config' };
  assert.equal(
    resolveConfigPath({ platform: 'linux', env, home: '/home/agent' }),
    '/home/agent/.config/aia-pgs/config.json',
  );
  assert.equal(
    resolveProfileDir({ platform: 'linux', env, home: '/home/agent' }),
    '/home/agent/.config/aia-pgs-automation',
  );
});

test('detects default Chrome profile overlap on every supported path style', () => {
  assert.equal(
    pathsOverlap(
      '/Users/agent/Library/Application Support/Google/Chrome/Default',
      '/Users/agent/Library/Application Support/Google/Chrome',
      'darwin',
    ),
    true,
  );
  assert.equal(
    pathsOverlap(
      'C:\\Users\\Agent\\AppData\\Local\\Google\\Chrome\\User Data',
      'c:\\users\\agent\\appdata\\local\\google\\chrome\\user data\\Default',
      'win32',
    ),
    true,
  );
  assert.equal(
    pathsOverlap(
      '/home/agent/.config/aia-pgs-automation',
      '/home/agent/.config/google-chrome',
      'linux',
    ),
    false,
  );
});

test('rejects configured profiles that contain or resolve into daily Chrome data', () => {
  const home = '/Users/agent';
  const dailyChrome = `${home}/Library/Application Support/Google/Chrome`;
  assert.equal(profileOverlapsDefaultChrome({
    platform: 'darwin',
    home,
    env: { AIA_PGS_PROFILE_DIR: `${dailyChrome}/Default` },
    exists: () => false,
    realpath: value => value,
  }), true);
  assert.equal(profileOverlapsDefaultChrome({
    platform: 'darwin',
    home,
    env: { AIA_PGS_PROFILE_DIR: `${home}/Library/Application Support/Google` },
    exists: () => false,
    realpath: value => value,
  }), true);
  assert.equal(profileOverlapsDefaultChrome({
    platform: 'darwin',
    home,
    env: { AIA_PGS_PROFILE_DIR: '/tmp/aia-profile-link' },
    exists: () => false,
    realpath: value => value === '/tmp/aia-profile-link' ? dailyChrome : value,
  }), true);
  assert.equal(profileOverlapsDefaultChrome({
    platform: 'darwin',
    home,
    env: { AIA_PGS_PROFILE_DIR: '/tmp/aia-profile-link/new-profile' },
    exists: () => false,
    realpath: value => {
      if (value === '/tmp/aia-profile-link/new-profile') throw new Error('not found');
      return value === '/tmp/aia-profile-link' ? dailyChrome : value;
    },
  }), true);
  assert.equal(profileOverlapsDefaultChrome({
    platform: 'darwin',
    home,
    env: { AIA_PGS_PROFILE_DIR: `${home}/Library/Application Support/AIA-PGS-Automation` },
    exists: () => false,
    realpath: value => value,
  }), false);
});
