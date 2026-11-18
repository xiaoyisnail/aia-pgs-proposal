import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { execFile, spawnSync } from 'node:child_process';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groupTextRows } from './irr-report.mjs';
import { toSimplified } from './proposal-files.mjs';
import { renderCriticalIllnessComparison } from './critical-illness-comparison-image.mjs';
import { parsePhotoOcr, validatePhotoData } from './photo-comparison-data.mjs';

const NUMBER = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
const numeric = value => Number(value.replaceAll(',', ''));
const compact = value => toSimplified(value).replace(/\s+/g, '');
const approximately = (a, b, tolerance = 0.011) => Math.abs(a - b) <= tolerance;

function requireField(condition, code, message) {
  if (!condition) throw new Error(`COMPARE_${code}: ${message}`);
}

async function readPages(pdfPath) {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(pdfPath)) });
  try {
    const pdf = await task.promise;
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const cells = groupTextRows((await page.getTextContent()).items)
        .map(row => row.cells.map(cell => cell.text));
      pages.push({ cells, text: compact(cells.flat().join('')) });
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

function numericRows(pages, columnCount) {
  return pages.flatMap(page => page.cells)
    .filter(cells => cells.length === columnCount && cells.every(cell => NUMBER.test(cell)))
    .map(cells => cells.map(numeric));
}

function verifySchedule(rows, age, term, name, ageAtStart = false) {
  requireField(Number.isInteger(age) && age >= 0 && age < 100 && rows.length >= term && term > 0,
    'SCHEDULE_INVALID', `${name}缺少完整的受保年龄、缴费年期或逐年利益表`);
  let cumulative = 0;
  for (const [i, row] of rows.entries()) {
    cumulative += row.premium;
    requireField(row.year === i + 1 && row.age === age + row.year - Number(ageAtStart)
      && approximately(row.paid, cumulative, row.rounding ?? 0.011),
    'SCHEDULE_INVALID', `${name}逐年数据或累计保费在第 ${i + 1} 年不一致`);
  }
}

export function parseHongKongComparison(pages) {
  const cover = pages[0];
  const planRow = cover.cells.find(row => /^计划[：:]/.test(compact(row.join(' '))));
  const product = planRow && compact(planRow.join('')).replace(/^计划[：:]/, '')
    .replace(/^AIA健康系列[：:]/, '').replace(/[「」]/g, '')
    .replace(/[（(]\d+年缴费[）)]$/, '');
  const currencyText = cover.text.match(/保单货币[：:]?(美元|美金|USD|港元|港币|HKD)/i)?.[1];
  requireField(product && currencyText && /友邦保险/.test(cover.text),
    'HK_SUMMARY_MISSING', '香港 PDF 需要友邦重疾计划书首页及明确的美元或港元标识');
  const currency = /港|HKD/i.test(currencyText) ? '港元' : '美元';
  const start = cover.cells.findIndex(row => /基本保单/.test(compact(row.join(''))));
  const end = cover.cells.findIndex((row, index) =>
    index > start && /附加契约/.test(compact(row.join(''))));
  const entries = cover.cells.slice(start + 1, end < 0 ? undefined : end);
  const baseRow = start >= 0 && entries.find(row =>
    row.length === 5 && row.slice(1, 4).every(cell => NUMBER.test(cell)));
  const profileMatch = cover.text.match(/年龄[：:](\d+).*?性别[：:]([男女])/);
  requireField(baseRow && profileMatch, 'HK_SUMMARY_MISSING', '香港 PDF 缺少投保年龄或基本保单金额列');
  const [, baseText, premiumText, termText] = baseRow;
  const base = numeric(baseText);
  const annual = numeric(premiumText);
  const term = numeric(termText);
  const age = Number(profileMatch[1]);
  requireField(base > 0 && annual > 0 && Number.isInteger(term), 'HK_SUMMARY_INVALID', '香港摘要金额或缴费年期无效');
  const upgradeRow = entries.find(row =>
    /升级保障/.test(compact(row[0])) && NUMBER.test(row[1]) && NUMBER.test(row.at(-1)));
  const upgrade = upgradeRow && {
    amount: numeric(upgradeRow[1]),
    label: `首 ${numeric(upgradeRow.at(-1))} 个保单年度额外保障 ${(numeric(upgradeRow[1]) / base * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`,
  };

  const detailed = pages.filter(page =>
    /详细说明/.test(page.text) && /退保发还金额.*严重疾病赔偿.*身故赔偿/.test(page.text)
    && page.text.includes('(A)+(B)(C)(D)(C)+(D)'));
  const rows = numericRows(detailed, 9).map(row => {
    const [endAge, year, paid, guaranteed, bonus, surrender, claimBase, claimBonus, claim] = row;
    requireField(approximately(guaranteed + bonus, surrender, 1)
      && approximately(claimBase + claimBonus, claim, 1), 'HK_TOTAL_MISMATCH', `香港第 ${year} 年金额总计不一致`);
    return { age: endAge, year, paid, premium: year <= term ? annual : 0, surrender, claim, rounding: 1 };
  });
  verifySchedule(rows, age, term, '香港');
  const withTenClaims = pages.some(page => /10X多重危疾赔偿下.*?最多可获10次/i.test(page.text));
  return {
    product, currency, base, age, term, rows, upgrade,
    profile: `${age} 岁${profileMatch[2]}性${cover.text.includes('非吸烟者') ? ' · 非吸烟' : ''}`,
    claimLabel: '危疾／身故赔偿总额',
    multi: withTenClaims ? '指定疾病合计最多额外 10 次' : '详见计划书',
  };
}

export function parseMainlandComparison(pages) {
  const text = pages.map(page => page.text).join('');
  const product = text.match(/《(友邦[^《》]{1,40}?)终身寿险[（(]分红型[）)]》/)?.[1];
  const description = text.match(/基本保险金额与主险相等[，,]为([\d,.]+)(万元|元)/)
    || text.match(/基本保险金额[：:]([\d,.]+)(万元|元)/);
  const insured = text.match(/(女士|先生)(\d+)(?:周)?岁[，,]/);
  const explicitAge = text.match(/(?:投保年龄|被保险人年龄)[：:](\d+)(?:周)?岁/);
  const explicitGender = text.match(/性别[：:]([男女])/);
  const age = Number(insured?.[2] ?? explicitAge?.[1]);
  const gender = insured ? (insured[1] === '女士' ? '女' : '男') : explicitGender?.[1];
  const term = Number(text.match(/(?:交费期间|缴费年期)[：:]?(\d+)年/)?.[1]);
  const base = description ? numeric(description[1]) * (description[2] === '万元' ? 10_000 : 1) : NaN;
  const bonusTable = pages.filter(page =>
    page.text.includes('红利利益演示保证利益演示')
    && page.text.includes('累计保险费')
    && page.text.includes('总身故保'));
  requireField(product && base > 0 && /人民币/.test(text) && bonusTable.length,
    'CN_LAYOUT_UNSUPPORTED', '内地 PDF 需含友邦方案摘要、人民币及可识别的重疾组合红利利益表');
  requireField(/被保险人年龄.{0,40}保单年度初/.test(text),
    'CN_AGE_CONVENTION_UNKNOWN', '内地利益表缺少年龄时点说明，无法核对年末年龄');
  const rows = numericRows(bonusTable, 18).map(row => {
    const [year, startAge, premium, paid, , , death, claim, surrender, , claimBonus, cashBonus,
      guaranteedDeath, guaranteedClaim, guaranteedCash] = row;
    requireField(approximately(guaranteedCash + cashBonus, surrender, 1)
      && approximately(guaranteedClaim + claimBonus, claim, 1)
      && approximately(guaranteedDeath + claimBonus, death, 1),
    'CN_TOTAL_MISMATCH', `内地第 ${year} 年红利利益总额不一致`);
    return { age: startAge, year, premium, paid, surrender, claim };
  });
  verifySchedule(rows, age, term, '内地', true);
  requireField(rows.findLastIndex(row => row.premium > 0) + 1 === term,
    'CN_TERM_MISMATCH', '内地利益表中的缴费年度与摘要不一致');
  return {
    product, currency: '元', age, term, base, rows,
    profile: `${age} 岁${gender ? `${gender}性` : ''}`,
    claimLabel: '重度疾病／全残保险金总额',
    multi: /重度疾病保险金给付以一次为限/.test(text)
      ? '表列重度疾病保险金限赔一次' : '详见计划书',
  };
}

async function readMainlandPhoto(image, dataPath) {
  await fs.access(image);
  if (dataPath) {
    let data;
    try { data = JSON.parse(await fs.readFile(dataPath, 'utf8')); }
    catch { throw new Error('PHOTO_DATA_INVALID: 图片取数文件不是可读取的 JSON'); }
    return validatePhotoData(data);
  }
  if (process.platform !== 'darwin' || spawnSync('xcode-select', ['-p'], { stdio: 'ignore' }).status !== 0) {
    throw new Error('PHOTO_OCR_UNAVAILABLE: 当前系统无本地 Vision OCR，请让支持图片输入的 Agent 按 references/photo-comparison.md 取数，并用 --data 接续');
  }
  let ocr;
  try {
    const script = fileURLToPath(new URL('./read-mainland-photo.swift', import.meta.url));
    const { stdout } = await promisify(execFile)('swift', [script, image], { timeout: 45_000 });
    ocr = JSON.parse(stdout);
  } catch {
    throw new Error('PHOTO_OCR_LAYOUT: 本地 OCR 无法读取该图片，请提供完整高清原图或让 Agent 读图后用 --data 接续');
  }
  return parsePhotoOcr(ocr);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { fx: { type: 'string' }, output: { type: 'string' }, data: { type: 'string' },
      'multiple-from': { type: 'string' }, 'no-estimate': { type: 'boolean' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log('npm run compare:ci -- --fx 6.66 [--output "对比表.png"] "香港计划书.pdf" "内地计划书.pdf或图片"\n同时在对比表旁输出保额和退保发还金额柱状图。图片模式可用 --multiple-from 35、--data 或 --no-estimate。');
    return;
  }
  const rate = Number(values.fx);
  requireField(/^\d+(?:\.\d+)?$/.test(values.fx || '') && Number.isFinite(rate) && rate > 0,
    'FX_REQUIRED', '用 --fx 指定 1 单位香港保单货币折合的人民币金额');
  const photo = /\.(jpg|jpeg|png|webp)$/i.test(positionals[1] || '');
  requireField(positionals.length === 2 && /\.pdf$/i.test(positionals[0]) && (photo || /\.pdf$/i.test(positionals[1])),
    'INPUT_REQUIRED', '依次提供香港友邦重疾险 PDF 和内地友邦重疾险 PDF 或图片（PNG/JPEG/WebP）');
  requireField(photo || (!values.data && !values['multiple-from'] && !values['no-estimate']), 'PHOTO_ONLY_OPTIONS', '图片选项不能用于两份 PDF 模式');
  const multipleFrom = Number(values['multiple-from'] ?? 35);
  requireField(Number.isInteger(multipleFrom) && multipleFrom >= 1 && multipleFrom <= 100,
    'MULTIPLE_FROM_INVALID', '红字起始保单年度须为 1–100 的整数');
  const [hkPath, cnPath] = positionals.map(file => path.resolve(file));
  const output = path.resolve(values.output || path.join(path.dirname(hkPath), `${path.parse(hkPath).name}_${photo ? '内地图片估算对比' : '港内地重疾险对比'}.png`));
  requireField(/\.png$/i.test(output), 'OUTPUT_INVALID', '输出文件必须以 .png 结尾');
  const [hongKong, mainland] = await Promise.all([
    readPages(hkPath).then(parseHongKongComparison),
    photo ? readMainlandPhoto(cnPath, values.data) : readPages(cnPath).then(parseMainlandComparison),
  ]);
  const files = await renderCriticalIllnessComparison({ hongKong, mainland, rate, photo, multipleFrom, estimateMissing: !values['no-estimate'] }, output);
  console.log(`CRITICAL_ILLNESS_COMPARISON_OK ${output}`);
  console.log(`保额柱状图：${files.claim}\n退保发还金额柱状图：${files.surrender}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
