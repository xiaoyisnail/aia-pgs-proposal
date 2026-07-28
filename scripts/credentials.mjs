import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

import { resolveConfigDir } from './runtime-platform.mjs';

const CREDENTIAL_SERVICE = 'aia-pgs-agency';

function windowsPasswordPath(username, options) {
  const digest = createHash('sha256').update(username).digest('hex').slice(0, 16);
  return path.win32.join(resolveConfigDir({ ...options, platform: 'win32' }), `password-${digest}.dpapi`);
}

function readMacPassword(username) {
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-a', username, '-s', CREDENTIAL_SERVICE, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return '';
  }
}

function readWindowsPassword(username, options) {
  const secretPath = windowsPasswordPath(username, options);
  if (!fs.existsSync(secretPath)) return '';
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$encrypted = [IO.File]::ReadAllText($env:AIA_PGS_SECRET_PATH)',
    '$secure = ConvertTo-SecureString -String $encrypted',
    "$credential = New-Object System.Management.Automation.PSCredential('aia-pgs', $secure)",
    '$bytes = [Text.Encoding]::UTF8.GetBytes($credential.GetNetworkCredential().Password)',
    '[Console]::Out.Write([Convert]::ToBase64String($bytes))',
  ].join('; ');
  try {
    const encoded = execFileSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        env: { ...process.env, AIA_PGS_SECRET_PATH: secretPath },
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    return Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function readStoredPassword(username, options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'darwin') return readMacPassword(username);
  if (platform === 'win32') return readWindowsPassword(username, options);
  return '';
}

function supportsStoredPassword(platform = process.platform) {
  return platform === 'darwin' || platform === 'win32';
}

function storeMacPassword(username) {
  return spawnSync(
    'security',
    ['add-generic-password', '-U', '-a', username, '-s', CREDENTIAL_SERVICE, '-w'],
    { stdio: 'inherit' },
  ).status === 0;
}

function storeWindowsPassword(username, options) {
  const secretPath = windowsPasswordPath(username, options);
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$secure = Read-Host 'Agency Corner password' -AsSecureString",
    '$encrypted = ConvertFrom-SecureString -SecureString $secure',
    '[IO.File]::WriteAllText($env:AIA_PGS_SECRET_PATH, $encrypted, [Text.Encoding]::UTF8)',
  ].join('; ');
  return spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-Command', script],
    {
      env: { ...process.env, AIA_PGS_SECRET_PATH: secretPath },
      stdio: 'inherit',
    },
  ).status === 0;
}

function storePassword(username, options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'darwin') return storeMacPassword(username);
  if (platform === 'win32') return storeWindowsPassword(username, options);
  return false;
}

export {
  CREDENTIAL_SERVICE,
  readStoredPassword,
  storePassword,
  supportsStoredPassword,
  windowsPasswordPath,
};
