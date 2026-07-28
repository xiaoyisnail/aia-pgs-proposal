#!/usr/bin/env node
/**
 * PGS 计划书全自动生成 v0.5.0
 * 技术栈：launchPersistentContext(channel:'chrome') + 纯 evaluate 表单操作
 *
 * 用法：AGENCY_PASSWORD='xxx' node scripts/generate-proposal.mjs [params.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensureAgencyLoggedIn, launchAutomationContext, LoginError } from './login-agency.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let automationSession;

// ====== 参数默认 ======
const DEFAULTS = {
  gender: '女', insuredSexValue: '0', age: 1,
  region: '中華人民共和國', smoking: false,
  sumAssured: 300000, premiumTerm: 25, extraPremium: false,
  productName: '愛伴航2', productCode: 'OYS2',
  insuredSurname: 'vip', insuredGivenName: 'vip',
  payorSurname: 'vip', payorGivenName: 'vip',
  outputDir: path.join(os.homedir(), 'Downloads'),
};

function loadConfig() {
  const cfg = { ...DEFAULTS };
  const pf = process.argv[2];
  if (pf && fs.existsSync(pf)) Object.assign(cfg, JSON.parse(fs.readFileSync(pf, 'utf8')));
  cfg.insuredSexValue = cfg.gender === '男' ? '1' : '0';
  return cfg;
}

function computeBirthDate(age) {
  const now = new Date();
  const birth = new Date(now.getFullYear() - age, now.getMonth(), now.getDate());
  return `${String(birth.getMonth() + 1).padStart(2, '0')}/${String(birth.getDate()).padStart(2, '0')}/${birth.getFullYear()}`;
}

function buildFileName(cfg) {
  const rMap = { '中華人民共和國': '大陆', '香港': '香港', '澳門': '澳门' };
  return `${cfg.productName}_${cfg.gender}${cfg.age}岁_${rMap[cfg.region] || cfg.region}_USD${cfg.sumAssured}_${cfg.premiumTerm}年缴${cfg.smoking ? '_吸烟' : ''}.pdf`;
}

// ====== PGS 表单操作 — 全 evaluate 模式 ======

/** 等 #aiaLoading 消失 */
async function waitPgs(page, maxMs = 2000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(() => {
      const el = document.querySelector('#aiaLoading');
      if (!el) return true;
      return getComputedStyle(el).opacity === '0' || el.getAttribute('aria-hidden') === 'true';
    }).catch(() => true);
    if (ok) return;
    await sleep(100);
  }
}

/** dismiss MUI dialogs with accept/confirm buttons */
async function dismissDialog(page) {
  await page.evaluate(() => {
    const re = /Accept|OK|接受|同意|Agree|Confirm|確認|确认|确定|確定/;
    for (const d of document.querySelectorAll('.MuiDialog-root')) {
      if (getComputedStyle(d).display === 'none') continue;
      for (const b of d.querySelectorAll('button')) {
        if (re.test(b.textContent.trim())) { b.click(); return; }
      }
    }
  });
  await sleep(200);
}

/** find visible button text for debug */
async function debugButtons(page) {
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.textContent?.trim()).slice(0, 10)
  );
  console.log('   BTNS:', JSON.stringify(btns));
  return btns;
}

/** evaluate-click a button by regex on textContent, searches all elements */
async function clickButtonEval(page, regex, label) {
  const src = regex.source;
  const flg = regex.flags;
  for (let attempt = 0; attempt < 5; attempt++) {
    const clicked = await page.evaluate(([s, f]) => {
      const re = new RegExp(s, f);
      for (const b of document.querySelectorAll('button, [role="button"], a, div[role="button"], span.MuiButton-label')) {
        if (re.test(b.textContent || '')) { b.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true})); b.click(); return true; }
      }
      for (const el of document.querySelectorAll('*')) {
        if (el.textContent && el.textContent.length < 30 && re.test(el.textContent.trim())) {
          el.dispatchEvent(new MouseEvent('click', {bubbles:true,cancelable:true})); el.click(); return true;
        }
      }
      return false;
    }, [src, flg]);
    if (clicked) { if (label) console.log('   👉', label); return true; }
    if (attempt < 4) await sleep(500);
  }
  if (label) console.log('   ⚠️ 未找到:', label);
  return false;
}

/** evaluate-click element containing text (leaf search) */
async function clickTextEval(page, regex, label) {
  const src = regex.source;
  const clicked = await page.evaluate(s => {
    const re = new RegExp(s);
    for (const el of document.querySelectorAll('*')) {
      if (el.children.length > 0) continue;
      if (re.test(el.textContent || el.textContent || '')) { el.click(); return true; }
    }
    return false;
  }, src);
  if (clicked && label) console.log('   👉', label);
  return clicked;
}

/** set input value via native setter */
async function setInputValue(page, selector, value) {
  await page.evaluate(([sel, val]) => {
    const input = document.querySelector(sel);
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [selector, String(value)]);
}

/** click a label's associated radio (MUI pattern) */
async function clickLabelRadio(page, labelText) {
  await page.evaluate(txt => {
    const labels = [...document.querySelectorAll('label')];
    const lbl = labels.find(l => l.textContent.trim() === txt);
    if (!lbl) return;
    const root = lbl.closest('.MuiFormControlLabel-root') || lbl.parentElement;
    const radio = root?.querySelector('input[type="radio"]');
    if (radio) radio.click();
  }, labelText);
}

/** click MUI Select by label text, then click the option */
async function selectMuiOption(page, labelPrefix, optionText) {
  await page.evaluate(([pfx, opt]) => {
    const labels = [...document.querySelectorAll('label')];
    const lbl = labels.find(l => l.textContent.trim().startsWith(pfx));
    if (!lbl) return;
    const selectDiv = lbl.closest('.MuiFormControl-root')?.querySelector('div.MuiSelect-select');
    if (selectDiv) selectDiv.click();
    // the listbox appears async; handled by caller's sleep
  }, [labelPrefix, optionText]);
  await sleep(800);
  // click option
  await page.evaluate(opt => {
    for (const it of document.querySelectorAll('[role="option"]')) {
      if (it.textContent.trim() === opt) { it.click(); return; }
    }
    for (const it of document.querySelectorAll('[role="listbox"] li, [role="listbox"] div')) {
      if (it.textContent.trim() === opt) { it.click(); return; }
    }
  }, optionText);
}

// ====== iPGS+ 打开 ======
async function openIpgs(agency) {
  if (!agency.url().includes('/electronic')) {
    await agency.evaluate(() => location.href = 'https://aiahk-blob01-prd.aia.com.hk/agency/zh-hk/electronic');
    await sleep(3500);
  }
  const link = agency.getByRole('link', { name: 'iPGS+', exact: true }).first();
  const href = await link.getAttribute('href');
  if (!href) throw new LoginError('IPGS_LINK', '未找到 iPGS+ 入口链接');
  await agency.evaluate(u => location.href = u, 'https://aiahk-blob01-prd.aia.com.hk' + href);
  await sleep(5000);
  const context = agency.context();
  const pgs = context.pages().find(p => /aiahk-apps.*pgs/i.test(p.url()) && !p.url().includes('/logout'));
  if (!pgs) throw new LoginError('PGS_NOT_FOUND', 'PGS 未打开');
  return pgs;
}

// ====== 主流程 ======
async function main() {
  const TOTAL_START = Date.now();
  let tStep = TOTAL_START;
  const tick = label => { const e = ((Date.now() - tStep) / 1000).toFixed(1); tStep = Date.now(); console.log(`   ⏱ ${label}: ${e}s`); };

  const CONFIG = loadConfig();
  const DOB = computeBirthDate(CONFIG.age);
  const FILENAME = buildFileName(CONFIG);
  console.log(`🎯 ${CONFIG.productName} | ${CONFIG.gender}${CONFIG.age}岁 | ${CONFIG.region} | USD ${CONFIG.sumAssured}`);

  // ── 1) Chrome + 登录 ──
  automationSession = await launchAutomationContext();
  const ctx = automationSession.context;
  const agency = await ensureAgencyLoggedIn(ctx);
  tick('Chrome+登录');

  // ── 2) iPGS+ ──
  const page = await openIpgs(agency);
  console.log('   ✅ PGS:', page.url());
  await page.bringToFront();
  tick('iPGS+');

  // ── 预关弹窗（每次 pgs 打开可能有 session 恢复提示）──
  for (let i = 0; i < 3; i++) { await dismissDialog(page); await sleep(300); }

  // ════════════════ Step 1: 受保人 ════════════════
  console.log('\n─── Step 1: 受保人 ───');
  await dismissDialog(page); await waitPgs(page);

  // DOB (第一个 text input，MUI 隐藏渲染，用 evaluate 原生 setter)
  await setInputValue(page, 'input[type="text"]', DOB);
  console.log('   DOB:', DOB);
  await sleep(1500); await waitPgs(page);

  // 性别 radio
  await clickLabelRadio(page, CONFIG.gender === '男' ? '男' : '女');
  console.log('   性别:', CONFIG.gender);
  await sleep(600); await waitPgs(page);

  // 吸烟（默认不吸烟，跳过）
  if (CONFIG.smoking) await clickLabelRadio(page, '吸煙');
  console.log('   吸烟:', CONFIG.smoking ? '是' : '否');
  await sleep(200); await waitPgs(page);

  // 居住地区
  await selectMuiOption(page, '慣常居住地', CONFIG.region);
  await selectMuiOption(page, '惯常居住地', CONFIG.region); // 简中 fallback
  console.log('   地区:', CONFIG.region);
  await sleep(600); await waitPgs(page);

  // 警告确认弹窗 — 用 textContent（MUI offsetParent null 导致 textContent 全空）
  const acceptDebug = await page.evaluate(() => {
    const all = [...document.querySelectorAll('button')];
    const texts = all.map(b => (b.textContent || '').trim()).filter(Boolean);
    let clicked = false;
    for (const b of all) {
      const t = (b.textContent || '').trim();
      if (t === '接受' || t === 'Accept' || t === '同意') { b.click(); clicked = true; break; }
    }
    if (!clicked) {
      for (const b of all) {
        if (/接受|Accept/i.test(b.textContent || '')) { b.click(); clicked = true; break; }
      }
    }
    return { texts, clicked };
  });
  console.log('   [ACCEPT] texts:', JSON.stringify(acceptDebug.texts.slice(0,10)), '| clicked:', acceptDebug.clicked);
  // 点完接受后 PGS 会跳转到 /transfer/ → 等页面稳定
  await sleep(2000);
  for (let i = 0; i < 30; i++) {
    if (!page.url().includes('/transfer/') && !page.url().includes('/proposal/index')) break;
    if (i > 5 && page.url().includes('/proposal')) break;
    await sleep(1000);
  }
  await waitPgs(page, 5000);
  tick('Step1');

  // ════════════════ Step 2: 选产品 ════════════════
  console.log('\n─── Step 2: 选产品 ───');
  await sleep(1000); await waitPgs(page);

  await clickButtonEval(page, /危疾|危疾保障|Critical/, '危疾');
  await sleep(500);
  // if "危疾" not found, try "確定" to advance from main page
  await clickButtonEval(page, /確定|确认|OK/, '確定');
  await sleep(500);
  await clickTextEval(page, new RegExp(CONFIG.productCode, 'i'), CONFIG.productCode);
  await sleep(500);
  await clickButtonEval(page, /選擇|选择|Select/, '選擇');
  await sleep(1000); await waitPgs(page);
  await clickButtonEval(page, /確定|确认|Confirm|OK/, '確定');
  await sleep(1000); await waitPgs(page);
  tick('Step2');

  // ════════════════ Step 3: 基本计划 ════════════════
  console.log('\n─── Step 3: 基本计划 ───');

  // 缴付年期 radio
  await clickLabelRadio(page, String(CONFIG.premiumTerm));
  await sleep(400);

  // 额外保费 radio
  await clickLabelRadio(page, CONFIG.extraPremium ? '是' : '否');
  await sleep(400);

  // 年缴 radio
  await clickLabelRadio(page, '年繳');
  await clickLabelRadio(page, '年缴'); // 简中
  await sleep(400);

  // 保额 — 按 label "保额" 或 "Sum Assured" 找最近的可用 text input
  const saSet = await page.evaluate(sa => {
    const labels = [...document.querySelectorAll('label')];
    const lbl = labels.find(l => /保額|保额|Sum\s*Assured/i.test(l.textContent));
    if (!lbl) return false;
    const ctrl = lbl.closest('.MuiFormControl-root, .MuiTextField-root, .MuiInputBase-root');
    const inp = ctrl?.querySelector('input[type="text"]:not([disabled])');
    if (!inp) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, sa);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, String(CONFIG.sumAssured));
  console.log('   保额: USD', CONFIG.sumAssured, saSet ? '✅' : '⚠️');
  await sleep(1200); await waitPgs(page);

  // 下一步
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(200);
  await clickButtonEval(page, /下一步|Next/i, '下一步');
  await sleep(1200); await waitPgs(page);
  tick('Step3');

  // ════════════════ Steps 4-9: 暴力推进 ════════════════
  for (let round = 1; round <= 5; round++) {
    console.log(`\n─── Round ${round}/5 ───`);
    const roundStart = Date.now();

    // 循环回来重填名字
    if (round > 1) {
      await page.evaluate(p => {
        const setVal = (el, v) => {
          const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          s.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        for (const [n, v] of Object.entries({ lastName: p.insuredSurname, firstName: p.insuredGivenName, payorName: p.payorSurname, payorFirst: p.payorGivenName })) {
          const inp = document.querySelector(`input[name="${n}"]`);
          if (inp) setVal(inp, v);
        }
      }, CONFIG);
      if (round === 2) console.log('   姓名已填');
      await sleep(200);
    }

    // 关确认弹窗
    await page.evaluate(() => {
      const re = /^(確認|Confirm|确定|確定|OK|接受|Accept)$/;
      for (const b of document.querySelectorAll('.MuiDialog-root button')) {
        if (re.test(b.textContent.trim())) b.click();
      }
    });
    await sleep(1000);

    // 下一步 / 確定
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(150);
    await debugButtons(page);
    // 也尝试 "確定"（appears on main page）
    const nextClicked = await clickButtonEval(page, /下一步|Next/i, '下一步') ||
                        await clickButtonEval(page, /確定|确认|OK/i, '確定');
    if (nextClicked) await sleep(1800);

    // 再关弹窗
    await page.evaluate(() => {
      const re = /^(確認|Confirm|确定|確定|OK|接受|Accept)$/;
      for (const b of document.querySelectorAll('.MuiDialog-root button')) {
        if (re.test(b.textContent.trim())) b.click();
      }
    });
    await sleep(1800);

    // 点检视按钮
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (/檢視詳盡|详盡建議|View/.test(b.textContent)) { b.click(); return; }
      }
    });
    await sleep(3500);

    // 搜 viewer iframe
    for (const pg of ctx.pages()) {
      const frame = pg.frames().find(fr => fr.url().includes('viewer.html'));
      if (!frame) continue;
      console.log('   ✅ PDF viewer 已找到');
      const dp = page.waitForEvent('download', { timeout: 40_000 });
      await frame.locator('#download').evaluate(el => el.click());
      const download = await dp;
      const finalPath = path.join(CONFIG.outputDir, FILENAME);
      fs.copyFileSync(await download.path(), finalPath);
      const totalTime = ((Date.now() - TOTAL_START) / 1000).toFixed(1);
      console.log(`\n✅ PDF: ${finalPath} (${fs.statSync(finalPath).size} bytes)`);
      console.log(`📊 总耗时: ${totalTime}s`);
      await automationSession?.close().catch(() => {});
      automationSession = undefined;
      return;
    }
    const roundTime = ((Date.now() - roundStart) / 1000).toFixed(1);
    console.log(`   本轮耗时: ${roundTime}s`);
  }
  throw new LoginError('PDF_NOT_FOUND', '5轮推进后未找到 PDF viewer');
}

main().catch(async e => {
  await automationSession?.close().catch(() => {});
  console.error(`❌ ${e.message}`);
  process.exitCode = 1;
});
