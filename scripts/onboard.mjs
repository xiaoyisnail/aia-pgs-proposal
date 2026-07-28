#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  findChromeExecutable,
  resolveConfigPath,
} from './runtime-platform.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ONBOARDING_VERSION = 1;

function fail(code, message) {
  throw new Error(`${code}: ${message}`);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function commandPath(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : '';
}

function run(command, args, code) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) fail(code, result.error.message);
  if (result.status !== 0) {
    fail(code, `${command} ${args.join(' ')} 退出码 ${result.status ?? 'unknown'}`);
  }
}

function installedDependencyMatches(name, expectedVersion) {
  const packagePath = path.join(ROOT, 'node_modules', name, 'package.json');
  const installed = readJson(packagePath).version;
  return installed === expectedVersion;
}

function ensureDependencies() {
  const packageJson = readJson(path.join(ROOT, 'package.json'));
  const expectedPlaywright = packageJson.dependencies?.playwright;
  if (expectedPlaywright
    && installedDependencyMatches('playwright', expectedPlaywright)) {
    console.log(`✅ Playwright ${expectedPlaywright} 已安装`);
    return;
  }
  console.log('📦 正在安装锁定的本地依赖…');
  run(commandPath('npm'), ['ci'], 'DEPENDENCY_INSTALL_FAILED');
}

function ensureChrome() {
  const existing = findChromeExecutable();
  if (existing) {
    console.log(`✅ Google Chrome: ${existing}`);
    return;
  }

  console.log('📦 未检测到 Google Chrome，正在尝试通过 Playwright 安装正式版 Chrome…');
  const executable = path.join(
    ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'playwright.cmd' : 'playwright',
  );
  run(executable, ['install', 'chrome'], 'CHROME_INSTALL_FAILED');
  const installed = findChromeExecutable();
  if (!installed) {
    fail(
      'CHROME_NOT_FOUND',
      '自动安装后仍未检测到 Chrome。请从 https://www.google.com/chrome/ 安装后重试',
    );
  }
  console.log(`✅ Google Chrome 已安装: ${installed}`);
}

function readOnboardingState() {
  return readJson(resolveConfigPath());
}

function writeOnboardingState() {
  const configPath = resolveConfigPath();
  const config = readJson(configPath);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({ ...config, onboardingVersion: ONBOARDING_VERSION }, null, 2)}\n`,
    { mode: 0o600 },
  );
  if (process.platform !== 'win32') fs.chmodSync(configPath, 0o600);
}

async function confirmHongKongNetwork() {
  if (process.env.AIA_PGS_HK_NETWORK_CONFIRMED === '1') return;
  const readline = createInterface({ input: stdin, output: stdout });
  const answer = (
    await readline.question('请先连接香港 VPN/香港网络；已连接请输入 y：')
  ).trim().toLowerCase();
  readline.close();
  if (!['y', 'yes'].includes(answer)) {
    fail('HK_NETWORK_REQUIRED', '尚未确认香港网络，初始化已安全暂停');
  }
}

function printNextUsage(alreadyReady = false) {
  console.log(alreadyReady ? 'ONBOARDING_ALREADY_OK' : 'ONBOARDING_OK');
  console.log('✅ 这台机器已准备好。以后只需告诉 Agent：');
  console.log('   “帮我生成一份重疾险计划书”');
  console.log('   或“帮我生成一份储蓄险计划书”');
}

async function main() {
  if (!['darwin', 'win32'].includes(process.platform)) {
    fail('PLATFORM_UNSUPPORTED', '自动初始化目前仅支持 macOS 和 Windows');
  }

  console.log(`AIA_PGS_ONBOARDING platform=${process.platform}`);
  ensureDependencies();
  ensureChrome();

  const state = readOnboardingState();
  if (state.onboardingVersion >= ONBOARDING_VERSION) {
    run(process.execPath, ['scripts/setup.mjs', '--check'], 'SETUP_CHECK_FAILED');
    printNextUsage(true);
    return;
  }

  const username = argumentValue('--username');
  const setupArguments = ['scripts/setup.mjs'];
  if (username) setupArguments.push('--username', username);
  run(process.execPath, setupArguments, 'ACCOUNT_SETUP_FAILED');
  run(
    process.execPath,
    ['scripts/login-agency.mjs', '--setup-outlook'],
    'OUTLOOK_SETUP_FAILED',
  );
  await confirmHongKongNetwork();
  run(
    process.execPath,
    ['scripts/login-agency.mjs', '--fresh-login'],
    'AGENCY_LOGIN_VERIFICATION_FAILED',
  );
  run(process.execPath, ['scripts/setup.mjs', '--check'], 'SETUP_CHECK_FAILED');
  writeOnboardingState();
  printNextUsage();
}

main().catch(error => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
