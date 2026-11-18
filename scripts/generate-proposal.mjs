#!/usr/bin/env node
/**
 * PGS 计划书全自动生成 v0.9.0
 * 技术栈：Playwright persistent context + 页面状态验证
 *
 * 用法：npm run generate -- <params.json>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearAgencySession,
  ensureAgencyLoggedIn,
  launchAutomationContext,
  LoginError,
  MANUAL_LOGIN_EXIT_CODE,
} from './login-agency.mjs';
import { generateIrrReport } from './irr-report.mjs';
import {
  DEFAULT_PROPOSAL_ROOT,
  resolveProposalOutput,
} from './proposal-files.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let automationSession;
const keepWindow = process.argv.includes('--keep-window');

// ====== 参数默认 ======
const DEFAULTS = {
  productType: 'criticalIllness',
  gender: '女', insuredSexValue: '0', age: 1,
  region: '中華人民共和國', smoking: false,
  sumAssured: 300000, premiumTerm: 25, extraPremium: false,
  annualPremium: 50000, currency: '美元',
  withdrawalPlan: { enabled: false },
  sameAsInsured: true,
  productName: '', productCode: '',
  insuredSurname: 'vip', insuredGivenName: 'vip',
  payorSurname: 'vip', payorGivenName: 'vip',
  payorGender: '男', payorAge: 35, payorRegion: '中華人民共和國',
  outputDir: DEFAULT_PROPOSAL_ROOT,
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
    'productType',
    'productName',
    'gender',
    'age',
    'region',
    'premiumTerm',
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
  if (input.unborn === true) {
    throw new LoginError('PARAMS_UNBORN_UNSUPPORTED', '未出生受保人的计划书需在 iPGS+ 手动制作');
  }
  if (!Number.isInteger(input.premiumTerm) || input.premiumTerm <= 0) {
    throw new LoginError('PARAMS_INVALID', 'premiumTerm 必须是正整数');
  }
  if (typeof input.sameAsInsured !== 'boolean') {
    throw new LoginError(
      'PARAMS_INVALID',
      'sameAsInsured 必须是 JSON boolean',
    );
  }
  if (typeof input.insuredSurname !== 'string'
    || typeof input.insuredGivenName !== 'string') {
    throw new LoginError('PARAMS_INVALID', '受保人的姓和名必须是字符串');
  }
  const productType = input.productType;
  if (!['criticalIllness', 'savings'].includes(productType)) {
    throw new LoginError(
      'PRODUCT_UNSUPPORTED',
      'productType 必须是 criticalIllness 或 savings',
    );
  }
  if (productType === 'criticalIllness') {
    if (!Number.isInteger(input.sumAssured) || input.sumAssured <= 0) {
      throw new LoginError('PARAMS_INVALID', '危疾险 sumAssured 必须是正整数');
    }
    if (typeof input.smoking !== 'boolean' || typeof input.extraPremium !== 'boolean') {
      throw new LoginError(
        'PARAMS_INVALID',
        '危疾险 smoking、extraPremium 必须是 JSON boolean',
      );
    }
    if (input.withdrawalPlan?.enabled) {
      throw new LoginError(
        'PARAMS_INVALID',
        '提领计划只适用于储蓄险',
      );
    }
  } else {
    if (!Number.isInteger(input.annualPremium) || input.annualPremium <= 0) {
      throw new LoginError('PARAMS_INVALID', '储蓄险 annualPremium 必须是正整数');
    }
    if (typeof input.currency !== 'string' || !input.currency.trim()) {
      throw new LoginError(
        'PARAMS_INVALID',
        '储蓄险 currency 必须是非空字符串',
      );
    }
    if (!input.withdrawalPlan
      || typeof input.withdrawalPlan !== 'object'
      || Array.isArray(input.withdrawalPlan)
      || typeof input.withdrawalPlan.enabled !== 'boolean') {
      throw new LoginError(
        'PARAMS_INVALID',
        '储蓄险 withdrawalPlan.enabled 必须明确为 true 或 false',
      );
    }
    if (input.withdrawalPlan.enabled) {
      const { startPolicyYear, endPolicyYear, annualAmount } = input.withdrawalPlan;
      if (!Number.isInteger(startPolicyYear) || startPolicyYear <= 0) {
        throw new LoginError(
          'PARAMS_INVALID',
          '提领 startPolicyYear 必须是正整数',
        );
      }
      if (endPolicyYear !== 'last'
        && (!Number.isInteger(endPolicyYear) || endPolicyYear <= 0)) {
        throw new LoginError(
          'PARAMS_INVALID',
          '提领 endPolicyYear 必须是正整数或字符串“last”',
        );
      }
      if (Number.isInteger(endPolicyYear) && endPolicyYear < startPolicyYear) {
        throw new LoginError(
          'PARAMS_INVALID',
          '提领 endPolicyYear 不能早于 startPolicyYear',
        );
      }
      if (!Number.isInteger(annualAmount) || annualAmount <= 0) {
        throw new LoginError(
          'PARAMS_INVALID',
          '提领 annualAmount 必须是正整数',
        );
      }
    }
  }
  if (typeof input.productName !== 'string' || !input.productName.trim()) {
    throw new LoginError('PARAMS_INVALID', 'productName 必须是非空字符串');
  }
  if (input.productCode !== undefined && typeof input.productCode !== 'string') {
    throw new LoginError('PARAMS_INVALID', 'productCode 必须是字符串');
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

  const cfg = {
    ...DEFAULTS,
    ...input,
    productType,
    sameAsInsured: sameOwner,
    smoking: productType === 'savings' ? false : input.smoking,
    productCategory: productType === 'savings' ? '儲蓄保險' : '危疾保障',
    productName: input.productName.trim(),
    productCode: input.productCode?.trim().toUpperCase() || '',
    withdrawalPlan: productType === 'savings'
      ? {
        ...input.withdrawalPlan,
        growthRate: 0,
        treatment: 'reduceAssured',
      }
      : { enabled: false },
  };
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

export async function declineUnbornDialog(page) {
  const dialogs = page.locator('[role="dialog"], .MuiDialog-root:not(:has([role="dialog"]))');
  const dialog = dialogs
    .filter({ hasText: /未出生|未出世|胎[兒儿]|unborn/i })
    .filter({ visible: true });
  if (await dialog.count() === 0) return false;
  const no = dialog.getByRole('button', { name: /^(否|不是|No)$/i });
  try {
    await no.click({ timeout: 5_000 });
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
  } catch {
    throw new LoginError('UNBORN_DIALOG_NOT_DISMISSED', '未能在未出生投保提示中选「否」');
  }
  console.log('   👉 未出生投保提示: 否');
  return true;
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
    await declineUnbornDialog(page);
    const ready = await page.locator('input[name="insuredAge"]').count().catch(() => 0);
    if (ready) return true;
    await sleep(250);
  }
  return false;
}

async function waitForStep6NameFields(page, names, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(expectedNames =>
      expectedNames.every(name => document.querySelector(`input[name="${name}"]`)),
    names).catch(() => false);
    if (ready) return true;
    await sleep(250);
  }
  return false;
}

async function selectProduct(page, { productCode, productName }) {
  const productAliases = {
    '环球盈活': '環宇盈活',
    '環球盈活': '環宇盈活',
  };
  const productQuery = productAliases[productName] || productName;
  const result = await page.evaluate(({ code, name }) => {
    const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
    const traditionalToSimplified = {
      '愛': '爱', '簡': '简', '緻': '致', '環': '环', '貨': '货', '幣': '币',
      '計': '计', '劃': '划', '諾': '诺', '寶': '宝', '續': '续', '級': '级',
      '財': '财', '顯': '显', '壽': '寿', '險': '险', '進': '进', '憂': '忧',
      '長': '长', '無': '无', '儲': '储', '護': '护',
    };
    const compact = value => normalize(value)
      .toLowerCase()
      .replace(/[愛簡緻環貨幣計劃諾寶續級財顯壽險進憂長無儲護]/g,
        character => traditionalToSimplified[character])
      .replace(/[\s「」『』【】()[\]（）"'“”‘’·•,，.。:：/\\-]/g, '');
    const isSubsequence = (query, text) => {
      let index = 0;
      for (const character of text) {
        if (character === query[index]) index++;
        if (index === query.length) return true;
      }
      return false;
    };
    const products = [...document.querySelectorAll('button, [role="button"], a')]
      .filter(button => /^(選擇|选择|Select)$/i.test(normalize(button.textContent)))
      .filter(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true')
      .map(button => {
        let card = button.closest('li');
        if (!card) {
          card = button.parentElement;
          while (card && normalize(card.textContent).length <= normalize(button.textContent).length) {
            card = card.parentElement;
          }
        }
        const text = normalize(card?.textContent)
          .replace(/\s*(選擇|选择|Select)\s*$/i, '')
          .trim();
        return {
          button,
          card,
          code: text.match(/^([A-Z][A-Z0-9+.-]{1,20})\s*-/)?.[1] || '',
          text,
        };
      })
      .filter((product, index, all) =>
        product.text && all.findIndex(candidate => candidate.text === product.text) === index
      );
    const codeMatches = code
      ? products.filter(product => product.code.toUpperCase() === code.toUpperCase())
      : products;
    const query = compact(name);
    const nameMatches = product => {
      const text = compact(product.text);
      return Boolean(query) && (text.includes(query) || isSubsequence(query, text));
    };
    let matches;
    if (code && codeMatches.length === 1) {
      matches = codeMatches;
    } else if (code) {
      matches = codeMatches.filter(nameMatches);
    } else {
      matches = products.filter(nameMatches);
    }
    const candidates = matches.map(product => ({ code: product.code, text: product.text }));
    if (matches.length !== 1) {
      return {
        status: matches.length ? 'ambiguous' : 'not-found',
        candidates: candidates.length
          ? candidates
          : products.map(product => ({ code: product.code, text: product.text })),
      };
    }
    const [product] = matches;
    product.button.click();
    return {
      status: 'clicked',
      code: product.code,
      cardTag: product.card?.tagName || '',
      cardClass: String(product.card?.className || '').slice(0, 160),
      cardText: product.text.slice(0, 300),
    };
  }, { code: productCode, name: productQuery });
  const target = productCode || productName;
  if (result.status === 'clicked') {
    console.log(`   👉 ${target} 同卡片選擇`, JSON.stringify(result));
    return result;
  }
  const candidateText = result.candidates
    .slice(0, 20)
    .map(candidate => `${candidate.code || '<无代码>'}: ${candidate.text}`)
    .join(' | ');
  if (result.status === 'ambiguous') {
    throw new LoginError(
      'PRODUCT_AMBIGUOUS',
      `产品“${target}”匹配到多张卡片，请补充产品代码、完整名称或货币版本：${candidateText}`,
    );
  }
  throw new LoginError(
    'PRODUCT_CARD_NOT_FOUND',
    `未找到产品“${target}”。当前分类可选产品：${candidateText}`,
  );
}

async function listVisibleProducts(page) {
  return page.evaluate(() => {
    const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
    const buttons = [...document.querySelectorAll('button, [role="button"], a')]
      .filter(button => /^(選擇|选择|Select)$/i.test(normalize(button.textContent)));
    const products = [];
    for (const button of buttons) {
      let card = button.closest('li');
      if (!card) {
        card = button.parentElement;
        while (card && normalize(card.textContent).length <= normalize(button.textContent).length) {
          card = card.parentElement;
        }
      }
      const text = normalize(card?.textContent)
        .replace(/\s*(選擇|选择|Select)\s*$/i, '')
        .trim();
      if (!text || products.some(product => product.text === text)) continue;
      const code = text.match(/^([A-Z][A-Z0-9+.-]{1,20})\s*-/)?.[1] || '';
      products.push({ code, text });
    }
    return products;
  });
}

async function inspectCurrentForm(page, label) {
  const snapshot = await page.evaluate(() => {
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
    return {
      url: `${location.origin}${location.pathname}${location.hash.split('?')[0]}`,
      text: normalize(document.body.textContent).slice(0, 4_000),
      labels: [...document.querySelectorAll('label, legend')]
        .filter(visible)
        .map(element => normalize(element.textContent))
        .filter(Boolean),
      inputs: [...document.querySelectorAll('input')].map(input => ({
        type: input.type,
        name: input.name,
        value: input.value,
        checked: input.type === 'radio' ? input.checked : undefined,
        disabled: input.disabled,
        visible: visible(input),
        placeholder: input.placeholder,
        parentText: normalize(input.parentElement?.parentElement?.textContent).slice(0, 200),
      })),
      selects: [...document.querySelectorAll('.MuiSelect-select')]
        .filter(visible)
        .map(element => normalize(element.textContent)),
      buttons: [...document.querySelectorAll('button, [role="button"]')]
        .filter(visible)
        .map(element => normalize(element.textContent))
        .filter(Boolean),
      dialogs: [...document.querySelectorAll('[role="dialog"], .MuiDialog-root')]
        .filter(visible)
        .map(element => normalize(element.textContent).slice(0, 800)),
    };
  });
  console.log(`   🔎 ${label}:`, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

async function waitForStep3(page, productType, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(type => {
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && style.opacity !== '0'
          && rect.width > 0
          && rect.height > 0;
      };
      const hasOwner = Boolean(document.querySelector('input[name="ownerSameWithInsured"]'));
      const hasTerm = Boolean(document.querySelector('input[name="premiumPaymentPeriod"]'));
      const visibleText = [...document.querySelectorAll('label, legend, h1, h2, h3, h4, p, span, button')]
        .filter(visible)
        .map(element => element.textContent || '')
        .join(' ');
      return hasOwner
        && hasTerm
        && (
          type === 'savings'
            ? /預算每年保費|预算每年保费|基本金額|基本金额/.test(visibleText)
            : /保額|保额|Sum\s*Assured/i.test(visibleText)
        );
    }, productType).catch(() => false);
    if (ready) return true;
    await sleep(250);
  }
  return false;
}

async function waitForProductSelectionOutcome(page, productType, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await declineUnbornDialog(page);
    const outcome = await page.evaluate(type => {
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
      if (/\/basicInfo\//i.test(location.href)) return 'STEP3';
      const text = [...document.querySelectorAll('label, legend, h1, h2, h3, h4, p, span')]
        .filter(visible)
        .map(element => element.textContent || '')
        .join(' ');
      if (type === 'savings' && /預算每年保費|预算每年保费|基本金額|基本金额/.test(text)) {
        return 'STEP3';
      }
      if (type === 'criticalIllness'
        && /繳付年期|缴付年期|基本計劃|基本计划/.test(text)
        && /保額|保额|Sum\s*Assured/i.test(text)) return 'STEP3';
      return '';
    }, productType).catch(() => '');
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

/** Select a radio-style card whose MUI control is implemented as a hidden checkbox. */
async function selectCheckableCard(page, labelTexts, label = '') {
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
      const textElement = [...document.querySelectorAll('*')]
        .find(element =>
          visible(element)
          && normalize(element.textContent) === text
          && ![...element.children].some(child =>
            visible(child) && normalize(child.textContent) === text
          )
        );
      if (!textElement) continue;
      let root = textElement;
      for (let depth = 0; root && depth < 8; depth++, root = root.parentElement) {
        const controls = [...root.querySelectorAll(
          'input[type="checkbox"], input[type="radio"]',
        )].filter(control => !control.disabled);
        if (controls.length !== 1) continue;
        const [control] = controls;
        if (!control.checked) control.click();
        return {
          found: true,
          text,
          type: control.type,
          name: control.name,
          value: control.value,
          checked: control.checked,
        };
      }
    }
    return { found: false };
  }, candidates);
  if (!result.found || !result.checked) {
    throw new LoginError(
      'OPTION_CARD_NOT_SELECTED',
      `${label || candidates.join('/')} 未成功选中：${JSON.stringify(result)}`,
    );
  }
  console.log(`   ${label || result.text}:`, result.text, '✅');
  return result;
}

async function fillTextInputByLabel(page, labelPrefixes, value, label) {
  const prefixes = Array.isArray(labelPrefixes) ? labelPrefixes : [labelPrefixes];
  const result = await page.evaluate(texts => {
    const normalize = text => (text || '').replace(/\s+/g, ' ').trim();
    const labels = [...document.querySelectorAll('label')];
    for (const candidate of labels) {
      const text = normalize(candidate.textContent);
      if (!texts.some(prefix => text.startsWith(prefix))) continue;
      let root = candidate;
      for (let depth = 0; root && depth < 6; depth++, root = root.parentElement) {
        const inputs = [...root.querySelectorAll('input[type="text"], input[type="number"]')]
          .filter(input => !input.disabled);
        if (inputs.length !== 1) continue;
        return {
          found: true,
          text,
          index: [...document.querySelectorAll('input')].indexOf(inputs[0]),
        };
      }
    }
    return { found: false };
  }, prefixes);
  if (!result.found) {
    throw new LoginError(
      'WITHDRAWAL_FIELD_NOT_FOUND',
      `未找到${label}输入框`,
    );
  }
  const input = page.locator('input').nth(result.index);
  if (Number(value) === 0) {
    await input.click();
    await input.fill('');
    await input.pressSequentially('0', { delay: 100 });
  } else {
    await input.fill(String(value));
    await input.press('Tab');
  }
  await sleep(250);
  const actual = (await input.inputValue()).replace(/,/g, '');
  if (!actual || Number(actual) !== Number(value)) {
    throw new LoginError(
      'WITHDRAWAL_FIELD_NOT_SET',
      `${label}填写失败，期望 ${value}，实际 ${actual || '<空>'}`,
    );
  }
  console.log(`   ${label}:`, actual, '✅');
  return input;
}

async function readWithdrawalPolicyYearBounds(page) {
  const bounds = await page.evaluate(() => {
    const text = (document.body.textContent || '').replace(/\s+/g, ' ');
    const minimum = text.match(/最早第\s*(\d+)\s*年|Earliest[^\d]*(\d+)/i);
    const maximum = text.match(/最多第\s*(\d+)\s*年|Latest[^\d]*(\d+)/i);
    return {
      minimum: Number(minimum?.[1] || minimum?.[2] || 0),
      maximum: Number(maximum?.[1] || maximum?.[2] || 0),
    };
  });
  if (!bounds.minimum || !bounds.maximum || bounds.maximum < bounds.minimum) {
    throw new LoginError(
      'WITHDRAWAL_YEAR_BOUNDS_NOT_FOUND',
      `未能读取提领保单年度范围：${JSON.stringify(bounds)}`,
    );
  }
  return bounds;
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

async function hasRadio(page, name, value) {
  const selector = value === undefined
    ? `input[type="radio"][name="${name}"]`
    : `input[type="radio"][name="${name}"][value="${value}"]`;
  return Boolean(await page.locator(selector).count());
}

async function selectAnnualFrequency(page, premiumTerm) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (premiumTerm !== 1 && await hasRadio(page, 'paymentFrequency', '1')) {
      return selectRadioValue(page, 'paymentFrequency', '1', '缴费模式（年缴）');
    }
    const current = await page.locator(
      'input[type="radio"][name="paymentFrequency"]:checked',
    ).first().getAttribute('value').catch(() => '');
    if (premiumTerm === 1 && current === '0') {
      console.log('   缴费模式: 一次过缴费 ✅');
      return;
    }
    await sleep(200);
  }
  throw new LoginError(
    'PAYMENT_FREQUENCY_UNAVAILABLE',
    `当前产品的 ${premiumTerm} 年缴没有对应的年缴选项`,
  );
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

async function selectCurrency(page, currency) {
  try {
    await selectMuiOption(page, ['貨幣', '货币', 'Currency'], currency);
    return;
  } catch (error) {
    if (error.code !== 'MUI_SELECT_NOT_FOUND') throw error;
  }
  const result = await page.evaluate(targetCurrency => {
    const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
    const labels = [...document.querySelectorAll('label')]
      .filter(label => normalize(label.textContent).includes(targetCurrency));
    for (const label of labels) {
      const nested = label.querySelector('input[name="currencyCode"]');
      const linked = label.htmlFor ? document.getElementById(label.htmlFor) : null;
      const radio = nested || linked;
      if (radio?.name !== 'currencyCode') continue;
      if (!radio.checked && !radio.disabled) radio.click();
      if (radio.checked) return { selected: true, value: radio.value };
    }
    const radios = [...document.querySelectorAll('input[name="currencyCode"]')];
    const checked = radios.find(radio => radio.checked);
    const pageText = normalize(document.body.textContent);
    if (radios.length === 1 && checked && pageText.includes(targetCurrency)) {
      return { selected: true, value: checked.value };
    }
    return {
      selected: false,
      labels: labels.map(label => normalize(label.textContent)),
      values: radios.map(radio => ({ value: radio.value, checked: radio.checked })),
    };
  }, currency);
  if (!result.selected) {
    throw new LoginError(
      'CURRENCY_NOT_AVAILABLE',
      `当前产品没有货币“${currency}”：${JSON.stringify(result)}`,
    );
  }
  console.log(`   货币: ${currency} ✅`);
}

async function configureSavingsWithdrawal(page, plan) {
  if (!plan.enabled) {
    console.log('   提领计划: 不提领 ✅');
    return;
  }

  if (!await clickEnabledButton(
    page,
    /^(保單選項|保单选项|Policy Options)$/i,
    '保单选项',
    45_000,
  )) {
    throw new LoginError('WITHDRAWAL_OPTIONS_NOT_FOUND', '概要页没有可用的保单选项标签');
  }
  await waitPgsCycle(page, 30_000);
  let withdrawalOptionsState = await inspectPgsState(page, '进入保单选项后');
  const optionsConfirmation = withdrawalOptionsState.dialogs.some(dialog =>
    dialog.buttons.some(button =>
      button.visible
      && button.topmost
      && !button.disabled
      && /^(確認|确认|確定|确定|OK)$/.test(button.text)
    )
  );
  if (optionsConfirmation) {
    await clickButtonEval(
      page,
      /^(確認|确认|確定|确定|OK)$/,
      '保单选项提示确认',
    );
    await sleep(500);
    await waitPgsCycle(page, 30_000);
  }
  let withdrawalOptionsReady = await page.waitForFunction(
    () => /以相同提取金額提取|以相同提取金额提取/.test(document.body.textContent || ''),
    null,
    { timeout: 45_000 },
  ).then(() => true).catch(() => false);
  if (!withdrawalOptionsReady) {
    withdrawalOptionsState = await inspectPgsState(page, '保单选项首次加载超时');
    const delayedConfirmation = withdrawalOptionsState.dialogs.some(dialog =>
      dialog.buttons.some(button =>
        button.visible
        && button.topmost
        && !button.disabled
        && /^(確認|确认|確定|确定|OK)$/.test(button.text)
      )
    );
    if (delayedConfirmation) {
      await clickButtonEval(
        page,
        /^(確認|确认|確定|确定|OK)$/,
        '延迟保单选项提示确认',
      );
      await sleep(500);
      withdrawalOptionsReady = await page.waitForFunction(
        () => /以相同提取金額提取|以相同提取金额提取/.test(document.body.textContent || ''),
        null,
        { timeout: 60_000 },
      ).then(() => true).catch(() => false);
    }
  }
  if (!withdrawalOptionsReady) {
    console.log('   ⚠️ 保单选项 45 秒内未挂载，按当前页面状态重试一次');
    if (!await clickEnabledButton(
      page,
      /^(保單選項|保单选项|Policy Options)$/i,
      '重试保单选项',
      15_000,
    )) {
      throw new LoginError(
        'WITHDRAWAL_OPTIONS_LOAD_TIMEOUT',
        '保单选项首次加载超时，且当前页面没有可重试的保单选项标签',
      );
    }
    await waitPgsCycle(page, 60_000);
    withdrawalOptionsReady = await page.waitForFunction(
      () => /以相同提取金額提取|以相同提取金额提取/.test(document.body.textContent || ''),
      null,
      { timeout: 60_000 },
    ).then(() => true).catch(() => false);
  }
  if (!withdrawalOptionsReady) {
    await inspectPgsState(page, '保单选项重试仍未就绪');
    throw new LoginError(
      'WITHDRAWAL_OPTIONS_LOAD_TIMEOUT',
      '重试后保单选项仍未在 60 秒内挂载',
    );
  }
  await selectCheckableCard(
    page,
    ['以相同提取金額提取', '以相同提取金额提取'],
    '以相同提取金额提取',
  );
  if (!await clickEnabledButton(
    page,
    /^(開始設定|开始设定|Start Setting)$/i,
    '开始设定',
  )) {
    throw new LoginError('WITHDRAWAL_START_NOT_FOUND', '保单选项页没有可用的开始设定按钮');
  }
  await page.waitForURL(/\/abstract\/po/i, { timeout: 30_000 });
  await page.waitForFunction(
    () => /提取金額|提取金额|Withdrawal Amount/i.test(document.body.textContent || ''),
    null,
    { timeout: 30_000 },
  );

  await clickLabelRadio(
    page,
    ['保單年度', '保单年度', 'Policy Year'],
    '按保单年度提领',
  );
  await page.waitForFunction(
    () => /開始年度|开始年度|Start Policy Year/i.test(document.body.textContent || ''),
    null,
    { timeout: 10_000 },
  );
  const bounds = await readWithdrawalPolicyYearBounds(page);
  const endPolicyYear = plan.endPolicyYear === 'last'
    ? bounds.maximum
    : plan.endPolicyYear;
  if (plan.startPolicyYear < bounds.minimum
    || plan.startPolicyYear > bounds.maximum
    || endPolicyYear < plan.startPolicyYear
    || endPolicyYear > bounds.maximum) {
    throw new LoginError(
      'WITHDRAWAL_YEAR_OUT_OF_RANGE',
      `提领年度必须在 ${bounds.minimum}-${bounds.maximum} 内，收到 ${plan.startPolicyYear}-${endPolicyYear}`,
    );
  }
  console.log(`   页面允许提领年度: ${bounds.minimum}-${bounds.maximum}`);

  await fillTextInputByLabel(
    page,
    ['開始年度', '开始年度', 'Start Policy Year'],
    plan.startPolicyYear,
    '开始保单年度',
  );
  await fillTextInputByLabel(
    page,
    ['終止年度', '终止年度', 'End Policy Year'],
    endPolicyYear,
    '终止保单年度',
  );
  await fillTextInputByLabel(
    page,
    ['提取金額', '提取金额', 'Withdrawal Amount'],
    plan.annualAmount,
    '目标每年提取金额',
  );
  const growthInput = await fillTextInputByLabel(
    page,
    ['預期每年通脹率', '预期每年通胀率', 'Expected Annual Inflation'],
    plan.growthRate,
    '每年提款增长率',
  );
  await clickLabelRadio(
    page,
    ['減少基本金額', '减少基本金额', 'Reduce Basic Amount'],
    '提取后处理',
  );
  const growthAfterBlur = (await growthInput.inputValue()).replace(/,/g, '');
  if (growthAfterBlur && Number(growthAfterBlur) !== 0) {
    throw new LoginError(
      'WITHDRAWAL_GROWTH_RATE_NOT_SET',
      `选择提取后处理后 0% 增长率未保留，实际 ${growthAfterBlur || '<空>'}`,
    );
  }
  if (!growthAfterBlur) {
    console.log('   每年提款增长率: 页面失焦后以空白显示 0%，继续由储存/计算状态验证');
  }
  const afterTreatment = await inspectPgsState(page, '减少基本金额后');
  const treatmentConfirmation = afterTreatment.dialogs.some(dialog =>
    dialog.buttons.some(button =>
      button.visible
      && button.topmost
      && !button.disabled
      && /^(確認|确认|確定|确定|OK)$/.test(button.text)
    )
  );
  if (treatmentConfirmation) {
    await clickButtonEval(
      page,
      /^(確認|确认|確定|确定|OK)$/,
      '部分退保提示确认',
    );
    await sleep(500);
  }

  if (!await clickEnabledButton(page, /^(儲存|储存|Save)$/i, '储存提领设定')) {
    await inspectCurrentForm(page, '提领储存按钮不可用');
    throw new LoginError('WITHDRAWAL_SAVE_NOT_FOUND', '同额提取设置页没有可用的储存按钮');
  }
  if (!await clickEnabledButton(
    page,
    /^(計算|计算|Calculate)$/i,
    '计算可实现提取金额',
    60_000,
  )) {
    await inspectCurrentForm(page, '提领储存后计算按钮不可用');
    throw new LoginError(
      'WITHDRAWAL_CALCULATE_NOT_READY',
      '储存提领设定后 60 秒内计算按钮仍不可用',
    );
  }
  await waitPgsCycle(page, 120_000);
  await sleep(1_000);
  const calculationState = await inspectPgsState(page, '提领计算后');
  const calculationConfirmation = calculationState.dialogs.some(dialog =>
    dialog.buttons.some(button =>
      button.visible
      && button.topmost
      && !button.disabled
      && /^(確認|确认|確定|确定|OK)$/.test(button.text)
    )
  );
  if (calculationConfirmation) {
    await clickButtonEval(
      page,
      /^(確認|确认|確定|确定|OK)$/,
      '提领计算结果确认',
    );
  }
  const resultPageDeadline = Date.now() + 60_000;
  while (Date.now() < resultPageDeadline
    && !/\/abstract\/po-result/i.test(page.url())) {
    await sleep(250);
  }
  const expectedWithdrawalRows = endPolicyYear - plan.startPolicyYear + 1;
  if (!/\/abstract\/po-result/i.test(page.url())) {
    const preliminaryRows = await page.locator('input[name^="withDraw-"]').count();
    if (preliminaryRows >= expectedWithdrawalRows) {
      console.log(
        '   ⚠️ 提领结果表已完整但路由未切换，按当前结果状态重试计算一次',
      );
      if (await clickEnabledButton(
        page,
        /^(計算|计算|Calculate)$/i,
        '重试完成提领计算',
        15_000,
      )) {
        await waitPgsCycle(page, 120_000);
        const retryCalculationState = await inspectPgsState(page, '重试提领计算后');
        const retryConfirmation = retryCalculationState.dialogs.some(dialog =>
          dialog.buttons.some(button =>
            button.visible
            && button.topmost
            && !button.disabled
            && /^(確認|确认|確定|确定|OK)$/.test(button.text)
          )
        );
        if (retryConfirmation) {
          await clickButtonEval(
            page,
            /^(確認|确认|確定|确定|OK)$/,
            '重试提领计算确认',
          );
        }
        const retryResultDeadline = Date.now() + 60_000;
        while (Date.now() < retryResultDeadline
          && !/\/abstract\/po-result/i.test(page.url())
          && !await hasVisibleButton(page, /^(完成|Done|Complete)$/i)) {
          await sleep(250);
        }
      }
    }
  }
  const resultReady = /\/abstract\/po-result/i.test(page.url())
    || (
      await page.locator('input[name^="withDraw-"]').count() >= expectedWithdrawalRows
      && await hasVisibleButton(page, /^(完成|Done|Complete)$/i)
    );
  if (!resultReady) {
    await inspectCurrentForm(page, '提领计算未进入可完成结果状态');
    throw new LoginError(
      'WITHDRAWAL_RESULT_NOT_READY',
      `提领计算后没有进入可完成的逐年结果状态：${page.url().split('?')[0]}`,
    );
  }
  await page.waitForFunction(
    expectedRows =>
      document.querySelectorAll('input[name^="withDraw-"]').length >= expectedRows,
    expectedWithdrawalRows,
    { timeout: 60_000 },
  );
  const schedule = await page.evaluate(({ start, end }) => {
    const rows = [...document.querySelectorAll('input[name^="withDraw-"]')]
      .map(input => {
        const index = Number(input.name.replace('withDraw-', ''));
        return {
          policyYear: index + 1,
          amount: Number(input.value.replace(/,/g, '')),
        };
      })
      .filter(row =>
        row.policyYear >= start
        && row.policyYear <= end
        && Number.isFinite(row.amount)
      )
      .sort((left, right) => left.policyYear - right.policyYear);
    return {
      rows: rows.length,
      expectedRows: end - start + 1,
      first: rows[0],
      last: rows.at(-1),
      minimum: rows.length ? Math.min(...rows.map(row => row.amount)) : null,
      maximum: rows.length ? Math.max(...rows.map(row => row.amount)) : null,
    };
  }, { start: plan.startPolicyYear, end: endPolicyYear });
  if (schedule.rows !== schedule.expectedRows
    || schedule.first?.policyYear !== plan.startPolicyYear
    || schedule.last?.policyYear !== endPolicyYear
    || schedule.first.amount <= 0
    || schedule.last.amount <= 0) {
    await inspectCurrentForm(page, '提领结果表不完整');
    throw new LoginError(
      'WITHDRAWAL_SCHEDULE_INVALID',
      `提领结果表未覆盖完整年度或首末金额不可提取：${JSON.stringify(schedule)}`,
    );
  }
  console.log(
    `   提领结果表: ${schedule.rows} 个年度，系统实际每年 USD ${schedule.minimum}-${schedule.maximum} ✅`,
  );
  if (!await clickEnabledButton(
    page,
    /^(完成|Done|Complete)$/i,
    '完成提领设置',
  )) {
    throw new LoginError(
      'WITHDRAWAL_COMPLETE_NOT_FOUND',
      '提领结果页没有可用的完成按钮',
    );
  }
  const completionDeadline = Date.now() + 60_000;
  while (Date.now() < completionDeadline && !/\/abstract\/index/i.test(page.url())) {
    await sleep(250);
  }
  if (!/\/abstract\/index/i.test(page.url())) {
    await inspectCurrentForm(page, '提领计算结果');
    throw new LoginError(
      'WITHDRAWAL_RESULT_NOT_APPLIED',
      `提领计算后未返回概要页：${page.url().split('?')[0]}`,
    );
  }
  console.log(
    `   提领计划: 第 ${plan.startPolicyYear}-${endPolicyYear} 保单年度，目标每年 USD ${plan.annualAmount}，减少基本金额 ✅`,
  );
}

// ====== iPGS+ 打开 ======
export async function openIpgs(agency, { entryWaitMs = 5 * 60_000, handoffAfterMs = 15_000 } = {}) {
  if (!agency.url().includes('/electronic')) {
    await agency.goto(new URL('electronic', agency.url()).href, { waitUntil: 'domcontentloaded' });
  }
  const link = agency.getByRole('link', { name: 'iPGS+', exact: true }).first();
  const context = agency.context();
  const existing = new Map(context.pages().map(page => [page, page.url()]));
  const started = Date.now();
  const deadline = started + entryWaitMs;
  // The electronic page can move the link between pointerdown and pointerup.
  const activate = () => link.press('Enter', { timeout: 15_000 }).then(() => true, () => false);
  let activated = await activate();
  if (!activated && !agency.isClosed() && agency.url() === existing.get(agency)
    && await agency.getByText('發生意外錯誤，請重試。', { exact: true }).first().isVisible().catch(() => false)) {
    console.log('IPGS_PORTAL_RETRY 电子服务页加载错误；在同一窗口刷新一次。');
    if (await agency.reload({ waitUntil: 'domcontentloaded' }).then(() => true, () => false)) {
      activated = await activate();
    }
  }
  let prompted = false;
  let pgs;
  while (Date.now() < deadline && context.pages().some(page => !page.isClosed())) {
    pgs = context.pages().find(page => {
      const url = page.url();
      return !page.isClosed() && url !== existing.get(page)
        && /aiahk-apps.*pgs/i.test(url) && !url.includes('/logout');
    });
    if (pgs) break;
    if (!prompted && (!activated || Date.now() - started >= handoffAfterMs)) {
      prompted = true;
      console.log('IPGS_MANUAL_ENTRY 请在同一独立 Chrome 检查提示或点击 iPGS+；脚本继续等待，不要重启或重新扫码。');
    }
    await sleep(250);
  }
  if (!pgs) {
    const hosts = context.pages().map(page => new URL(page.url() || 'about:blank').hostname).filter(Boolean);
    throw new LoginError('PGS_NOT_FOUND', `打开 iPGS+ 后未跳转，当前标签页域名：${[...new Set(hosts)].join('、') || '无'}`);
  }
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
  const OUTPUT = resolveProposalOutput(CONFIG);
  const amount = CONFIG.productType === 'savings'
    ? `每年 USD ${CONFIG.annualPremium}`
    : `USD ${CONFIG.sumAssured}`;
  console.log(`🎯 ${CONFIG.productName} | ${CONFIG.gender}${CONFIG.age}岁 | ${CONFIG.region} | ${amount}`);
  if (process.argv.includes('--check-params')) {
    console.log(
      `PARAMS_OK productType=${CONFIG.productType} product=${CONFIG.productCode || CONFIG.productName}`,
    );
    return;
  }

  // ── 1) Chrome + 登录 ──
  const freshLogin = process.argv.includes('--fresh-login');
  automationSession = await launchAutomationContext({ freshLogin });
  const ctx = automationSession.context;
  if (freshLogin) {
    await clearAgencySession(ctx);
  }
  const agency = await ensureAgencyLoggedIn(ctx, { waitMs: keepWindow ? Infinity : undefined, freshLogin });
  tick('Chrome+登录');

  // ── 2) iPGS+ ──
  const page = await openIpgs(agency, { entryWaitMs: keepWindow ? Infinity : undefined });
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
    if (await declineUnbornDialog(page)) continue;
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
      if (index < 3) {
        await sleep(750);
        continue;
      }
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
  await declineUnbornDialog(page);
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
    await declineUnbornDialog(page);
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
  let afterStep1 = await inspectPgsState(page, 'Step1 完成检查');
  for (let index = 0; index < 4 && afterStep1.dialogs.length; index++) {
    const unbornDeclined = await declineUnbornDialog(page);
    const dialogButtons = afterStep1.dialogs.flatMap(dialog => dialog.buttons)
      .filter(button => button.visible && button.topmost && !button.disabled);
    if (!unbornDeclined && dialogButtons.some(button => /^(確定|确认|确定|OK)$/.test(button.text))) {
      await clickButtonEval(page, /^(確定|确认|确定|OK)$/, 'Step1 延迟确认');
    } else if (!unbornDeclined && dialogButtons.some(button => /^(接受|Accept|同意)$/.test(button.text))) {
      await clickButtonEval(page, /^(接受|Accept|同意)$/, 'Step1 延迟接受');
    } else if (!unbornDeclined) {
      break;
    }
    await sleep(500);
    await waitPgs(page, 5_000);
    afterStep1 = await inspectPgsState(page, `Step1 延迟弹窗 ${index + 1} 后`);
  }
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

  const categoryPattern = CONFIG.productType === 'savings'
    ? /^儲蓄保險$|^储蓄保险$|Savings/i
    : /^危疾保障$|^危疾$|Critical/i;
  if (!await clickButtonEval(page, categoryPattern, CONFIG.productCategory)) {
    throw new LoginError(
      'PRODUCT_CATEGORY_NOT_FOUND',
      `未找到产品分类 ${CONFIG.productCategory}`,
    );
  }
  await sleep(500);
  if (process.argv.includes('--list-products')) {
    const products = await listVisibleProducts(page);
    console.log(`PRODUCTS category=${CONFIG.productCategory} count=${products.length}`);
    for (const product of products) {
      console.log(`- ${product.code || '<无代码>'}\t${product.text}`);
    }
    await automationSession?.close().catch(() => {});
    automationSession = undefined;
    return;
  }
  await selectProduct(page, CONFIG);
  const productLabel = CONFIG.productCode || CONFIG.productName;
  const productOutcome = await waitForProductSelectionOutcome(page, CONFIG.productType);
  if (productOutcome === 'CONFIRM_DIALOG') {
    await inspectPgsState(page, '产品提示弹窗');
    await clickButtonEval(page, /^(確定|确认|确定|Confirm|OK)$/, '产品确认');
  } else if (productOutcome === 'TIMEOUT') {
    await inspectPgsState(page, '产品选择结果超时');
    throw new LoginError('PRODUCT_SELECT_TIMEOUT', `选择 ${productLabel} 后没有出现确认或基本计划页`);
  }
  const basicInfoDeadline = Date.now() + 20_000;
  while (Date.now() < basicInfoDeadline && !/\/basicInfo\//i.test(page.url())) {
    await declineUnbornDialog(page);
    await sleep(250);
  }
  if (!/\/basicInfo\//i.test(page.url())) {
    throw new LoginError('STEP3_ROUTE_TIMEOUT', '选择产品后 20 秒内未进入基本计划路由');
  }
  if (!await waitPgsCycle(page, 30_000)) {
    await inspectPgsState(page, '基本计划加载超时');
    throw new LoginError('STEP3_LOADING_TIMEOUT', '基本计划加载遮罩 30 秒内未消失');
  }
  if (!await waitForStep3(page, CONFIG.productType)) {
    await inspectPgsState(page, '基本计划页未出现');
    throw new LoginError('STEP3_NOT_READY', `选择 ${productLabel} 后未进入基本计划页`);
  }
  await inspectPgsState(page, '基本计划页');
  tick('Step2');
  if (process.argv.includes('--inspect-product')) {
    await inspectCurrentForm(page, `${productLabel} 基本计划字段`);
    await automationSession?.close().catch(() => {});
    automationSession = undefined;
    return;
  }

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

  if (CONFIG.productType === 'savings') {
    await selectCurrency(page, CONFIG.currency);
    await waitPgs(page, 5_000);
    await selectRadioValue(page, 'premiumPaymentPeriod', CONFIG.premiumTerm, '缴付年期');
    await selectAnnualFrequency(page, CONFIG.premiumTerm);
    if (!await clickEnabledButton(
      page,
      /^(預算每年保費|预算每年保费|Budget Annual Premium)$/,
      '预算每年保费',
    )) {
      throw new LoginError(
        'ANNUAL_PREMIUM_BUTTON_NOT_FOUND',
        '未找到“预算每年保费”按钮',
      );
    }
    await sleep(500);
    const budgetInput = page.locator('input[name="budgetPremium"]');
    await budgetInput.waitFor({ state: 'visible', timeout: 5_000 });
    await budgetInput.fill(String(CONFIG.annualPremium));
    await budgetInput.press('Tab');
    const actualBudget = await budgetInput.inputValue();
    if (Number(actualBudget.replace(/,/g, '')) !== CONFIG.annualPremium) {
      throw new LoginError(
        'ANNUAL_PREMIUM_NOT_SET',
        `每年保费填写失败，期望 ${CONFIG.annualPremium}，实际 ${actualBudget || '<空>'}`,
      );
    }
    if (!await clickEnabledButton(page, /^(計算|计算|Calculate)$/i, '计算基本金额')) {
      throw new LoginError(
        'ANNUAL_PREMIUM_CALCULATE_NOT_FOUND',
        '预算弹窗没有可用的计算按钮',
      );
    }
    const calculatedDeadline = Date.now() + 60_000;
    const basicAmountInput = page.locator('input[name="sumAssured"]');
    let calculatedBasicAmount = '';
    let budgetDialogVisible = true;
    while (Date.now() < calculatedDeadline) {
      calculatedBasicAmount = await basicAmountInput.inputValue().catch(() => '');
      budgetDialogVisible = await budgetInput.isVisible().catch(() => false);
      if (calculatedBasicAmount && !budgetDialogVisible) break;
      await sleep(250);
    }
    if (!calculatedBasicAmount || budgetDialogVisible) {
      await inspectCurrentForm(page, '预算每年保费计算失败');
      throw new LoginError(
        'ANNUAL_PREMIUM_CALCULATION_TIMEOUT',
        '输入每年保费后 60 秒内弹窗未关闭或没有计算出基本金额',
      );
    }
    console.log(
      `   每年保费: USD ${actualBudget} → 基本金额: USD ${calculatedBasicAmount} ✅`,
    );
  } else {
    await selectRadioValue(page, 'premiumPaymentPeriod', CONFIG.premiumTerm, '缴付年期');
    if (await hasRadio(page, 'paymentPatternOption')) {
      await selectRadioValue(
        page,
        'paymentPatternOption',
        CONFIG.extraPremium ? '1' : '0',
        '额外保费',
      );
    } else if (CONFIG.extraPremium) {
      throw new LoginError(
        'PRODUCT_OPTION_UNAVAILABLE',
        `${CONFIG.productName} 不提供额外保费选项`,
      );
    } else {
      console.log('   额外保费: 当前产品不适用，已跳过 ✅');
    }
    await selectAnnualFrequency(page, CONFIG.premiumTerm);
    if (await hasRadio(page, 'ciAdvancement', '1')) {
      await selectRadioValue(page, 'ciAdvancement', '1', '危疾保额部分（100%）');
    } else {
      console.log('   危疾保额部分: 当前产品不适用，已跳过 ✅');
    }

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
  }
  await sleep(500);

  // 下一步
  const step3Route = page.url();
  let step3NextClicked = await clickEnabledButton(
    page,
    /^(下一步|Next)$/i,
    'Step3 下一步',
  );
  if (!step3NextClicked) {
    await inspectPgsState(page, 'Step3 下一步不可用');
    console.log('   ⚠️ 基本计划字段已回读但下一步仍不可用，等待状态稳定后重试一次');
    await waitPgsCycle(page, 60_000);
    step3NextClicked = await clickEnabledButton(
      page,
      /^(下一步|Next)$/i,
      'Step3 重试下一步',
      30_000,
    );
  }
  if (!step3NextClicked) {
    throw new LoginError('STEP3_NEXT_NOT_CLICKED', '基本计划填写完成但重试后下一步仍不可点击');
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
  if (CONFIG.productType === 'savings') {
    await configureSavingsWithdrawal(page, CONFIG.withdrawalPlan);
  }
  const summaryRoute = page.url();
  if (!await clickEnabledButton(page, /^(下一步|Next)$/i, 'Step5 下一步')) {
    throw new LoginError('STEP5_NEXT_NOT_CLICKED', '概要页下一步不可点击');
  }
  const summaryDeadline = Date.now() + 30_000;
  while (Date.now() < summaryDeadline && page.url() === summaryRoute) await sleep(250);
  if (page.url() === summaryRoute) {
    await inspectPgsState(page, 'Step5 首次提交后路由未变化');
    console.log('   ⚠️ 概要页 30 秒内未跳转，按当前页面状态重试下一步一次');
    if (await clickEnabledButton(page, /^(下一步|Next)$/i, 'Step5 重试下一步', 15_000)) {
      const retryDeadline = Date.now() + 45_000;
      while (Date.now() < retryDeadline && page.url() === summaryRoute) await sleep(250);
    }
  }
  if (page.url() === summaryRoute) {
    throw new LoginError('STEP5_ROUTE_TIMEOUT', '概要页重试提交后路由仍未变化');
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
  };
  if (!sameOwner) {
    nameFields.payorName = CONFIG.payorSurname;
    nameFields.payorFirst = CONFIG.payorGivenName;
  }
  if (!await waitForStep6NameFields(page, Object.keys(nameFields))) {
    await inspectPgsState(page, '建议书选项姓名字段缺失');
    throw new LoginError(
      'STEP6_NAME_FIELD_MISSING',
      '建议书选项页在 45 秒内未完整挂载姓名字段',
    );
  }
  for (const [name, value] of Object.entries(nameFields)) {
    const input = page.locator(`input[name="${name}"]`);
    await input.fill(value);
    if (await input.inputValue() !== value) {
      throw new LoginError('STEP6_NAME_NOT_SET', `建议书选项字段 ${name} 填写失败`);
    }
  }
  console.log(`   ${sameOwner ? '受保人姓名' : '受保人与持有人姓名'}: 已填写 ✅`);

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
    OUTPUT.pdfPath,
  );
  if (!pdfSaved) {
    throw new LoginError('PDF_START_NOT_FOUND', '完成页没有可用的详尽建议书入口');
  }
  if (CONFIG.productType === 'savings') {
    try {
      const irr = await generateIrrReport(
        OUTPUT.pdfPath,
        OUTPUT.irrWorkbookPath,
        {
          generateSummaryImage: CONFIG.largeSavingsBatchRole !== 'withdrawal',
          summaryImagePath: OUTPUT.irrSummaryImagePath,
        },
      );
      console.log(`✅ IRR 表: ${irr.outputPath} (${irr.rowCount} 个保单年度)`);
      if (irr.summaryImagePath) {
        console.log(`✅ IRR 说明图: ${irr.summaryImagePath}`);
      }
    } catch (error) {
      const partialResult = error.code?.startsWith('IRR_IMAGE_')
        ? 'PDF 和 IRR Excel 已保存'
        : 'PDF 已保存';
      throw new LoginError(
        'IRR_REPORT_FAILED',
        `${partialResult}，但储蓄险 IRR 配套文件生成失败：${error.message}`,
      );
    }
  }
  const totalTime = ((Date.now() - TOTAL_START) / 1000).toFixed(1);
  console.log(`📊 总耗时: ${totalTime}s`);
  await automationSession?.close().catch(() => {});
  automationSession = undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async e => {
    console.error(`❌ ${e.message}`);
    process.exitCode = e.code === 'MANUAL_LOGIN_TIMEOUT' ? MANUAL_LOGIN_EXIT_CODE : 1;
    const context = automationSession?.context;
    if (keepWindow && context?.pages().some(page => !page.isClosed())) {
      console.log('BROWSER_KEPT_OPEN 已保留独立 Chrome 供排查，关闭窗口后脚本才退出。');
      while (context.pages().some(page => !page.isClosed())) await sleep(500);
    }
    await automationSession?.close().catch(() => {});
  });
}
