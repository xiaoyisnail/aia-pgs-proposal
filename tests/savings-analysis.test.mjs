import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLargeSavingsScenarioConfigs,
  buildSavingsAnalysisModel,
  calculateScenarioAnnualAmount,
  qualifiesForLargeSavingsAnalysis,
} from '../scripts/savings-analysis.mjs';

function buildBaselineData() {
  return {
    productName: '環宇盈活',
    currency: '美元',
    annualPremium: 100000,
    premiumTerm: 5,
    hasWithdrawalPlan: false,
    rows: Array.from({ length: 100 }, (_, index) => {
      const policyYear = index + 1;
      return {
        age: policyYear,
        policyYear,
        paidPremiumTotal: Math.min(policyYear, 5) * 100000,
        surrenderValueTotal: 500000 * (1.06 ** policyYear),
        lifeCoverageTotal: 550000 * (1.06 ** policyYear),
      };
    }),
  };
}

function buildWithdrawalData(startPolicyYear, annualAmount) {
  const baseline = buildBaselineData();
  return {
    ...baseline,
    hasWithdrawalPlan: true,
    withdrawalRows: baseline.rows.map(row => ({
      age: row.age,
      policyYear: row.policyYear,
      paidPremiumTotal: row.paidPremiumTotal,
      withdrawalAmount: row.policyYear >= startPolicyYear ? annualAmount : 0,
      basicAmountAfterWithdrawal: 500000,
      surrenderValueAfterWithdrawal: 400000 * (1.04 ** row.policyYear),
    })),
  };
}

const baseConfig = {
  productType: 'savings',
  productName: '環宇盈活',
  insuredSurname: 'VIP',
  insuredGivenName: '',
  annualPremium: 100000,
  premiumTerm: 5,
  currency: '美元',
};

test('美元年缴达到五万时进入大单储蓄流程', () => {
  assert.equal(qualifiesForLargeSavingsAnalysis({
    productType: 'savings',
    annualPremium: 50000,
    currency: '美元',
  }), true);
  assert.equal(qualifiesForLargeSavingsAnalysis({
    productType: 'savings',
    annualPremium: 49999,
    currency: '美元',
  }), false);
  assert.equal(qualifiesForLargeSavingsAnalysis({
    productType: 'criticalIllness',
    annualPremium: 100000,
    currency: '美元',
  }), false);
});

test('五档提领金额按不提领计划书实际总保费比例计算', () => {
  assert.equal(calculateScenarioAnnualAmount(500000, 0.064), 32000);
  const configs = buildLargeSavingsScenarioConfigs(baseConfig, 500000);
  assert.deepEqual(
    configs.map(config => ({
      start: config.withdrawalPlan.startPolicyYear,
      amount: config.withdrawalPlan.annualAmount,
      ratio: config.analysisScenario.totalPremiumRatio,
      role: config.largeSavingsBatchRole,
    })),
    [
      { start: 6, amount: 32000, ratio: 0.064, role: 'withdrawal' },
      { start: 11, amount: 44000, ratio: 0.088, role: 'withdrawal' },
      { start: 15, amount: 58000, ratio: 0.116, role: 'withdrawal' },
      { start: 20, amount: 81000, ratio: 0.162, role: 'withdrawal' },
      { start: 25, amount: 110000, ratio: 0.22, role: 'withdrawal' },
    ],
  );
});

test('分析模型只汇总五份同额提领计划书的真实逐年数据', () => {
  const baselineData = buildBaselineData();
  const configs = buildLargeSavingsScenarioConfigs(baseConfig, 500000);
  const withdrawalEntries = configs.map(config => ({
    config,
    data: buildWithdrawalData(
      config.withdrawalPlan.startPolicyYear,
      config.withdrawalPlan.annualAmount,
    ),
  }));
  const model = buildSavingsAnalysisModel({
    baseConfig,
    baselineData,
    withdrawalEntries,
  });
  assert.equal(model.productName, '環宇盈活');
  assert.equal(model.usesReferenceFeaturePanel, true);
  assert.equal(model.insuredAge, 0);
  assert.equal(model.totalPremium, 500000);
  assert.equal(model.scenarios.length, 5);
  assert.deepEqual(
    model.scenarios.map(scenario => scenario.totalWithdrawals),
    [3040000, 3960000, 4988000, 6561000, 8360000],
  );
  assert.deepEqual(
    model.legacyRows.map(row => row.label),
    ['30年', '70岁', '80岁', '90岁', '100岁'],
  );
});
