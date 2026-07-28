#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AGENCY_LOGIN_URL = 'https://aiahk-agency-prd.aia.com.hk/agency/login.do';
const OUTLOOK_URL = 'https://outlook.office.com/mail/';
const DEFAULT_USERNAME = 'H3926';
const DEFAULT_TIMEOUT = 30_000;
const MANUAL_ACTION_TIMEOUT = 5 * 60_000;
const OTP_TIMEOUT = 2 * 60_000;

const BUTTONS = {
  login: /^Login$|^登入$|^登录$/,
  sendOtp: /Send OTP|Resend OTP|發送.*驗證碼|发送.*验证码|重新發送|重新发送/i,
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

function expandHome(input) {
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return input;
}

function resolveProfileDir() {
  if (process.env.AIA_PGS_PROFILE_DIR) {
    return path.resolve(expandHome(process.env.AIA_PGS_PROFILE_DIR));
  }

  const existingProfile = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Google',
    'Chrome-Debug',
  );
  if (fs.existsSync(existingProfile)) return existingProfile;

  return path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'AIA-PGS-Automation',
  );
}

async function loadChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    path.join(
      os.homedir(),
      '.workbuddy',
      'binaries',
      'node',
      'workspace',
      'node_modules',
      'playwright',
      'index.mjs',
    ),
  ].filter(Boolean);

  try {
    const module = await import('playwright');
    return module.chromium;
  } catch {}

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const module = await import(pathToFileURL(candidate).href);
    return module.chromium;
  }

  throw new LoginError(
    'PLAYWRIGHT_NOT_FOUND',
    '未找到 Playwright。请安装 playwright，或设置 PLAYWRIGHT_MODULE 指向 index.mjs',
  );
}

function readKeychainPassword(username) {
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-a', username, '-s', 'aia-pgs-agency', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return '';
  }
}

function getAgencyCredentials() {
  const username = process.env.AGENCY_USERNAME || DEFAULT_USERNAME;
  const password = process.env.AGENCY_PASSWORD || readKeychainPassword(username);
  return { username, password };
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

async function visibleButton(page, name) {
  return firstVisible([
    page.getByRole('button', { name }),
    page.locator('button').filter({ hasText: name }),
    page.locator('input[type="submit"]').filter({ hasText: name }),
  ]);
}

async function inspectLoginState(context) {
  const pages = context.pages().filter(page => !page.isClosed()).reverse();
  const home = pages.find(page => isAgencyHomeUrl(page.url()));
  if (home) return { name: 'AGENCY_HOME', page: home };

  for (const page of pages) {
    const username = page.locator('#username');
    if (await username.isVisible({ timeout: 100 }).catch(() => false)) {
      return { name: 'AGENCY_USERNAME', page, locator: username };
    }

    const password = page.locator('input[type="password"]');
    if (await password.first().isVisible({ timeout: 100 }).catch(() => false)) {
      return { name: 'SSO_PASSWORD', page, locator: password.first() };
    }

    const sendOtp = await visibleButton(page, BUTTONS.sendOtp);
    const otpInput = await firstVisible([
      page.locator('input[autocomplete="one-time-code"]'),
      page.locator('input[name*="otp" i]'),
      page.locator('input[id*="otp" i]'),
      page.locator('input[inputmode="numeric"]'),
    ]);
    if (sendOtp || otpInput) {
      return { name: 'SSO_OTP', page, sendOtp, otpInput };
    }
  }

  return null;
}

async function waitForLoginState(context, names, timeout = DEFAULT_TIMEOUT) {
  const expected = new Set(names);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await inspectLoginState(context);
    if (state && expected.has(state.name)) return state;
    await sleep(250);
  }
  const pageStates = await Promise.all(
    context.pages().filter(page => !page.isClosed()).map(async page => {
      let location = page.url();
      try {
        const url = new URL(location);
        location = `${url.origin}${url.pathname}`;
      } catch {}
      const title = await page.title().catch(() => '');
      const controls = await page.evaluate(() => {
        const visible = element => {
          const style = getComputedStyle(element);
          return style.display !== 'none' && style.visibility !== 'hidden';
        };
        const inputs = [...document.querySelectorAll('input')]
          .filter(visible)
          .slice(0, 8)
          .map(input => ({
            type: input.type || '',
            name: input.name || '',
            id: input.id || '',
            autocomplete: input.autocomplete || '',
          }));
        const buttons = [...document.querySelectorAll('button, input[type="submit"]')]
          .filter(visible)
          .slice(0, 8)
          .map(button => (button.innerText || button.value || '').trim());
        return { inputs, buttons };
      }).catch(() => ({ inputs: [], buttons: [] }));
      return `${title || '<untitled>'} @ ${location} ${JSON.stringify(controls)}`;
    }),
  );
  throw new LoginError(
    'LOGIN_STATE_TIMEOUT',
    `等待登录状态超时，期望：${[...expected].join(', ')}；当前页面：${pageStates.join(' | ')}`,
  );
}

async function waitForPassword(page, passwordInput, configuredPassword) {
  if (configuredPassword) {
    await passwordInput.fill(configuredPassword);
    return;
  }

  if (await passwordInput.inputValue().catch(() => '')) return;

  console.log('   ⏸ 请在 Chrome 密码页输入密码；脚本将自动继续（最多等待 5 分钟）');
  const deadline = Date.now() + MANUAL_ACTION_TIMEOUT;
  let lastValue = '';
  let stableSince = 0;
  while (Date.now() < deadline) {
    if (page.isClosed()) break;
    const value = await passwordInput.inputValue().catch(() => '');
    if (value && value === lastValue) {
      if (Date.now() - stableSince >= 750) return;
    } else {
      lastValue = value;
      stableSince = Date.now();
    }
    if (!await passwordInput.isVisible({ timeout: 100 }).catch(() => false)) return;
    await sleep(150);
  }

  throw new LoginError(
    'AGENCY_PASSWORD_REQUIRED',
    '未配置密码且 Chrome 未自动填充。请设置 AGENCY_PASSWORD 或保存到 macOS 钥匙串',
  );
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

  await outlook.bringToFront();
  let announced = false;
  const deadline = Date.now() + MANUAL_ACTION_TIMEOUT;
  while (Date.now() < deadline) {
    if (isOutlookUrl(outlook.url())) {
      const searchBox = await findOutlookSearchBox(outlook);
      if (searchBox) return { outlook, searchBox };
    }
    if (!announced) {
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

async function waitForReference(page, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const text = await page.locator('body').innerText().catch(() => '');
    const reference = extractReferenceNumber(text);
    if (reference) return reference;
    await sleep(250);
  }
  throw new LoginError('OTP_REFERENCE_NOT_FOUND', '发送验证码后 SSO 页面未显示参考编号');
}

function redactDiagnosticText(text) {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<email>')
    .replace(/\b\d{6}\b/g, '******')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

async function visibleOtpError(page) {
  const errorPattern = /(?:(?:OTP|verification code|one-time|驗證碼|验证码).{0,100}(?:wrong|incorrect|invalid|expired|錯誤|错误|不正確|不正确|無效|无效|已過期|已过期|已失效)|(?:wrong|incorrect|invalid|expired|錯誤|错误|不正確|不正确|無效|无效|已過期|已过期|已失效).{0,100}(?:OTP|verification code|one-time|驗證碼|验证码))/i;
  const candidates = page.locator(
    '[role="alert"], [aria-live="assertive"], .error, [class*="error-message" i], [class*="alert-danger" i]',
  );
  const count = await candidates.count().catch(() => 0);
  for (let index = 0; index < count; index++) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible({ timeout: 100 }).catch(() => false)) continue;
    const text = await candidate.innerText().catch(() => '');
    if (errorPattern.test(text)) return redactDiagnosticText(text);
  }
  return '';
}

async function waitForOtpOutcome(context, ssoPage, reference) {
  const errorGracePeriod = Date.now() + 12_000;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const home = context.pages().find(page => !page.isClosed() && isAgencyHomeUrl(page.url()));
    if (home) return { name: 'AGENCY_HOME', page: home };

    const errorText = Date.now() >= errorGracePeriod
      ? await visibleOtpError(ssoPage)
      : '';
    if (errorText) {
      console.log(`   ⚠️ SSO 拒绝验证码：${errorText}`);
      return { name: 'OTP_REJECTED' };
    }

    const text = await ssoPage.locator('body').innerText().catch(() => '');
    const currentReference = extractReferenceNumber(text);
    if (currentReference && currentReference !== reference) {
      throw new LoginError('OTP_CHALLENGE_CHANGED', '提交验证码后 SSO 参考编号意外改变');
    }
    await sleep(250);
  }

  throw new LoginError('OTP_SUBMIT_TIMEOUT', '验证码提交后未进入 Agency Corner');
}

async function submitOtp(context, initialState) {
  let state = initialState;
  const usedCodes = new Set();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ssoPage = state.page;
    const sendButton = state.sendOtp || await visibleButton(ssoPage, BUTTONS.sendOtp);
    if (!sendButton) {
      throw new LoginError('OTP_SEND_BUTTON_NOT_FOUND', 'SSO 页面未找到发送验证码按钮');
    }

    await sendButton.click();
    await sleep(750);
    const reference = await waitForReference(ssoPage);
    console.log(`   ✉️ 已发送第 ${attempt} 次验证码（参考编号 ${maskReference(reference)}）`);

    const code = await readOtpFromOutlook(context, reference, usedCodes);
    usedCodes.add(code);
    const currentReference = extractReferenceNumber(
      await ssoPage.locator('body').innerText().catch(() => ''),
    );
    if (currentReference !== reference) {
      throw new LoginError('OTP_CHALLENGE_CHANGED', '读取邮件期间 SSO 参考编号发生变化');
    }

    await ssoPage.bringToFront();
    const otpInput = await firstVisible([
      ssoPage.locator('input[autocomplete="one-time-code"]'),
      ssoPage.locator('input[name*="otp" i]'),
      ssoPage.locator('input[id*="otp" i]'),
      ssoPage.locator('input[inputmode="numeric"]'),
      ssoPage.locator('input[type="text"]'),
    ]);
    if (!otpInput) {
      throw new LoginError('OTP_INPUT_NOT_FOUND', 'SSO 页面未找到验证码输入框');
    }
    const inputDescription = await otpInput.evaluate(input => ({
      type: input.type || '',
      name: input.name || '',
      id: input.id || '',
      autocomplete: input.autocomplete || '',
      inputmode: input.inputMode || '',
    })).catch(() => ({}));
    console.log(`   🔎 OTP 输入控件：${JSON.stringify(inputDescription)}`);
    await otpInput.fill(code);

    const confirm = await visibleButton(ssoPage, BUTTONS.confirm);
    if (confirm) {
      const label = redactDiagnosticText(await confirm.innerText().catch(() => ''));
      console.log(`   🔎 OTP 提交按钮：${label || '<无文本>'}`);
      await confirm.click();
    }
    else await otpInput.press('Enter');
    console.log('   🔐 验证码已提交');

    const outcome = await waitForOtpOutcome(context, ssoPage, reference);
    if (outcome.name === 'AGENCY_HOME') return outcome.page;
    state = await waitForLoginState(context, ['SSO_OTP'], 15_000);
  }

  throw new LoginError('OTP_RETRY_EXHAUSTED', '三次验证码尝试均未成功');
}

async function ensureAgencyLoggedIn(context, credentials = getAgencyCredentials()) {
  let state = await inspectLoginState(context);
  if (state?.name === 'AGENCY_HOME') {
    console.log('✅ Agency Corner 已登录（现有会话）');
    return state.page;
  }

  if (!state) {
    let agencyPage = context.pages().find(page => isAgencyUrl(page.url()) && !page.isClosed());
    if (!agencyPage) agencyPage = await context.newPage();
    await agencyPage.goto(AGENCY_LOGIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    state = await waitForLoginState(
      context,
      ['AGENCY_HOME', 'AGENCY_USERNAME', 'SSO_PASSWORD', 'SSO_OTP'],
      60_000,
    );
  }

  if (state.name === 'AGENCY_HOME') return state.page;

  if (state.name === 'AGENCY_USERNAME') {
    console.log('1) Agency 用户名');
    await state.locator.fill(credentials.username);
    const login = state.page.locator('#login');
    if (!await login.isVisible({ timeout: 1_000 }).catch(() => false)) {
      throw new LoginError('AGENCY_LOGIN_BUTTON_NOT_FOUND', 'Agency 登录页未找到登录按钮');
    }
    await login.click();
    state = await waitForLoginState(
      context,
      ['AGENCY_HOME', 'SSO_PASSWORD', 'SSO_OTP'],
      60_000,
    );
  }

  if (state.name === 'AGENCY_HOME') return state.page;

  if (state.name === 'SSO_PASSWORD') {
    console.log('2) SSO 密码');
    await state.page.bringToFront();
    await waitForPassword(state.page, state.locator, credentials.password);
    const login = await visibleButton(state.page, BUTTONS.login);
    if (login) await login.click();
    else await state.locator.press('Enter');
    state = await waitForLoginState(
      context,
      ['AGENCY_HOME', 'SSO_OTP'],
      60_000,
    );
  }

  if (state.name === 'AGENCY_HOME') {
    console.log('✅ Agency Corner 登录成功（无需 OTP）');
    return state.page;
  }

  if (state.name === 'SSO_OTP') {
    console.log('3) Outlook OTP');
    const home = await submitOtp(context, state);
    console.log('✅ Agency Corner 登录成功');
    return home;
  }

  throw new LoginError('UNEXPECTED_LOGIN_STATE', `无法处理登录状态：${state.name}`);
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

async function launchAutomationContext() {
  const chromium = await loadChromium();
  const profileDir = resolveProfileDir();
  const defaultChromeDir = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Google',
    'Chrome',
  );
  if (path.resolve(profileDir) === path.resolve(defaultChromeDir)) {
    throw new LoginError(
      'DEFAULT_CHROME_PROFILE_FORBIDDEN',
      '自动化 profile 不能使用日常 Chrome 默认目录，请设置独立的 AIA_PGS_PROFILE_DIR',
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
      args: ['--no-first-run'],
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
  console.log(`🚀 自动化 Chrome 已启动（profile: ${profileDir}）`);
  return {
    context,
    profileDir,
    close: () => context.close(),
  };
}

async function runLoginOnly() {
  let session;
  try {
    session = await launchAutomationContext();
    if (process.argv.includes('--fresh-login')) {
      await clearAgencySession(session.context);
    }
    const home = await ensureAgencyLoggedIn(session.context);
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
  ensureAgencyLoggedIn,
  extractOtpCode,
  extractReferenceNumber,
  getAgencyCredentials,
  isAgencyCookieDomain,
  isAgencyHomeUrl,
  isOtpConfirmLabel,
  isOutlookUrl,
  launchAutomationContext,
  normalizeReference,
  readOtpFromOutlook,
  resolveProfileDir,
};
