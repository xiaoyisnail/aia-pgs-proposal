import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ensureAgencyLoggedIn,
  extractOtpCode,
  extractReferenceNumber,
  isAgencyCookieDomain,
  isAgencyHomeUrl,
  isOtpConfirmLabel,
  isOutlookUrl,
  normalizeReference,
  readStoredUsername,
} from '../scripts/login-agency.mjs';

test('reuses an authenticated Agency page without navigating', async () => {
  const page = {
    url: () => 'https://aiahk-blob01-prd.aia.com.hk/agency/zh-hk/home',
    isClosed: () => false,
  };
  assert.equal(await ensureAgencyLoggedIn({ pages: () => [page] }), page);
});

test('probes the protected Agency home before visiting the login endpoint', async () => {
  const visited = [];
  const page = {
    url: () => visited.at(-1) || 'about:blank',
    isClosed: () => false,
    goto: async url => { visited.push(url); return { ok: () => true }; },
    bringToFront: async () => {},
  };
  const pages = [];
  const context = { pages: () => pages, newPage: async () => { pages.push(page); return page; } };
  assert.equal(await ensureAgencyLoggedIn(context, { waitMs: 50 }), page);
  assert.deepEqual(visited, ['https://aiahk-blob01-prd.aia.com.hk/agency/zh-hk/home']);
});

test('pauses on the login page and continues only when a home page appears', async t => {
  const log = t.mock.method(console, 'log', () => {});
  const pages = [];
  let pageUrl = 'about:blank';
  const home = {
    url: () => 'https://aiahk-blob01-prd.aia.com.hk/agency/zh-hk/home',
    isClosed: () => false,
  };
  const page = {
    url: () => pageUrl,
    isClosed: () => false,
    goto: async url => {
      pageUrl = url.endsWith('/home') ? 'https://aiahk-agency-prd.aia.com.hk/agency/login.do' : url;
      return { ok: () => true };
    },
    bringToFront: async () => {
      assert.match(pageUrl, /\/login\.do$/);
      assert.match(log.mock.calls.at(-1).arguments[0], /MANUAL_LOGIN_REQUIRED/);
      setTimeout(() => pages.push(home), 10);
    },
  };
  const context = {
    pages: () => pages,
    newPage: async () => { pages.push(page); return page; },
  };
  assert.equal(await ensureAgencyLoggedIn(context), home);
});

test('extracts Traditional Chinese reference and OTP', () => {
  const message = '參考編號：C622\n123456 是您的六位數字一次性密碼。';
  assert.equal(extractReferenceNumber(message), 'C622');
  assert.equal(extractOtpCode(message, 'C622'), '123456');
});

test('extracts Simplified Chinese reference and OTP', () => {
  const message = '参考编号: P864\n您的验证码是 654321，请勿转发。';
  assert.equal(extractReferenceNumber(message), 'P864');
  assert.equal(extractOtpCode(message, 'P864'), '654321');
});

test('extracts English reference and OTP', () => {
  const message = 'Reference No.: A1234\nYour one-time password is 012345.';
  assert.equal(extractReferenceNumber(message), 'A1234');
  assert.equal(extractOtpCode(message, 'A1234'), '012345');
});

test('rejects a delayed OTP from a previous challenge', () => {
  const delayedMessage = 'Reference No.: C621\nYour one-time password is 111111.';
  assert.equal(extractOtpCode(delayedMessage, 'C622'), null);
});

test('does not accept an unrelated six-digit number', () => {
  const unrelated = '參考編號：C622\n保單編號 987654，請聯絡客戶服務。';
  assert.equal(extractOtpCode(unrelated, 'C622'), null);
});

test('normalizes reference separators and case', () => {
  assert.equal(normalizeReference(' c-622 '), 'C622');
});

test('recognizes Agency Corner home URLs only', () => {
  assert.equal(
    isAgencyHomeUrl('https://aiahk-blob01-prd.aia.com.hk/agency/zh-hk/home'),
    true,
  );
  assert.equal(
    isAgencyHomeUrl('https://aiahk-agency-prd.aia.com.hk/agency/login.do'),
    false,
  );
});

test('clears only AIA cookie domains for a fresh login', () => {
  assert.equal(isAgencyCookieDomain('.aia.com.hk'), true);
  assert.equal(isAgencyCookieDomain('sso.aia.com'), true);
  assert.equal(isAgencyCookieDomain('outlook.cloud.microsoft'), false);
  assert.equal(isAgencyCookieDomain('accounts.google.com'), false);
});

test('recognizes current and legacy Outlook web hosts', () => {
  assert.equal(isOutlookUrl('https://outlook.cloud.microsoft/mail/inbox'), true);
  assert.equal(isOutlookUrl('https://outlook.office.com/mail/'), true);
  assert.equal(isOutlookUrl('https://login.microsoftonline.com/'), false);
});

test('accepts OTP confirmation labels but rejects resend labels', () => {
  assert.equal(isOtpConfirmLabel('确认'), true);
  assert.equal(isOtpConfirmLabel('確認'), true);
  assert.equal(isOtpConfirmLabel('Confirm'), true);
  assert.equal(isOtpConfirmLabel('重新发送一次性验证码'), false);
});

test('reads the machine-specific Agency username configuration', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aia-pgs-test-'));
  const configPath = path.join(directory, 'config.json');
  t.after(() => fs.rmSync(directory, { recursive: true }));
  fs.writeFileSync(configPath, '{"username":" A1234 "}');
  assert.equal(readStoredUsername(configPath), 'A1234');
});
