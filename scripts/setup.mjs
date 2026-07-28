#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import {
  readStoredPassword,
  storePassword,
  supportsStoredPassword,
} from './credentials.mjs';
import {
  findChromeExecutable,
  profileOverlapsDefaultChrome,
  resolveConfigPath,
  resolveProfileDir,
} from './runtime-platform.mjs';

const MIN_NODE_MAJOR = 20;
const CONFIG_PATH = resolveConfigPath();

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : '';
}

function readConfiguredUsername() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return typeof config.username === 'string' ? config.username.trim() : '';
  } catch {
    return '';
  }
}

async function checkPrerequisites() {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < MIN_NODE_MAJOR) {
    throw new Error(`需要 Node.js ${MIN_NODE_MAJOR} 或更高版本，当前为 ${process.versions.node}`);
  }
  if (!['darwin', 'win32', 'linux'].includes(process.platform)) {
    throw new Error(`不支持当前操作系统：${process.platform}`);
  }
  if (!findChromeExecutable()) {
    throw new Error('未找到 Google Chrome。请先运行 npm run setup:chrome');
  }
  if (profileOverlapsDefaultChrome()) {
    throw new Error(
      '自动化 profile 与日常 Chrome 用户目录重叠。请删除或修改 AIA_PGS_PROFILE_DIR',
    );
  }
  try {
    await import('playwright');
  } catch {
    throw new Error('未安装 Playwright。请先运行 npm install');
  }
}

async function collectEnvironmentChecks(configuredUsername) {
  const platformNames = {
    darwin: 'macOS',
    win32: 'Windows',
    linux: 'Linux',
  };
  const checks = [];
  const add = (label, ok, detail, action = '') => {
    checks.push({ label, ok, detail, action });
  };

  const platformName = platformNames[process.platform] || process.platform;
  add(
    '操作系统',
    Boolean(platformNames[process.platform]),
    platformName,
    '当前仅支持 macOS、Windows 和 Linux',
  );

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add(
    'Node.js',
    nodeMajor >= MIN_NODE_MAJOR,
    process.versions.node,
    `安装 Node.js ${MIN_NODE_MAJOR} 或更高版本后重新打开终端`,
  );

  const chromePath = findChromeExecutable();
  add(
    'Google Chrome',
    Boolean(chromePath),
    chromePath || '未找到',
    '安装正式版 Google Chrome；安装完成后重新运行 npm run setup:check',
  );

  let playwrightReady = false;
  try {
    await import('playwright');
    playwrightReady = true;
  } catch {}
  add(
    'Playwright 依赖',
    playwrightReady,
    playwrightReady ? '已安装' : '未安装',
    '在 Skill 根目录运行 npm install',
  );

  const profileDir = resolveProfileDir();
  const profileSafe = !profileOverlapsDefaultChrome();
  add(
    'Chrome profile 隔离',
    profileSafe,
    profileSafe ? profileDir : '与日常 Chrome 用户目录重叠',
    '删除或修正 AIA_PGS_PROFILE_DIR，必须使用独立自动化目录',
  );

  add(
    'Agency 用户编号',
    Boolean(configuredUsername),
    configuredUsername ? '已配置' : '未配置',
    '运行 npm run setup -- --username "<用户编号>"',
  );

  if (configuredUsername && supportsStoredPassword()) {
    const passwordReady = Boolean(readStoredPassword(configuredUsername));
    add(
      'Agency 密码安全存储',
      passwordReady,
      passwordReady ? '已配置' : '未配置',
      '运行 npm run setup，按系统提示安全输入密码',
    );
  } else if (!supportsStoredPassword()) {
    add('Agency 密码模式', true, '登录时在独立 Chrome 中手动输入');
  }

  add(
    '自动化 Chrome profile',
    fs.existsSync(profileDir),
    fs.existsSync(profileDir) ? '已初始化' : '未初始化',
    '完成账号 setup 后运行 npm run setup:outlook，并在专用 Chrome 中登录 Outlook',
  );

  return checks;
}

function printEnvironmentChecks(checks) {
  console.log('AIA_PGS_ENVIRONMENT_CHECK');
  for (const check of checks) {
    console.log(`${check.ok ? '✅' : '❌'} ${check.label}: ${check.detail}`);
    if (!check.ok && check.action) console.log(`   处理：${check.action}`);
  }
  const failed = checks.filter(check => !check.ok);
  if (failed.length) {
    console.error(`SETUP_NOT_READY failed=${failed.length}`);
    process.exitCode = 1;
    return false;
  }
  console.log(supportsStoredPassword() ? 'SETUP_OK' : 'SETUP_OK PASSWORD_MODE=MANUAL');
  console.log('ℹ️ 本地环境已就绪；Outlook 登录态和香港网络请用 npm run login:fresh 实际验证');
  return true;
}

async function main() {
  const configuredUsername = readConfiguredUsername();
  if (process.argv.includes('--check')) {
    printEnvironmentChecks(await collectEnvironmentChecks(configuredUsername));
    return;
  }

  await checkPrerequisites();

  let username = argumentValue('--username')
    || process.env.AGENCY_USERNAME?.trim()
    || configuredUsername;
  if (!username) {
    const readline = createInterface({ input: stdin, output: stdout });
    username = (await readline.question('Agency 用户编号：')).trim();
    readline.close();
  }
  if (!/^[A-Za-z0-9._@-]{1,128}$/.test(username)) {
    throw new Error('Agency 用户编号只能包含字母、数字、点、下划线、@ 或连字符');
  }

  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify({ username }, null, 2)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(CONFIG_PATH, 0o600);
  console.log(`✅ 已保存 Agency 用户编号配置：${CONFIG_PATH}`);

  if (supportsStoredPassword()) {
    const resetPassword = process.argv.includes('--reset-password');
    if (!resetPassword && readStoredPassword(username)) {
      console.log('✅ 操作系统安全存储中已存在 Agency 密码');
    } else {
      console.log('请在系统安全提示中输入 Agency 密码；不要把密码发给 Agent：');
      if (!storePassword(username)) throw new Error('Agency 密码未成功写入系统安全存储');
      console.log('✅ Agency 密码已写入系统安全存储');
    }
  } else {
    console.log('ℹ️ Linux 不持久化密码；登录时请在 Chrome 密码框中手动输入');
  }

  console.log('下一步：npm run setup:outlook');
}

main().catch(error => fail(error.message));
