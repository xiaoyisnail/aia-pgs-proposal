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

async function main() {
  await checkPrerequisites();

  const configuredUsername = readConfiguredUsername();
  if (process.argv.includes('--check')) {
    if (!configuredUsername) throw new Error('尚未保存 Agency 用户编号，请运行 npm run setup');
    if (
      supportsStoredPassword()
      && !readStoredPassword(configuredUsername)
    ) {
      throw new Error('尚未安全保存 Agency 密码，请运行 npm run setup');
    }
    console.log(supportsStoredPassword() ? 'SETUP_OK' : 'SETUP_OK PASSWORD_MODE=MANUAL');
    return;
  }

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
