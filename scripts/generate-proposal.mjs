#!/usr/bin/env node
/**
 * PGS 计划书全自动生成 v0.6.0
 * 技术栈：Playwright persistent context + 页面状态验证
 *
 * 用法：npm run generate -- <params.json>
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  clearAgencySession,
  ensureAgencyLoggedIn,
  launchAutomationContext,
  LoginError,
} from './login-agency.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let automationSession;

// ====== 参数默认 ======
const DEFAULTS = {
  gender: '女', insuredSexValue: '0', age: 1,
  region: '中華人民共和國', smoking: false,
  sumAssured: 300000, premiumTerm: 25, extraPremium: false,
  sameAsInsured: true,
  productName: '愛伴航2', productCode: 'OYS2',
  insuredSurname: 'vip', insuredGivenName: 'vip',
  payorSurname: 'vip', payorGivenName: 'vip',
  payorGender: '男', payorAge: 35, payorRegion: '中華人民共和國',
  outputDir: path.join(os.homedir(), 'Downloads'),
};

function loadConfig() {
  const pf = process.argv.slice(2).find(argument => !argument.startsWith('--'));
  if (!pf) {
    throw new LoginError(
      'PARAMS_REQUIRED',
      '缺少参数文件。请运行 npm run generate -- params.json',
    );
  }
  if (!fs.existsSync(pf)) {
    throw new LoginError('PARAMS_NOT_FOUND', `参数文件不存在：${pf}`);
  }
  let input;
  try {
    input = JSON.parse(fs.readFileSync(pf, 'utf8'));
  } catch (error) {
    throw new LoginError('PARAMS_INVALID_JSON', `参数文件不是有效 JSON：${error.message}`);
  }

  const required = [
    'gender',
    'age',
    'region',
    'smoking',
    'sumAssured',
    'premiumTerm',
    'extraPremium',
    'sameAsInsured',
    'insuredSurname',
    'insuredGivenName',
  ];
  const missing = required.filter(key => input[key] === undefined || input[key] === '');
  if (missing.length) {
    throw new LoginError('PARAMS_MISSING', `参数文件缺少字段：${missing.join(', ')}`);
  }
  if (!['男', '女'].includes(input.gender)) {
    throw new LoginError('PARAMS_INVALID', 'gender 必须是“男”或“女”');
  }
  if (!['中華人民共和國', '香港', '澳門'].includes(input.region)) {
    throw new LoginError(
      'PARAMS_INVALID',
      'region 必须是中華人民共和國、香港或澳門',
    );
  }
  if (!Number.isInteger(input.age) || input.age < 0) {
    throw new LoginError('PARAMS_INVALID', 'age 必须是非负整数');
  }
  if (!Number.isInteger(input.sumAssured) || input.sumAssured <= 0) {
    throw new LoginError('PARAMS_INVALID', 'sumAssured 必须是正整数');
  }
  if (!Number.isInteger(input.premiumTerm) || input.premiumTerm <= 0) {
    throw new LoginError('PARAMS_INVALID', 'premiumTerm 必须是正整数');
  }
  if (typeof input.smoking !== 'boolean'
    || typeof input.extraPremium !== 'boolean'
    || typeof input.sameAsInsured !== 'boolean') {
    throw new LoginError(
      'PARAMS_INVALID',
      'smoking、extraPremium、sameAsInsured 必须是 JSON boolean',
    );
  }
  if (typeof input.insuredSurname !== 'string'
    || typeof input.insuredGivenName !== 'string') {
    throw new LoginError('PARAMS_INVALID', '受保人的姓和名必须是字符串');
  }
  if (input.productCode && input.productCode !== 'OYS2') {
    throw new LoginError('PRODUCT_UNSUPPORTED', '当前仅支持 productCode=OYS2');
  }

  const sameOwner = input.sameAsInsured && input.age >= 18;
  if (!sameOwner) {
    const payorFields = [
      'payorSurname',
      'payorGivenName',
      'payorGender',
      'payorAge',
      'payorRegion',
    ];
    const missingPayor = payorFields.filter(key => input[key] === undefined || input[key] === '');
    if (missingPayor.length) {
      throw new LoginError(
        'PARAMS_PAYOR_REQUIRED',
        `保单持有人与受保人不同，缺少字段：${missingPayor.join(', ')}`,
      );
    }
    if (!['男', '女'].includes(input.payorGender)
      || !Number.isInteger(input.payorAge)
      || input.payorAge < 18) {
      throw new LoginError(
        'PARAMS_INVALID',
        'payorGender 必须是男/女，payorAge 必须是大于或等于 18 的整数',
      );
    }
    if (!['中華人民共和國', '香港', '澳門'].includes(input.payorRegion)
      || typeof input.payorSurname !== 'string'
      || typeof input.payorGivenName !== 'string') {
      throw new LoginError(
        'PARAMS_INVALID',
        '保单持有人的地区必须受支持，姓和名必须是字符串',
      );
    }
  }

  const cfg = { ...DEFAULTS, ...input, sameAsInsured: sameOwner };
  if (sameOwner) {
    cfg.payorSurname = cfg.insuredSurname;
    cfg.payorGivenName = cfg.insuredGivenName;
  }
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

// ====== PGS 表单操作与状态验证 ======

/** 等 #aiaLoading 消失 */
async function waitPgs(page, maxMs = 2000, stableMs = 200) {
  const deadline = Date.now() + maxMs;
  let readySince = 0;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(() => {
      const el = document.querySelector('#aiaLoading');
      if (!el) return true;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display === 'none'
        || style.visibility === 'hidden'
        || style.opacity === '0'
        || rect.width === 0
        || rect.height === 0;
    }).catch(() => true);
    if (ok) {
      readySince ||= Date.now();
      if (Date.now() - readySince >= stableMs) return true;
    } else {
      readySince = 0;
    }
    await sleep(100);
  }
  return false;
}

/** Wait for a route-triggered loading cycle, including loaders mounted after navigation. */
async function waitPgsCycle(page, maxMs = 30_000) {
  const startedAt = Date.now();
  const deadline = startedAt + maxMs;
  let sawLoading = false;
  let quietSince = 0;
  while (Date.now() < deadline) {
    const loading = await page.evaluate(() => {
      const element = document.querySelector('#aiaLoading');
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && rect.width > 0
        && rect.height > 0;
    }).catch(() => false);
    if (loading) {
      sawLoading = true;
      quietSince = 0;
    } else {
      quietSince ||= Date.now();
      if (sawLoading && Date.now() - quietSince >= 500) return true;
      if (!sawLoading && Date.now() - startedAt >= 5_000 && Date.now() - quietSince >= 2_000) {
        return true;
      }
    }
    await sleep(100);
  }
  return false;
}

/** Click the first visible, enabled interactive element matching textContent. */
async function clickButtonEval(page, regex, label) {
  const src = regex.source;
  const flg = regex.flags.replace('g', '');
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await page.evaluate(([s, f]) => {
      const re = new RegExp(s, f);
      const matches = [...document.querySelectorAll('button, [role="button"], a')]
        .map((element, index) => {
          const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const hit = rect.width > 0 && rect.height > 0
            ? document.elementFromPoint(
              Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2)),
              Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2)),
            )
            : null;
          return {
            element,
            index,
            text,
            visible: style.display !== 'none'
              && style.visibility !== 'hidden'
              && style.opacity !== '0'
              && rect.width > 0
              && rect.height > 0,
            enabled: !element.disabled
              && element.getAttribute('aria-disabled') !== 'true'
              && style.pointerEvents !== 'none',
            topmost: Boolean(hit && (element === hit || element.contains(hit))),
          };
        })
        .filter(candidate => re.test(candidate.text));
      const target = matches.find(candidate =>
        candidate.visible && candidate.enabled && candidate.topmost
      );
      if (!target) {
        return {
          clicked: false,
          matches: matches.slice(0, 6).map(({ text, visible, enabled, topmost }) => ({
            text, visible, enabled, topmost,
          })),
        };
      }
      target.element.click();
      return {
        clicked: true,
        target: {
          text: target.text,
          tag: target.element.tagName,
          className: String(target.element.className || '').slice(0, 120),
        },
      };
    }, [src, flg]);
    if (result.clicked) {
      if (label) console.log('   👉', label, JSON.stringify(result.target));
      return true;
    }
    if (attempt === 4 && result.matches?.length) {
      console.log(`   ⚠️ ${label || src} 仅匹配到不可用元素:`, JSON.stringify(result.matches));
    }
    if (attempt < 4) await sleep(500);
  }
  if (label) console.log('   ⚠️ 未找到:', label);
  return false;
}

async function clickEnabledButton(page, regex, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const buttons = page.locator('button');
    const count = await buttons.count();
    for (let index = 0; index < count; index++) {
      const button = buttons.nth(index);
      const text = (await button.textContent().catch(() => '') || '').replace(/\s+/g, ' ').trim();
      if (!regex.test(text) || !await button.isVisible().catch(() => false)) continue;
      if (await button.isDisabled().catch(() => true)) continue;
      await button.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await button.click({ timeout: 3_000 });
        console.log(`   👉 ${label}:`, text);
        return true;
      } catch {
        await waitPgs(page, 2_000);
      }
    }
    await sleep(250);
  }
  return false;
}

async function inspectPgsState(page, label) {
  const state = await page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && rect.width > 0
        && rect.height > 0;
    };
    const loading = document.querySelector('#aiaLoading');
    const buttonState = button => {
      const rect = button.getBoundingClientRect();
      const hit = rect.width > 0 && rect.height > 0
        ? document.elementFromPoint(
          Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2)),
          Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2)),
        )
        : null;
      return {
        text: (button.textContent || '').replace(/\s+/g, ' ').trim(),
        disabled: button.disabled || button.getAttribute('aria-disabled') === 'true',
        visible: visible(button),
        topmost: Boolean(hit && (button === hit || button.contains(hit))),
      };
    };
    const dialogs = [...document.querySelectorAll('[role="dialog"], .MuiDialog-root')]
      .filter(visible)
      .map(dialog => ({
        text: (dialog.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        buttons: [...dialog.querySelectorAll('button')].map(buttonState),
      }));
    const buttons = [...document.querySelectorAll('button, [role="button"], a')]
      .map(buttonState)
      .filter(button => button.visible)
      .slice(0, 30);
    const inputs = [...document.querySelectorAll('input')]
      .filter(input => visible(input) || input.type === 'radio')
      .slice(0, 20)
      .map(input => ({
        type: input.type,
        name: input.name,
        value: input.value,
        checked: input.type === 'radio' ? input.checked : undefined,
        disabled: input.disabled,
        invalid: input.getAttribute('aria-invalid'),
      }));
    return {
      url: `${location.origin}${location.pathname}${location.hash.split('?')[0]}`,
      loading: loading ? {
        display: getComputedStyle(loading).display,
        opacity: getComputedStyle(loading).opacity,
        pointerEvents: getComputedStyle(loading).pointerEvents,
        ariaHidden: loading.getAttribute('aria-hidden'),
      } : null,
      dialogs,
      buttons,
      inputs,
    };
  });
  if (/失败|缺失|未出现|不可用|超时|错误/.test(label)) {
    console.log(`   🔎 ${label}:`, JSON.stringify(state));
  }
  return state;
}

async function waitForStep2(page, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => {
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && style.opacity !== '0'
          && rect.width > 0
          && rect.height > 0;
      };
      return [...document.querySelectorAll('button, [role="button"], [role="tab"], a, h1, h2, h3, h4')]
        .filter(visible)
        .some(element => /危疾|Critical|產品類別|产品类别/.test(element.textContent || ''));
    }).catch(() => false);
    if (ready) return true;
    await sleep(250);
  }
  return false;
}

async function waitForStep1Ready(page, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ready = await page.locator('input[name="insuredAge"]').count().catch(() => 0);
    if (ready) return true;
    await sleep(250);
  }
  return false;
}

async function selectProductByCode(page, productCode) {
  const result = await page.evaluate(code => {
    const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
    const nodes = [...document.querySelectorAll('*')]
      .filter(element => normalize(element.textContent).includes(code))
      .filter(element =>
        ![...element.children].some(child => normalize(child.textContent).includes(code))
      );
    for (const node of nodes) {
      let card = node;
      for (let depth = 0; card && depth < 10; depth++, card = card.parentElement) {
        const buttons = [...card.querySelectorAll('button, [role="button"], a')]
          .filter(button => /^(選擇|选择|Select)$/i.test(normalize(button.textContent)))
          .filter(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true');
        if (buttons.length !== 1) continue;
        buttons[0].click();
        return {
          clicked: true,
          codeText: normalize(node.textContent),
          cardTag: card.tagName,
          cardClass: String(card.className || '').slice(0, 160),
          cardText: normalize(card.textContent).slice(0, 300),
        };
      }
    }
    return {
      clicked: false,
      matchingLeafTexts: nodes.slice(0, 10).map(node => normalize(node.textContent)),
    };
  }, productCode);
  if (result.clicked) {
    console.log(`   👉 ${productCode} 同卡片選擇`, JSON.stringify(result));
    return true;
  }
  console.log(`   ⚠️ 未找到 ${productCode} 对应的产品卡选择按钮:`, JSON.stringify(result));
  return false;
}

async function waitForStep3(page, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => {
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && style.opacity !== '0'
          && rect.width > 0
          && rect.height > 0;
      };
      const visibleText = [...document.querySelectorAll('label, legend, h1, h2, h3, h4, p, span')]
        .filter(visible)
        .map(element => element.textContent || '')
        .join(' ');
      return /繳付年期|缴付年期|基本計劃|基本计划/.test(visibleText)
        && /保額|保额|Sum\s*Assured/i.test(visibleText);
    }).catch(() => false);
    if (ready) return true;
    await sleep(250);
  }
  return false;
}

async function waitForProductSelectionOutcome(page, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const outcome = await page.evaluate(() => {
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && style.opacity !== '0'
          && rect.width > 0
          && rect.height > 0;
      };
      const dialogConfirm = [...document.querySelectorAll('[role="dialog"] button, .MuiDialog-root button')]
        .find(button =>
          visible(button)
          && !button.disabled
          && /^(確定|确认|确定|Confirm|OK)$/.test((button.textContent || '').trim())
        );
      if (dialogConfirm) return 'CONFIRM_DIALOG';
      const text = [...document.querySelectorAll('label, legend, h1, h2, h3, h4, p, span')]
        .filter(visible)
        .map(element => element.textContent || '')
        .join(' ');
      if (
        /繳付年期|缴付年期|基本計劃|基本计划/.test(text)
        && /保額|保额|Sum\s*Assured/i.test(text)
      ) return 'STEP3';
      return '';
    }).catch(() => '');
    if (outcome) return outcome;
    await sleep(250);
  }
  return 'TIMEOUT';
}

async function hasVisibleButton(page, regex) {
  const [source, flags] = [regex.source, regex.flags.replace('g', '')];
  return page.evaluate(([s, f]) => {
    const re = new RegExp(s, f);
    return [...document.querySelectorAll('button, [role="button"], a')].some(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && rect.width > 0
        && rect.height > 0
        && re.test((element.textContent || '').replace(/\s+/g, ' ').trim());
    });
  }, [source, flags]).catch(() => false);
}

async function waitForPdfViewer(context, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const ownerPage of context.pages().filter(candidate => !candidate.isClosed())) {
      const viewerFrame = ownerPage.frames().find(frame => /viewer\.html|pdfjs/i.test(frame.url()));
      if (viewerFrame) return { ownerPage, viewerFrame };
    }
    await sleep(250);
  }
  return null;
}

async function saveDownloadedPdf(download, outputPath) {
  const temporaryPath = await download.path();
  if (!temporaryPath) throw new LoginError('PDF_DOWNLOAD_PATH_MISSING', '浏览器下载未返回临时文件');
  return savePdfBuffer(fs.readFileSync(temporaryPath), outputPath);
}

function savePdfBuffer(file, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (file.length < 10_000 || file.subarray(0, 5).toString() !== '%PDF-') {
    throw new LoginError('PDF_INVALID', `下载文件不是有效 PDF 或过小：${file.length} bytes`);
  }
  const partialPath = `${outputPath}.partial-${process.pid}`;
  try {
    fs.writeFileSync(partialPath, file);
    fs.rmSync(outputPath, { force: true });
    fs.renameSync(partialPath, outputPath);
  } finally {
    fs.rmSync(partialPath, { force: true });
  }
  console.log(`\n✅ PDF: ${outputPath} (${file.length} bytes)`);
  return true;
}

async function clickExactVisibleText(page, texts, label) {
  const result = await page.evaluate(candidates => {
    const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && rect.width > 0
        && rect.height > 0;
    };
    const elements = [...document.querySelectorAll('*')]
      .filter(element => visible(element) && candidates.includes(normalize(element.textContent)))
      .filter(element =>
        ![...element.children].some(child =>
          visible(child) && candidates.includes(normalize(child.textContent))
        )
      );
    const target = elements[0];
    if (!target) return { clicked: false };
    target.click();
    return {
      clicked: true,
      text: normalize(target.textContent),
      tag: target.tagName,
      className: String(target.className || '').slice(0, 120),
    };
  }, texts);
  if (result.clicked) console.log(`   👉 ${label}:`, JSON.stringify(result));
  return result.clicked;
}

async function downloadProposalPdf(context, page, outputPath) {
  if (!await hasVisibleButton(page, /檢視詳盡建議書|详尽建议书|View Detailed/i)) {
    return false;
  }
  let capturedPdf;
  let resolveCapturedPdf;
  const capturedPdfPromise = new Promise(resolve => {
    resolveCapturedPdf = resolve;
  });
  const networkCandidates = [];
  page.on('response', async response => {
    const contentType = response.headers()['content-type'] || '';
    const rawUrl = response.url();
    if (!/pdf|proposal|illustration|report/i.test(rawUrl) && !/pdf|octet-stream/i.test(contentType)) {
      return;
    }
    let safeUrl = rawUrl;
    try {
      const parsed = new URL(rawUrl);
      safeUrl = `${parsed.origin}${parsed.pathname}`;
    } catch {}
    networkCandidates.push({
      url: safeUrl,
      status: response.status(),
      contentType,
    });
    try {
      const body = await response.body();
      let pdf = body.subarray(0, 5).toString() === '%PDF-' ? body : null;
      if (!pdf && /json|text/i.test(contentType)) {
        const match = body.toString('utf8').match(/JVBERi0[A-Za-z0-9+/=]{1000,}/);
        if (match) pdf = Buffer.from(match[0], 'base64');
      }
      if (pdf && pdf.length >= 10_000 && !capturedPdf) {
        capturedPdf = pdf;
        resolveCapturedPdf(pdf);
      }
    } catch {}
  });

  await clickButtonEval(page, /檢視詳盡建議書|详尽建议书|View Detailed/i, '檢視詳盡建議書');
  const viewDeadline = Date.now() + 20_000;
  while (Date.now() < viewDeadline && !/\/viewPdf\//i.test(page.url())) {
    await sleep(250);
  }
  if (/\/viewPdf\//i.test(page.url())) await waitPgsCycle(page, 60_000);
  if (capturedPdf) return savePdfBuffer(capturedPdf, outputPath);

  let viewer = await waitForPdfViewer(context, 2_000);
  if (!viewer) {
    const previewState = await page.evaluate(() => {
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && style.opacity !== '0'
          && rect.width > 0
          && rect.height > 0;
      };
      return {
        text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
        controls: [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')]
          .filter(visible)
          .map(element => (element.textContent || '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .slice(0, 40),
        frames: [...document.querySelectorAll('iframe')]
          .map(element => ({ id: element.id, src: element.src })),
        embeds: [...document.querySelectorAll('embed, object')]
          .map(element => ({ tag: element.tagName, src: element.src || element.data || '' })),
        versions: [...document.querySelectorAll('*')]
          .filter(element => /^(簽名版|签名版|完整版|完整版本|Full Version)$/.test(
            (element.textContent || '').replace(/\s+/g, ' ').trim(),
          ))
          .filter(element =>
            ![...element.children].some(child =>
              /^(簽名版|签名版|完整版|完整版本|Full Version)$/.test(
                (child.textContent || '').replace(/\s+/g, ' ').trim(),
              )
            )
          )
          .map(element => ({
            tag: element.tagName,
            className: String(element.className || '').slice(0, 120),
            parent: element.parentElement?.outerHTML.slice(0, 500),
          })),
      };
    });
    console.log('   🔎 PDF 预览页:', JSON.stringify(previewState));

    const downloadPromise = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
    const clickedFull = await clickExactVisibleText(
      page,
      ['完整版', '完整版本', 'Full Version'],
      '完整版',
    );
    if (clickedFull) {
      const outcome = await Promise.race([
        downloadPromise.then(download => ({ download })),
        waitForPdfViewer(context, 45_000).then(foundViewer => ({ viewer: foundViewer })),
        capturedPdfPromise.then(buffer => ({ buffer })),
      ]);
      if (outcome.download) return saveDownloadedPdf(outcome.download, outputPath);
      if (outcome.buffer) return savePdfBuffer(outcome.buffer, outputPath);
      viewer = outcome.viewer;
    }
  }
  if (!viewer) {
    const pageStates = context.pages().map(candidate => ({
      url: `${new URL(candidate.url()).origin}${new URL(candidate.url()).pathname}${new URL(candidate.url()).hash.split('?')[0]}`,
      frames: candidate.frames().map(frame => frame.url()).filter(Boolean),
    }));
    console.log('   🔎 PDF viewer 未出现:', JSON.stringify({ pageStates, networkCandidates }));
    throw new LoginError('PDF_VIEWER_TIMEOUT', 'PDF 预览页未出现下载或 PDF viewer');
  }

  try {
    await viewer.viewerFrame.waitForFunction(
      () => window.PDFViewerApplication?.pdfDocument?.numPages > 0,
      null,
      { timeout: 60_000 },
    );
    const base64 = await viewer.viewerFrame.evaluate(async () => {
      const bytes = await window.PDFViewerApplication.pdfDocument.getData();
      let binary = '';
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      }
      return btoa(binary);
    });
    return savePdfBuffer(Buffer.from(base64, 'base64'), outputPath);
  } catch (error) {
    console.log('   ⚠️ PDF.js 直接取数失败，回退下载按钮:', error.message);
  }

  const downloadPromise = viewer.ownerPage.waitForEvent('download', { timeout: 40_000 });
  await viewer.viewerFrame.locator('#download').evaluate(element => element.click());
  const download = await downloadPromise;
  return saveDownloadedPdf(download, outputPath);
}

/** Click a visible MUI radio by exact label text and verify the DOM state. */
async function clickLabelRadio(page, labelTexts, label = '') {
  const candidates = Array.isArray(labelTexts) ? labelTexts : [labelTexts];
  const result = await page.evaluate(texts => {
    const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && rect.width > 0
        && rect.height > 0;
    };
    for (const text of texts) {
      const labelElement = [...document.querySelectorAll('label')]
        .find(candidate => visible(candidate) && normalize(candidate.textContent) === text);
      if (!labelElement) continue;
      const root = labelElement.closest('.MuiFormControlLabel-root') || labelElement;
      const radio = root.querySelector('input[type="radio"]')
        || labelElement.querySelector('input[type="radio"]');
      if (!radio || radio.disabled) continue;
      labelElement.click();
      return {
        found: true,
        text,
        name: radio.name,
        value: radio.value,
        checked: radio.checked,
      };
    }
    return {
      found: false,
      visibleLabels: [...document.querySelectorAll('label')]
        .filter(visible)
        .map(element => normalize(element.textContent))
        .filter(Boolean)
        .slice(0, 40),
    };
  }, candidates);
  if (!result.found || !result.checked) {
    throw new LoginError(
      'RADIO_NOT_SELECTED',
      `${label || candidates.join('/')} 未成功选中：${JSON.stringify(result)}`,
    );
  }
  console.log(`   ${label || result.text}:`, result.text, '✅');
  return result;
}

async function selectRadioValue(page, name, value, label) {
  const result = await page.evaluate(([radioName, radioValue]) => {
    const radio = document.querySelector(
      `input[type="radio"][name="${CSS.escape(radioName)}"][value="${CSS.escape(radioValue)}"]`,
    );
    if (!radio) return { found: false };
    if (!radio.checked && !radio.disabled) radio.click();
    return {
      found: true,
      checked: radio.checked,
      disabled: radio.disabled,
      name: radio.name,
      value: radio.value,
    };
  }, [name, String(value)]);
  if (!result.found || !result.checked) {
    throw new LoginError(
      'RADIO_NOT_SELECTED',
      `${label} 未成功选中 ${name}=${value}：${JSON.stringify(result)}`,
    );
  }
  console.log(`   ${label}:`, value, result.disabled ? '✅（系统锁定）' : '✅');
  return result;
}

/** Select a MUI option by its associated label and verify the displayed value. */
async function selectMuiOption(page, labelPrefixes, optionText) {
  const prefixes = Array.isArray(labelPrefixes) ? labelPrefixes : [labelPrefixes];
  const labels = page.locator('label');
  const count = await labels.count();
  let select;
  for (let index = 0; index < count; index++) {
    const label = labels.nth(index);
    const text = (await label.textContent().catch(() => '') || '').trim();
    if (!prefixes.some(prefix => text.startsWith(prefix))) continue;
    const control = label.locator(
      'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " MuiFormControl-root ")][1]',
    );
    const candidate = control.locator('div.MuiSelect-select').first();
    if (await candidate.isVisible().catch(() => false)) {
      select = candidate;
      break;
    }
  }
  if (!select) {
    throw new LoginError(
      'MUI_SELECT_NOT_FOUND',
      `未找到 ${prefixes.join('/')} 的可见下拉框`,
    );
  }

  await select.click();
  const option = page.getByRole('option', { name: optionText, exact: true }).last();
  await option.waitFor({ state: 'visible', timeout: 5_000 });
  await option.click();
  const actual = (await select.textContent().catch(() => '') || '').trim();
  if (!actual.includes(optionText)) {
    throw new LoginError(
      'MUI_OPTION_NOT_SELECTED',
      `${prefixes.join('/')} 期望 ${optionText}，实际 ${actual || '<空>'}`,
    );
  }
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
  const transferDeadline = Date.now() + 30_000;
  while (Date.now() < transferDeadline && /\/transfer\//i.test(pgs.url())) {
    await sleep(250);
  }
  if (/\/transfer\//i.test(pgs.url())) {
    throw new LoginError('PGS_TRANSFER_TIMEOUT', 'iPGS+ 身份转移页面 30 秒内未完成');
  }
  if (!await waitPgs(pgs, 15_000)) {
    throw new LoginError('PGS_LOADING_TIMEOUT', 'iPGS+ 页面加载遮罩 15 秒内未消失');
  }
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
  if (process.argv.includes('--fresh-login')) {
    await clearAgencySession(ctx);
  }
  const agency = await ensureAgencyLoggedIn(ctx);
  tick('Chrome+登录');

  // ── 2) iPGS+ ──
  const page = await openIpgs(agency);
  console.log('   ✅ PGS 已就绪');
  tick('iPGS+');

  // ════════════════ Step 1: 受保人 ════════════════
  console.log('\n─── Step 1: 受保人 ───');
  await waitPgs(page);
  if (!await waitForStep1Ready(page)) {
    await inspectPgsState(page, '受保人表单未出现');
    throw new LoginError('STEP1_NOT_READY', '受保人表单 30 秒内未出现');
  }
  await sleep(750);

  // PGS 首次打开可能叠加声明或提示弹窗；严格按顶层按钮顺序处理。
  let statementAccepted = false;
  let emptyDialogChecks = 0;
  for (let index = 0; index < 4; index++) {
    const state = await inspectPgsState(page, `Step1 初始弹窗 ${index + 1}`);
    const topButtons = state.dialogs.flatMap(dialog => dialog.buttons)
      .filter(button => button.visible && button.topmost && !button.disabled);
    if (topButtons.some(button => /^(確定|确认|确定|OK)$/.test(button.text))) {
      await clickButtonEval(page, /^(確定|确认|确定|OK)$/, '初始弹窗 確定');
      await sleep(400);
      continue;
    }
    if (topButtons.some(button => /^(接受|Accept|同意)$/.test(button.text))) {
      await clickButtonEval(page, /^(接受|Accept|同意)$/, '初始声明 接受');
      statementAccepted = true;
      await sleep(400);
      continue;
    }
    if (state.dialogs.length) {
      throw new LoginError('PGS_DIALOG_UNHANDLED', 'PGS 初始弹窗没有可识别的确认或接受按钮');
    }
    emptyDialogChecks++;
    if (emptyDialogChecks >= 2) {
      statementAccepted = true;
      break;
    }
    await sleep(500);
  }

  // DOB 必须经过真实输入和失焦，日期控件才会计算 insuredAge。
  const dobInput = page.locator('input[type="text"]').first();
  await dobInput.click();
  await dobInput.fill(DOB);
  await dobInput.press('Tab');
  console.log('   DOB:', DOB);
  const ageInput = page.locator('input[name="insuredAge"]');
  await ageInput.waitFor({ state: 'attached', timeout: 5_000 });
  const ageDeadline = Date.now() + 8_000;
  let computedAge = '';
  while (Date.now() < ageDeadline) {
    computedAge = await ageInput.inputValue().catch(() => '');
    if (computedAge) break;
    await sleep(200);
  }
  if (computedAge !== String(CONFIG.age)) {
    await inspectPgsState(page, '年龄计算失败');
    throw new LoginError(
      'STEP1_AGE_NOT_COMPUTED',
      `DOB 输入后年龄未正确计算，期望 ${CONFIG.age}，实际 ${computedAge || '<空>'}`,
    );
  }
  console.log('   年龄:', computedAge);
  await waitPgs(page);

  // 性别 radio
  await clickLabelRadio(page, CONFIG.gender === '男' ? '男' : '女');
  console.log('   性别:', CONFIG.gender);
  await sleep(600); await waitPgs(page);

  // 吸烟（默认不吸烟，跳过）
  if (CONFIG.smoking) await clickLabelRadio(page, '吸煙');
  console.log('   吸烟:', CONFIG.smoking ? '是' : '否');
  await sleep(200); await waitPgs(page);

  // 居住地区
  await selectMuiOption(page, ['慣常居住地', '惯常居住地'], CONFIG.region);
  console.log('   地区:', CONFIG.region);
  await sleep(600); await waitPgs(page);

  // 居住地区可能先触发警告确认；必须先处理顶层弹窗，不能越层点击接受。
  let afterRegion = await inspectPgsState(page, '地区选择后');
  if (afterRegion.dialogs.some(dialog =>
    dialog.buttons.some(button =>
      button.visible && button.topmost && /^(確定|确认|确定|OK)$/.test(button.text)
    )
  )) {
    await clickButtonEval(page, /^(確定|确认|确定|OK)$/, '地区警告 確定');
    await sleep(500);
    afterRegion = await inspectPgsState(page, '地区警告确认后');
  }

  // 接受声明
  const acceptAvailable = afterRegion.dialogs.some(dialog =>
    dialog.buttons.some(button =>
      button.visible && button.topmost && /^(接受|Accept|同意)$/.test(button.text)
    )
  );
  if (acceptAvailable) {
    statementAccepted = await clickButtonEval(page, /^(接受|Accept|同意)$/, '接受');
    await sleep(500);
    afterRegion = await inspectPgsState(page, '接受后');
  }
  if (!statementAccepted) {
    await inspectPgsState(page, '接受按钮缺失');
    throw new LoginError('STEP1_ACCEPT_NOT_FOUND', '未找到可用的接受按钮');
  }

  // 提交 Step 1。声明可能在填写前或填写后出现，因此先判断产品页是否已自动进入。
  if (!await waitForStep2(page, 1_500)) {
    const submitAvailable = afterRegion.buttons.some(button =>
      button.visible
      && button.topmost
      && !button.disabled
      && /^(確定|确认|确定|OK)$/.test(button.text)
    );
    if (!submitAvailable) {
      await inspectPgsState(page, 'Step1 提交按钮缺失');
      throw new LoginError('STEP1_SUBMIT_NOT_FOUND', '表单填写完成但未找到可用的確定按钮');
    }
    await clickButtonEval(page, /^(確定|确认|确定|OK)$/, 'Step1 確定');
    await sleep(500);
    const afterSubmit = await inspectPgsState(page, 'Step1 確定后');
    if (afterSubmit.dialogs.some(dialog =>
      dialog.buttons.some(button =>
        button.visible
        && button.topmost
        && !button.disabled
        && /^(確定|确认|确定|OK)$/.test(button.text)
      )
    )) {
      await clickButtonEval(page, /^(確定|确认|确定|OK)$/, 'Step1 二次確認');
    }
  }

  await sleep(1000);
  await waitPgs(page, 5000);
  const afterStep1 = await inspectPgsState(page, 'Step1 完成检查');
  if (afterStep1.dialogs.some(dialog =>
    dialog.buttons.some(button => button.visible && /^(接受|Accept|不接受|確定|确认|确定)$/.test(button.text))
  )) {
    throw new LoginError('STEP1_NOT_COMPLETED', '接受及确认后仍停留在 Step 1 弹窗');
  }
  if (!await waitForStep2(page)) {
    await inspectPgsState(page, '产品页未出现');
    throw new LoginError('STEP2_NOT_READY', 'Step 1 提交后 30 秒内未进入产品选择页');
  }
  tick('Step1');

  // ════════════════ Step 2: 选产品 ════════════════
  console.log('\n─── Step 2: 选产品 ───');
  await sleep(1000); await waitPgs(page);

  await clickButtonEval(page, /危疾|危疾保障|Critical/, '危疾');
  await sleep(500);
  if (!await selectProductByCode(page, CONFIG.productCode)) {
    await inspectPgsState(page, '产品卡匹配失败');
    throw new LoginError('PRODUCT_CARD_NOT_FOUND', `未找到产品 ${CONFIG.productCode}`);
  }
  const productOutcome = await waitForProductSelectionOutcome(page);
  if (productOutcome === 'CONFIRM_DIALOG') {
    await inspectPgsState(page, '产品提示弹窗');
    await clickButtonEval(page, /^(確定|确认|确定|Confirm|OK)$/, '产品确认');
  } else if (productOutcome === 'TIMEOUT') {
    await inspectPgsState(page, '产品选择结果超时');
    throw new LoginError('PRODUCT_SELECT_TIMEOUT', `选择 ${CONFIG.productCode} 后没有出现确认或基本计划页`);
  }
  const basicInfoDeadline = Date.now() + 20_000;
  while (Date.now() < basicInfoDeadline && !/\/basicInfo\//i.test(page.url())) {
    await sleep(250);
  }
  if (!/\/basicInfo\//i.test(page.url())) {
    throw new LoginError('STEP3_ROUTE_TIMEOUT', '选择产品后 20 秒内未进入基本计划路由');
  }
  if (!await waitPgsCycle(page, 30_000)) {
    await inspectPgsState(page, '基本计划加载超时');
    throw new LoginError('STEP3_LOADING_TIMEOUT', '基本计划加载遮罩 30 秒内未消失');
  }
  if (!await waitForStep3(page)) {
    await inspectPgsState(page, '基本计划页未出现');
    throw new LoginError('STEP3_NOT_READY', `选择 ${CONFIG.productCode} 后未进入基本计划页`);
  }
  await inspectPgsState(page, '基本计划页');
  tick('Step2');

  // ════════════════ Step 3: 基本计划 ════════════════
  console.log('\n─── Step 3: 基本计划 ───');

  const sameOwner = CONFIG.sameAsInsured && CONFIG.age >= 18;
  await selectRadioValue(page, 'ownerSameWithInsured', sameOwner ? '1' : '0', '保单持有人');
  if (!sameOwner) {
    await selectRadioValue(page, 'sex', CONFIG.payorGender === '女' ? '0' : '1', '持有人性别');
    const payorDob = computeBirthDate(CONFIG.payorAge);
    const payorDobInput = page.locator(
      'input[type="text"]:not([name]), input[type="text"][name=""]',
    ).first();
    await payorDobInput.click();
    await payorDobInput.fill(payorDob);
    await payorDobInput.press('Tab');
    const payorAgeInput = page.locator('input[name="age"]');
    const payorAgeDeadline = Date.now() + 8_000;
    let computedPayorAge = '';
    while (Date.now() < payorAgeDeadline) {
      computedPayorAge = await payorAgeInput.inputValue().catch(() => '');
      if (computedPayorAge) break;
      await sleep(200);
    }
    if (computedPayorAge !== String(CONFIG.payorAge)) {
      throw new LoginError(
        'STEP3_PAYOR_AGE_NOT_COMPUTED',
        `持有人 DOB 输入后年龄未正确计算，期望 ${CONFIG.payorAge}，实际 ${computedPayorAge || '<空>'}`,
      );
    }
    console.log('   持有人年龄:', computedPayorAge, '✅');
    await selectMuiOption(
      page,
      ['慣常居住地', '惯常居住地'],
      CONFIG.payorRegion,
    );
    console.log('   持有人地区:', CONFIG.payorRegion);
    await sleep(500);
  }

  await selectRadioValue(page, 'premiumPaymentPeriod', CONFIG.premiumTerm, '缴付年期');
  await selectRadioValue(page, 'paymentPatternOption', CONFIG.extraPremium ? '1' : '0', '额外保费');
  await selectRadioValue(page, 'paymentFrequency', '1', '缴费模式（年缴）');
  await selectRadioValue(page, 'ciAdvancement', '1', '危疾保额部分（100%）');

  const sumAssuredInput = page.locator('input[name="sumAssured"]');
  await sumAssuredInput.click();
  await sumAssuredInput.fill(String(CONFIG.sumAssured));
  await sumAssuredInput.press('Tab');
  const actualSumAssured = await sumAssuredInput.inputValue();
  if (actualSumAssured.replace(/,/g, '') !== String(CONFIG.sumAssured)) {
    throw new LoginError(
      'STEP3_SUM_ASSURED_NOT_SET',
      `保额填写失败，期望 ${CONFIG.sumAssured}，实际 ${actualSumAssured || '<空>'}`,
    );
  }
  console.log('   保额: USD', actualSumAssured, '✅');
  await sleep(500);

  // 下一步
  const step3Route = page.url();
  if (!await clickEnabledButton(page, /^(下一步|Next)$/i, 'Step3 下一步')) {
    await inspectPgsState(page, 'Step3 下一步不可用');
    throw new LoginError('STEP3_NEXT_NOT_CLICKED', '基本计划填写完成但下一步 20 秒内不可点击');
  }
  const step3Deadline = Date.now() + 30_000;
  while (Date.now() < step3Deadline && page.url() === step3Route) await sleep(250);
  if (page.url() === step3Route) {
    throw new LoginError('STEP3_ROUTE_TIMEOUT', '点击基本计划下一步后 30 秒内路由未变化');
  }
  await waitPgsCycle(page, 30_000);
  await inspectPgsState(page, 'Step3 下一步后');
  tick('Step3');

  // ════════════════ Step 4: 附加契约 ════════════════
  console.log('\n─── Step 4: 附加契约 ───');
  if (!/\/rider\//i.test(page.url())) {
    throw new LoginError('STEP4_ROUTE_MISMATCH', `预期附加契约页，实际 ${page.url().split('?')[0]}`);
  }
  const riderRoute = page.url();
  if (!await clickEnabledButton(page, /^(下一步|Next)$/i, 'Step4 下一步')) {
    throw new LoginError('STEP4_NEXT_NOT_CLICKED', '附加契约页下一步不可点击');
  }
  const riderDeadline = Date.now() + 30_000;
  while (Date.now() < riderDeadline && page.url() === riderRoute) await sleep(250);
  if (page.url() === riderRoute) {
    throw new LoginError('STEP4_ROUTE_TIMEOUT', '附加契约页提交后路由未变化');
  }
  if (!/\/abstract\//i.test(page.url())) {
    throw new LoginError(
      'STEP5_ROUTE_MISMATCH',
      `预期概要页，实际 ${page.url().split('?')[0]}`,
    );
  }
  await waitPgsCycle(page, 30_000);
  await inspectPgsState(page, 'Step4 下一步后');
  tick('Step4');

  // ════════════════ Step 5: 概要 ════════════════
  console.log('\n─── Step 5: 概要 ───');
  const summaryRoute = page.url();
  if (!await clickEnabledButton(page, /^(下一步|Next)$/i, 'Step5 下一步')) {
    throw new LoginError('STEP5_NEXT_NOT_CLICKED', '概要页下一步不可点击');
  }
  const summaryDeadline = Date.now() + 30_000;
  while (Date.now() < summaryDeadline && page.url() === summaryRoute) await sleep(250);
  if (page.url() === summaryRoute) {
    throw new LoginError('STEP5_ROUTE_TIMEOUT', '概要页提交后路由未变化');
  }
  if (!/\/setting\//i.test(page.url())) {
    throw new LoginError(
      'STEP6_ROUTE_MISMATCH',
      `预期建议书选项页，实际 ${page.url().split('?')[0]}`,
    );
  }
  await waitPgsCycle(page, 30_000);
  await inspectPgsState(page, 'Step5 下一步后');
  tick('Step5');

  // ════════════════ Step 6: 建议书选项 ════════════════
  console.log('\n─── Step 6: 建议书选项 ───');
  const nameFields = {
    lastName: CONFIG.insuredSurname,
    firstName: CONFIG.insuredGivenName,
    payorName: CONFIG.payorSurname,
    payorFirst: CONFIG.payorGivenName,
  };
  for (const [name, value] of Object.entries(nameFields)) {
    const input = page.locator(`input[name="${name}"]`);
    if (!await input.count()) {
      await inspectPgsState(page, `建议书选项缺少 ${name}`);
      throw new LoginError('STEP6_NAME_FIELD_MISSING', `建议书选项页缺少字段 ${name}`);
    }
    await input.fill(value);
    if (await input.inputValue() !== value) {
      throw new LoginError('STEP6_NAME_NOT_SET', `建议书选项字段 ${name} 填写失败`);
    }
  }
  console.log('   受保人与持有人姓名: 已填写 ✅');

  const optionsRoute = page.url();
  if (!await clickEnabledButton(page, /^(下一步|Next)$/i, 'Step6 下一步')) {
    throw new LoginError('STEP6_NEXT_NOT_CLICKED', '建议书选项页下一步不可点击');
  }
  const confirmDeadline = Date.now() + 90_000;
  let confirmationClicked = false;
  while (Date.now() < confirmDeadline && page.url() === optionsRoute) {
    const clicked = await page.evaluate(() => {
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (
          style.display === 'none'
          || style.visibility === 'hidden'
          || style.opacity === '0'
          || rect.width === 0
          || rect.height === 0
        ) return false;
        const hit = document.elementFromPoint(
          Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2)),
          Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2)),
        );
        return Boolean(hit && (element === hit || element.contains(hit)));
      };
      const button = [...document.querySelectorAll('[role="dialog"] button, .MuiDialog-root button')]
        .find(candidate =>
          visible(candidate)
          && !candidate.disabled
          && /^(確認|确认|確定|确定|Confirm|OK)$/.test((candidate.textContent || '').trim())
        );
      if (!button) return false;
      button.click();
      return true;
    }).catch(() => false);
    if (clicked) {
      confirmationClicked = true;
      console.log('   👉 建议书确认');
      break;
    }
    await sleep(250);
  }
  if (page.url() === optionsRoute && !confirmationClicked) {
    await inspectPgsState(page, 'Step6 确认弹窗超时');
    throw new LoginError('STEP6_CONFIRM_TIMEOUT', '提交后 90 秒内未出现确认弹窗或完成页');
  }
  const successDeadline = Date.now() + 60_000;
  while (Date.now() < successDeadline && page.url() === optionsRoute) await sleep(250);
  if (page.url() === optionsRoute) {
    throw new LoginError('STEP7_ROUTE_TIMEOUT', '提交建议书选项后 60 秒内未进入完成页');
  }
  await waitPgsCycle(page, 60_000);
  if (!await hasVisibleButton(page, /檢視詳盡建議書|详尽建议书|View Detailed/i)) {
    await inspectPgsState(page, '完成页缺少检视按钮');
    throw new LoginError('STEP7_NOT_READY', '完成页没有检视详尽建议书按钮');
  }
  tick('Step6');

  // ════════════════ Step 7: 下载 PDF ════════════════
  console.log('\n─── Step 7: 下载 PDF ───');
  const pdfSaved = await downloadProposalPdf(
    ctx,
    page,
    path.join(CONFIG.outputDir, FILENAME),
  );
  if (!pdfSaved) {
    throw new LoginError('PDF_START_NOT_FOUND', '完成页没有可用的详尽建议书入口');
  }
  const totalTime = ((Date.now() - TOTAL_START) / 1000).toFixed(1);
  console.log(`📊 总耗时: ${totalTime}s`);
  await automationSession?.close().catch(() => {});
  automationSession = undefined;
}

main().catch(async e => {
  await automationSession?.close().catch(() => {});
  console.error(`❌ ${e.message}`);
  process.exitCode = 1;
});
