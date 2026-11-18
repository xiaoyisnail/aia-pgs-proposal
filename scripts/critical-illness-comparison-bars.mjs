const chartStyle = `
.chart-sheet { width: 1640px; }
.chart-hero { padding-top: 35px; }
.chart-hero h1 { font-size: 49px; }
.chart-card { margin-top: 22px; padding: 18px 16px 15px; border: 1px solid #ded4bf; border-radius: 14px; background: #fffdf8; }
.legend { display: flex; align-items: center; gap: 28px; padding: 4px 16px 10px; color: #465761; font-size: 16px; }
.legend span { display: flex; align-items: center; gap: 8px; }
.legend i { width: 22px; height: 13px; border-radius: 2px; }
.hk-key { background: #1a5774; }
.cn-key { background: #b48745; }
.estimate-key { background: repeating-linear-gradient(135deg,#f5e7c9 0 4px,#bc985d 4px 6px); border: 1px solid #a98144; }
.unit { margin-left: auto; font-weight: 650; }
.plot { width: 100%; display: block; }
.axis { fill: #55636a; font-size: 17px; }
.year { fill: #294956; font-size: 19px; font-weight: 670; }
.age { fill: #5a666c; font-size: 16px; }
.hk-value,.cn-value { font-size: 18px; font-weight: 630; }
.hk-value { fill: #123b55; }
.cn-value { fill: #6a522e; }
.strip-label { fill: #3d515c; font-size: 16px; font-weight: 630; }
.estimated-value { font-size: 11px; fill: #785721; }
.callout-text { font-size: 16px; font-weight: 650; fill: #943a32; }
.notes { margin: 3px 17px 1px; color: #4e6066; font-size: 15px; line-height: 1.55; }
`;

const COLUMNS = 16;
const amountLabel = value => value === null ? '—' : (value / 10_000).toFixed(2);
const irrLabel = value => value === null ? '—' : `${(value * 100).toFixed(2)}%`;

function plot(rows, metric, photo, interval, index, five) {
  const width = 1490, height = 640, left = 136, right = 20, top = 73, base = 418;
  const step = (width - left - right) / rows.length;
  const y = value => base - value / (interval * 4) * (base - top);
  const x = i => left + step * (i + 0.5);
  const eligible = rows.flatMap((row, i) => row[metric].multiple ? [i] : []);
  const first = eligible[0], last = eligible.at(-1);
  const middle = eligible.find(i => rows[i].year >= 50 && i - first >= 3 && last - i >= 3);
  const callouts = new Set([first, middle, ...(last - first >= 3 ? [last] : []), rows.indexOf(five)]);
  const highlight = rows.findIndex(row => row.year === 30);
  const bars = rows.flatMap((row, i) => [[row[metric].hk, -28], [row[metric].cn, 3]]
    .flatMap(([value, offset]) => value > 0 ? [{ x: x(i) + offset, y: y(value), w: 25, h: base - y(value) }] : []));
  const labels = [];
  const overlaps = (a, b) => a.x < b.x + b.w + 4 && b.x < a.x + a.w + 4
    && a.y < b.y + b.h + 4 && b.y < a.y + a.h + 4;
  const leaders = [];
  const series = rows.map((r, i) => {
    const { hk, cn, estimated, multiple } = r[metric];
    const mid = x(i);
    const rect = (offset, amount, kind, extra = '') => amount === null ? ''
      : `<rect class="bar-${kind}" x="${mid + offset}" y="${y(amount)}" width="25" height="${base - y(amount)}" rx="2" fill="url(#${kind}-${index})" ${extra}/>`;
    const high = y(Math.max(hk, cn ?? 0));
    if (callouts.has(i)) {
      const w = 236, h = 31;
      const preferred = Math.max(8, Math.min(mid - w / 2, width - w - 8));
      const legal = box => box.x >= 8 && box.x + w <= width - 8;
      const candidates = [preferred, preferred - step, preferred + step];
      const blockers = [...bars, ...labels];
      const fits = box => legal(box) && !blockers.some(other => overlaps(box, other));
      let box;
      for (let pos = high - 50; pos >= 40 && !box; pos -= 36) {
        box = candidates.map(x => ({ x, y: pos, w, h })).find(fits);
      }
      // 顶栏的六个固定槽位不与柱子或下方标签重叠，至少有两个空位。
      box ??= Array.from({ length: 6 }, (_, j) => ({ x: 8 + j * (w + 8), y: 4, w, h }))
        .filter(fits).sort((a, b) => Math.abs(a.x - preferred) - Math.abs(b.x - preferred))[0];
      const anchor = mid + (cn > hk ? 15.5 : -15.5);
      const end = Math.min(box.x + w - 8, Math.max(box.x + 8, anchor));
      leaders.push(`<path d="M${anchor} ${high - 3} L${anchor} ${high - 10} L${end} ${box.y + h}" fill="none" stroke="#9e5548" stroke-width="1.4"/>`);
      labels.push({ ...box, content: `<g class="callout" data-year="${r.year}">
        <rect x="${box.x}" y="${box.y}" width="${w}" height="${h}" rx="6" fill="#fcf2e8" stroke="#dac0aa"/>
        <text class="callout-text" x="${box.x + w / 2}" y="${box.y + 21}" text-anchor="middle">${multiple}${estimated ? '（估）' : ''}</text>
      </g>` });
    }
    const data = (className, v, label) => `<text class="${className}" text-anchor="middle" x="${mid}" y="${v}">${label}</text>`;
    return `<g class="node" data-year="${r.year}">
      ${rect(-28, hk, 'hk')}${rect(3, cn, estimated ? 'estimated' : 'cn', estimated ? 'stroke="#aa8654" stroke-width=".75"' : '')}
      ${data('year', 446, `第 ${r.year} 年`)}${data('age', 468, `${r.hkAge === r.cnAge ? r.hkAge : `${r.hkAge}／${r.cnAge}`} 岁`)}
      ${data('hk-value', 501, amountLabel(hk))}
      ${data('cn-value', 531, amountLabel(cn) + (estimated ? '<tspan class="estimated-value" dx="2" dy="-3">估</tspan>' : ''))}
      ${data('hk-value', 581, irrLabel(r.hkIrr))}${data('cn-value', 611, irrLabel(r.cnIrr))}
    </g>`;
  }).join('');
  return `<svg class="plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="两地金额和退保 IRR">
    <defs>
      <linearGradient id="hk-${index}" x2="0" y2="1"><stop stop-color="#4a8398"/><stop offset="1" stop-color="#174e6b"/></linearGradient>
      <linearGradient id="cn-${index}" x2="0" y2="1"><stop stop-color="#ddb77a"/><stop offset="1" stop-color="#aa8044"/></linearGradient>
      <pattern id="estimated-${index}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="7" height="7" fill="#f0e2c6"/><path d="M1 0V7" stroke="#b3915c" stroke-width="2"/></pattern>
    </defs>
    ${highlight < 0 ? '' : `<rect x="${x(highlight) - step / 2 + 2}" y="${top}" width="${step - 4}" height="${base - top + 54}" rx="7" fill="#f5edd9"/>`}
    ${Array.from({ length: 5 }, (_, i) => {
      const value = i * interval, pos = y(value);
      return `<line x1="${left}" x2="${width - right}" y1="${pos}" y2="${pos}" stroke="${i ? '#ded8cc' : '#a9aaa1'}"/>
        <text class="axis" x="${left - 14}" y="${pos + 5}" text-anchor="end">${Number((value / 10_000).toPrecision(6))}</text>`;
    }).join('')}
    <rect x="0" y="481" width="${width}" height="62" rx="6" fill="#f7f2e8"/>
    <rect x="0" y="560" width="${width}" height="63" rx="6" fill="#f0f4f4"/>
    <text class="strip-label" x="13" y="501">香港金额</text><text class="strip-label" x="13" y="531">内地金额</text>
    <text class="strip-label" x="13" y="581">香港退保 IRR</text><text class="strip-label" x="13" y="611">${photo ? '内地 IRR（估算）' : '内地退保 IRR'}</text>
    ${series}${leaders.join('')}${labels.map(label => label.content).join('')}</svg>`;
}

export function buildComparisonBarsHtml({ rows, metric, photo, theme, context, claimBasis, roundedBase }) {
  const cash = metric === 'surrender';
  const title = cash ? '港内地重疾险｜退保发还金额对比' : '港内地重疾险｜保障金额对比';
  const max = Math.max(1, ...rows.flatMap(row => [row[metric].hk, row[metric].cn ?? 0]));
  const scale = 10 ** Math.floor(Math.log10(max / 4));
  const interval = [1, 2, 2.5, 5, 10].find(n => n * scale * 4 >= max) * scale;
  const distance = row => Math.abs(row[metric].hk / row[metric].cn - 5);
  const five = rows.filter(row => row[metric].multiple).reduce((best, row) =>
    !best || distance(row) < distance(best) ? row : best, null);
  const charts = Array.from({ length: Math.ceil(rows.length / COLUMNS) }, (_, i) =>
    plot(rows.slice(i * COLUMNS, (i + 1) * COLUMNS), metric, photo, interval, i, five)).join('');
  const estimateLegend = rows.some(row => row[metric].estimated)
    ? '<span><i class="estimate-key"></i>内地估算 · 含带「估」倍数</span>' : '';
  const ages = rows.some(row => row.hkAge !== row.cnAge) ? '斜线两侧为香港／内地年末年龄。' : '';
  const note = (cash ? '金额为年末退保发还总额。' : `${claimBasis}下方 IRR 为同年度退保 IRR，不是保额收益率。`)
    + 'IRR 按期初缴费、当年期末退保计算。' + (photo ? '内地缴费与期间按图片资料估算。' : '') + ages
    + (roundedBase ? '标题下的基本保额按人民币万元取整。' : '');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${theme}\n${chartStyle}</style>
    <main class="chart-sheet"><div class="title chart-hero"><h1>${title}</h1></div>
    <p class="context">${context}</p>
    <section class="chart-card" aria-label="金额对比图">
      <div class="legend"><span><i class="hk-key"></i>香港方案</span><span><i class="cn-key"></i>内地方案 · ${photo ? '图示原值' : '计划书原值'}</span>${estimateLegend}<span class="unit">金额单位：人民币万元</span></div>
      ${charts}<p class="notes">${note}</p>
    </section></main>`;
}
