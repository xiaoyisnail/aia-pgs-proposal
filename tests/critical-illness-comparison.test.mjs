import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { parseHongKongComparison, parseMainlandComparison } from '../scripts/compare-critical-illness.mjs';
import { findChromeExecutable } from '../scripts/runtime-platform.mjs';
import {
  buildComparisonBarHtml, buildComparisonHtml, comparisonBarRows, comparisonImagePaths,
  comparisonMultiple, comparisonYears, renderCriticalIllnessComparison,
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
  assert.deepEqual(comparisonYears(youngPlan, youngPlan).slice(-3), [90, 95, 99]);
  const adultPlan = { age: 28, rows: Array(80) };
  assert.deepEqual(comparisonYears(adultPlan, adultPlan), [10, 20, 30, 35, 40, 45, 50, 55, 60, 65, 70, 72]);
  const html = buildComparisonHtml({ hongKong: hk, mainland: cn, rate: 6.6 });
  assert.match(html, /指定汇率 1 美元 = 6\.6 元人民币/);
  assert.match(html, /32 岁/);
  assert.match(html, /33 岁/);
  assert.doesNotMatch(html, /class="multiple"/);
});

test('strict PDF rendering hides product names and both charts use the same year and separate premium cash flows', () => {
  const hongKong = parseHongKongComparison(hongKongFixture());
  const mainland = parseMainlandComparison(mainlandFixture());
  const model = { hongKong, mainland, rate: 6.6 };
  const rows = comparisonBarRows(model);
  const solve = (first, second, refund) => (-second + Math.sqrt(second ** 2 + 4 * first * refund)) / (2 * first) - 1;
  assert.deepEqual(rows.map(({ year, hkAge, cnAge }) => [year, hkAge, cnAge]), [[2, 32, 33]]);
  assert.deepEqual(rows[0].surrender, { hk: 1386, cn: 550, estimated: false, multiple: '' });
  assert.ok(Math.abs(rows[0].hkIrr - solve(220, 220, 210)) < 1e-9);
  assert.ok(Math.abs(rows[0].cnIrr - solve(350, 300, 550)) < 1e-9);
  const documents = [buildComparisonHtml(model), ...['claim', 'surrender'].map(metric => buildComparisonBarHtml(model, rows, metric))];
  for (const html of documents) {
    assert.ok(!html.includes(hongKong.product) && !html.includes(mainland.product));
    assert.match(html, /香港方案[\s\S]*内地方案/);
  }
  assert.match(documents[1], /32／33 岁/);
  assert.match(documents[1], /香港 30岁女性／内地 31岁女性 · 基本保额：香港约 132,000 元／内地 20,000 元人民币/);
  assert.match(documents[1], /不是保额收益率/);
  for (const html of documents.slice(1)) {
    assert.doesNotMatch(html, /金额含非保证利益|class="bar-estimated"|内地 IRR（估算）/);
    assert.match(html, /内地退保 IRR/);
  }
});

test('latest charts select the closest eligible ratio per metric without duplicating nodes or dropping estimates', async t => {
  const model = {
    hongKong: { age: 32, profile: '32 岁女性', term: 20, currency: '美元', base: 60_000 },
    mainland: { age: 32, gender: '女', term: 20, base: 400_000 }, rate: 6.65, photo: true,
  };
  const rows = Array.from({ length: 16 }, (_, i) => {
    const metric = (ratio, estimated) => ({ hk: ratio * 100_000, cn: 100_000, estimated,
      multiple: i >= 3 ? comparisonMultiple(i + 32, ratio * 100_000, 100_000, 1, 35) : '' });
    return { year: i + 32, hkAge: i + 64, cnAge: i + 64, hkIrr: .032, cnIrr: -.015,
      claim: metric(i === 2 ? 5 : i === 12 ? 4.98 : i >= 13 ? 10 : 2, false),
      surrender: metric(i === 10 ? 5.03 : i >= 11 ? 9 : 2.5, i === 10) };
  });
  const claim = buildComparisonBarHtml(model, rows, 'claim');
  const surrender = buildComparisonBarHtml(model, rows, 'surrender');
  assert.match(claim, /data-year="44">\s*<rect[^>]*>\s*<text[^>]*>约为内地方案的 4\.98 倍<\/text>/);
  assert.match(surrender, /data-year="42">\s*<rect[^>]*>\s*<text[^>]*>约为内地方案的 5\.03 倍（估）<\/text>/);
  assert.doesNotMatch(claim, /class="callout" data-year="34"/);
  const firstOnly = buildComparisonBarHtml(model, rows.slice(0, 4), 'claim');
  assert.equal((firstOnly.match(/class="callout" data-year="35"/g) || []).length, 1);
  for (const html of [claim, surrender]) {
    assert.match(html, /32岁女性 · 两地保额均为40w人民币/);
    assert.match(html, /基本保额按人民币万元取整/);
  }
  const executablePath = findChromeExecutable();
  if (!executablePath) return t.diagnostic('Chrome missing; SVG layout check skipped');
  const browser = await chromium.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1640, height: 1100 } });
  for (const html of [claim, surrender]) {
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.locator('.plot').evaluate(svg => {
      const bounds = selector => [...svg.querySelectorAll(selector)].map(el => el.getBBox());
      const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x
        && a.y < b.y + b.height && a.y + a.height > b.y;
      const labels = bounds('.callout rect'), bars = bounds('[class^="bar-"]');
      return {
        collisions: labels.some((label, i) => [...labels.slice(i + 1), ...bars].some(box => overlap(box, label))),
        firstIrrCollision: overlap(bounds('.strip-label').at(-1), bounds('.cn-value')[1]),
        valueFont: getComputedStyle(svg.querySelector('.hk-value')).fontSize,
      };
    });
    assert.deepEqual(layout, { collisions: false, firstIrrCollision: false, valueFont: '18px' });
  }
});

test('all three output filenames are checked before overwriting any existing image', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'compare-ci-test-'));
  t.after(() => fs.rm(dir, { recursive: true }));
  const files = comparisonImagePaths(path.join(dir, '对比表.png'));
  assert.equal(path.basename(files.claim), '对比表_保额柱状图.png');
  assert.equal(path.basename(files.surrender), '对比表_退保发还金额柱状图.png');
  await fs.writeFile(files.surrender, 'existing fixture');
  await assert.rejects(renderCriticalIllnessComparison({}, files.table), /COMPARE_OUTPUT_EXISTS/);
  assert.deepEqual(await fs.readdir(dir), [path.basename(files.surrender)]);
  assert.equal(await fs.readFile(files.surrender, 'utf8'), 'existing fixture');
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
