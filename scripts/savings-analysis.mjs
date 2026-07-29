import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { extractSavingsProposalData } from './irr-report.mjs';
import {
  buildSavingsAnalysisPath,
  toSimplified,
} from './proposal-files.mjs';
import { findChromeExecutable } from './runtime-platform.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const featureImagePath = path.resolve(
  scriptDirectory,
  '..',
  'assets',
  'savings-analysis-product-features.jpg',
);

export const LARGE_SAVINGS_ANNUAL_PREMIUM_USD = 50_000;
export const LARGE_SAVINGS_WITHDRAWAL_SCENARIOS = Object.freeze([
  Object.freeze({ startPolicyYear: 6, totalPremiumRatio: 0.064 }),
  Object.freeze({ startPolicyYear: 11, totalPremiumRatio: 0.088 }),
  Object.freeze({ startPolicyYear: 15, totalPremiumRatio: 0.116 }),
  Object.freeze({ startPolicyYear: 20, totalPremiumRatio: 0.162 }),
  Object.freeze({ startPolicyYear: 25, totalPremiumRatio: 0.22 }),
]);

export class SavingsAnalysisError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'SavingsAnalysisError';
    this.code = code;
  }
}

export function isUsdCurrency(currency) {
  return /美元|美金|USD/i.test(String(currency || ''));
}

export function qualifiesForLargeSavingsAnalysis(config) {
  return config?.productType === 'savings'
    && isUsdCurrency(config.currency)
    && Number(config.annualPremium) >= LARGE_SAVINGS_ANNUAL_PREMIUM_USD;
}

export function calculateScenarioAnnualAmount(totalPremium, ratio) {
  if (!(totalPremium > 0) || !(ratio > 0)) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_RATIO_INVALID',
      '总保费和提领比例必须为正数',
    );
  }
  return Math.round(totalPremium * ratio);
}

export function buildLargeSavingsScenarioConfigs(baseConfig, actualTotalPremium) {
  return LARGE_SAVINGS_WITHDRAWAL_SCENARIOS.map(scenario => ({
    ...baseConfig,
    largeSavingsBatchRole: 'withdrawal',
    withdrawalPlan: {
      enabled: true,
      startPolicyYear: scenario.startPolicyYear,
      endPolicyYear: 'last',
      annualAmount: calculateScenarioAnnualAmount(
        actualTotalPremium,
        scenario.totalPremiumRatio,
      ),
    },
    analysisScenario: {
      startPolicyYear: scenario.startPolicyYear,
      totalPremiumRatio: scenario.totalPremiumRatio,
    },
  }));
}

function assertFinitePositive(value, code, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new SavingsAnalysisError(code, `${label}不是有效正数：${value}`);
  }
}

function insuredAgeFromData(data) {
  const firstRow = data.rows?.[0];
  if (!firstRow) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_BASE_ROWS_MISSING',
      '不提领计划书没有逐年详细说明数据',
    );
  }
  return firstRow.age - firstRow.policyYear;
}

function buildInsuredName(config) {
  const surname = String(config.insuredSurname || '').trim();
  const givenName = String(config.insuredGivenName || '').trim();
  if (surname && givenName && surname.toLowerCase() === givenName.toLowerCase()) {
    return surname.toLowerCase() === 'vip' ? 'VIP' : surname;
  }
  const value = [surname, givenName].filter(Boolean).join(' ');
  return value || '受保人';
}

function normalizedIdentity(value) {
  return toSimplified(String(value || '')).replace(/\s+/g, '').trim();
}

function compareProposalBasics(baseline, scenario, index) {
  const prefix = `第 ${index + 1} 档提领计划书`;
  if (!scenario.hasWithdrawalPlan) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_WITHDRAWAL_MISSING',
      `${prefix}没有提领后逐年数据`,
    );
  }
  const baselineProduct = normalizedIdentity(baseline.productName);
  const scenarioProduct = normalizedIdentity(scenario.productName);
  if (!baselineProduct || !scenarioProduct || scenarioProduct !== baselineProduct) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_PRODUCT_MISMATCH',
      `${prefix}产品“${scenario.productName || '<未识别>'}”与不提领计划书“${baseline.productName || '<未识别>'}”不一致`,
    );
  }
  if (normalizedIdentity(scenario.currency) !== normalizedIdentity(baseline.currency)) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_CURRENCY_MISMATCH',
      `${prefix}货币 ${scenario.currency} 与不提领计划书 ${baseline.currency} 不一致`,
    );
  }
  if (scenario.premiumTerm !== baseline.premiumTerm) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_TERM_MISMATCH',
      `${prefix}缴费年期 ${scenario.premiumTerm} 与不提领计划书 ${baseline.premiumTerm} 不一致`,
    );
  }
  if (Math.abs(scenario.annualPremium - baseline.annualPremium) > 0.02) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_PREMIUM_MISMATCH',
      `${prefix}实际年缴保费 ${scenario.annualPremium} 与不提领计划书 ${baseline.annualPremium} 不一致`,
    );
  }
  if (insuredAgeFromData(scenario) !== insuredAgeFromData(baseline)) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_AGE_MISMATCH',
      `${prefix}受保人投保年龄与不提领计划书不一致`,
    );
  }
}

function buildWithdrawalScenarioModel(
  baseline,
  scenarioData,
  scenarioConfig,
  index,
) {
  compareProposalBasics(baseline, scenarioData, index);
  const positiveRows = scenarioData.withdrawalRows.filter(row => row.withdrawalAmount > 0);
  if (!positiveRows.length) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_WITHDRAWAL_EMPTY',
      `第 ${index + 1} 档提领计划书没有正数提取金额`,
    );
  }
  const expectedStart = scenarioConfig.analysisScenario.startPolicyYear;
  if (positiveRows[0].policyYear !== expectedStart) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_START_YEAR_MISMATCH',
      `第 ${index + 1} 档实际从第 ${positiveRows[0].policyYear} 年提取，期望第 ${expectedStart} 年`,
    );
  }
  const distinctAmounts = new Set(
    positiveRows.map(row => Math.round(row.withdrawalAmount * 100) / 100),
  );
  if (distinctAmounts.size !== 1) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_WITHDRAWAL_NOT_CONSTANT',
      `第 ${index + 1} 档实际提取金额并非每年相同，不能按参考模板汇总`,
    );
  }
  const finalRow = scenarioData.withdrawalRows.at(-1);
  const totalWithdrawals = positiveRows.reduce(
    (total, row) => total + row.withdrawalAmount,
    0,
  );
  assertFinitePositive(
    finalRow.surrenderValueAfterWithdrawal,
    'SAVINGS_ANALYSIS_FINAL_VALUE_INVALID',
    `第 ${index + 1} 档最后年度退保价值`,
  );
  return {
    startPolicyYear: positiveRows[0].policyYear,
    endPolicyYear: positiveRows.at(-1).policyYear,
    endAge: positiveRows.at(-1).age,
    withdrawalTermYears: positiveRows.length,
    annualWithdrawal: positiveRows[0].withdrawalAmount,
    totalPremiumRatio: scenarioConfig.analysisScenario.totalPremiumRatio,
    totalWithdrawals,
    surrenderValueAtEnd: finalRow.surrenderValueAfterWithdrawal,
    combinedValue: totalWithdrawals + finalRow.surrenderValueAfterWithdrawal,
  };
}

function buildLegacyRows(baseline, totalPremium) {
  const selectedRows = [];
  const policyYear30 = baseline.rows.find(row => row.policyYear === 30);
  if (policyYear30) {
    selectedRows.push({ label: '30年', row: policyYear30 });
  }
  for (const age of [70, 80, 90, 100]) {
    const row = baseline.rows.find(candidate => candidate.age === age);
    if (row && !selectedRows.some(item => item.row.policyYear === row.policyYear)) {
      selectedRows.push({ label: `${age}岁`, row });
    }
  }
  if (!selectedRows.length) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_LEGACY_ROWS_MISSING',
      '不提领计划书没有第 30 保单年度或 70/80/90/100 岁数据',
    );
  }
  return selectedRows.map(({ label, row }) => {
    assertFinitePositive(
      row.lifeCoverageTotal,
      'SAVINGS_ANALYSIS_LIFE_COVERAGE_INVALID',
      `${label}人寿保障`,
    );
    assertFinitePositive(
      row.surrenderValueTotal,
      'SAVINGS_ANALYSIS_SURRENDER_VALUE_INVALID',
      `${label}退保价值`,
    );
    return {
      label,
      policyYear: row.policyYear,
      age: row.age,
      lifeCoverageTotal: row.lifeCoverageTotal,
      surrenderValueTotal: row.surrenderValueTotal,
      growthMultiple: row.surrenderValueTotal / totalPremium,
    };
  });
}

export function buildSavingsAnalysisModel({
  baseConfig,
  baselineData,
  withdrawalEntries,
  requiredScenarioCount = LARGE_SAVINGS_WITHDRAWAL_SCENARIOS.length,
}) {
  if (baselineData.hasWithdrawalPlan) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_BASE_HAS_WITHDRAWAL',
      '分析书基准文件必须是不提领计划书',
    );
  }
  if (requiredScenarioCount === null
    && (withdrawalEntries.length < 1
      || withdrawalEntries.length > LARGE_SAVINGS_WITHDRAWAL_SCENARIOS.length)) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_SCENARIO_COUNT',
      `直接生成分析书需要 1-${LARGE_SAVINGS_WITHDRAWAL_SCENARIOS.length} 份提领计划书，实际 ${withdrawalEntries.length} 份`,
    );
  }
  if (requiredScenarioCount !== null
    && withdrawalEntries.length !== requiredScenarioCount) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_SCENARIO_COUNT',
      `分析书需要 ${requiredScenarioCount} 份提领计划书，实际 ${withdrawalEntries.length} 份`,
    );
  }
  if (!isUsdCurrency(baselineData.currency)) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_CURRENCY_UNSUPPORTED',
      `当前分析模板只支持美元，实际为 ${baselineData.currency}`,
    );
  }
  const totalPremium = baselineData.annualPremium * baselineData.premiumTerm;
  assertFinitePositive(
    totalPremium,
    'SAVINGS_ANALYSIS_TOTAL_PREMIUM_INVALID',
    '实际总保费',
  );
  const scenarios = withdrawalEntries.map((entry, index) =>
    buildWithdrawalScenarioModel(
      baselineData,
      entry.data,
      entry.config,
      index,
    ));
  const productName = String(
    baseConfig.productName || baselineData.productName,
  ).trim();
  return {
    productName,
    titleSuffix: productName.includes('计划')
      ? '（教育 / 创业 / 养老基金）'
      : '储蓄计划（教育 / 创业 / 养老基金）',
    usesReferenceFeaturePanel: /环宇盈活|環宇盈活/.test(productName),
    insuredName: buildInsuredName(baseConfig),
    insuredAge: insuredAgeFromData(baselineData),
    annualPremium: baselineData.annualPremium,
    premiumTerm: baselineData.premiumTerm,
    totalPremium,
    currency: '美元',
    proposalCount: 1 + withdrawalEntries.length,
    scenarios,
    legacyRows: buildLegacyRows(baselineData, totalPremium),
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function trimDecimal(value, digits = 2) {
  return Number(value.toFixed(digits)).toString();
}

function formatReferenceMoney(value) {
  const rounded = Math.round(value / 1_000) * 1_000;
  if (Math.abs(rounded) >= 100_000_000) {
    return `${trimDecimal(rounded / 100_000_000)}亿美金`;
  }
  return `${trimDecimal(rounded / 10_000, 1)}万美金`;
}

function formatReferenceWanNumber(value) {
  const rounded = Math.round(value / 1_000) * 1_000;
  if (Math.abs(rounded) >= 100_000_000) {
    return `${trimDecimal(rounded / 100_000_000)}亿`;
  }
  return `${trimDecimal(rounded / 10_000, 1)}万`;
}

function formatWholeUsd(value) {
  return `${Math.round(value)}美金`;
}

function buildAnalysisHtml(model, featureImageDataUri) {
  const scenarioRows = model.scenarios.map(scenario => `
    <tr class="scenario-row">
      <td>
        <span>从保单年度第${scenario.startPolicyYear}年开始</span>
        <span>到受保人${scenario.endAge}岁</span>
      </td>
      <td>${scenario.withdrawalTermYears}年</td>
      <td>
        <span>每年提取${escapeHtml(formatWholeUsd(scenario.annualWithdrawal))}</span>
        <span>共提取${escapeHtml(formatReferenceMoney(scenario.totalWithdrawals))}</span>
      </td>
      <td>${escapeHtml(formatReferenceMoney(scenario.surrenderValueAtEnd))}</td>
      <td>
        <span>${escapeHtml(formatReferenceWanNumber(scenario.totalWithdrawals))}
          + ${escapeHtml(formatReferenceWanNumber(scenario.surrenderValueAtEnd))} =</span>
        <span>${escapeHtml(formatReferenceMoney(scenario.combinedValue))}</span>
      </td>
    </tr>
  `).join('');
  const legacyRows = model.legacyRows.map(row => `
    <tr>
      <td>${escapeHtml(row.label)}</td>
      <td>${escapeHtml(formatReferenceMoney(row.lifeCoverageTotal))}</td>
      <td>${escapeHtml(formatReferenceMoney(row.surrenderValueTotal))}</td>
      <td>${trimDecimal(row.growthMultiple, 2)} 倍</td>
    </tr>
  `).join('');
  const featurePanel = model.usesReferenceFeaturePanel ? `
    <section class="features">
      <img src="${featureImageDataUri}" alt="">
    </section>
  ` : `
    <section class="generic-features">
      <strong>${escapeHtml(model.productName)}产品说明</strong>
      <p>本页仅汇总${model.proposalCount}份正式计划书中的保费、提取、退保价值和人寿保障数据。</p>
      <p>产品权益、红利、货币转换、保障及其他选项，请以本次正式计划书和保单条款为准。</p>
    </section>
  `;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body {
      color: #202020;
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC",
        "Source Han Sans SC", Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 210mm;
      height: 297mm;
      overflow: hidden;
      padding: 11mm 16mm 4mm;
      background: #fff;
    }
    h1 {
      margin: 0;
      color: #424242;
      font-size: 17pt;
      line-height: 1.25;
      text-align: center;
    }
    .rule {
      height: .4mm;
      margin: 3.5mm 0 1.8mm;
      background: #b7b7b7;
    }
    .section-name {
      margin: 0;
      font-size: 8pt;
      font-weight: 600;
      letter-spacing: 3.4mm;
      text-align: center;
    }
    .section-note {
      margin: 1.2mm 0 2.5mm;
      font-size: 7.4pt;
      text-align: center;
    }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th {
      height: 8.5mm;
      padding: 1.2mm 1mm;
      color: #fff;
      background: #c6be94;
      font-size: 7.3pt;
      font-weight: 700;
      line-height: 1.3;
      text-align: center;
    }
    td {
      padding: 1.1mm 1.2mm;
      font-size: 7.3pt;
      line-height: 1.45;
      text-align: center;
      vertical-align: middle;
    }
    td span { display: block; }
    .plan-table td { height: 8.5mm; font-size: 7.6pt; }
    .withdrawal-heading {
      margin: 2.2mm 0 .4mm;
      font-size: 8.2pt;
      font-weight: 700;
      letter-spacing: 1.7mm;
      text-align: center;
    }
    .withdrawal-note {
      margin: 0 0 1.3mm;
      font-size: 7.2pt;
      text-align: center;
    }
    .withdrawal-table col:nth-child(1) { width: 23%; }
    .withdrawal-table col:nth-child(2) { width: 14%; }
    .withdrawal-table col:nth-child(3) { width: 26%; }
    .withdrawal-table col:nth-child(4) { width: 18%; }
    .withdrawal-table col:nth-child(5) { width: 19%; }
    .withdrawal-table th { height: 10mm; }
    .withdrawal-table .scenario-row td {
      height: 15.5mm;
      padding-top: 1.4mm;
      padding-bottom: 1.4mm;
    }
    .value-note {
      margin: 1.1mm 0 1.2mm;
      font-size: 6.9pt;
      text-align: center;
    }
    .legacy-table th { height: 9mm; }
    .legacy-table td {
      height: 7.2mm;
      padding-top: .5mm;
      padding-bottom: .5mm;
    }
    .features {
      position: relative;
      width: 100%;
      height: 70mm;
      margin-top: 1.2mm;
      overflow: hidden;
      background: #fffaf1;
    }
    .features img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: fill;
    }
    .generic-features {
      width: 100%;
      height: 70mm;
      margin-top: 1.2mm;
      padding: 12mm 14mm;
      color: #444;
      background: #fffaf1;
      border-top: 2mm solid #d40b46;
      text-align: center;
    }
    .generic-features strong {
      display: block;
      margin-bottom: 8mm;
      color: #c90043;
      font-size: 14pt;
    }
    .generic-features p {
      margin: 4mm 0;
      font-size: 9pt;
      line-height: 1.7;
    }
  </style>
</head>
<body>
  <main class="page">
    <h1>${escapeHtml(model.productName)}${escapeHtml(model.titleSuffix)}</h1>
    <div class="rule"></div>
    <p class="section-name">计划详情</p>
    <p class="section-note">（可根据客户家庭情况设置金额，丰俭由人）</p>
    <table class="plan-table">
      <thead>
        <tr><th>受保人</th><th>保费年期</th><th>每年保费</th><th>总保单</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(model.insuredName)}</td>
          <td>${model.premiumTerm}年</td>
          <td>${escapeHtml(formatReferenceMoney(model.annualPremium))}</td>
          <td>${escapeHtml(formatReferenceMoney(model.totalPremium))}</td>
        </tr>
      </tbody>
    </table>

    <p class="withdrawal-heading">提取金额举例</p>
    <p class="withdrawal-note">（可根据客户自身情况做调整，灵活性强）</p>
    <table class="withdrawal-table">
      <colgroup><col><col><col><col><col></colgroup>
      <thead>
        <tr>
          <th>每年取款<br>（全家共享稳定收益）</th>
          <th>提取年期</th>
          <th>提取现金</th>
          <th>爱传承<br>（100岁时退保价值）</th>
          <th>总共提取金额</th>
        </tr>
      </thead>
      <tbody>${scenarioRows}</tbody>
    </table>

    <p class="value-note">（后期退保现金价值或者人寿保障金额，计算资产增值比例）</p>
    <table class="legacy-table">
      <thead>
        <tr>
          <th>年龄</th>
          <th>人寿保障</th>
          <th>退保价值</th>
          <th>增长率<br>（成本 ${escapeHtml(formatReferenceMoney(model.totalPremium))}）</th>
        </tr>
      </thead>
      <tbody>${legacyRows}</tbody>
    </table>

    ${featurePanel}
  </main>
</body>
</html>`;
}

export async function renderSavingsAnalysisPdf(model, outputPath) {
  const executablePath = findChromeExecutable();
  if (!executablePath) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_CHROME_NOT_FOUND',
      '未找到 Google Chrome，无法生成大单储蓄分析书',
    );
  }
  let featureImageDataUri = '';
  if (model.usesReferenceFeaturePanel) {
    let featureImage;
    try {
      featureImage = await fs.readFile(featureImagePath);
    } catch (error) {
      throw new SavingsAnalysisError(
        'SAVINGS_ANALYSIS_ASSET_MISSING',
        `缺少产品特点模板图：${error.message}`,
      );
    }
    featureImageDataUri = `data:image/jpeg;base64,${featureImage.toString('base64')}`;
  }
  const html = buildAnalysisHtml(model, featureImageDataUri);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const partialPath = `${outputPath}.partial-${process.pid}.pdf`;
  let browser;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--hide-scrollbars'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: partialPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    const bytes = await fs.readFile(partialPath);
    if (bytes.length < 20_000 || bytes.subarray(0, 5).toString() !== '%PDF-') {
      throw new SavingsAnalysisError(
        'SAVINGS_ANALYSIS_PDF_INVALID',
        `生成的分析书不是有效 PDF 或文件过小：${bytes.length} bytes`,
      );
    }
    await fs.rm(outputPath, { force: true });
    await fs.rename(partialPath, outputPath);
  } catch (error) {
    if (error instanceof SavingsAnalysisError) throw error;
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_RENDER_FAILED',
      error.message,
    );
  } finally {
    await browser?.close().catch(() => {});
    await fs.rm(partialPath, { force: true });
  }
  return outputPath;
}

export async function generateSavingsAnalysisPdf({
  baseConfig,
  baselinePdfPath,
  withdrawalEntries,
  outputPath = buildSavingsAnalysisPath(baseConfig),
}) {
  const [baselineData, ...withdrawalData] = await Promise.all([
    extractSavingsProposalData(baselinePdfPath),
    ...withdrawalEntries.map(entry => extractSavingsProposalData(entry.pdfPath)),
  ]);
  const model = buildSavingsAnalysisModel({
    baseConfig,
    baselineData,
    withdrawalEntries: withdrawalEntries.map((entry, index) => ({
      config: entry.config,
      data: withdrawalData[index],
    })),
  });
  await renderSavingsAnalysisPdf(model, outputPath);
  return {
    outputPath,
    model,
    proposalCount: 1 + withdrawalEntries.length,
  };
}

export function buildProvidedSavingsAnalysisPath(baselinePdfPath, outputDirectory) {
  const parsed = path.parse(path.resolve(baselinePdfPath));
  return path.join(
    outputDirectory ? path.resolve(outputDirectory) : parsed.dir,
    `${parsed.name}_储蓄分析书.pdf`,
  );
}

export function prepareProvidedSavingsAnalysisEntries(entries) {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_INPUT_COUNT',
      '直接生成分析书至少需要 2 份 PDF：1 份不提领计划书和至少 1 份提领计划书',
    );
  }
  if (entries.length > LARGE_SAVINGS_WITHDRAWAL_SCENARIOS.length + 1) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_INPUT_COUNT',
      `当前一页分析书最多支持 ${LARGE_SAVINGS_WITHDRAWAL_SCENARIOS.length + 1} 份 PDF`,
    );
  }
  const baselineEntries = entries.filter(entry => !entry.data.hasWithdrawalPlan);
  if (baselineEntries.length !== 1) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_BASE_COUNT',
      `分析书必须且只能包含 1 份不提领计划书，实际识别到 ${baselineEntries.length} 份`,
    );
  }
  const [baselineEntry] = baselineEntries;
  const totalPremium = baselineEntry.data.annualPremium
    * baselineEntry.data.premiumTerm;
  assertFinitePositive(
    totalPremium,
    'SAVINGS_ANALYSIS_TOTAL_PREMIUM_INVALID',
    '实际总保费',
  );
  const withdrawalEntries = entries
    .filter(entry => entry !== baselineEntry)
    .map((entry, index) => {
      compareProposalBasics(baselineEntry.data, entry.data, index);
      const positiveRows = entry.data.withdrawalRows
        .filter(row => row.withdrawalAmount > 0);
      if (!positiveRows.length) {
        throw new SavingsAnalysisError(
          'SAVINGS_ANALYSIS_WITHDRAWAL_EMPTY',
          `第 ${index + 1} 份提领计划书没有正数提取金额`,
        );
      }
      return {
        ...entry,
        config: {
          analysisScenario: {
            startPolicyYear: positiveRows[0].policyYear,
            totalPremiumRatio: positiveRows[0].withdrawalAmount / totalPremium,
          },
        },
      };
    })
    .sort((left, right) =>
      left.config.analysisScenario.startPolicyYear
        - right.config.analysisScenario.startPolicyYear
      || left.config.analysisScenario.totalPremiumRatio
        - right.config.analysisScenario.totalPremiumRatio
    );
  return { baselineEntry, withdrawalEntries };
}

export async function generateSavingsAnalysisFromPdfFiles({
  pdfPaths,
  outputPath,
  outputDirectory,
  insuredName,
}) {
  const resolvedPaths = pdfPaths.map(pdfPath => path.resolve(pdfPath));
  if (new Set(resolvedPaths).size !== resolvedPaths.length) {
    throw new SavingsAnalysisError(
      'SAVINGS_ANALYSIS_DUPLICATE_INPUT',
      '分析书输入包含重复的 PDF 路径',
    );
  }
  const data = await Promise.all(
    resolvedPaths.map(pdfPath => extractSavingsProposalData(pdfPath)),
  );
  const { baselineEntry, withdrawalEntries } =
    prepareProvidedSavingsAnalysisEntries(
      resolvedPaths.map((pdfPath, index) => ({ pdfPath, data: data[index] })),
    );
  const baseConfig = {
    productName: baselineEntry.data.productName,
    insuredSurname: String(insuredName || '').trim(),
    insuredGivenName: '',
  };
  const model = buildSavingsAnalysisModel({
    baseConfig,
    baselineData: baselineEntry.data,
    withdrawalEntries,
    requiredScenarioCount: null,
  });
  const finalOutputPath = outputPath
    ? path.resolve(outputPath)
    : buildProvidedSavingsAnalysisPath(
      baselineEntry.pdfPath,
      outputDirectory,
    );
  await renderSavingsAnalysisPdf(model, finalOutputPath);
  return {
    outputPath: finalOutputPath,
    model,
    baselinePdfPath: baselineEntry.pdfPath,
    proposalCount: resolvedPaths.length,
  };
}
