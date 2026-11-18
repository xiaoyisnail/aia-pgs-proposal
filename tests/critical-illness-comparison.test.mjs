import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseHongKongComparison, parseMainlandComparison } from '../scripts/compare-critical-illness.mjs';
import {
  buildComparisonHtml, comparisonMultiple, comparisonYears,
} from '../scripts/critical-illness-comparison-image.mjs';

function hongKongFixture() {
  return [
    {
      text: '友邦保险年龄：30性别：女非吸烟者保单货币：美元',
      cells: [
        ['計劃：', '測試產品（2 年繳費）'],
        ['基本保單'],
        ['測試產品', '20,000', '220.00', '2', '終身'],
        ['升級保障（首十年）', '10,000', '0.00', '不適用', '10'],
        ['附加契約'],
      ],
    },
    {
      text: '详细说明退保发还金额严重疾病赔偿身故赔偿(A)+(B)(C)(D)(C)+(D)',
      cells: [
        ['31', '1', '220', '100', '10', '110', '30,000', '45', '30,045'],
        ['32', '2', '440', '200', '10', '210', '30,000', '50', '30,050'],
      ],
    },
  ];
}

function mainlandFixture() {
  const rows = [
    ['1', '31', '350', '350', '0', '0', '30,020', '20,020', '220', '0', '20', '5', '30,000', '20,000', '215', '0', '0', '0'],
    ['2', '32', '300', '650', '0', '0', '30,030', '20,030', '550', '0', '30', '10', '30,000', '20,000', '540', '0', '0', '0'],
    ['3', '33', '0', '650', '0', '0', '30,040', '20,040', '700', '0', '40', '15', '30,000', '20,000', '685', '0', '0', '0'],
  ];
  return [
    {
      text: '《友邦测试基础计划终身寿险（分红型）》女士31周岁，基本保险金额与主险相等，为2万元交费期间2年人民币',
      cells: [],
    },
    { text: '红利利益演示保证利益演示累计保险费总身故保', cells: rows },
    { text: '被保险人年龄、当年度保险费和累计保险费中的数值为保单年度初。重度疾病保险金给付以一次为限', cells: [] },
  ];
}

test('香港明细取退保与赔偿总额，首十年保障从基本计划表读取', () => {
  const hk = parseHongKongComparison(hongKongFixture());
  assert.equal(hk.age, 30);
  assert.equal(hk.upgrade.amount, 10_000);
  assert.equal(hk.rows[0].surrender, 110);
  assert.equal(hk.rows[0].claim, 30_045);
  assert.equal(hk.rows.at(-1).paid, 440);
});

test('内地取重疾列及每年实际保费，拒绝断档和不一致的数据', () => {
  const pages = mainlandFixture();
  const plan = parseMainlandComparison(pages);
  assert.equal(plan.age, 31);
  assert.deepEqual(plan.rows.map(row => row.premium), [350, 300, 0]);
  assert.equal(plan.rows[0].claim, 20_020);
  assert.equal(plan.rows[0].surrender, 220);
  pages[1].cells[1][3] = '651';
  assert.throws(() => parseMainlandComparison(pages), /COMPARE_SCHEDULE_INVALID/);
  pages[1].cells.splice(1, 1);
  assert.throws(() => parseMainlandComparison(pages), /COMPARE_SCHEDULE_INVALID/);
});

test('按共同保单年度出图，红字从第 40 年开始并随汇率改变', () => {
  assert.equal(comparisonMultiple(39, 20, 40, 6.6), '');
  assert.equal(comparisonMultiple(40, 20, 40, 6.6), '约为内地方案的 3.30 倍');
  assert.equal(comparisonMultiple(40, 20, 40, 7), '约为内地方案的 3.50 倍');
  assert.equal(comparisonMultiple(40, 20, 0, 7), '');
  const hk = parseHongKongComparison(hongKongFixture());
  const cn = parseMainlandComparison(mainlandFixture());
  assert.deepEqual(comparisonYears(hk, cn), [2]);
  const youngPlan = { age: 1, rows: Array(99) };
  assert.deepEqual(comparisonYears(youngPlan, youngPlan).slice(-3), [80, 90, 99]);
  const html = buildComparisonHtml({ hongKong: hk, mainland: cn, rate: 6.6 });
  assert.match(html, /指定汇率 1 美元 = 6\.6 元人民币/);
  assert.match(html, /32 岁/);
  assert.match(html, /33 岁/);
  assert.doesNotMatch(html, /class="multiple"/);
});

test('CLI 缺少有效换算汇率时在读 PDF 前报错', () => {
  const script = new URL('../scripts/compare-critical-illness.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [
    fileURLToPath(script),
    '--fx', '0', 'missing-hk.pdf', 'missing-cn.pdf',
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /COMPARE_FX_REQUIRED/);
});
