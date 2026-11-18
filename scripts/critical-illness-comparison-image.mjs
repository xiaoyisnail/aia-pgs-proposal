import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { calculateIrr } from './irr-report.mjs';
import { findChromeExecutable } from './runtime-platform.mjs';
import { alignPhotoComparison } from './photo-comparison-data.mjs';

const comparisonStyle = readFileSync(new URL('../assets/critical-illness-comparison.css', import.meta.url), 'utf8');

const format = (value, digits = 0) => value.toLocaleString('zh-CN', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});
const money = amount => format(amount, Number.isInteger(amount) ? 0 : 2);
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function comparisonMultiple(year, foreignAmount, mainlandAmount, rate, fromYear = 40) {
  if (year < fromYear || mainlandAmount <= 0) return '';
  return `约为内地方案的 ${(foreignAmount * rate / mainlandAmount).toFixed(2)} 倍`;
}

export function comparisonYears(hongKong, mainland) {
  const last = Math.min(hongKong.rows.length, mainland.rows.length,
    100 - Math.max(hongKong.age, mainland.age));
  if (last < 1) throw new Error('COMPARE_YEARS_MISSING: 没有至 100 岁的共同保单年度');
  const decades = Array.from({ length: Math.floor((last - 1) / 10) }, (_, i) => (i + 1) * 10);
  return [...decades, last];
}

function premiumLabel(plan) {
  const [first, ...rest] = plan.rows.slice(0, plan.term).map(row => row.premium);
  const paid = amount => `<strong>${format(amount, 2)} ${plan.currency}</strong>`;
  if (rest.every(amount => amount === first)) return paid(first);
  if (rest.every(amount => amount === rest[0])) {
    return `首年 ${paid(first)}<br>其余缴费年度 ${paid(rest[0])}`;
  }
  return `首年 ${paid(first)}<br>后续年度保费按计划书列示`;
}

function amountLabel(amount, plan, rate) {
  const converted = rate ? `（约 ${format(amount * rate / 10000, 2)} 万元人民币）` : '';
  return `<strong>${money(amount)} ${plan.currency}</strong>${converted}`;
}

function displayIrr(plan, year, surrender) {
  const payments = plan.rows.slice(0, year).map(row => -row.premium);
  const irr = calculateIrr([...payments, surrender]);
  return irr === null ? 'IRR —' : `IRR ${(irr * 100).toFixed(2)}%`;
}

export function buildComparisonHtml({ hongKong, mainland, rate, photo = false, multipleFrom = 35, estimateMissing = true }) {
  if (photo) return buildPhotoComparisonHtml({ hongKong, mainland, rate, multipleFrom, estimateMissing });
  const base = (plan, conversion) => {
    const extra = plan.upgrade
      ? `<br>${escapeHtml(plan.upgrade.label)} ${amountLabel(plan.upgrade.amount, plan, conversion)}
        <br>该期间合计 ${amountLabel(plan.base + plan.upgrade.amount, plan, conversion)}`
      : '';
    return amountLabel(plan.base, plan, conversion) + extra;
  };
  const rows = [
    ['受保人', hongKong.profile, mainland.profile].map(escapeHtml),
    ['基本保额', base(hongKong, rate), base(mainland)],
    ['缴费年期', `<strong>${hongKong.term} 年</strong>`, `<strong>${mainland.term} 年</strong>`],
    ['年缴保费', premiumLabel(hongKong), premiumLabel(mainland)],
    ['计划总保费', amountLabel(hongKong.rows.at(-1).paid, hongKong, rate),
      amountLabel(mainland.rows.at(-1).paid, mainland)],
    ['重疾多重赔付', escapeHtml(hongKong.multi), escapeHtml(mainland.multi)],
  ];
  const summaryRows = rows.map(([label, hk, cn]) =>
    `<tr><th scope="row">${label}</th><td>${hk}</td><td>${cn}</td></tr>`).join('');
  const bodyRows = comparisonYears(hongKong, mainland).map(year => {
    const hk = hongKong.rows[year - 1];
    const cn = mainland.rows[year - 1];
    const hkCell = (amount, mainlandAmount) => {
      const label = comparisonMultiple(year, amount, mainlandAmount, rate);
      return `<strong>${money(amount)} ${hongKong.currency}</strong>
        ${label ? `<span class="multiple">${label}</span>` : ''}
        <span class="sub">约 ${format(amount * rate / 10000, 2)} 万元人民币</span>`;
    };
    return `<tr class="${year === 30 ? 'highlight' : ''}">
      <th scope="row">${year} 年（${hongKong.age + year} 岁）</th>
      <td>${hkCell(hk.surrender, cn.surrender)}<span class="irr">${displayIrr(hongKong, year, hk.surrender)}</span></td>
      <td>${hkCell(hk.claim, cn.claim)}</td>
      <th scope="row">${year} 年（${mainland.age + year} 岁）</th>
      <td><strong>${money(cn.surrender)} 元</strong><span class="irr">${displayIrr(mainland, year, cn.surrender)}</span></td>
      <td><strong>${money(cn.claim)} 元</strong></td>
    </tr>`;
  }).join('');

  return comparisonDocument({ hongKong, mainland, rate, summaryRows, bodyRows });
}

function buildPhotoComparisonHtml({ hongKong, mainland, rate, multipleFrom, estimateMissing }) {
  const rows = alignPhotoComparison(hongKong, mainland, { estimateMissing });
  const hkPaid = hongKong.rows.at(-1).paid;
  const projected = `${format(mainland.age)} 岁${mainland.gender}性`;
  const special = mainland.special;
  const hkUpgrade = hongKong.upgrade;
  const amount = (value, unit) => `<strong>${money(value)} ${unit}</strong>`;
  const estimate = '<span class="estimate">估算</span>';
  const converted = value => `约 ${format(value * rate / 10_000, 2)} 万元人民币`;
  const hkAmount = value => `${amount(value, hongKong.currency)}<span class="nowrap">（${converted(value)}）</span>`;
  const cnAmount = ({ amount: value, estimated }) => value === null ? '—' : `${amount(value, '元')}${estimated ? estimate : ''}`;
  const hkPremium = hongKong.rows[0].premium;
  const summaryRows = [
    ['受保人', escapeHtml(hongKong.profile), projected],
    ['基本保额', hkAmount(hongKong.base) + (hkUpgrade ? `<br>${escapeHtml(hkUpgrade.label)}：${hkAmount(hkUpgrade.amount)}<br>该期间合计：${hkAmount(hongKong.base + hkUpgrade.amount)}` : ''),
      amount(mainland.base, '元') + (special ? `<br>${special.endAgeExclusive} 周岁前特别保障：${amount(special.amount, '元')}<br>该期间合计：${amount(mainland.base + special.amount, '元')}` : '')],
    ['缴费年期', `<strong>${hongKong.term} 年</strong>`, `<strong>${mainland.term} 年</strong>（主险）`],
    ['年缴保费', `<strong>${format(hkPremium, 2)} ${hongKong.currency}</strong>（约 ${format(hkPremium * rate)} 元人民币）`, `约 ${amount(mainland.annual, '元')}（组合保费）`],
    ['计划总保费', hkAmount(hkPaid), `约 ${amount(mainland.annual * mainland.term, '元')}（按 ${mainland.term} 次年缴估算）`],
    ['重疾多重赔付', escapeHtml(hongKong.multi === '指定疾病合计最多额外 10 次' ? '重疾最多11次赔付' : hongKong.multi),
      escapeHtml(mainland.multi || '资料未列重疾多次赔付')],
  ].map(([label, hk, cn]) => `<tr><th scope="row">${label}</th><td>${hk}</td><td>${cn}</td></tr>`).join('');
  const bodyRows = rows.map(({ hk, cnYear, surrender, claim }) => {
    const hkCell = (value, comparison) => {
      const label = comparisonMultiple(hk.year, value, comparison.amount, rate, multipleFrom);
      return `${amount(value, hongKong.currency)}<span class="sub">${converted(value)}</span>${label
        ? `<span class="multiple">${label}${comparison.estimated ? '<span class="estimate basis-tag">内地估算</span>' : ''}</span>` : ''}`;
    };
    const payments = Array.from({ length: cnYear }, (_, i) => i < mainland.term ? -mainland.annual : 0);
    const irr = surrender.amount === null ? null : calculateIrr([...payments, surrender.amount]);
    return `<tr class="${hk.year === 30 ? 'highlight' : ''}">
      <th scope="row">第 ${hk.year} 年（${hk.age} 岁）</th>
      <td>${hkCell(hk.surrender, surrender)}<span class="irr">${displayIrr(hongKong, hk.year, hk.surrender)}</span></td>
      <td>${hkCell(hk.claim, claim)}</td><th scope="row">${hk.age} 岁</th>
      <td>${cnAmount(surrender)}${irr === null ? '' : `<span class="irr">IRR（估算）${(irr * 100).toFixed(2)}%</span>`}</td>
      <td>${cnAmount(claim)}</td>
    </tr>`;
  }).join('');
  const note = (estimateMissing ? '标「估算」的金额非保险公司原值。内地缺值按已知节点插值或外推。' : '内地未披露金额留空。')
    + '内地 IRR 按年龄差与期初组合年缴估算。金额含非保证利益。';
  const profile = hongKong.age === mainland.age ? `${hongKong.age} 岁${hongKong.profile.includes(projected) ? mainland.gender + '性' : ''} · ` : '';
  const context = profile + (hongKong.term === mainland.term ? `两地均为 ${hongKong.term} 年缴费` : `香港 ${hongKong.term} 年缴 · 内地主险 ${mainland.term} 年缴`);
  return comparisonDocument({ hongKong, mainland, rate, summaryRows, bodyRows, photo: true, context, note });
}

function comparisonDocument({ hongKong, mainland, rate, summaryRows, bodyRows, photo = false, context, note }) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<style>${comparisonStyle}</style>
<main>
  <div class="title"><h1>重疾险香港 vs 内地对比</h1></div>
  <p class="context">${context || `香港 ${format(hongKong.base)} ${hongKong.currency}　｜　内地 ${format(mainland.base)} 元人民币`}　｜　指定汇率 1 ${hongKong.currency} = ${rate} 元人民币</p>
  <table class="overview">
    <colgroup><col style="width:13%"><col style="width:43.5%"><col style="width:43.5%"></colgroup>
    <thead><tr><th>项目</th><th class="hk">香港 · ${escapeHtml(hongKong.product)}</th><th class="cn">内地 · ${escapeHtml(mainland.product)}</th></tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>
  <h2 class="section">历年退保发还、保障金额与 IRR</h2>
  ${note ? `<p class="method">${note}</p>` : ''}
  <table class="long">
    <colgroup><col style="width:13%"><col style="width:19%"><col style="width:18%">${photo
      ? '<col style="width:10%"><col style="width:20%"><col style="width:20%">' : '<col style="width:13%"><col style="width:19%"><col style="width:18%">'}</colgroup>
    <thead>
      <tr><th colspan="3" class="hk">香港 · ${photo ? '计划书数据' : '计划书原值'}</th><th colspan="3" class="cn">内地 · ${photo ? '客户提供的图片数据估算' : '计划书原值（人民币）'}</th></tr>
      <tr><th>保单年度（年末年龄）</th><th>退保发还总额</th><th>${escapeHtml(hongKong.claimLabel)}</th>
      ${photo ? '<th>对齐年龄</th><th>主险总退保金</th><th>重度疾病保险金</th>' : `<th>保单年度（年末年龄）</th><th>退保发还总额</th><th>${escapeHtml(mainland.claimLabel)}</th>`}</tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
</main>`;
}

export async function renderCriticalIllnessComparison(model, outputPath) {
  const executablePath = findChromeExecutable();
  if (!executablePath) throw new Error('COMPARE_CHROME_NOT_FOUND: 请安装正式版 Google Chrome');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1800 }, deviceScaleFactor: 2,
    });
    await page.setContent(buildComparisonHtml(model));
    await page.evaluate(() => document.fonts.ready);
    const clipped = await page.locator('th, td').evaluateAll(cells =>
      cells.some(cell => cell.scrollWidth > cell.clientWidth + 1));
    if (clipped) throw new Error('COMPARE_IMAGE_OVERFLOW: 比较图的表格内容超出列宽');
    const png = await page.locator('main').screenshot({ type: 'png', animations: 'disabled' });
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, png, { flag: 'wx' });
  } finally {
    await browser.close();
  }
}
