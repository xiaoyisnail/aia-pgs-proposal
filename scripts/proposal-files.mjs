import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenCC from 'opencc-js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROPOSAL_ROOT = path.resolve(scriptDirectory, '..', '计划书');

const simplifyHongKongChinese = OpenCC.Converter({ from: 'hk', to: 'cn' });

export function toSimplified(text) {
  return simplifyHongKongChinese(String(text));
}

export function sanitizePathSegment(text) {
  const sanitized = toSimplified(text)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[.\s]+$/g, '')
    .trim();
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new Error(`无法生成有效的文件名：${text}`);
  }
  return sanitized;
}

export function buildProposalFileName(cfg) {
  const regionMap = {
    '中華人民共和國': '大陆',
    '中华人民共和国': '大陆',
    '香港': '香港',
    '澳門': '澳门',
    '澳门': '澳门',
  };
  const productName = sanitizePathSegment(cfg.productName);
  const region = regionMap[cfg.region] || sanitizePathSegment(cfg.region);
  if (cfg.productType === 'savings') {
    const currencyCodes = {
      '美元': 'USD',
      '港幣': 'HKD',
      '港币': 'HKD',
      '澳門幣': 'MOP',
      '澳门币': 'MOP',
      '新加坡元': 'SGD',
      '人民幣': 'CNY',
      '人民币': 'CNY',
    };
    const currencyCode = currencyCodes[cfg.currency] || sanitizePathSegment(cfg.currency);
    const withdrawal = cfg.withdrawalPlan.enabled
      ? `_第${cfg.withdrawalPlan.startPolicyYear}至${cfg.withdrawalPlan.endPolicyYear === 'last' ? '最后' : cfg.withdrawalPlan.endPolicyYear}年每年提取${currencyCode}${cfg.withdrawalPlan.annualAmount}_减少基本金额`
      : '_不提取';
    return `${productName}_${cfg.gender}${cfg.age}岁_${region}_${currencyCode}${cfg.annualPremium}每年_${cfg.premiumTerm}年缴${withdrawal}.pdf`;
  }
  return `${productName}_${cfg.gender}${cfg.age}岁_${region}_USD${cfg.sumAssured}_${cfg.premiumTerm}年缴${cfg.smoking ? '_吸烟' : ''}.pdf`;
}

export function resolveProposalOutput(cfg) {
  const rootDirectory = path.resolve(cfg.outputDir || DEFAULT_PROPOSAL_ROOT);
  const productDirectoryName = sanitizePathSegment(cfg.productName);
  const productDirectory = path.join(rootDirectory, productDirectoryName);
  const fileName = buildProposalFileName(cfg);
  const pdfPath = path.join(productDirectory, fileName);
  return {
    rootDirectory,
    productDirectory,
    productDirectoryName,
    fileName,
    pdfPath,
    irrWorkbookPath: buildIrrWorkbookPath(pdfPath),
    irrSummaryImagePath: buildIrrSummaryImagePath(pdfPath),
  };
}

export function buildSavingsAnalysisPath(cfg) {
  const output = resolveProposalOutput({
    ...cfg,
    withdrawalPlan: { enabled: false },
  });
  const parsed = path.parse(output.pdfPath);
  return path.join(parsed.dir, `${parsed.name}_大单储蓄分析书.pdf`);
}

export function buildIrrWorkbookPath(pdfPath) {
  const parsed = path.parse(pdfPath);
  return path.join(parsed.dir, `${parsed.name}_IRR表.xlsx`);
}

export function buildIrrSummaryImagePath(pdfPath) {
  const parsed = path.parse(pdfPath);
  return path.join(parsed.dir, `${parsed.name}_IRR说明图.png`);
}

export function productNameFromProposalFile(fileName) {
  const parsed = path.parse(fileName);
  const separator = parsed.name.indexOf('_');
  if (separator <= 0) {
    throw new Error(`无法从文件名识别产品名：${fileName}`);
  }
  return sanitizePathSegment(parsed.name.slice(0, separator));
}
