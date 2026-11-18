const fail = (code, message) => { throw new Error(`PHOTO_${code}: ${message}`); };
const requireData = (valid, code, message) => { if (!valid) fail(code, message); };
const positive = value => Number.isFinite(value) && value > 0;
const validAge = age => Number.isInteger(age) && age >= 0 && age <= 120;

export function validatePhotoData(data) {
  requireData(data && typeof data.product === 'string' && data.product.trim().length > 0
    && validAge(data.age) && data.age < 100 && ['女', '男'].includes(data.gender)
    && positive(data.base) && positive(data.annual) && Number.isInteger(data.term) && data.term > 0 && data.term <= 100,
  'SUMMARY', '核对图片上的产品名、受保人年龄和性别、基本保额、组合年缴保费及主险缴费年期');
  requireData(data.special === null || (data.special && positive(data.special.amount)
    && validAge(data.special.endAgeExclusive) && data.special.endAgeExclusive > data.age),
  'SPECIAL', '特别保障：明确不存在则填 null；否则需要金额及不再包含该保障的起始年龄');
  for (const [field, label] of [['surrender', '主险总退保金'], ['claim', '重度疾病保险金']]) {
    const anchors = data[field];
    requireData(Array.isArray(anchors) && anchors.length >= 2 && anchors.every((anchor, i) => anchor
      && validAge(anchor.age) && anchor.age >= data.age && Number.isFinite(anchor.amount) && anchor.amount >= 0
      && (i === 0 || anchor.age > anchors[i - 1].age)),
    'ANCHORS', `核对${label}的已披露红利情景年龄及人民币总额：至少两个年龄，从小到大且不重复`);
  }
  requireData(data.claim.every(({ age, amount }) => amount >= data.base + (age < data.special?.endAgeExclusive ? data.special.amount : 0)),
    'CLAIM_TOTAL', '图片重度疾病总额小于该年龄的基本及特别保障，请核对是否读错图例');
  return data;
}

function estimateAt(anchors, age, estimateMissing, adjustment = () => 0, minimum = 0) {
  const found = anchors.findIndex(point => point.age >= age);
  if (found >= 0 && anchors[found].age === age) return { amount: anchors[found].amount, estimated: false };
  if (!estimateMissing) return { amount: null, estimated: false };
  const i = found < 0 ? anchors.length - 1 : Math.max(1, found);
  const [lo, hi] = anchors.slice(i - 1, i + 1);
  // Do not extend a slope across a known benefit transition.
  if ((age < lo.age || age > hi.age) && (adjustment(lo.age) !== adjustment(hi.age)
    || adjustment(age) !== adjustment(lo.age))) return { amount: null, estimated: false };
  const y0 = lo.amount - adjustment(lo.age);
  const y1 = hi.amount - adjustment(hi.age);
  const value = y0 + (y1 - y0) * (age - lo.age) / (hi.age - lo.age) + adjustment(age);
  const floor = minimum + adjustment(age);
  const step = value >= 1_000 ? 1_000 : 1;
  return value < floor ? { amount: null, estimated: false }
    : { amount: Math.max(floor, Math.round(value / step) * step), estimated: true };
}

export function comparisonMilestones(lastYear) {
  const years = [10, 20].filter(year => year < lastYear);
  for (let year = 30; year < lastYear; year += 5) years.push(year);
  return [...years, lastYear];
}

export function alignPhotoComparison(hongKong, data, { estimateMissing = true } = {}) {
  const cn = validatePhotoData(data);
  const lastAge = Math.min(hongKong.rows.at(-1).age, 100);
  const special = age => age < cn.special?.endAgeExclusive ? cn.special.amount : 0;
  const comparable = hongKong.rows.filter(row => row.age > cn.age && row.age <= lastAge);
  requireData(comparable.length, 'AGE_ALIGNMENT', '两份资料没有可对照的年龄节点');
  const years = new Set(comparisonMilestones(comparable.at(-1).year));
  return comparable.filter(row => years.has(row.year)).map(hk => ({
    hk, cnYear: hk.age - cn.age, surrender: estimateAt(cn.surrender, hk.age, estimateMissing),
    claim: estimateAt(cn.claim, hk.age, estimateMissing, special, cn.base),
  }));
}

function yuan(text) { return Math.round(Number(text) * 10_000); }
const OCR_NUMBER = /^(\d+(?:[.．]\d+)?)\s*万$/;

function chartAnchors(words, label, requireGuarantee = true) {
  const ages = words.filter(word => /^\d{1,3}周岁$/.test(word.text)).sort((a, b) => a.x - b.x);
  requireData(ages.length >= 3 && Math.max(...ages.map(w => w.y)) - Math.min(...ages.map(w => w.y)) <= 14,
    'OCR_AXIS', `无法核对${label}的整条年龄轴`);
  const numbers = words.filter(word => OCR_NUMBER.test(word.text) && word.y < ages[0].y - 15);
  const spacing = Math.min(...ages.slice(1).map((w, i) => w.x - ages[i].x));
  requireData(spacing >= 75 && numbers.length >= ages.length && numbers.length <= ages.length * 2,
    'OCR_BAR_COUNT', `无法把${label}的金额一一对应到保证值和红利值（识别到 ${numbers.length} 个金额、${ages.length} 个年龄）`);
  return ages.map(({ text, x }) => {
    const left = numbers.filter(w => w.x < x && x - w.x < spacing / 2);
    const right = numbers.filter(w => w.x >= x && w.x - x < spacing / 2);
    requireData(right.length === 1 && left.length <= 1 && (!requireGuarantee || left.length === 1),
      'OCR_BAR_POSITION', `${label}：${text}的红利柱或保证柱无法确认`);
    const value = word => yuan(word.text.match(OCR_NUMBER)[1].replace('．', '.'));
    const [guaranteed, amount] = [left.length ? value(left[0]) : null, value(right[0])];
    requireData(guaranteed === null || amount >= guaranteed, 'OCR_SERIES', `${label}：${text}的红利总额小于保证值`);
    return { age: parseInt(text), amount, guaranteed };
  });
}

export function parsePhotoOcr({ title, claim, surrender }) {
  const clean = words => words.map(w => ({ ...w, text: w.text.replace(/\s+/g, '') }));
  const [titleWords, claimWords, cashWords] = [title, claim, surrender].map(clean);
  const joined = words => words.map(w => w.text).join('|');
  const heading = joined(titleWords);
  const benefits = joined(claimWords);
  requireData(['传世', '盈如意', '顺心珍藏'].every(word => heading.includes(word))
    && /高额重疾保障/.test(benefits) && /红利利益演示重度疾病保险金/.test(benefits)
    && /总退保金/.test(joined(cashWords)),
  'OCR_LAYOUT', '当前本地 OCR 只自动识别完整版「传世盈如意顺心珍藏」双柱图；其他版式请用 Agent 读图');
  const ages = titleWords.filter(w => /^\d{1,3}周岁$/.test(w.text));
  const gender = heading.includes('女士') && !heading.includes('先生') ? '女'
    : heading.includes('先生') && !heading.includes('女士') ? '男' : '';
  const term = Number(heading.match(/(\d+)年交[（(]主险交费期间[）)]/)?.[1]);
  const annual = yuan(heading.match(/年交保费\s*([\d.]+)万/)?.[1]);
  const base = yuan(benefits.match(/基本保额([\d.]+)万/)?.[1]);
  const special = { amount: yuan(benefits.match(/特别保障保险金([\d.]+)万/)?.[1]), endAgeExclusive: Number(benefits.match(/保障加码至(\d+)周岁/)?.[1]) };
  requireData(ages.length === 1 && /组合保费/.test(heading) && positive(base) && positive(annual)
    && positive(special.amount) && validAge(special.endAgeExclusive), 'OCR_SUMMARY', '无法确认年龄、组合保费或特别保障截止年龄');
  const claimNodes = chartAnchors(claimWords, '重疾保险金');
  const cashNodes = chartAnchors(cashWords, '主险总退保金', false);
  requireData(claimNodes.every(node => node.guaranteed === base + (node.age < special.endAgeExclusive ? special.amount : 0))
    && claimNodes.some(node => node.age === special.endAgeExclusive)
    && cashNodes.every((node, i) => i === 0 || node.amount >= cashNodes[i - 1].amount),
  'OCR_CROSSCHECK', '保证保额、特别保障到期点或退保金额顺序不一致，请回看原图');
  const withoutCheckColumns = nodes => nodes.map(({ age, amount }) => ({ age, amount }));
  return validatePhotoData({ product: '传世盈如意顺心珍藏', age: parseInt(ages[0].text), gender,
    annual, term, base, special, surrender: withoutCheckColumns(cashNodes), claim: withoutCheckColumns(claimNodes) });
}
