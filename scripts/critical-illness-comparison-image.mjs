import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { calculateIrr } from './irr-report.mjs';
import { findChromeExecutable } from './runtime-platform.mjs';

const format = (value, digits = 0) => value.toLocaleString('zh-CN', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
});
const money = amount => format(amount, Number.isInteger(amount) ? 0 : 2);
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function comparisonMultiple(year, foreignAmount, mainlandAmount, rate) {
  if (year < 40 || mainlandAmount <= 0) return '';
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

export function buildComparisonHtml({ hongKong, mainland, rate }) {
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

  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<style>
:root { --ink:#25152e; --line:#8a718a; --violet:#d98af7; --rose:#f4e8ec;
  --rose-dark:#e8d3dc; --green:#a4dbc5; --yellow:#ffe9a1; }
* { box-sizing:border-box; }
body { margin:0; background:#fff; color:var(--ink); font:19px/1.42 "PingFang SC","Microsoft YaHei",sans-serif;
  font-variant-numeric:tabular-nums; }
main { width:1390px; margin:0 auto; padding:30px; }
h1,h2,p { margin:0; }
.title { background:var(--violet); border:1px solid var(--line); text-align:center; padding:23px 14px 20px; }
h1 {font-size:40px; letter-spacing:1px; font-weight:700; line-height:1.2;}
.context { text-align:center; font-size:19px; font-weight:500; background:#c9eaf8; padding:9px 12px;
  border:1px solid var(--line); border-top:0; }
table { border-collapse:collapse; width:100%; table-layout:fixed; }
th,td { border:1px solid var(--line); padding:11px 16px; vertical-align:middle; }
thead th { font-weight:650; }
.overview thead th { font-size:23px; padding:10px; border-top:0; }
.hk { background:var(--green); }
.cn { background:var(--yellow); }
tbody tr { background:var(--rose); }
tbody tr:nth-child(even) { background:var(--rose-dark); }
tbody th { font-weight:600; }
.overview tbody td { font-size:18px; }
.overview tbody th { background:#e4cfd9; text-align:center; font-size:19px;}
.section { border:1px solid var(--line); border-top:0; padding:12px 14px; background:var(--violet);
  text-align:center; font-size:25px; line-height:1.25; }
.long thead tr:first-child th { font-size:19px; padding:7px; border-top:0; }
.long thead tr:nth-child(2) th { background:#f4e8ed; font-size:16px; padding:9px 5px; }
.long tbody th { text-align:center; font-size:17px; white-space:nowrap; padding:9px 6px; }
.long tbody td { font-size:17px; padding:8px 13px; }
.long .sub { display:block; }
.sub { font-size:15px; color:#4e394f; }
.irr { display:block; font-weight:650; font-size:16px; }
.multiple { display:block; color:#a51d2d; font-weight:700; font-size:15px; }
.long .highlight { background:#ffca52; }
</style>
<main>
  <div class="title"><h1>重疾险香港 vs 内地对比</h1></div>
  <p class="context">香港 ${format(hongKong.base)} ${hongKong.currency}　｜　内地 ${format(mainland.base)} 元人民币　｜　指定汇率 1 ${hongKong.currency} = ${rate} 元人民币</p>
  <table class="overview">
    <colgroup><col style="width:13%"><col style="width:43.5%"><col style="width:43.5%"></colgroup>
    <thead><tr><th style="background:#e4cfd9">项目</th><th class="hk">香港 · ${escapeHtml(hongKong.product)}</th><th class="cn">内地 · ${escapeHtml(mainland.product)}</th></tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>
  <h2 class="section">历年退保发还、保障金额与 IRR</h2>
  <table class="long">
    <colgroup><col style="width:13%"><col style="width:19%"><col style="width:18%"><col style="width:13%"><col style="width:19%"><col style="width:18%"></colgroup>
    <thead>
      <tr><th colspan="3" class="hk">香港 · 计划书原值</th><th colspan="3" class="cn">内地 · 计划书原值（人民币）</th></tr>
      <tr><th>保单年度（年末年龄）</th><th>退保发还总额</th><th>${escapeHtml(hongKong.claimLabel)}</th>
      <th>保单年度（年末年龄）</th><th>退保发还总额</th><th>${escapeHtml(mainland.claimLabel)}</th></tr>
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
      viewport: { width: 1390, height: 1800 }, deviceScaleFactor: 2,
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
