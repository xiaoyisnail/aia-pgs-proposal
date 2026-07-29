import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCashFlows,
  buildIrrSummaryModel,
  buildWithdrawalCashFlows,
  buildWithdrawalSummaryModel,
  calculateIrr,
  parseDetailedRowCells,
  parseWithdrawalRowCells,
} from '../scripts/irr-report.mjs';

test('逐年表格行提取退保发还金额总额', () => {
  const row = parseDetailedRowCells([
    '8', '5', '250,000', '70,697', '12,636', '34,121',
    '117,454', '262,500', '12,636', '34,121', '117,454', '262,500',
  ]);
  assert.deepEqual(row, {
    age: 8,
    policyYear: 5,
    paidPremiumTotal: 250000,
    surrenderValueTotal: 117454,
    lifeCoverageTotal: 262500,
  });
});

test('期初缴费现金流和 IRR 计算正确', () => {
  assert.deepEqual(buildCashFlows(2, 100, 2, 231), [-100, -100, 231]);
  assert.ok(Math.abs(calculateIrr([-100, -100, 231]) - 0.1) < 1e-10);
  assert.ok(Math.abs(calculateIrr([-100, 110]) - 0.1) < 1e-10);
});

test('没有正负现金流时 IRR 为空', () => {
  assert.equal(calculateIrr([-100, 0]), null);
  assert.equal(calculateIrr([0, 100]), null);
});

test('长期高额退保价值不会因 NPV 溢出漏算 IRR', () => {
  const irr = calculateIrr(buildCashFlows(97, 50000.09, 5, 99511755));
  assert.notEqual(irr, null);
  assert.ok(irr > 0.06 && irr < 0.07);
});

test('IRR 说明图使用回本年、十年节点和最后年度', () => {
  const rows = Array.from({ length: 30 }, (_, index) => {
    const policyYear = index + 1;
    return {
      age: policyYear + 3,
      policyYear,
      paidPremiumTotal: Math.min(policyYear, 2) * 100,
      surrenderValueTotal: policyYear < 3 ? policyYear * 80 : 220 * (1.05 ** (policyYear - 3)),
    };
  });
  const model = buildIrrSummaryModel({
    productName: '環宇盈活',
    currency: '美元',
    annualPremium: 100,
    premiumTerm: 2,
    rows,
    sourcePages: [10, 11],
  }, '/tmp/環宇盈活_不提取.pdf');
  assert.equal(model.title, '香港友邦储蓄保险计划');
  assert.equal(model.insuredAge, 3);
  assert.equal(model.totalPremium, 200);
  assert.equal(model.breakEvenRow.policyYear, 3);
  assert.deepEqual(model.tableRows.map(row => row.policyYear), [3, 20, 30]);
  assert.equal(model.irrMilestones.length, 5);
});

test('提领后逐年表提取现金提取和退保发还总额', () => {
  const row = parseWithdrawalRowCells([
    '9', '6', '250,000', '5,000', '512,296',
    '93,238', '12,833', '108,702', '214,773',
  ]);
  assert.deepEqual(row, {
    age: 9,
    policyYear: 6,
    paidPremiumTotal: 250000,
    withdrawalAmount: 5000,
    basicAmountAfterWithdrawal: 512296,
    surrenderValueAfterWithdrawal: 214773,
  });
});

test('提领说明图使用整十年度并计算累计提取和综合 IRR', () => {
  const withdrawalRows = Array.from({ length: 30 }, (_, index) => {
    const policyYear = index + 1;
    return {
      age: policyYear + 3,
      policyYear,
      paidPremiumTotal: Math.min(policyYear, 2) * 100,
      withdrawalAmount: policyYear >= 3 ? 10 : 0,
      basicAmountAfterWithdrawal: 500,
      surrenderValueAfterWithdrawal: 180 * (1.05 ** Math.max(0, policyYear - 2)),
    };
  });
  const model = buildWithdrawalSummaryModel({
    currency: '美元',
    annualPremium: 100,
    premiumTerm: 2,
    rows: withdrawalRows.map(row => ({
      age: row.age,
      policyYear: row.policyYear,
    })),
    withdrawalRows,
    withdrawalSourcePages: [19, 20],
  }, '/tmp/环宇盈活_提取.pdf');
  assert.equal(model.variant, 'withdrawal');
  assert.equal(model.title, '香港友邦储蓄保险计划');
  assert.equal(model.insuredAge, 3);
  assert.equal(model.startPolicyYear, 3);
  assert.equal(model.endPolicyYear, 30);
  assert.equal(model.totalWithdrawals, 280);
  assert.deepEqual(model.tableRows.map(row => row.policyYear), [10, 20, 30]);
  assert.deepEqual(
    buildWithdrawalCashFlows(3, 100, 2, withdrawalRows, 250),
    [-100, -100, 0, 260],
  );
  assert.notEqual(model.finalIrr, null);
});
