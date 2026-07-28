// ARCHIVED: 此文件已不再被 generate-proposal.mjs 使用。generate-proposal.mjs 现在是自包含的单文件脚本。保留此文件仅作参考。
#!/usr/bin/env node
/**
 * AIA Agency Corner 登录 → iPGS+ 打开自动化（v2 — 复用 browser context）
 * ==============================================================================
 * 供 generate-proposal.mjs 导入使用，不独立运行。
 * 导出两个函数：
 *   ensureAgencyLoggedIn(context) — 确保 agency corner 已登录
 *   openIpgs(context)           — 从 agency 打开 iPGS+ 并返回 PGS 页面
 */

const AGENCY_USERNAME = process.env.AGENCY_USERNAME || 'H3926';
const AGENCY_LOGIN_URL = 'https://aiahk-agency-prd.aia.com.hk/agency/login.do';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getPassword() {
  if (process.env.AGENCY_PASSWORD) return process.env.AGENCY_PASSWORD;
  try {
    const p = require('path').join(require('os').homedir(), 'WorkBuddy', 'atuo-pgs-pipeline', 'agency-creds.json');
    if (require('fs').existsSync(p)) return JSON.parse(require('fs').readFileSync(p, 'utf8')).password || '';
  } catch { return ''; }
}

// ====== 语言自适应按钮文本 ======
const BTN = {
  LOGIN: /^Login$|^登入$|^登录$/,
  SEND_OTP: /Send OTP|Resend OTP|發送.*驗證碼|发送.*验证码/,
  CONFIRM: /Confirm|確認|确定|確定|驗證|验证|提交/,
  ACCEPT: /^(接受|Accept|同意|Agree)$/,
};

/**
 * 确保 Agency Corner 已登录。
 * 若已登录（home 页）则直接返回；否则走完整登录流。
 */
async function ensureAgencyLoggedIn(context) {
  const PASSWORD = getPassword();
  if (!PASSWORD) throw new Error('未配置密码。请设置 AGENCY_PASSWORD 环境变量');

  // 检查是否已登录
  const homePage = context.pages().find(p => /aiahk/i.test(p.url()) && /\/home/.test(p.url()));
  if (homePage) { console.log('   ✅ Agency Corner 已登录'); return homePage; }

  // 清理残留 SSO 页面
  for (const p of context.pages()) {
    if (p.url().includes('sso.aia')) await p.close().catch(()=>{});
  }

  // 找或创建 agency 页面
  let agencyPage = context.pages().find(p => /aiahk/i.test(p.url()) && !p.url().includes('sso.aia'));
  if (!agencyPage) {
    agencyPage = await context.newPage();
    await agencyPage.goto(AGENCY_LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await sleep(3000);
    // 检查 session 缓存是否直接跳到了 home 页
    if (/\/home/.test(agencyPage.url())) {
      console.log('   ✅ Agency Corner 已登录（session 缓存）');
      return agencyPage;
    }
  }
  await agencyPage.bringToFront();
  await sleep(500);

  // 1) 用户名 → Login with password
  console.log('   1) 用户名 -> Login with password');
  await agencyPage.locator('#username').fill(AGENCY_USERNAME);
  await agencyPage.locator('#login').click();
  // SSO 重定向可能较慢
  await sleep(5000);

  // 2) SSO 密码页（可能在同标签或新标签）
  let ssoPage = context.pages().find(p => p.url().includes('sso.aia'));
  // 若同一页导航到了 SSO
  if (!ssoPage && agencyPage.url().includes('sso.aia')) ssoPage = agencyPage;
  // 等更长
  if (!ssoPage) { await sleep(5000); ssoPage = context.pages().find(p => p.url().includes('sso.aia')); }
  if (!ssoPage && agencyPage.url().includes('sso.aia')) ssoPage = agencyPage;
  if (!ssoPage) {
    console.log(`   [DEBUG] All pages: ${context.pages().map(p => p.url().slice(0,60)).join(' | ')}`);
    throw new Error('SSO 页面未出现');
  }

  await ssoPage.bringToFront(); await sleep(1000);
  console.log('   2) 密码 -> Login');
  await ssoPage.locator('input[type="password"]').first().fill(PASSWORD);
  
  const loginBtn = ssoPage.locator('button').filter({ hasText: BTN.LOGIN }).first();
  await loginBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if (await loginBtn.count()) { await loginBtn.click(); }
  else { await ssoPage.locator('input[type="password"]').first().press('Enter'); }
  await sleep(4000);

  // 检测是否免 OTP 直接登录成功
  const homeAfterPwd = context.pages().find(p => /aiahk.*agency/i.test(p.url()) && /\/home/.test(p.url()));
  if (homeAfterPwd) { console.log('   ✅ 无需验证码，直接登录成功！'); return homeAfterPwd; }

  // 3) OTP 流程（含重试 3 次）
  const outlook = context.pages().find(p => /outlook\.office\.com\/mail/.test(p.url()));
  if (!outlook) throw new Error('未找到 Outlook 页面');
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(attempt > 1 ? `   🔄 第${attempt}次 OTP...` : '   3) OTP 验证');
    
    ssoPage = context.pages().find(p => p.url().includes('sso.aia'));
    if (!ssoPage) {
      const home = context.pages().find(p => /aiahk.*agency/i.test(p.url()) && /\/home/.test(p.url()));
      if (home) { console.log('   ✅ 已登录'); return home; }
      throw new Error('SSO 页面丢失');
    }

    // 收集已有 OTP 邮件 ref 用于去重
    await outlook.bringToFront(); await sleep(800);
    const existingRefs = await outlook.evaluate(() => {
      const refs = [];
      for (const it of [...document.querySelectorAll('[role="option"]')]) {
        const t = it.innerText || '';
        if (t.includes('otp@aia.com.hk') && (t.includes('六位數字') || t.includes('六位数字') || t.includes('One-Time'))) {
          const m = t.match(/參考編號[：:]\s*(\w+)/) || t.match(/参考编号[：:]\s*(\w+)/) || t.match(/Ref No[.:]\s*(\w+)/i);
          if (m) refs.push(m[1]);
        }
      }
      return refs;
    });

    // 发码
    await ssoPage.bringToFront(); await sleep(500);
    const sendBtn = ssoPage.locator('button').filter({ hasText: BTN.SEND_OTP }).first();
    if (await sendBtn.count()) {
      await sendBtn.click();
      console.log(`   已发送 OTP (已有 ${existingRefs.length} 封旧邮件)`);
    }

    // 轮询等新邮件（基于 ref 去重）
    const code = await outlook.evaluate(async (existingRefs) => {
      const get = () => {
        for (const it of [...document.querySelectorAll('[role="option"]')]) {
          const t = it.innerText || '';
          if (!t.includes('otp@aia.com.hk')) continue;
          if (!t.includes('六位數字') && !t.includes('六位数字') && !t.includes('One-Time')) continue;
          const rm = t.match(/參考編號[：:]\s*(\w+)/) || t.match(/参考编号[：:]\s*(\w+)/) || t.match(/Ref No[.:]\s*(\w+)/i);
          if (rm && existingRefs.includes(rm[1])) continue;
          const cm = t.match(/(\d{6})\s*是您的/) || t.match(/(\d{6})\s*是您的/) || t.match(/is your (\d{6})/i);
          if (cm) return cm[1];
          const all = t.match(/\b\d{6}\b/g);
          if (all) return all[0];
        }
        return null;
      };
      for (let i = 0; i < 24; i++) { await new Promise(r => setTimeout(r, 5000)); const c = get(); if (c) return c; }
      return null;
    }, existingRefs);
    if (!code) continue; // 超时重试

    // 填码确认
    ssoPage = context.pages().find(p => p.url().includes('sso.aia'));
    if (!ssoPage) { const h = context.pages().find(p => /aiahk.*agency/i.test(p.url()) && /\/home/.test(p.url())); if (h) { console.log('   ✅ 已登录'); return h; } continue; }
    await ssoPage.bringToFront(); await sleep(500);
    await ssoPage.locator('input[type="text"]').first().fill(code);
    // 尝试点�� Confirm，不行就按 Enter
    const cfmBtn = ssoPage.locator('button').filter({ hasText: BTN.CONFIRM }).first();
    await cfmBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (await cfmBtn.count()) { await cfmBtn.click(); }
    else { await ssoPage.locator('input[type="text"]').first().press('Enter'); }
    console.log(`   验证码: ${code}，已提交`);
    await sleep(5000);

    // 验证
    const home = context.pages().find(p => /aiahk.*agency/i.test(p.url()) && /\/home/.test(p.url()));
    if (home) { console.log('   ✅ 登录成功'); return home; }
    const errText = await ssoPage.evaluate(() => document.body.innerText).catch(() => '');
    console.log(`   ❌ 失败 (${errText.includes('wrong') || errText.includes('expired') || errText.includes('錯誤') || errText.includes('过期') ? '验证码错误/过期' : '未知'})`);
    if (attempt < 3) await sleep(3000);
  }
  throw new Error('3 次 OTP 尝试均失败');
}

/**
 * 从已登录的 Agency Corner 打开 iPGS+ 并返回 PGS 页面。
 */
async function openIpgs(context) {
  let agencyPage = context.pages().find(p => /aiahk.*agency/i.test(p.url()) && /\/home/.test(p.url()));
  if (!agencyPage) throw new Error('Agency Corner 主页未打开');
  await agencyPage.bringToFront();

  // 导航到 電子服務
  if (!agencyPage.url().includes('/electronic')) {
    await agencyPage.evaluate(() => location.href = 'https://aiahk-blob01-prd.aia.com.hk/agency/zh-hk/electronic');
    await sleep(4000);
  }

  // 取 iPGS+ 隐藏链接的 redirect URL
  const link = agencyPage.getByRole('link', { name: 'iPGS+', exact: true }).first();
  const href = await link.getAttribute('href');
  if (!href) throw new Error('未找到 iPGS+ 链接');
  const fullUrl = 'https://aiahk-blob01-prd.aia.com.hk' + href;
  await agencyPage.evaluate(url => { location.href = url; }, fullUrl);
  await sleep(5000);

  const pgs = context.pages().find(p => /aiahk-apps.*pgs/i.test(p.url()) && !p.url().includes('/logout'));
  if (!pgs) throw new Error('PGS 未打开');
  console.log('   ✅ iPGS+ 已打开:', pgs.url());
  return pgs;
}

export { ensureAgencyLoggedIn, openIpgs };
