import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { findChromeExecutable } from './runtime-platform.mjs';

export class IrrSummaryImageError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'IrrSummaryImageError';
    this.code = code;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function currencyCode(currency) {
  if (currency.includes('美元')) return 'USD';
  if (currency.includes('港')) return 'HKD';
  if (currency.includes('澳')) return 'MOP';
  if (currency.includes('新加坡')) return 'SGD';
  if (currency.includes('人民')) return 'CNY';
  return currency || '';
}

function formatMoney(value, currency) {
  const amount = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${currencyCode(currency)} ${amount}`.trim();
}

function formatCompactMoney(value, currency) {
  if (Math.abs(value) < 10_000) return formatMoney(value, currency);
  const amount = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value / 10_000);
  return `${currencyCode(currency)} ${amount} 万`.trim();
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function buildHtml(model) {
  const isWithdrawal = model.variant === 'withdrawal';
  const tableRows = model.tableRows.map((row, index) => isWithdrawal ? `
    <tr class="${index % 2 ? 'alternate' : ''}">
      <td><strong>第 ${row.policyYear} 年</strong><span>${row.age} 岁</span></td>
      <td>${escapeHtml(formatCompactMoney(row.surrenderValueAfterWithdrawal, model.currency))}</td>
      <td>${escapeHtml(formatCompactMoney(row.cumulativeWithdrawal, model.currency))}</td>
      <td>${escapeHtml(formatCompactMoney(row.combinedValue, model.currency))}</td>
      <td>${row.growthMultiple.toFixed(2)} 倍</td>
    </tr>
  ` : `
    <tr class="${index % 2 ? 'alternate' : ''}">
      <td><strong>第 ${row.policyYear} 年</strong><span>${row.age} 岁</span></td>
      <td>${escapeHtml(formatCompactMoney(row.surrenderValueTotal, model.currency))}</td>
      <td>${row.growthMultiple.toFixed(2)} 倍</td>
    </tr>
  `).join('');
  const tableHeader = isWithdrawal
    ? `<tr>
        <th>保单年度（岁数）</th>
        <th>退保发还金额</th>
        <th>累计提取金额</th>
        <th>合计总额</th>
        <th>增长率</th>
      </tr>`
    : `<tr>
        <th>保单年度（岁数）</th>
        <th>退保发还金额</th>
        <th>增长率（倍）</th>
      </tr>`;
  const withdrawalPlan = isWithdrawal ? `
    <section class="withdrawal-plan">
      <div>
        <span>提领期间</span>
        <strong>第 ${model.startPolicyYear} 年至第 ${model.endPolicyYear} 年</strong>
      </div>
      <div>
        <span>${model.annualWithdrawalIsConstant ? '每年提取' : '首年提取'}</span>
        <strong>${escapeHtml(formatMoney(model.annualWithdrawal, model.currency))}</strong>
      </div>
      <div>
        <span>占初始总保费</span>
        <strong>${formatPercent(model.withdrawalToPremiumRatio)}</strong>
      </div>
    </section>
  ` : '';
  const standardDetails = !isWithdrawal ? (() => {
    const milestoneCards = model.irrMilestones.map(milestone => `
      <div class="milestone ${milestone.policyYear ? '' : 'unreached'}">
        <span class="target">约 ${milestone.targetPercent.toFixed(1)}%</span>
        <strong>${milestone.policyYear ? `第 ${milestone.policyYear} 年` : '未达到'}</strong>
        <small>${milestone.policyYear ? `实际 ${formatPercent(milestone.irr)}` : `截至第 ${model.lastPolicyYear} 年`}</small>
      </div>
    `).join('');
    const breakEven = model.breakEvenRow
      ? `第 ${model.breakEvenRow.policyYear} 个保单年度`
      : `截至第 ${model.lastPolicyYear} 年尚未回本`;
    return `
      <div class="break-even">
        <span>静态回本期</span>
        <strong>${escapeHtml(breakEven)}</strong>
      </div>
      <div class="section-title">
        <h2>IRR 里程碑</h2>
        <span>首次达到对应显示收益率的保单年度</span>
      </div>
      <section class="milestones">${milestoneCards}</section>
    `;
  })() : '';
  const withdrawalDetails = isWithdrawal ? `
    <section class="withdrawal-irr">
      <div>
        <span>累计提取总额</span>
        <strong>${escapeHtml(formatCompactMoney(model.totalWithdrawals, model.currency))}</strong>
      </div>
      <div class="irr-result">
        <span>截至第 ${model.lastPolicyYear} 年综合 IRR</span>
        <strong>${model.finalIrr === null ? '-' : formatPercent(model.finalIrr)}</strong>
      </div>
    </section>
  ` : '';
  const note = isWithdrawal
    ? '计算口径：每个保单年度期初缴付当年保费；每年提取金额及目标年度末“现金提取后之退保发还金额”作为期末现金流。合计总额为累计提取金额加当年退保发还金额。'
    : '计算口径：每个保单年度期初缴付当年保费，最多缴至供款年期；该年度终结时取得 PDF“详细说明”中的退保发还金额总额。';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #dfe8eb; }
    body {
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC",
        "Source Han Sans SC", "Helvetica Neue", Arial, sans-serif;
      color: #17313a;
    }
    #poster {
      --hero-start: #14333d;
      --hero-end: #1d6c67;
      --hero-glow: rgba(38, 190, 163, .24);
      --eyebrow: #c9fff3;
      --table: #176c68;
      --alternate: #f1f7f6;
      --soft-start: #e9f7f3;
      --soft-end: #d8f0e9;
      --soft-border: #b8ded2;
      --soft-text: #126159;
      --accent: #f1aa43;
      width: 1080px;
      min-height: 1660px;
      padding: 0 54px 48px;
      background:
        radial-gradient(circle at 92% 4%, var(--hero-glow), transparent 25%),
        linear-gradient(180deg, #f7fbfa 0%, #edf4f3 100%);
      overflow: hidden;
    }
    #poster.withdrawal {
      --hero-start: #302044;
      --hero-end: #704263;
      --hero-glow: rgba(189, 92, 146, .23);
      --eyebrow: #ffe1f0;
      --table: #823d70;
      --alternate: #f8f0f5;
      --soft-start: #f8ecf4;
      --soft-end: #f0dce9;
      --soft-border: #dfb8cf;
      --soft-text: #71355f;
      --accent: #d879a7;
      background:
        radial-gradient(circle at 92% 4%, var(--hero-glow), transparent 25%),
        linear-gradient(180deg, #fcf8fb 0%, #f5edf3 100%);
    }
    .hero {
      margin: 0 -54px;
      min-height: 270px;
      padding: 54px 66px 42px;
      color: #fff;
      background: linear-gradient(125deg, var(--hero-start), var(--hero-end));
      position: relative;
    }
    .hero::after {
      content: "";
      position: absolute;
      right: -48px;
      bottom: -118px;
      width: 330px;
      height: 330px;
      border: 54px solid rgba(255,255,255,.07);
      border-radius: 50%;
    }
    .eyebrow {
      display: inline-flex;
      padding: 9px 18px;
      border-radius: 999px;
      background: rgba(255,255,255,.14);
      color: var(--eyebrow);
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 1px;
    }
    h1 {
      max-width: 860px;
      margin: 20px 0 10px;
      font-size: 54px;
      line-height: 1.15;
      letter-spacing: -1px;
    }
    .hero-meta {
      margin: 0;
      color: rgba(255,255,255,.82);
      font-size: 26px;
      font-weight: 600;
    }
    .summary {
      display: grid;
      grid-template-columns: 1fr 1.35fr 1.35fr;
      gap: 16px;
      margin-top: -26px;
      position: relative;
      z-index: 2;
    }
    .summary-card {
      min-height: 126px;
      padding: 22px 24px;
      border: 1px solid rgba(30, 95, 91, .12);
      border-radius: 18px;
      background: rgba(255,255,255,.96);
      box-shadow: 0 12px 30px rgba(23, 49, 58, .08);
    }
    .summary-card span {
      display: block;
      margin-bottom: 10px;
      color: #5f777e;
      font-size: 21px;
      font-weight: 700;
    }
    .summary-card strong {
      display: block;
      color: #163b42;
      font-size: 30px;
      line-height: 1.15;
    }
    .section-title {
      display: flex;
      align-items: end;
      justify-content: space-between;
      margin: 42px 0 16px;
    }
    .section-title h2 {
      margin: 0;
      color: #17313a;
      font-size: 32px;
    }
    .section-title span {
      color: #698187;
      font-size: 19px;
    }
    table {
      width: 100%;
      overflow: hidden;
      border-collapse: separate;
      border-spacing: 0;
      border-radius: 18px;
      background: #fff;
      box-shadow: 0 8px 24px rgba(23, 49, 58, .06);
    }
    th {
      padding: 20px 22px;
      color: #fff;
      background: var(--table);
      font-size: 22px;
      text-align: left;
    }
    th:nth-child(2), td:nth-child(2) { text-align: right; }
    th:nth-child(3), td:nth-child(3) { text-align: right; }
    th:nth-child(4), td:nth-child(4) { text-align: right; }
    th:nth-child(5), td:nth-child(5) { text-align: right; }
    td {
      height: 66px;
      padding: 13px 22px;
      border-bottom: 1px solid #dce8e6;
      background: #fff;
      font-size: 24px;
    }
    tr.alternate td { background: var(--alternate); }
    tr:last-child td { border-bottom: 0; }
    td strong { margin-right: 10px; }
    td span { color: #72888c; font-size: 20px; }
    .withdrawal-table th {
      padding: 18px 12px;
      font-size: 19px;
      line-height: 1.25;
    }
    .withdrawal-table td {
      padding: 13px 12px;
      font-size: 20px;
    }
    .withdrawal-table td:first-child { white-space: nowrap; }
    .withdrawal-table td:first-child strong { font-size: 21px; }
    .withdrawal-table td:first-child span { font-size: 17px; }
    .withdrawal-plan {
      display: grid;
      grid-template-columns: 1.15fr 1.2fr 1fr;
      gap: 1px;
      overflow: hidden;
      margin-top: 30px;
      border: 1px solid var(--soft-border);
      border-radius: 18px;
      background: var(--soft-border);
      box-shadow: 0 8px 24px rgba(23, 49, 58, .06);
    }
    .withdrawal-plan div {
      min-height: 110px;
      padding: 20px 22px;
      background: linear-gradient(125deg, var(--soft-start), var(--soft-end));
    }
    .withdrawal-plan span {
      display: block;
      margin-bottom: 9px;
      color: #725c6b;
      font-size: 19px;
      font-weight: 700;
    }
    .withdrawal-plan strong {
      color: var(--soft-text);
      font-size: 25px;
      line-height: 1.2;
    }
    .break-even {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 94px;
      margin-top: 28px;
      padding: 20px 28px;
      border-radius: 18px;
      background: linear-gradient(110deg, var(--soft-start), var(--soft-end));
      border: 1px solid var(--soft-border);
    }
    .break-even span { color: #52726f; font-size: 22px; font-weight: 700; }
    .break-even strong { color: var(--soft-text); font-size: 31px; }
    .milestones {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
    }
    .milestone {
      min-height: 142px;
      padding: 18px 15px;
      border-radius: 16px;
      background: #fff;
      border-top: 5px solid var(--accent);
      box-shadow: 0 8px 24px rgba(23, 49, 58, .06);
      text-align: center;
    }
    .milestone .target {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      color: #7a4b0d;
      background: #fff1d7;
      font-size: 18px;
      font-weight: 700;
    }
    .milestone strong {
      display: block;
      margin: 13px 0 4px;
      color: #17313a;
      font-size: 25px;
    }
    .milestone small { color: #657d82; font-size: 17px; }
    .milestone.unreached { opacity: .68; border-top-color: #9bb0b4; }
    .withdrawal-irr {
      display: grid;
      grid-template-columns: 1fr 1.35fr;
      gap: 18px;
      margin-top: 30px;
    }
    .withdrawal-irr > div {
      min-height: 124px;
      padding: 23px 28px;
      border-radius: 18px;
      background: linear-gradient(125deg, var(--soft-start), var(--soft-end));
      border: 1px solid var(--soft-border);
    }
    .withdrawal-irr span {
      display: block;
      margin-bottom: 8px;
      color: #725c6b;
      font-size: 20px;
      font-weight: 700;
    }
    .withdrawal-irr strong {
      color: var(--soft-text);
      font-size: 32px;
    }
    .withdrawal-irr .irr-result {
      color: #fff;
      background: linear-gradient(125deg, var(--hero-start), var(--hero-end));
      border: 0;
    }
    .withdrawal-irr .irr-result span { color: rgba(255,255,255,.78); }
    .withdrawal-irr .irr-result strong { color: #fff; font-size: 42px; }
    .notice {
      margin: 28px 2px 0;
      color: #60787e;
      font-size: 17px;
      line-height: 1.6;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      margin-top: 24px;
      padding-top: 18px;
      border-top: 1px solid #cdddda;
      color: #71868a;
      font-size: 16px;
    }
  </style>
</head>
<body>
  <main id="poster" class="${isWithdrawal ? 'withdrawal' : 'standard'}">
    <header class="hero">
      <span class="eyebrow">${isWithdrawal ? '储蓄险 · 提领数据说明' : '储蓄险 · IRR 数据说明'}</span>
      <h1>${escapeHtml(model.title)}</h1>
      <p class="hero-meta">受保人投保年龄 ${model.insuredAge} 岁 · ${model.premiumTerm} 年缴 · 总保费 ${escapeHtml(formatCompactMoney(model.totalPremium, model.currency))}</p>
    </header>

    <section class="summary">
      <div class="summary-card"><span>供款年期</span><strong>${model.premiumTerm} 年</strong></div>
      <div class="summary-card"><span>实际年缴保费</span><strong>${escapeHtml(formatMoney(model.annualPremium, model.currency))}</strong></div>
      <div class="summary-card"><span>保费总额</span><strong>${escapeHtml(formatMoney(model.totalPremium, model.currency))}</strong></div>
    </section>

    ${withdrawalPlan}
    <div class="section-title">
      <h2>${isWithdrawal ? '历年退保价值与累计提取' : '关键保单年度'}</h2>
      <span>${isWithdrawal ? '主情景 · 合计总额相对初始总保费' : '退保发还金额 · 总保费倍数'}</span>
    </div>
    <table class="${isWithdrawal ? 'withdrawal-table' : ''}">
      <thead>${tableHeader}</thead>
      <tbody>${tableRows}</tbody>
    </table>

    ${standardDetails}
    ${withdrawalDetails}

    <p class="notice">${escapeHtml(note)} 金额及 IRR 仅作计划书数据整理。</p>
    <footer class="footer">
      <span>数据来源：${escapeHtml(model.sourceLabel)}</span>
      <span>最后保单年度：第 ${model.lastPolicyYear} 年</span>
    </footer>
  </main>
</body>
</html>`;
}

export async function renderIrrSummaryImage(model, outputPath) {
  const executablePath = findChromeExecutable();
  if (!executablePath) {
    throw new IrrSummaryImageError(
      'IRR_IMAGE_CHROME_NOT_FOUND',
      '未找到 Google Chrome，无法渲染 IRR 说明图',
    );
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const partialPath = `${outputPath}.partial-${process.pid}.png`;
  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--hide-scrollbars'],
    });
    const page = await browser.newPage({
      viewport: { width: 1080, height: 1800 },
      deviceScaleFactor: 1,
    });
    await page.setContent(buildHtml(model), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#poster').screenshot({
      path: partialPath,
      type: 'png',
      animations: 'disabled',
    });
    await fs.rm(outputPath, { force: true });
    await fs.rename(partialPath, outputPath);
  } catch (error) {
    if (error instanceof IrrSummaryImageError) throw error;
    throw new IrrSummaryImageError('IRR_IMAGE_RENDER_FAILED', error.message);
  } finally {
    await browser?.close().catch(() => {});
    await fs.rm(partialPath, { force: true });
  }
  return outputPath;
}
