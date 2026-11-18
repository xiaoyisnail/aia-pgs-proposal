#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  profileOverlapsDefaultChrome,
  resolveConfigPath,
  resolveProfileDir,
} from './runtime-platform.mjs';

const AGENCY_LOGIN_URL = 'https://aiahk-agency-prd.aia.com.hk/agency/login.do';
const AGENCY_HOME_URL = 'https://aiahk-blob01-prd.aia.com.hk/agency/zh-hk/home';
const OUTLOOK_URL = 'https://outlook.office.com/mail/';
const DEFAULT_TIMEOUT = 30_000;
const MANUAL_ACTION_TIMEOUT = 5 * 60_000;
const OTP_TIMEOUT = 2 * 60_000;
export const MANUAL_LOGIN_EXIT_CODE = 2;

const BUTTONS = {
  confirm: /^(?:Confirm|確認|确认|确定|確定|提交)$/i,
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class LoginError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'LoginError';
    this.code = code;
  }
}

function readStoredUsername(configPath = resolveConfigPath()) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return typeof config.username === 'string' ? config.username.trim() : '';
  } catch {
    return '';
  }
}

async function loadChromium() {
  try {
    const module = await import('playwright');
    return module.chromium;
  } catch {}

  if (process.env.PLAYWRIGHT_MODULE && fs.existsSync(process.env.PLAYWRIGHT_MODULE)) {
    const module = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
    return module.chromium;
  }

  throw new LoginError(
    'PLAYWRIGHT_NOT_FOUND',
    '未找到 Playwright。请在 Skill 根目录运行 npm install',
  );
}

function isAgencyHomeUrl(value) {
  try {
    const url = new URL(value);
    return (
      /aia\.com\.hk$/i.test(url.hostname)
      && /\/agency(?:\/[^/]+)*\/home(?:[/?#]|$)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function isAgencyUrl(value) {
  try {
    const url = new URL(value);
    return /aia\.com\.hk$/i.test(url.hostname) && /\/agency(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isAgencyCookieDomain(value) {
  const domain = value.replace(/^\./, '');
  return /(?:^|\.)aia\.com(?:\.hk)?$/i.test(domain);
}

function isOutlookUrl(value) {
  try {
    const hostname = new URL(value).hostname;
    return /^(?:outlook\.office(?:365)?\.com|outlook\.live\.com|outlook\.cloud\.microsoft)$/i.test(hostname);
  } catch {
    return false;
  }
}

function normalizeReference(value) {
  return value?.replace(/[^a-z0-9]/gi, '').toUpperCase() || '';
}

function isOtpConfirmLabel(value) {
  return BUTTONS.confirm.test(value.trim());
}

function extractReferenceNumber(text) {
  const patterns = [
    /(?:參考編號|参考编号)\s*[：:#.-]?\s*([a-z]{1,4}\d{2,10})/i,
    /(?:reference\s*(?:number|no\.?)?|ref(?:erence)?\s*no\.?)\s*[：:#.-]?\s*([a-z]{1,4}\d{2,10})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return normalizeReference(match[1]);
  }
  return '';
}

function extractOtpCode(text, expectedReference) {
  const normalizedReference = normalizeReference(expectedReference);
  if (!normalizedReference) return null;

  const compactText = text.replace(/\s+/g, ' ');
  if (!normalizeReference(compactText).includes(normalizedReference)) return null;

  const patterns = [
    /(?:驗證碼|验证码|一次性密碼|一次性密码|one[- ]time password|one[- ]time code|OTP)[^\d]{0,50}(\d{6})/i,
    /\b(\d{6})\b(?=[^\n]{0,100}(?:是您的|驗證碼|验证码|一次性|one[- ]time|OTP))/i,
  ];
  for (const pattern of patterns) {
    const match = compactText.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function maskReference(reference) {
  if (reference.length < 3) return '***';
  return `${reference[0]}***${reference.at(-1)}`;
}

async function firstVisible(locators) {
  for (const locator of locators) {
    const candidate = locator.first();
    if (await candidate.isVisible({ timeout: 250 }).catch(() => false)) return candidate;
  }
  return null;
}

async function findOutlookSearchBox(page) {
  return firstVisible([
    page.getByRole('searchbox'),
    page.locator('input[aria-label*="Search" i]'),
    page.locator('input[placeholder*="Search" i]'),
    page.locator('input[aria-label*="搜尋"]'),
    page.locator('input[aria-label*="搜索"]'),
  ]);
}

async function ensureOutlookReady(context) {
  let outlook = context.pages().find(page => isOutlookUrl(page.url()) && !page.isClosed());
  if (!outlook) {
    outlook = await context.newPage();
    await outlook.goto(OUTLOOK_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }

  let announced = false;
  const manualPromptAt = Date.now() + 5_000;
  const deadline = Date.now() + MANUAL_ACTION_TIMEOUT;
  while (Date.now() < deadline) {
    if (isOutlookUrl(outlook.url())) {
      const searchBox = await findOutlookSearchBox(outlook);
      if (searchBox) return { outlook, searchBox };
    }
    if (!announced && Date.now() >= manualPromptAt) {
      await outlook.bringToFront();
      console.log('   ⏸ Outlook 尚未就绪；若出现登录页请完成登录，脚本将自动继续（最多等待 5 分钟）');
      announced = true;
    }
    await sleep(500);
  }

  throw new LoginError('OUTLOOK_NOT_READY', 'Outlook 未在等待时间内进入已登录邮箱页面');
}

async function readOtpFromOutlook(
  context,
  expectedReference,
  ignoredCodes = new Set(),
  timeout = OTP_TIMEOUT,
) {
  const reference = normalizeReference(expectedReference);
  if (!reference) {
    throw new LoginError('OTP_REFERENCE_NOT_FOUND', 'SSO 页面没有显示本轮验证码参考编号');
  }

  const { outlook } = await ensureOutlookReady(context);
  const query = `from:otp@aia.com.hk "${reference}"`;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const searchBox = await findOutlookSearchBox(outlook);
    if (!searchBox) {
      throw new LoginError('OUTLOOK_NOT_READY', 'Outlook 搜索框不可用，登录状态可能已失效');
    }

    await searchBox.fill(query);
    await searchBox.press('Enter');
    await sleep(1_000);

    const items = outlook.locator('[role="option"], [data-convid], [role="treeitem"]');
    const texts = await items.allTextContents().catch(() => []);
    const matchingIndexes = [];
    for (let index = 0; index < texts.length; index++) {
      const text = texts[index];
      if (
        normalizeReference(text).includes(reference)
        || /otp@aia\.com\.hk|one-time|一次性|驗證碼|验证码/i.test(text)
      ) {
        matchingIndexes.push(index);
      }
    }

    for (const index of matchingIndexes.slice(0, 5)) {
      await items.nth(index).click().catch(() => {});
      await sleep(500);

      const messageTexts = [];
      for (const frame of outlook.frames().slice(1)) {
        const text = await frame.locator('body').innerText().catch(() => '');
        if (text) messageTexts.push(text);
      }
      const readingPane = await firstVisible([
        outlook.locator('[role="document"]'),
        outlook.locator('[data-app-section="MailReadCompose"]'),
        outlook.locator('[aria-label*="Message body" i]'),
        outlook.locator('[aria-label*="郵件本文"]'),
        outlook.locator('[aria-label*="邮件正文"]'),
      ]);
      if (readingPane) {
        const text = await readingPane.innerText().catch(() => '');
        if (text) messageTexts.push(text);
      }
      messageTexts.push(texts[index]);

      for (const messageText of messageTexts) {
        const code = extractOtpCode(messageText, reference);
        if (code && !ignoredCodes.has(code)) {
          console.log('   📬 已从匹配邮件正文取得验证码');
          return code;
        }
      }
    }

    await sleep(2_000);
  }

  throw new LoginError(
    'OTP_EMAIL_TIMEOUT',
    `未找到与参考编号 ${maskReference(reference)} 匹配的 Outlook 邮件`,
  );
}

async function ensureAgencyLoggedIn(context, { waitMs = MANUAL_ACTION_TIMEOUT, freshLogin = false } = {}) {
  const openPages = () => context.pages().filter(page => !page.isClosed());
  const staleHomes = new Set(freshLogin ? openPages().filter(page => isAgencyHomeUrl(page.url())) : []);
  const findHome = active => openPages().find(page => isAgencyHomeUrl(page.url())
    && (page === active || !staleHomes.has(page)));
  const existing = findHome();
  if (existing) {
    console.log('✅ Agency Corner 已登录（现有会话）');
    return existing;
  }

  const page = openPages().find(candidate => isAgencyUrl(candidate.url()))
    || openPages().find(candidate => candidate.url() === 'about:blank')
    || await context.newPage();
  const navigation = { waitUntil: 'domcontentloaded', timeout: 60_000 };
  // The login endpoint can start a new challenge even when the protected home is still accessible.
  if (!freshLogin) {
    const response = await page.goto(AGENCY_HOME_URL, navigation);
    if (response?.ok() && isAgencyHomeUrl(page.url())) {
      console.log('✅ Agency Corner 已登录（恢复现有会话）');
      return page;
    }
  }
  if (freshLogin || !page.url().startsWith(AGENCY_LOGIN_URL)) {
    await page.goto(AGENCY_LOGIN_URL, navigation);
  }
  const redirectedHome = findHome(page);
  if (redirectedHome) {
    console.log('✅ Agency Corner 已登录（现有会话）');
    return redirectedHome;
  }

  console.log('MANUAL_LOGIN_REQUIRED 请在独立 Chrome 手动登录 Agency Corner，完成后自动继续。');
  await page.bringToFront().catch(() => {});
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && openPages().length) {
    const home = findHome(page);
    if (home) {
      console.log('✅ Agency Corner 手动登录成功');
      return home;
    }
    await sleep(500);
  }
  throw new LoginError(
    'MANUAL_LOGIN_TIMEOUT',
    Number.isFinite(waitMs)
      ? '登录窗口已关闭或 5 分钟内未进入 Agency Corner 首页，请重新运行并完成手动登录'
      : '登录窗口已关闭，尚未进入 Agency Corner 首页',
  );
}

async function clearAgencySession(context) {
  const cookies = await context.cookies();
  const agencyCookies = cookies.filter(cookie => isAgencyCookieDomain(cookie.domain));
  for (const cookie of agencyCookies) {
    await context.clearCookies({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
    });
  }
  console.log(`🧹 已清除 ${agencyCookies.length} 个 AIA 会话 Cookie（Outlook 登录态保留）`);
}

async function launchAutomationContext({ freshLogin = false } = {}) {
  const chromium = await loadChromium();
  const profileDir = resolveProfileDir();
  if (profileOverlapsDefaultChrome()) {
    throw new LoginError(
      'DEFAULT_CHROME_PROFILE_FORBIDDEN',
      '自动化 profile 不能等于、位于或包含日常 Chrome 用户目录，请设置独立的 AIA_PGS_PROFILE_DIR',
    );
  }
  fs.mkdirSync(profileDir, { recursive: true });

  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless: false,
      viewport: null,
      acceptDownloads: true,
      args: freshLogin ? ['--no-first-run'] : ['--no-first-run', '--restore-last-session'],
      timeout: 60_000,
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (/ProcessSingleton|profile.*in use|SingletonLock/i.test(message)) {
      throw new LoginError(
        'BROWSER_PROFILE_IN_USE',
        `自动化 Chrome profile 正被其他进程使用：${profileDir}`,
      );
    }
    throw error;
  }

  context.setDefaultTimeout(DEFAULT_TIMEOUT);
  console.log(`🚀 独立自动化 Chrome 已启动（profile: ${profileDir}）`);
  return {
    context,
    profileDir,
    close: () => context.close(),
  };
}

async function runLoginOnly() {
  let session;
  try {
    const freshLogin = process.argv.includes('--fresh-login');
    session = await launchAutomationContext({ freshLogin });
    if (freshLogin) {
      await clearAgencySession(session.context);
    }
    const home = await ensureAgencyLoggedIn(session.context, { freshLogin });
    const url = new URL(home.url());
    console.log(`LOGIN_OK ${url.origin}${url.pathname}`);
  } finally {
    await session?.close().catch(() => {});
  }
}

async function runOutlookSetup() {
  let session;
  try {
    session = await launchAutomationContext();
    await ensureOutlookReady(session.context);
    console.log('OUTLOOK_OK');
  } finally {
    await session?.close().catch(() => {});
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const command = process.argv.includes('--setup-outlook')
    ? runOutlookSetup
    : runLoginOnly;
  command().catch(error => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  LoginError,
  clearAgencySession,
  ensureAgencyLoggedIn,
  extractOtpCode,
  extractReferenceNumber,
  isAgencyCookieDomain,
  isAgencyHomeUrl,
  isOtpConfirmLabel,
  isOutlookUrl,
  launchAutomationContext,
  normalizeReference,
  readOtpFromOutlook,
  readStoredUsername,
  resolveConfigPath,
  resolveProfileDir,
};
