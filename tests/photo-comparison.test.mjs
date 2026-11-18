import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { alignPhotoComparison, parsePhotoOcr } from '../scripts/photo-comparison-data.mjs';
import { buildComparisonHtml } from '../scripts/critical-illness-comparison-image.mjs';

const word = (text, x = 0, y = 0) => ({ text, x, y });
const pair = (age, guaranteed, total, x) => [word(`${age}周岁`, x, 100),
  word(`${guaranteed}万`, x - 25, 62), word(`${total}万`, x + 25, 50)];

function ocrFixture() {
  return {
    title: ['传世', '盈如意', '顺心珍藏', '女士', '30周岁', '18年交（主险交费期间）', '年交保费1.8万', '组合保费'].map(text => word(text)),
    claim: [word('高额重疾保障'), word('基本保额20万'), word('特别保障保险金10万'),
      word('保障加码至65周岁'), word('红利利益演示重度疾病保险金'),
      ...pair(30, 30, 30, 100), ...pair(64, 30, 40, 250), ...pair(65, 20, 30.5, 400), ...pair(90, 20, 45, 550)],
    surrender: [word('总退保金（总现金价值）'),
      ...pair(30, 0.15, 0.15, 100), ...pair(64, 4, 8, 270), ...pair(80, 8, 15, 440), ...pair(100, 12, 20, 610)],
  };
}

const hk = { age: 30, term: 18, base: 30_000, product: '测试计划', currency: '美元',
  claimLabel: '危疾／身故赔偿总额', profile: '30 岁女性', multi: '详见计划书',
  rows: Array.from({ length: 70 }, (_, i) => ({ year: i + 1, age: i + 31, premium: i < 18 ? 1000 : 0,
    paid: Math.min(i + 1, 18) * 1000, surrender: (i + 1) * 1000, claim: (i + 1) * 2000 })) };

test('maps the right-hand dividend values to their own age axes and keeps disclosed amounts', () => {
  const fixture = ocrFixture();
  fixture.surrender = fixture.surrender.filter(w => w.text !== '4万');
  const model = parsePhotoOcr(fixture);
  assert.deepEqual(model.surrender.map(w => w.age), [30, 64, 80, 100]);
  assert.deepEqual(model.surrender.map(w => w.amount), [1500, 80000, 150000, 200000]);
  assert.deepEqual(model.claim.map(w => w.amount), [300000, 400000, 305000, 450000]);
});

test('rejects an unreadable projected bar and a reversed projected value instead of inventing an anchor', () => {
  const missing = ocrFixture();
  missing.surrender = missing.surrender.filter(w => w.text !== '15万');
  assert.throws(() => parsePhotoOcr(missing), /PHOTO_OCR_BAR_POSITION.*80周岁/);
  const reversed = ocrFixture();
  reversed.claim.find(w => w.text === '30.5万').text = '15万';
  assert.throws(() => parsePhotoOcr(reversed), /PHOTO_OCR_SERIES.*65周岁/);
});

test('interpolates separate series and does not smooth the special benefit across its cutoff', () => {
  const model = parsePhotoOcr(ocrFixture());
  model.claim[1] = { age: 63, amount: 390_000 };
  const rows = alignPhotoComparison(hk, model);
  const at = age => rows.find(({ hk: row }) => row.age === age);
  assert.deepEqual(at(64).surrender, { amount: 80_000, estimated: false });
  assert.deepEqual(at(64).claim, { amount: 398_000, estimated: true });
  assert.deepEqual(at(65).claim, { amount: 305_000, estimated: false });
  assert.equal(at(65).surrender.estimated, true);
  assert.deepEqual(at(100).claim, { amount: 508_000, estimated: true });
  assert.equal(at(30), undefined);
  assert.throws(() => alignPhotoComparison(hk, { ...model, surrender: [model.surrender[0], model.surrender[0]] }), /PHOTO_ANCHORS/);
  const disclosedOnly = alignPhotoComparison(hk, model, { estimateMissing: false });
  assert.deepEqual(disclosedOnly.find(({ hk: row }) => row.age === 64).claim, { amount: null, estimated: false });
});

test('photo HTML labels estimates and only the ratios that use them, from policy year 35', () => {
  const mainland = parsePhotoOcr(ocrFixture());
  const html = buildComparisonHtml({ hongKong: hk, mainland, rate: 6.66, photo: true });
  const row = year => html.match(new RegExp(`<tr[^>]*>\\s*<th scope="row">第 ${year} 年[\\s\\S]*?</tr>`))[0];
  assert.doesNotMatch(row(34), /class="multiple"/);
  assert.equal((row(35).match(/class="multiple"/g) || []).length, 2);
  assert.equal((row(35).match(/内地估算/g) || []).length, 1);
  assert.match(row(35), /IRR（估算）/);
  assert.match(html, /1,000\.00 美元<\/strong>（约 6,660 元人民币）/);
  assert.match(html, /香港 · 计划书数据/);
  assert.match(html, /内地 · 客户提供的图片数据估算/);
});

test('CLI refuses a photo start year on the strict two-PDF route', () => {
  const script = fileURLToPath(new URL('../scripts/compare-critical-illness.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--fx', '6.66', '--multiple-from', '35', 'hk.pdf', 'cn.pdf'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /COMPARE_PHOTO_ONLY_OPTIONS/);
});
