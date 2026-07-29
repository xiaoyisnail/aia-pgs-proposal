import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  buildSavingsAnalysisPath,
  buildProposalFileName,
  resolveProposalOutput,
  toSimplified,
} from '../scripts/proposal-files.mjs';

test('香港繁体产品名转换为简体', () => {
  assert.equal(toSimplified('環宇盈活'), '环宇盈活');
  assert.equal(toSimplified('簡緻愛伴航'), '简致爱伴航');
});

test('储蓄险文件名和产品目录使用简体', () => {
  const cfg = {
    productType: 'savings',
    productName: '環宇盈活',
    gender: '男',
    age: 3,
    region: '中華人民共和國',
    annualPremium: 50000,
    currency: '美元',
    premiumTerm: 5,
    withdrawalPlan: { enabled: false },
    outputDir: '/tmp/proposals',
  };
  assert.equal(
    buildProposalFileName(cfg),
    '环宇盈活_男3岁_大陆_USD50000每年_5年缴_不提取.pdf',
  );
  const output = resolveProposalOutput(cfg);
  assert.equal(output.productDirectory, path.resolve('/tmp/proposals/环宇盈活'));
  assert.equal(
    output.irrWorkbookPath,
    path.resolve('/tmp/proposals/环宇盈活/环宇盈活_男3岁_大陆_USD50000每年_5年缴_不提取_IRR表.xlsx'),
  );
  assert.equal(
    output.irrSummaryImagePath,
    path.resolve('/tmp/proposals/环宇盈活/环宇盈活_男3岁_大陆_USD50000每年_5年缴_不提取_IRR说明图.png'),
  );
});

test('储蓄险文件名使用保单货币代码', () => {
  assert.equal(
    buildProposalFileName({
      productType: 'savings',
      productName: '年金寶',
      gender: '女',
      age: 40,
      region: '香港',
      annualPremium: 100000,
      currency: '港幣',
      premiumTerm: 5,
      withdrawalPlan: {
        enabled: true,
        startPolicyYear: 6,
        endPolicyYear: 20,
        annualAmount: 10000,
      },
    }),
    '年金宝_女40岁_香港_HKD100000每年_5年缴_第6至20年每年提取HKD10000_减少基本金额.pdf',
  );
});

test('大单储蓄分析书使用不提取基础文件名', () => {
  const analysisPath = buildSavingsAnalysisPath({
    productType: 'savings',
    productName: '環宇盈活',
    gender: '男',
    age: 3,
    region: '中華人民共和國',
    currency: '美元',
    annualPremium: 50000,
    premiumTerm: 5,
    withdrawalPlan: {
      enabled: true,
      startPolicyYear: 6,
      endPolicyYear: 'last',
      annualAmount: 16000,
    },
    outputDir: '/tmp/aia-proposals',
  });
  assert.equal(
    analysisPath,
    '/tmp/aia-proposals/环宇盈活/环宇盈活_男3岁_大陆_USD50000每年_5年缴_不提取_大单储蓄分析书.pdf',
  );
});
