
const https = require('https');
const fs = require('fs');
const path = require('path');

const SVG_W = 900;
const SVG_H = 540;
const C = {
  bg: '#0d0d0d', accent: '#58A6B8', accentHalf: 'rgba(88,166,184,0.35)',
  accentDim: 'rgba(88,166,184,0.12)', text: '#c8d6d9', textDim: '#5a7a80',
  bright: '#e8f4f7', cardBg: 'rgba(88,166,184,0.05)',
  cardBorder: 'rgba(88,166,184,0.22)', grid: 'rgba(88,166,184,0.055)',
};
const GR = { l: 90, r: 860, t: 210, b: 430 }; // graph region


function prng(seed) {
  let s = seed | 0;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function fetchContributions(token, username) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      query: `query($u:String!){user(login:$u){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{contributionCount date}}}}}}`,
      variables: { u: username },
    });
    const opts = {
      hostname: 'api.github.com', path: '/graphql', method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        'User-Agent': 'commit-coven-gen', 'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.errors) return reject(new Error('GraphQL: ' + JSON.stringify(j.errors)));
          resolve(j.data);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function processData(raw) {
  const cal = raw.user.contributionsCollection.contributionCalendar;
  const all = cal.weeks.flatMap(w => w.contributionDays).sort((a, b) => a.date.localeCompare(b.date));
  const last30 = all.slice(-30);
  const total = cal.totalContributions;
  let hiCount = 0, hiDate = '';
  for (const d of last30) { if (d.contributionCount > hiCount) { hiCount = d.contributionCount; hiDate = d.date; } }
  let cur = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].contributionCount > 0) cur++; else { if (i === all.length - 1) continue; break; }
  }
  let longest = 0, run = 0;
  for (const d of all) { if (d.contributionCount > 0) { run++; longest = Math.max(longest, run); } else run = 0; }
  return { days: last30, total, hiCount, hiDate, cur, longest };
}
function demoData() {
  const days = []; const now = new Date();
  const vals = [2, 0, 5, 3, 7, 1, 4, 8, 6, 3, 14, 2, 0, 1, 5, 9, 3, 0, 6, 11, 4, 2, 7, 3, 1, 8, 5, 0, 3, 6];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    days.push({ date: d.toISOString().slice(0, 10), contributionCount: vals[29 - i] });
  }
  return { days, total: 847, hiCount: 14, hiDate: days[10].date, cur: 3, longest: 8 };
}
function spline(pts, t = 0.4) {
  if (pts.length < 2) return `M${pts[0].x} ${pts[0].y}`;
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) * t / 3, c1y = p1.y + (p2.y - p0.y) * t / 3;
    const c2x = p2.x - (p3.x - p1.x) * t / 3, c2y = p2.y - (p3.y - p1.y) * t / 3;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)},${c2x.toFixed(1)} ${c2y.toFixed(1)},${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}
function yTicks(max) {
  if (max <= 0) max = 1;
  const steps = [1, 2, 3, 5, 10, 15, 20, 25, 50, 100];
  let s = 1;
  for (const c of steps) { if (max / c <= 5) { s = c; break; } }
  const t = [];
  for (let v = 0; v <= max + s - 1; v += s) { t.push(v); if (t.length > 6) break; }
  return t;
}
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function generateSVG(data) {
  const { days, total, hiCount, hiDate, cur, longest } = data;
  const maxC = Math.max(...days.map(d => d.contributionCount), 1);
  const ticks = yTicks(maxC);
  const yMax = ticks[ticks.length - 1] || maxC;
  const rand = prng(parseInt(days[0].date.replace(/-/g, ''), 10));

  const gW = GR.r - GR.l, gH = GR.b - GR.t;
  const pts = days.map((d, i) => ({
    x: GR.l + (i / (days.length - 1)) * gW,
    y: GR.b - (d.contributionCount / yMax) * gH,
    count: d.contributionCount, date: d.date,
  }));


  const hiIdx = days.findIndex(d => d.date === hiDate);
  const linePath = spline(pts);
  const areaPath = linePath + ` L${pts[pts.length - 1].x.toFixed(1)} ${GR.b} L${pts[0].x.toFixed(1)} ${GR.b} Z`;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}">
<defs>
  <!-- Gradients -->
  <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${C.accent}" stop-opacity="0.28"/>
    <stop offset="85%" stop-color="${C.accent}" stop-opacity="0.03"/>
    <stop offset="100%" stop-color="${C.accent}" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="haloGrad" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="${C.accent}" stop-opacity="0.5"/>
    <stop offset="100%" stop-color="${C.accent}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="frameFade" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${C.accent}" stop-opacity="0.35"/>
    <stop offset="50%" stop-color="${C.accent}" stop-opacity="0.12"/>
    <stop offset="100%" stop-color="${C.accent}" stop-opacity="0.35"/>
  </linearGradient>
  <!-- Filters -->
  <filter id="glowSm" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="glowMd" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="glowLg" x="-80%" y="-80%" width="260%" height="260%">
    <feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="130%">
    <feGaussianBlur stdDeviation="6" result="b"/><feFlood flood-color="${C.accent}" flood-opacity="0.08" result="c"/>
    <feComposite in="c" in2="b" operator="in" result="s"/><feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>

<!-- Background -->
<rect width="${SVG_W}" height="${SVG_H}" fill="${C.bg}" rx="16"/>
`;


  for (let i = 0; i <= 6; i++) {
    const y = GR.t + (i / 6) * gH;
    svg += `<line x1="${GR.l}" y1="${y.toFixed(1)}" x2="${GR.r}" y2="${y.toFixed(1)}" stroke="${C.grid}" stroke-width="0.7"/>\n`;
  }
  for (let i = 0; i < days.length; i += 5) {
    const x = pts[i].x;
    svg += `<line x1="${x.toFixed(1)}" y1="${GR.t}" x2="${x.toFixed(1)}" y2="${GR.b}" stroke="${C.grid}" stroke-width="0.5"/>\n`;
  }
  for (let i = 0; i < 55; i++) {
    const sx = rand() * SVG_W, sy = rand() * SVG_H, sr = rand() * 1.1 + 0.3;
    const so = (rand() * 0.12 + 0.04).toFixed(3);
    const dur = (3.5 + rand() * 5).toFixed(1), del = (rand() * 6).toFixed(1);
    svg += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${sr.toFixed(1)}" fill="${C.accent}" opacity="${so}"><animate attributeName="opacity" values="${so};${(parseFloat(so) * 2.2).toFixed(3)};${so}" dur="${dur}s" begin="${del}s" repeatCount="indefinite"/></circle>\n`;
  }
  for (let i = 0; i < 8; i++) {
    const dx = rand() * (SVG_W - 80) + 40, dy = rand() * (SVG_H - 80) + 40;
    const ds = 2.5 + rand() * 2, dop = (0.04 + rand() * 0.06).toFixed(3);
    const ddur = (6 + rand() * 4).toFixed(1), ddel = (rand() * 5).toFixed(1);
    svg += `<g transform="translate(${dx.toFixed(1)},${dy.toFixed(1)}) rotate(45)" opacity="${dop}"><rect x="${(-ds / 2).toFixed(1)}" y="${(-ds / 2).toFixed(1)}" width="${ds.toFixed(1)}" height="${ds.toFixed(1)}" fill="${C.accent}"/><animate attributeName="opacity" values="${dop};${(parseFloat(dop) * 2.5).toFixed(3)};${dop}" dur="${ddur}s" begin="${ddel}s" repeatCount="indefinite"/></g>\n`;
  }


  const orn = (x, y, sx, sy) =>
    `<g transform="translate(${x},${y}) scale(${sx},${sy})"><path d="M0 25 L0 6 Q0 0 6 0 L25 0" fill="none" stroke="${C.accent}" stroke-width="1.3" opacity="0.35"/><circle cx="0" cy="0" r="1.8" fill="${C.accent}" opacity="0.4"/><path d="M0 12 L5 12" fill="none" stroke="${C.accent}" stroke-width="0.6" opacity="0.2"/><path d="M12 0 L12 5" fill="none" stroke="${C.accent}" stroke-width="0.6" opacity="0.2"/></g>`;
  svg += orn(18, 18, 1, 1) + orn(SVG_W - 18, 18, -1, 1) + orn(18, SVG_H - 18, 1, -1) + orn(SVG_W - 18, SVG_H - 18, -1, -1) + '\n';

  svg += `<rect x="10" y="10" width="${SVG_W - 20}" height="${SVG_H - 20}" rx="12" fill="none" stroke="url(#frameFade)" stroke-width="1"/>\n`;

  svg += `<text x="${SVG_W / 2}" y="50" text-anchor="middle" font-family="Georgia,'Palatino Linotype','Book Antiqua',Palatino,serif" font-size="22" font-weight="bold" fill="${C.bright}" letter-spacing="8" filter="url(#glowMd)">✧ THE COMMIT COVEN ✧</text>\n`;

  svg += `<line x1="${SVG_W / 2 - 140}" y1="62" x2="${SVG_W / 2 + 140}" y2="62" stroke="${C.accent}" stroke-width="0.5" opacity="0.25"/>\n`;

  const cards = [
    { label: 'Highest Harvest', value: `${hiCount} Offerings`, icon: '🌕' },
    { label: 'Current Ritual', value: `${cur} Nights`, icon: '🕯️' },
    { label: 'Total Offerings', value: `${total}`, icon: '📜' },
  ];
  const cardW = 240, cardH = 78, cardGap = 20;
  const cardStartX = (SVG_W - (cardW * 3 + cardGap * 2)) / 2;
  cards.forEach((c, i) => {
    const cx = cardStartX + i * (cardW + cardGap), cy = 80;
    svg += `<g filter="url(#cardShadow)">`;
    svg += `<rect x="${cx}" y="${cy}" width="${cardW}" height="${cardH}" rx="10" fill="${C.cardBg}" stroke="${C.cardBorder}" stroke-width="0.8"/>`;
    svg += `<text x="${cx + cardW / 2}" y="${cy + 30}" text-anchor="middle" font-family="Georgia,'Palatino Linotype',serif" font-size="11" fill="${C.textDim}" letter-spacing="3" text-transform="uppercase">${c.label.toUpperCase()}</text>`;
    svg += `<text x="${cx + cardW / 2}" y="${cy + 56}" text-anchor="middle" font-family="Georgia,'Palatino Linotype',serif" font-size="20" fill="${C.bright}" font-weight="bold" filter="url(#glowSm)">${c.value}</text>`;
    svg += `</g>\n`;
  });

  for (const tv of ticks) {
    const ty = GR.b - (tv / yMax) * gH;
    svg += `<text x="${GR.l - 10}" y="${(ty + 4).toFixed(1)}" text-anchor="end" font-family="'Courier New',monospace" font-size="10" fill="${C.textDim}">${tv}</text>\n`;
    svg += `<line x1="${GR.l - 4}" y1="${ty.toFixed(1)}" x2="${GR.l}" y2="${ty.toFixed(1)}" stroke="${C.textDim}" stroke-width="0.5"/>\n`;
  }

  const step = days.length <= 15 ? 2 : days.length <= 20 ? 3 : 4;
  for (let i = 0; i < days.length; i += step) {
    const dayNum = new Date(days[i].date + 'T00:00:00').getDate();
    svg += `<text x="${pts[i].x.toFixed(1)}" y="${GR.b + 20}" text-anchor="middle" font-family="'Courier New',monospace" font-size="10" fill="${C.textDim}">${dayNum}</text>\n`;
  }
  const lastDay = new Date(days[days.length - 1].date + 'T00:00:00').getDate();
  svg += `<text x="${pts[pts.length - 1].x.toFixed(1)}" y="${GR.b + 20}" text-anchor="middle" font-family="'Courier New',monospace" font-size="10" fill="${C.textDim}">${lastDay}</text>\n`;
  svg += `<line x1="${GR.l}" y1="${GR.t}" x2="${GR.l}" y2="${GR.b}" stroke="${C.accent}" stroke-width="0.5" opacity="0.2"/>\n`;
  svg += `<line x1="${GR.l}" y1="${GR.b}" x2="${GR.r}" y2="${GR.b}" stroke="${C.accent}" stroke-width="0.5" opacity="0.2"/>\n`;

  svg += `<path d="${areaPath}" fill="url(#areaFill)" opacity="0.9">\n  <animate attributeName="opacity" values="0;0.9" dur="2s" fill="freeze"/>\n</path>\n`;

  svg += `<path d="${linePath}" fill="none" stroke="${C.accent}" stroke-width="4" opacity="0.15" filter="url(#glowLg)" stroke-linecap="round" stroke-linejoin="round"/>\n`;

  const pathLen = estimatePathLength(pts);
  svg += `<path d="${linePath}" fill="none" stroke="${C.accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" filter="url(#glowSm)" stroke-dasharray="${pathLen}" stroke-dashoffset="${pathLen}">\n`;
  svg += `  <animate attributeName="stroke-dashoffset" from="${pathLen}" to="0" dur="2.5s" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1"/>\n`;
  svg += `  <animate attributeName="opacity" values="0.7;1;0.85;1" dur="6s" begin="2.5s" repeatCount="indefinite"/>\n`;
  svg += `</path>\n`;

  pts.forEach((p, i) => {
    const isHi = i === hiIdx;
    const baseR = 2.2 + (p.count / maxC) * 3.5;
    const r = isHi ? baseR + 1.5 : baseR;
    const nodeDelay = (0.8 + i * 0.06).toFixed(2);
    const tooltip = `${fmtDate(p.date)}\n${p.count} Contribution${p.count !== 1 ? 's' : ''}`;

    if (isHi) {
      svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="18" fill="url(#haloGrad)" opacity="0">\n`;
      svg += `  <animate attributeName="opacity" values="0;0.6;0.3;0.6" dur="4s" begin="${nodeDelay}s" repeatCount="indefinite"/>\n`;
      svg += `  <animate attributeName="r" values="14;22;14" dur="4s" begin="${nodeDelay}s" repeatCount="indefinite"/>\n`;
      svg += `</circle>\n`;
    }

    svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${isHi ? C.bright : C.accent}" stroke="${C.bg}" stroke-width="1" filter="${isHi ? 'url(#glowMd)' : 'url(#glowSm)'}" opacity="0">\n`;
    svg += `  <title>${tooltip}</title>\n`;
    svg += `  <animate attributeName="opacity" from="0" to="1" dur="0.4s" begin="${nodeDelay}s" fill="freeze"/>\n`;
    svg += `  <animate attributeName="r" values="${r.toFixed(1)};${(r + (isHi ? 2 : 1)).toFixed(1)};${r.toFixed(1)}" dur="${isHi ? '3' : '4'}s" begin="${(parseFloat(nodeDelay) + 0.4).toFixed(2)}s" repeatCount="indefinite"/>\n`;
    svg += `</circle>\n`;
  });
  const firstMonth = new Date(days[0].date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' });
  svg += `<text x="${GR.l}" y="${GR.b + 36}" text-anchor="start" font-family="Georgia,'Palatino Linotype',serif" font-size="10" fill="${C.textDim}" letter-spacing="1.5">${firstMonth.toUpperCase()}</text>\n`;
  const lastMonth = new Date(days[days.length - 1].date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' });
  if (lastMonth !== firstMonth) {
    svg += `<text x="${GR.r}" y="${GR.b + 36}" text-anchor="end" font-family="Georgia,'Palatino Linotype',serif" font-size="10" fill="${C.textDim}" letter-spacing="1.5">${lastMonth.toUpperCase()}</text>\n`;
  }

  svg += `<text x="${SVG_W / 2}" y="${SVG_H - 18}" text-anchor="middle" font-family="Georgia,'Palatino Linotype',serif" font-size="9" fill="${C.textDim}" letter-spacing="4" opacity="0.5">LAST 30 DAYS OF DARK RITUALS</text>\n`;

  svg += `</svg>`;
  return svg;
}
function estimatePathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return Math.ceil(len * 1.3);
}


async function main() {
  const isDemo = process.argv.includes('--demo');
  const outDir = path.resolve(__dirname, '..', 'assets');
  const outFile = path.join(outDir, 'commit-coven.svg');

  console.log('✧ The Commit Coven — Generating visualization…');

  let data;
  if (isDemo) {
    console.log('  ↳ Using demo data');
    data = demoData();
  } else {
    const token = process.env.GITHUB_TOKEN;
    const username = process.env.GITHUB_USERNAME || process.env.GITHUB_REPOSITORY_OWNER;
    if (!token || !username) {
      console.error('✗ Missing GITHUB_TOKEN or GITHUB_USERNAME. Use --demo for local testing.');
      process.exit(1);
    }
    console.log(`  ↳ Fetching contributions for @${username}…`);
    try {
      const raw = await fetchContributions(token, username);
      data = processData(raw);
      console.log(`  ↳ Total: ${data.total} | Highest: ${data.hiCount} | Streak: ${data.cur} days | Longest: ${data.longest} days`);
    } catch (err) {
      console.error('✗ API Error:', err.message);
      process.exit(1);
    }
  }

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const svg = generateSVG(data);
  fs.writeFileSync(outFile, svg, 'utf8');
  console.log(`✧ SVG written to ${outFile} (${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB)`);
}

main().catch(err => { console.error('✗ Fatal:', err); process.exit(1); });
