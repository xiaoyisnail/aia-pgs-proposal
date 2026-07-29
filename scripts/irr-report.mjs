#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import writeExcelFile from 'write-excel-file/node';
import { renderIrrSummaryImage } from './irr-summary-image.mjs';
import {
  buildIrrSummaryImagePath,
  buildIrrWorkbookPath,
  toSimplified,
} from './proposal-files.mjs';

const NUMBER_PATTERN = /^\d[\d,]*(?:\.\d+)?$/;
const TITLE_COLOR = '#17365D';
const HEADER_COLOR = '#1F4E78';
const LIGHT_BLUE = '#D9EAF7';
const LIGHT_GRAY = '#F2F2F2';
const BORDER_COLOR = '#D9E2F3';

export class IrrReportError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'IrrReportError';
    this.code = code;
  }
}

function parseNumber(text) {
  return Number(String(text).replaceAll(',', ''));
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, '').trim();
}

export function groupTextRows(items, yTolerance = 1.5) {
  const sorted = items
    .filter(item => item.str?.trim())
    .map(item => ({
      text: item.str.trim(),
      x: item.transform[4],
      y: item.transform[5],
    }))
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const rows = [];
  for (const item of sorted) {
    let row = rows.at(-1);
    if (!row || Math.abs(row.y - item.y) >= yTolerance) {
      row = { y: item.y, cells: [] };
      rows.push(row);
    }
    row.cells.push(item);
  }
  for (const row of rows) row.cells.sort((left, right) => left.x - right.x);
  return rows;
}

function rowText(row) {
  return row.cells.map(cell => cell.text).join(' ');
}

function findHeaderCell(rows, patterns) {
  for (const row of rows) {
    const cell = row.cells.find(candidate =>
      patterns.some(pattern => normalizeText(candidate.text).includes(pattern))
    );
    if (cell) return { ...cell, rowY: row.y };
  }
  return null;
}

function findNumericCellBelow(rows, header) {
  const candidates = rows
    .filter(row => header.rowY - row.y > 0 && header.rowY - row.y < 45)
    .flatMap(row => row.cells.map(cell => ({ ...cell, rowY: row.y })))
    .filter(cell => NUMBER_PATTERN.test(cell.text))
    .sort((left, right) => {
      const xDistance = Math.abs(left.x - header.x) - Math.abs(right.x - header.x);
      if (xDistance) return xDistance;
      return Math.abs(left.rowY - header.rowY) - Math.abs(right.rowY - header.rowY);
    });
  return candidates[0] || null;
}

export function parseDetailedRowCells(cells) {
  const numericCells = cells
    .map(cell => typeof cell === 'string' ? cell : cell.text)
    .filter(text => NUMBER_PATTERN.test(text));
  if (numericCells.length !== 12) return null;
  const values = numericCells.map(parseNumber);
  const [
    age,
    policyYear,
    paidPremiumTotal,
    ,
    ,
    ,
    surrenderValueTotal,
    ,
    ,
    ,
    ,
    lifeCoverageTotal,
  ] = values;
  if (!Number.isInteger(age) || !Number.isInteger(policyYear) || policyYear <= 0) {
    return null;
  }
  return {
    age,
    policyYear,
    paidPremiumTotal,
    surrenderValueTotal,
    lifeCoverageTotal,
  };
}

export function parseWithdrawalRowCells(cells) {
  const numericCells = cells
    .map(cell => typeof cell === 'string' ? cell : cell.text)
    .filter(text => NUMBER_PATTERN.test(text));
  if (numericCells.length !== 9) return null;
  const values = numericCells.map(parseNumber);
  const [
    age,
    policyYear,
    paidPremiumTotal,
    withdrawalAmount,
    basicAmountAfterWithdrawal,
    ,
    ,
    ,
    surrenderValueAfterWithdrawal,
  ] = values;
  if (!Number.isInteger(age) || !Number.isInteger(policyYear) || policyYear <= 0) {
    return null;
  }
  return {
    age,
    policyYear,
    paidPremiumTotal,
    withdrawalAmount,
    basicAmountAfterWithdrawal,
    surrenderValueAfterWithdrawal,
  };
}

function parseProductName(rows) {
  const planRow = rows.find(row => /計劃[:：]|计划[:：]/.test(rowText(row)));
  if (!planRow) return '';
  return toSimplified(rowText(planRow)
    .replace(/^.*?(?:計劃|计划)[:：]\s*/, '')
    .replace(/[（(]\s*\d+\s*年(?:繳費|缴费)[）)]\s*$/, '')
    .replace(/[「」]/g, '')
    .trim());
}

function parseCurrency(rows) {
  const currencyRow = rows.find(row => /保單貨幣[:：]|保单货币[:：]/.test(rowText(row)));
  if (!currencyRow) return '';
  return toSimplified(rowText(currencyRow)
    .replace(/^.*?(?:保單貨幣|保单货币)[:：]\s*/, '')
    .trim());
}

export async function extractSavingsProposalData(pdfPath) {
  const pdfBytes = new Uint8Array(await fs.readFile(pdfPath));
  let document;
  try {
    document = await getDocument({ data: pdfBytes, disableWorker: true }).promise;
  } catch (error) {
    throw new IrrReportError('IRR_PDF_INVALID', `无法读取 PDF：${error.message}`);
  }

  try {
    const firstPage = await document.getPage(1);
    const firstContent = await firstPage.getTextContent();
    const firstRows = groupTextRows(firstContent.items);
    const premiumHeader = findHeaderCell(firstRows, ['年繳保費', '年缴保费']);
    const termHeader = findHeaderCell(firstRows, ['保費供款年期', '保费供款年期']);
    if (!premiumHeader || !termHeader) {
      throw new IrrReportError(
        'IRR_PREMIUM_HEADER_NOT_FOUND',
        '首页没有找到“年缴保费”或“保费供款年期”',
      );
    }
    const premiumCell = findNumericCellBelow(firstRows, premiumHeader);
    const termCell = findNumericCellBelow(firstRows, termHeader);
    const annualPremium = premiumCell ? parseNumber(premiumCell.text) : NaN;
    const premiumTerm = termCell ? parseNumber(termCell.text) : NaN;
    if (!(annualPremium > 0) || !Number.isInteger(premiumTerm) || premiumTerm <= 0) {
      throw new IrrReportError(
        'IRR_PREMIUM_NOT_FOUND',
        '无法从首页准确读取实际年缴保费或缴费年期',
      );
    }

    const rows = [];
    const sourcePages = [];
    const withdrawalRows = [];
    const withdrawalSourcePages = [];
    let hasWithdrawalPlan = false;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = normalizeText(content.items.map(item => item.str).join(' '));
      if (text.includes('現金提取後') || text.includes('现金提取后')) {
        hasWithdrawalPlan = true;
      }
      const groupedRows = groupTextRows(content.items);
      if ((text.includes('現金提取後之退保發還金額')
          || text.includes('现金提取后之退保发还金额'))
        && !text.includes('悲觀情景')
        && !text.includes('悲观情景')) {
        const parsedWithdrawalRows = groupedRows
          .map(row => parseWithdrawalRowCells(row.cells))
          .filter(Boolean);
        if (parsedWithdrawalRows.length) {
          withdrawalSourcePages.push(pageNumber);
          withdrawalRows.push(...parsedWithdrawalRows);
        }
      }
      if (!text.includes('詳細說明')
        || (!text.includes('退保發還金額') && !text.includes('退保发还金额'))) {
        continue;
      }
      const pageRows = groupedRows
        .map(row => parseDetailedRowCells(row.cells))
        .filter(Boolean);
      if (pageRows.length) {
        sourcePages.push(pageNumber);
        rows.push(...pageRows);
      }
    }
    rows.sort((left, right) => left.policyYear - right.policyYear);
    if (!rows.length) {
      throw new IrrReportError(
        'IRR_DETAIL_TABLE_NOT_FOUND',
        '没有找到“详细说明”中的逐年退保发还金额表',
      );
    }
    for (let index = 0; index < rows.length; index++) {
      if (rows[index].policyYear !== index + 1) {
        throw new IrrReportError(
          'IRR_DETAIL_TABLE_INCOMPLETE',
          `逐年数据不连续：预期第 ${index + 1} 年，实际为第 ${rows[index].policyYear} 年`,
        );
      }
    }
    withdrawalRows.sort((left, right) => left.policyYear - right.policyYear);
    if (hasWithdrawalPlan && !withdrawalRows.length) {
      throw new IrrReportError(
        'IRR_WITHDRAWAL_TABLE_NOT_FOUND',
        '计划书包含提领安排，但没有找到主情景“现金提取后之退保发还金额”逐年表',
      );
    }
    for (let index = 0; index < withdrawalRows.length; index++) {
      if (withdrawalRows[index].policyYear !== index + 1) {
        throw new IrrReportError(
          'IRR_WITHDRAWAL_TABLE_INCOMPLETE',
          `提领后逐年数据不连续：预期第 ${index + 1} 年，实际为第 ${withdrawalRows[index].policyYear} 年`,
        );
      }
    }

    return {
      productName: parseProductName(firstRows),
      currency: parseCurrency(firstRows) || '美元',
      annualPremium,
      premiumTerm,
      rows,
      sourcePages,
      pageCount: document.numPages,
      hasWithdrawalPlan,
      withdrawalRows,
      withdrawalSourcePages,
    };
  } finally {
    await document.destroy();
  }
}

export function buildCashFlows(policyYear, annualPremium, premiumTerm, surrenderValue) {
  const cashFlows = Array(policyYear + 1).fill(0);
  for (let time = 0; time < Math.min(policyYear, premiumTerm); time++) {
    cashFlows[time] = -annualPremium;
  }
  cashFlows[policyYear] += surrenderValue;
  return cashFlows;
}

function npv(rate, cashFlows) {
  return cashFlows.reduce(
    (total, value, period) => value === 0
      ? total
      : total + value / ((1 + rate) ** period),
    0,
  );
}

export function calculateIrr(cashFlows) {
  if (!cashFlows.some(value => value < 0) || !cashFlows.some(value => value > 0)) {
    return null;
  }
  let low = -0.999999999;
  let high = 1;
  let lowValue = npv(low, cashFlows);
  let highValue = npv(high, cashFlows);
  while (lowValue * highValue > 0 && high < 1_000_000) {
    high = high * 2 + 1;
    highValue = npv(high, cashFlows);
  }
  if (Number.isNaN(lowValue) || Number.isNaN(highValue) || lowValue * highValue > 0) {
    return null;
  }
  for (let iteration = 0; iteration < 200; iteration++) {
    const middle = (low + high) / 2;
    const middleValue = npv(middle, cashFlows);
    if (Math.abs(middleValue) < 1e-9) return middle;
    if (lowValue * middleValue <= 0) {
      high = middle;
      highValue = middleValue;
    } else {
      low = middle;
      lowValue = middleValue;
    }
  }
  return (low + high) / 2;
}

export function buildIrrSummaryModel(data, pdfPath) {
  const totalPremium = data.annualPremium * data.premiumTerm;
  const rows = data.rows.map(row => {
    const irr = calculateIrr(buildCashFlows(
      row.policyYear,
      data.annualPremium,
      data.premiumTerm,
      row.surrenderValueTotal,
    ));
    return {
      ...row,
      irr,
      growthMultiple: row.surrenderValueTotal / totalPremium,
    };
  });
  const lastPolicyYear = rows.at(-1).policyYear;
  const breakEvenRow = rows.find(row => row.surrenderValueTotal >= totalPremium) || null;
  const firstTableYear = breakEvenRow?.policyYear
    || Math.min(data.premiumTerm, lastPolicyYear);
  const tableYears = new Set([firstTableYear, lastPolicyYear]);
  for (let year = 20; year <= lastPolicyYear; year += 10) {
    if (year > firstTableYear) tableYears.add(year);
  }
  const targets = [3, 4, 5, 6, 6.5];
  const irrMilestones = targets.map(targetPercent => {
    const row = rows.find(candidate => candidate.irr !== null
      && Math.round(candidate.irr * 10_000) / 100 >= targetPercent);
    return {
      targetPercent,
      policyYear: row?.policyYear || null,
      irr: row?.irr ?? null,
    };
  });
  return {
    variant: 'standard',
    title: '香港友邦储蓄保险计划',
    currency: toSimplified(data.currency),
    insuredAge: data.rows[0].age - data.rows[0].policyYear,
    annualPremium: data.annualPremium,
    premiumTerm: data.premiumTerm,
    totalPremium,
    lastPolicyYear,
    breakEvenRow,
    tableRows: rows.filter(row => tableYears.has(row.policyYear)),
    irrMilestones,
    sourceLabel: `PDF 第 ${data.sourcePages.join('、')} 页“详细说明”`,
    sourceFile: path.basename(pdfPath),
  };
}

export function buildWithdrawalCashFlows(
  policyYear,
  annualPremium,
  premiumTerm,
  withdrawalRows,
  surrenderValueAfterWithdrawal,
) {
  const cashFlows = Array(policyYear + 1).fill(0);
  for (let time = 0; time < Math.min(policyYear, premiumTerm); time++) {
    cashFlows[time] = -annualPremium;
  }
  for (const row of withdrawalRows) {
    if (row.policyYear > policyYear) break;
    cashFlows[row.policyYear] += row.withdrawalAmount;
  }
  cashFlows[policyYear] += surrenderValueAfterWithdrawal;
  return cashFlows;
}

export function buildWithdrawalSummaryModel(data, pdfPath) {
  if (!data.withdrawalRows?.length) {
    throw new IrrReportError(
      'IRR_WITHDRAWAL_TABLE_NOT_FOUND',
      '无法为提领计划生成说明图：缺少提领后逐年数据',
    );
  }
  const totalPremium = data.annualPremium * data.premiumTerm;
  let cumulativeWithdrawal = 0;
  const rows = data.withdrawalRows.map(row => {
    cumulativeWithdrawal += row.withdrawalAmount;
    const combinedValue = row.surrenderValueAfterWithdrawal + cumulativeWithdrawal;
    return {
      ...row,
      cumulativeWithdrawal,
      combinedValue,
      growthMultiple: combinedValue / totalPremium,
      irr: calculateIrr(buildWithdrawalCashFlows(
        row.policyYear,
        data.annualPremium,
        data.premiumTerm,
        data.withdrawalRows,
        row.surrenderValueAfterWithdrawal,
      )),
    };
  });
  const positiveWithdrawalRows = rows.filter(row => row.withdrawalAmount > 0);
  if (!positiveWithdrawalRows.length) {
    throw new IrrReportError(
      'IRR_WITHDRAWAL_AMOUNT_NOT_FOUND',
      '提领后逐年表没有正数提取金额',
    );
  }
  const startPolicyYear = positiveWithdrawalRows[0].policyYear;
  const endPolicyYear = positiveWithdrawalRows.at(-1).policyYear;
  const firstTableYear = Math.ceil(startPolicyYear / 10) * 10;
  const lastPolicyYear = rows.at(-1).policyYear;
  const tableYears = new Set([lastPolicyYear]);
  for (let year = firstTableYear; year <= lastPolicyYear; year += 10) {
    tableYears.add(year);
  }
  const withdrawalAmounts = new Set(
    positiveWithdrawalRows.map(row => row.withdrawalAmount.toFixed(2)),
  );
  return {
    variant: 'withdrawal',
    title: '香港友邦储蓄保险计划',
    currency: toSimplified(data.currency),
    insuredAge: data.rows[0].age - data.rows[0].policyYear,
    annualPremium: data.annualPremium,
    premiumTerm: data.premiumTerm,
    totalPremium,
    lastPolicyYear,
    startPolicyYear,
    endPolicyYear,
    annualWithdrawal: positiveWithdrawalRows[0].withdrawalAmount,
    annualWithdrawalIsConstant: withdrawalAmounts.size === 1,
    withdrawalToPremiumRatio: positiveWithdrawalRows[0].withdrawalAmount / totalPremium,
    totalWithdrawals: positiveWithdrawalRows.reduce(
      (total, row) => total + row.withdrawalAmount,
      0,
    ),
    finalIrr: rows.at(-1).irr,
    tableRows: rows.filter(row => tableYears.has(row.policyYear)),
    sourceLabel: `PDF 第 ${data.withdrawalSourcePages.join('、')} 页“现金提取后之退保发还金额”`,
    sourceFile: path.basename(pdfPath),
  };
}

function excelColumnName(columnNumber) {
  let value = columnNumber;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function currencyFormat(currency) {
  if (currency.includes('美元')) return '"USD" #,##0.00;[Red]("USD" #,##0.00);-';
  if (currency.includes('港')) return '"HKD" #,##0.00;[Red]("HKD" #,##0.00);-';
  if (currency.includes('澳')) return '"MOP" #,##0.00;[Red]("MOP" #,##0.00);-';
  if (currency.includes('新加坡')) return '"SGD" #,##0.00;[Red]("SGD" #,##0.00);-';
  if (currency.includes('人民')) return '"CNY" #,##0.00;[Red]("CNY" #,##0.00);-';
  return '#,##0.00;[Red](#,##0.00);-';
}

function styleRow(values, style) {
  return values.map(value => value === null ? null : { value, ...style });
}

function buildWorkbookSheets(data, pdfPath) {
  const maximumPolicyYear = data.rows.at(-1).policyYear;
  const tableStartRow = 11;
  const titleStyle = {
    backgroundColor: TITLE_COLOR,
    textColor: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
    align: 'left',
    alignVertical: 'center',
    height: 28,
  };
  const labelStyle = {
    backgroundColor: LIGHT_BLUE,
    fontWeight: 'bold',
    borderColor: BORDER_COLOR,
    bottomBorderStyle: 'thin',
  };
  const headerStyle = {
    backgroundColor: HEADER_COLOR,
    textColor: '#FFFFFF',
    fontWeight: 'bold',
    align: 'center',
    alignVertical: 'center',
    wrap: true,
    height: 36,
  };
  const sourcePages = data.sourcePages.join('、');
  const analysisData = [
    [
      { value: `${toSimplified(data.productName) || '储蓄险'} IRR 分析`, columnSpan: 10, ...titleStyle },
      null, null, null, null, null, null, null, null, null,
    ],
    styleRow(['来源文件', path.basename(pdfPath), null, null, null, null, null, null, null, null], {}),
    styleRow(['产品', toSimplified(data.productName) || '未识别', null, null, null, null, null, null, null, null], {}),
    styleRow(['保单货币', toSimplified(data.currency), null, '实际年缴保费', data.annualPremium, null, '缴费年期', data.premiumTerm, null, null], {}),
    styleRow(['数据来源', `PDF 第 ${sourcePages} 页“详细说明”`, null, null, null, null, null, null, null, null], {}),
    [
      {
        value: '现金流口径：每个保单年度开始时缴付当年保费，最多缴至缴费年期；该保单年度终结时取得“退保发还金额总额”。IRR 为年化回报率。',
        columnSpan: 10,
        backgroundColor: LIGHT_GRAY,
        wrap: true,
        height: 32,
      },
      null, null, null, null, null, null, null, null, null,
    ],
    [
      {
        value: '提示：本表严格采用“详细说明”数据。若计划书含提取安排，本表不把提取金额计入现金流，也不采用“现金提取后”示例页。',
        columnSpan: 10,
        backgroundColor: '#FFF2CC',
        wrap: true,
        height: 32,
      },
      null, null, null, null, null, null, null, null, null,
    ],
    [null],
    [null],
    styleRow([
      '保单年度',
      '年末年龄',
      '实际年缴保费',
      '缴费年期',
      '累计已缴保费（精确）',
      'PDF 缴付保费总额',
      '退保发还金额总额',
      'IRR（结果）',
      'IRR（Excel 公式核验）',
      '差异检查',
    ], headerStyle),
  ];

  const cashFlowData = [
    styleRow(
      ['截至保单年度', ...Array.from({ length: maximumPolicyYear + 1 }, (_, index) => `t=${index}`)],
      headerStyle,
    ),
  ];

  data.rows.forEach((row, index) => {
    const sheetRow = tableStartRow + index;
    const cashFlowRow = index + 2;
    const cashFlows = buildCashFlows(
      row.policyYear,
      data.annualPremium,
      data.premiumTerm,
      row.surrenderValueTotal,
    );
    const scriptIrr = calculateIrr(cashFlows);
    const irrLastColumn = excelColumnName(row.policyYear + 2);
    analysisData.push([
      { value: row.policyYear, type: Number, format: '0', align: 'center' },
      { value: row.age, type: Number, format: '0', align: 'center' },
      { value: data.annualPremium, type: Number, format: currencyFormat(data.currency), align: 'right' },
      { value: data.premiumTerm, type: Number, format: '0', align: 'center' },
      {
        value: `=C${sheetRow}*MIN(A${sheetRow},D${sheetRow})`,
        type: 'Formula',
        format: currencyFormat(data.currency),
        align: 'right',
      },
      { value: row.paidPremiumTotal, type: Number, format: currencyFormat(data.currency), align: 'right' },
      { value: row.surrenderValueTotal, type: Number, format: currencyFormat(data.currency), align: 'right' },
      scriptIrr === null
        ? { value: null, type: Number, format: '0.00%;[Red](0.00%);-', align: 'right' }
        : { value: scriptIrr, type: Number, format: '0.00%;[Red](0.00%);-', align: 'right' },
      {
        value: `=IFERROR(IRR('现金流核验'!B${cashFlowRow}:${irrLastColumn}${cashFlowRow},H${sheetRow}),"")`,
        type: 'Formula',
        format: '0.00%;[Red](0.00%);-',
        align: 'right',
      },
      {
        value: `=IF(OR(H${sheetRow}="",I${sheetRow}=""),"",I${sheetRow}-H${sheetRow})`,
        type: 'Formula',
        format: '0.0000%',
        align: 'right',
      },
    ]);

    const cashFlowCells = Array.from({ length: maximumPolicyYear + 1 }, (_, time) => ({
        value: cashFlows[time] || 0,
        type: Number,
        format: currencyFormat(data.currency),
      }));
    cashFlowData.push([
      { value: row.policyYear, type: Number, format: '0', align: 'center' },
      ...cashFlowCells,
    ]);
  });

  analysisData[1][0] = { ...analysisData[1][0], ...labelStyle };
  analysisData[2][0] = { ...analysisData[2][0], ...labelStyle };
  analysisData[3][0] = { ...analysisData[3][0], ...labelStyle };
  analysisData[3][3] = { ...analysisData[3][3], ...labelStyle };
  analysisData[3][6] = { ...analysisData[3][6], ...labelStyle };
  analysisData[4][0] = { ...analysisData[4][0], ...labelStyle };
  analysisData[3][4] = {
    ...analysisData[3][4],
    type: Number,
    format: currencyFormat(data.currency),
    align: 'right',
  };
  analysisData[3][7] = { ...analysisData[3][7], type: Number, format: '0', align: 'center' };

  return [
    {
      data: analysisData,
      sheet: 'IRR分析',
      columns: [
        { width: 12 }, { width: 12 }, { width: 18 }, { width: 12 }, { width: 22 },
        { width: 22 }, { width: 23 }, { width: 18 }, { width: 18 }, { width: 14 },
      ],
      stickyRowsCount: 10,
      showGridLines: false,
      zoomScale: 0.9,
    },
    {
      data: cashFlowData,
      sheet: '现金流核验',
      columns: [
        { width: 14 },
        ...Array.from({ length: maximumPolicyYear + 1 }, () => ({ width: 14 })),
      ],
      stickyRowsCount: 1,
      stickyColumnsCount: 1,
      showGridLines: false,
      zoomScale: 0.75,
    },
  ];
}

export async function generateIrrReport(
  pdfPath,
  outputPath = buildIrrWorkbookPath(pdfPath),
  options = {},
) {
  const data = await extractSavingsProposalData(pdfPath);
  const shouldGenerateWorkbook = options.generateWorkbook ?? true;
  let workbookOutputPath = null;
  if (shouldGenerateWorkbook) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const partialPath = `${outputPath}.partial-${process.pid}.xlsx`;
    try {
      const workbook = writeExcelFile(buildWorkbookSheets(data, pdfPath), {
        fontFamily: 'Aptos',
        fontSize: 10,
      });
      await workbook.toFile(partialPath);
      await fs.rm(outputPath, { force: true });
      await fs.rename(partialPath, outputPath);
      workbookOutputPath = outputPath;
    } finally {
      await fs.rm(partialPath, { force: true });
    }
  }
  const shouldGenerateSummaryImage = options.generateSummaryImage ?? true;
  let summaryImagePath = null;
  if (shouldGenerateSummaryImage) {
    summaryImagePath = options.summaryImagePath || buildIrrSummaryImagePath(pdfPath);
    const summaryModel = data.hasWithdrawalPlan
      ? buildWithdrawalSummaryModel(data, pdfPath)
      : buildIrrSummaryModel(data, pdfPath);
    await renderIrrSummaryImage(summaryModel, summaryImagePath);
  }
  return {
    outputPath: workbookOutputPath,
    summaryImagePath,
    rowCount: data.rows.length,
    firstPolicyYear: data.rows[0].policyYear,
    lastPolicyYear: data.rows.at(-1).policyYear,
    annualPremium: data.annualPremium,
    premiumTerm: data.premiumTerm,
    sourcePages: data.sourcePages,
    hasWithdrawalPlan: data.hasWithdrawalPlan,
  };
}

async function main() {
  const pdfPath = process.argv.slice(2).find(argument => !argument.startsWith('--'));
  if (!pdfPath) {
    throw new IrrReportError(
      'IRR_PDF_REQUIRED',
      '请运行 npm run irr -- "<储蓄险计划书.pdf>"',
    );
  }
  const resolvedPdfPath = path.resolve(pdfPath);
  const result = await generateIrrReport(resolvedPdfPath);
  console.log(
    `IRR_OK rows=${result.rowCount} years=${result.firstPolicyYear}-${result.lastPolicyYear}`,
  );
  console.log(`✅ IRR 表: ${result.outputPath}`);
  if (result.summaryImagePath) {
    console.log(`✅ IRR 说明图: ${result.summaryImagePath}`);
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(error => {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  });
}
