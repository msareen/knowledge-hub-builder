// Renders the interactive graph UI served by `khb visualize`. Two zoom levels: bundles
// (outer graph, refs.md edges) and, after clicking a bundle, its concepts (inner graph,
// markdown-link edges). Clicking a node opens a panel with its full title, path and body.
//
// The inner graph is *clustered*: every concept is pinned to the region of its top-level
// subdirectory (tables/, notes/, …) so the bundle's own organisation is the visible
// structure. The canvas is pan/zoomable and the layout is pre-settled before first paint,
// so the view opens on a stable picture rather than an exploding one.
//
// Labels are drawn in *screen* space, not world space: they stay legible at any zoom, and
// any label whose box would collide with one already drawn is dropped. Node text is
// therefore always sparse and readable — the full title and path live in the click panel.
import type { GraphData } from "./graph";

/** Escape `</script>` so injected JSON can't terminate the surrounding <script> tag. */
const safeJSON = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export function renderGraphPage(data: GraphData): string {
  return `<!doctype html>
<meta charset="utf-8"><title>KHB — bundle graph</title>
<style>
  :root{
    --bg:#111318; --fg:#e6e8ee; --dim:#8a91a3; --line:#2b303b;
    --panel:#181b22; --accent:#6ee7d5;
  }
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;
    background:var(--bg);color:var(--fg);overflow:hidden}
  canvas{display:block;touch-action:none}

  /* top bar --------------------------------------------------------------- */
  #bar{position:fixed;top:0;left:0;right:0;z-index:4;display:flex;align-items:center;
    gap:12px;padding:9px 14px;background:color-mix(in srgb,var(--bg) 82%,transparent);
    backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
  #bar .brand{font-weight:650;letter-spacing:.04em;color:var(--accent)}
  #bar .stat{color:var(--dim);font-size:12.5px}
  #bar .spacer{flex:1}
  .btn{background:transparent;color:var(--fg);border:1px solid var(--line);
    border-radius:6px;padding:4px 10px;cursor:pointer;font:12.5px system-ui}
  .btn:hover{border-color:var(--accent);color:var(--accent)}
  .btn:disabled{opacity:.4;cursor:default}
  #back{display:none}
  #back.on{display:inline-block}

  /* concept panel --------------------------------------------------------- */
  #panel{position:fixed;top:0;right:0;width:min(460px,42vw);height:100%;
    background:var(--panel);border-left:1px solid var(--line);transform:translateX(101%);
    transition:transform .16s ease;z-index:5;display:flex;flex-direction:column}
  #panel.open{transform:translateX(0)}
  #panel header{padding:14px 16px;border-bottom:1px solid var(--line);display:flex;
    justify-content:space-between;align-items:start;gap:10px}
  #panel h2{font-size:15.5px;margin:0 0 5px;overflow-wrap:anywhere}
  #panel .meta{color:var(--dim);font-size:12px;overflow-wrap:anywhere}
  #panel .chip{display:inline-block;margin-top:7px;padding:2px 8px;border-radius:99px;
    font-size:11.5px;border:1px solid currentColor}
  #panel button{background:none;border:none;color:var(--dim);font-size:18px;cursor:pointer}
  #panel button:hover{color:var(--fg)}
  #panel pre{margin:0;padding:16px;overflow:auto;white-space:pre-wrap;word-break:break-word;
    font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--fg);flex:1}
</style>

<div id="bar">
  <span class="brand">KHB</span>
  <button class="btn" id="back">← all bundles</button>
  <span class="stat" id="stat"></span>
  <span class="spacer"></span>
  <button class="btn" id="fit" title="Fit to view (F)">⤢ fit</button>
  <button class="btn" id="theme" title="Toggle light / dark">☾</button>
  <button class="btn" id="refresh" title="Rescan the hub">↻</button>
</div>
<div id="panel">
  <header>
    <div><h2 id="pTitle"></h2><div class="meta" id="pMeta"></div><span class="chip" id="pChip"></span></div>
    <button id="pClose">✕</button>
  </header>
  <pre id="pBody">loading…</pre>
</div>
<canvas id="c"></canvas>

<script>
let DATA = ${safeJSON(data)};
const cv = document.getElementById('c'), cx = cv.getContext('2d');
const $ = id => document.getElementById(id);
let W, H, DPR = 1;
function rs(){
  DPR = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  cv.width = W * DPR; cv.height = H * DPR;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
}
rs();
onresize = rs; // pan/zoom means the layout no longer depends on viewport size

/* ---- themes: two, because a picker with four was one option too many ---------- */
const THEMES = {
  dark:  {bg:'#111318',fg:'#e6e8ee',dim:'#8a91a3',line:'#2b303b',panel:'#181b22',
          accent:'#6ee7d5',edge:'#59606f',hull:'rgba(255,255,255,.045)',hullLine:'rgba(255,255,255,.12)'},
  light: {bg:'#f6f7f9',fg:'#1c2028',dim:'#697082',line:'#dfe2e8',panel:'#ffffff',
          accent:'#0d7d70',edge:'#aab1bd',hull:'rgba(20,30,60,.04)',hullLine:'rgba(20,30,60,.12)'},
};
let T = THEMES.dark;
function setTheme(name){
  T = THEMES[name] || THEMES.dark;
  const r = document.documentElement.style;
  for (const k of ['bg','fg','dim','line','panel','accent']) r.setProperty('--' + k, T[k]);
  document.documentElement.style.colorScheme = name;
  $('theme').textContent = name === 'light' ? '☀' : '☾';
  try { localStorage.setItem('khb-theme', name); } catch {}
}
let themeName = 'dark';
try { themeName = localStorage.getItem('khb-theme') === 'light' ? 'light' : 'dark'; } catch {}
setTheme(themeName);
$('theme').onclick = () => setTheme(themeName = themeName === 'dark' ? 'light' : 'dark');

/* ---- type encoding: colour only. No legend, no shape vocabulary to learn — the
   type is spelled out in the hover strip and the panel. ------------------------- */
const PALETTE = ['#4f9cf9','#e8883b','#28a97f','#a173e0','#e05c5c','#d7b13a','#3ec1d3','#8b93a8'];
let typeKeys = [];
const typeColor = t => PALETTE[Math.max(0, typeKeys.indexOf(t)) % PALETTE.length];

/* ---- state -------------------------------------------------------------------- */
let view = { level: 'bundles', bundle: null };
let N = [], E = [], idx = {}, clusters = [];
let drag = null, hover = null, down = null, panning = null;
let scale = 1, tx = 0, ty = 0;
const toWorld = (sx, sy) => ({ x: (sx - tx) / scale, y: (sy - ty) / scale });

function build(){
  let nodes, edges;
  if (view.level === 'bundles') {
    typeKeys = [];
    nodes = DATA.bundles.map(n => ({ id: n.id, label: n.id, note: n.scope || '',
      group: '', type: '', size: n.notes, kind: 'bundle', badge: n.notes + ' concepts' }));
    edges = DATA.bundleEdges.map(e => ({ from: e.from, to: e.to, why: e.why }));
  } else {
    const g = DATA.bundleGraphs[view.bundle] || { concepts: [], edges: [] };
    typeKeys = [...new Set(g.concepts.map(c => c.type || 'Untyped'))].sort();
    nodes = g.concepts.map(c => ({ id: c.id, label: c.title || c.id.split('/').pop(),
      note: c.id, group: c.folder || '(root)', type: c.type || 'Untyped',
      size: c.bytes, kind: 'concept', badge: '' }));
    edges = g.edges.map(e => ({ from: e.from, to: e.to, why: '' }));
  }
  N = nodes.map(n => ({ ...n, x: 0, y: 0, vx: 0, vy: 0,
    r: n.kind === 'bundle' ? 16 + Math.sqrt(Math.max(n.size, 0)) * 3.2
                           : 7 + Math.min(Math.sqrt(Math.max(n.size, 1) / 300) * 3, 9) }));
  idx = Object.fromEntries(N.map((n, i) => [n.id, i]));
  E = edges.filter(e => idx[e.from] !== undefined && idx[e.to] !== undefined)
    .map(e => ({ a: idx[e.from], b: idx[e.to], why: e.why }));
  drag = hover = null;
  place();
  for (let i = 0; i < 260; i++) step(); // settle before first paint, then frame it
  fitView();
  renderChrome();
}

/** Seat every node: bundles on a ring, concepts around their folder's cluster centre.
 *  World coordinates are viewport-independent — fitView() frames whatever comes out. */
function place(){
  if (view.level === 'bundles') {
    clusters = [];
    // Ring just big enough to seat the nodes side by side: the hub opens as one compact
    // cluster you can read at a glance, and zoom handles the detail.
    const circ = N.reduce((s, n) => s + n.r * 2 + 34, 0);
    const R = N.length < 2 ? 0 : Math.max(70, circ / 6.2832);
    N.forEach((n, i) => {
      const a = i / Math.max(N.length, 1) * 6.2832 - Math.PI / 2;
      n.x = Math.cos(a) * R; n.y = Math.sin(a) * R; n.vx = n.vy = 0;
    });
    return;
  }
  const names = [...new Set(N.map(n => n.group))].sort((a, b) =>
    a === '(root)' ? -1 : b === '(root)' ? 1 : a.localeCompare(b));
  const k = names.length;
  // Each folder occupies a disc whose radius grows with its file count; the ring is then
  // sized so neighbouring discs just clear each other. Sizing off a *global* constant is
  // what used to fling two folders a screen and a half apart.
  const rad = Object.fromEntries(names.map(nm =>
    [nm, 55 + Math.sqrt(N.filter(n => n.group === nm).length) * 42]));
  const rs_ = names.map(nm => rad[nm]);
  const R = k === 1 ? 0
    : k === 2 ? (rs_[0] + rs_[1] + 70) / 2
    : Math.max(rs_.reduce((s, r) => s + r * 2 + 70, 0) / 6.2832, Math.max(...rs_) + 50);
  // Laid out on an ellipse, not a circle: screens are wider than they are tall, and two
  // folders stacked vertically is the one arrangement that never fits.
  clusters = names.map((name, i) => {
    const a = i / k * 6.2832 + (k === 2 ? 0 : -Math.PI / 2);
    return { name, x: Math.cos(a) * R * 1.3, y: Math.sin(a) * R * 0.82 };
  });
  const home = Object.fromEntries(clusters.map(c => [c.name, c]));
  N.forEach((n, i) => {
    n.home = home[n.group];
    const a = i * 2.399; // golden-angle scatter so nodes don't start stacked
    n.x = n.home.x + Math.cos(a) * 26 * Math.sqrt(i % 12 + 1);
    n.y = n.home.y + Math.sin(a) * 26 * Math.sqrt(i % 12 + 1);
    n.vx = n.vy = 0;
  });
}

/** Frame the whole graph with a floor on the zoom, so a small hub opens zoomed in
 *  rather than as three dots in the middle of an empty canvas. */
function fitView(){
  if (!N.length) { scale = 1; tx = W / 2; ty = H / 2; return; }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const n of N) {
    x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r);
    y0 = Math.min(y0, n.y - n.r); y1 = Math.max(y1, n.y + n.r);
  }
  const pad = 110, top = 52;
  const s = Math.min((W - pad * 2) / Math.max(x1 - x0, 1),
                     (H - top - pad * 1.4) / Math.max(y1 - y0, 1));
  // Only a ceiling, never a floor: a floor would leave a big graph cropped at the edges,
  // which is worse than small. The outer ring is compact by design, so it may magnify more.
  scale = Math.min(Math.max(s, 0.05), view.level === 'bundles' ? 2.4 : 1.7);
  tx = W / 2 - (x0 + x1) / 2 * scale;
  ty = (H + top) / 2 - (y0 + y1) / 2 * scale;
}

function renderChrome(){
  $('back').classList.toggle('on', view.level !== 'bundles');
  $('stat').textContent = view.level === 'bundles'
    ? DATA.bundles.length + ' bundles · ' + DATA.bundleEdges.length + ' refs · click one to open'
    : view.bundle + ' · ' + N.length + ' concepts · ' + E.length + ' links';
}

/* ---- forces: cluster-anchored, so the layout settles instead of drifting ------- */
function step(){
  const inner = view.level !== 'bundles';
  // Outer forces are deliberately gentle and short-range: bundles stay a tight group
  // instead of flinging themselves to the corners of an unbounded world.
  const rep = inner ? 4200 : 2200, cap = inner ? 9 : 6, reach = inner ? 460 : 300;
  for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
    const a = N[i], b = N[j];
    let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    if (d > reach) continue;
    const f = Math.min(rep / (d * d), cap); dx /= d; dy /= d;
    a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
  }
  const rest = inner ? 110 : 150;
  for (const e of E) {
    const a = N[e.a], b = N[e.b];
    // links that leave a folder pull only weakly — clusters own the layout, not edges
    const k = inner && a.group !== b.group ? 0.0006 : 0.003;
    let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    const f = (d - rest) * k;
    a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
  }
  for (const n of N) {
    if (inner) { n.vx += (n.home.x - n.x) * 0.012; n.vy += (n.home.y - n.y) * 0.012; }
    else { n.vx += -n.x * 0.006; n.vy += -n.y * 0.006; }
    if (n !== drag) { n.x += n.vx *= 0.82; n.y += n.vy *= 0.82; }
  }
}

/* ---- folder hulls -------------------------------------------------------------- */
function hullOf(pts){
  if (pts.length < 3) return pts;
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length-2], lo[lo.length-1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i];
    while (up.length >= 2 && cr(up[up.length-2], up[up.length-1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up);
}
/** Draws the hulls in world space and returns their captions for the screen-space pass. */
function drawHulls(){
  const caps = [];
  for (const c of clusters) {
    const mem = N.filter(n => n.group === c.name);
    if (!mem.length) continue;
    const pad = 40;
    let pts = hullOf(mem.map(n => ({ x: n.x, y: n.y })));
    const gx = mem.reduce((s, n) => s + n.x, 0) / mem.length;
    const gy = mem.reduce((s, n) => s + n.y, 0) / mem.length;
    if (pts.length < 3) {
      cx.beginPath(); cx.arc(gx, gy, (mem[0].r || 12) + pad, 0, 6.2832);
    } else {
      pts = pts.map(p => { const dx = p.x - gx, dy = p.y - gy, d = Math.hypot(dx, dy) || 1;
        return { x: p.x + dx / d * pad, y: p.y + dy / d * pad }; });
      cx.beginPath();
      const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const m0 = mid(pts[pts.length - 1], pts[0]);
      cx.moveTo(m0.x, m0.y);
      for (let i = 0; i < pts.length; i++) {
        const nx = mid(pts[i], pts[(i + 1) % pts.length]);
        cx.quadraticCurveTo(pts[i].x, pts[i].y, nx.x, nx.y);
      }
      cx.closePath();
    }
    cx.fillStyle = T.hull; cx.fill();
    cx.strokeStyle = T.hullLine; cx.lineWidth = 1 / scale;
    cx.setLineDash([5 / scale, 5 / scale]); cx.stroke(); cx.setLineDash([]);
    const top = Math.min(...mem.map(n => n.y - n.r)) - pad - 6;
    caps.push({ x: gx * scale + tx, y: top * scale + ty,
                text: c.name.toUpperCase() + '  ·  ' + mem.length });
  }
  return caps;
}

/* ---- draw ---------------------------------------------------------------------- */
function draw(){
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  cx.clearRect(0, 0, W, H);
  cx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * tx, DPR * ty);

  const caps = view.level !== 'bundles' ? drawHulls() : [];

  const lit = hover ? new Set([hover.id]) : null;
  if (lit) for (const e of E) {
    if (N[e.a] === hover) lit.add(N[e.b].id);
    if (N[e.b] === hover) lit.add(N[e.a].id);
  }

  for (const e of E) {
    const a = N[e.a], b = N[e.b];
    const on = !lit || (lit.has(a.id) && lit.has(b.id));
    cx.globalAlpha = on ? (lit ? .95 : .45) : .1;
    cx.strokeStyle = on && lit ? T.accent : T.edge;
    cx.lineWidth = (on && lit ? 1.8 : 1.1) / scale;
    // gentle arc: two straight lines between the same pair would overlap
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const ox = -(b.y - a.y) * .08, oy = (b.x - a.x) * .08;
    cx.beginPath(); cx.moveTo(a.x, a.y); cx.quadraticCurveTo(mx + ox, my + oy, b.x, b.y); cx.stroke();
    const ang = Math.atan2(b.y - (my + oy), b.x - (mx + ox));
    const hx = b.x - Math.cos(ang) * (b.r + 2), hy = b.y - Math.sin(ang) * (b.r + 2);
    const ah = 7 / scale;
    cx.fillStyle = on && lit ? T.accent : T.edge;
    cx.beginPath(); cx.moveTo(hx, hy);
    cx.lineTo(hx - ah * Math.cos(ang - .38), hy - ah * Math.sin(ang - .38));
    cx.lineTo(hx - ah * Math.cos(ang + .38), hy - ah * Math.sin(ang + .38));
    cx.fill();
  }

  for (const n of N) {
    cx.globalAlpha = !lit || lit.has(n.id) ? 1 : .16;
    const col = n.kind === 'bundle' ? T.accent : typeColor(n.type);
    cx.beginPath(); cx.arc(n.x, n.y, n.r, 0, 6.2832);
    cx.fillStyle = n === hover ? col : col + '33'; cx.fill();
    cx.strokeStyle = col; cx.lineWidth = (n === hover ? 2 : 1.4) / scale; cx.stroke();
  }
  cx.globalAlpha = 1;

  /* ---- labels: screen space, fixed size, collision-culled ---------------------- */
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  cx.textAlign = 'center';
  const boxes = [];
  const fits = (x, y, w, h) => {
    for (const b of boxes) if (x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y) return false;
    boxes.push({ x, y, w, h }); return true;
  };
  cx.font = '600 11px system-ui'; cx.fillStyle = T.dim;
  for (const c of caps) {
    const w = cx.measureText(c.text).width;
    if (fits(c.x - w / 2, c.y - 11, w, 14)) cx.fillText(c.text, c.x, c.y);
  }
  // biggest first, so when labels compete the important node keeps its name
  const order = [...N].sort((a, b) => b.r - a.r);
  for (const n of order) {
    if (lit && !lit.has(n.id)) continue;
    const sx = n.x * scale + tx, sy = n.y * scale + ty, sr = n.r * scale;
    if (sx < -80 || sx > W + 80 || sy < 30 || sy > H + 40) continue;
    cx.font = (n.kind === 'bundle' ? '600 13px' : '12px') + ' system-ui';
    const text = clip(n.label, n.kind === 'bundle' ? 22 : 16);
    const w = cx.measureText(text).width, y = sy + sr + 13;
    if (!fits(sx - w / 2, y - 10, w + 8, 14) && n !== hover) continue;
    cx.fillStyle = T.fg; cx.fillText(text, sx, y);
    if (n.badge) { cx.fillStyle = T.dim; cx.font = '11px system-ui'; cx.fillText(n.badge, sx, y + 14); }
  }

  if (hover) {
    const txt = hover.kind === 'bundle'
      ? hover.id + (hover.note ? ' — ' + hover.note : '')
      : hover.label + '   ' + hover.note + (hover.type ? '  ·  ' + hover.type : '');
    cx.font = '12.5px system-ui'; cx.textAlign = 'left';
    const w = cx.measureText(txt).width;
    cx.fillStyle = T.panel; cx.globalAlpha = .96;
    roundRect(14, H - 42, w + 20, 28, 7); cx.fill();
    cx.globalAlpha = 1; cx.strokeStyle = T.line; cx.lineWidth = 1;
    roundRect(14, H - 42, w + 20, 28, 7); cx.stroke();
    cx.fillStyle = T.fg; cx.fillText(txt, 24, H - 23);
  }
}
function roundRect(x, y, w, h, r){
  cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r);
  cx.arcTo(x + w, y + h, x, y + h, r); cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath();
}
const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;

/* ---- interaction ---------------------------------------------------------------- */
function at(sx, sy){
  const p = toWorld(sx, sy);
  for (let i = N.length - 1; i >= 0; i--) {
    const n = N[i];
    if (Math.hypot(n.x - p.x, n.y - p.y) < n.r + 6 / scale) return n;
  }
}
function goBundles(){ view = { level: 'bundles', bundle: null }; build(); $('panel').classList.remove('open'); }
$('back').onclick = goBundles;
$('fit').onclick = fitView;
addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    $('panel').classList.contains('open') ? $('panel').classList.remove('open')
      : view.level !== 'bundles' && goBundles();
  } else if (e.key === 'f' || e.key === 'F') fitView();
});

async function openPanel(n){
  $('panel').classList.add('open');
  $('pTitle').textContent = n.label;                       // full title, never clipped
  $('pMeta').textContent = view.bundle + ' / ' + n.id;     // full path
  const chip = $('pChip');
  chip.textContent = n.type || '';
  chip.style.color = typeColor(n.type);
  chip.style.display = n.type ? 'inline-block' : 'none';
  const body = $('pBody');
  body.textContent = 'loading…';
  try {
    const r = await fetch('/api/file?bundle=' + encodeURIComponent(view.bundle) + '&path=' + encodeURIComponent(n.id));
    body.textContent = r.ok ? await r.text() : '(could not load file)';
  } catch { body.textContent = '(could not load file)'; }
}
$('pClose').onclick = () => $('panel').classList.remove('open');

cv.onmousedown = e => {
  const node = at(e.clientX, e.clientY);
  down = { x: e.clientX, y: e.clientY, node };
  drag = node;
  panning = node ? null : { x: e.clientX - tx, y: e.clientY - ty };
};
cv.onmouseup = e => {
  drag = null; panning = null;
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
  if (!moved) {
    // A click on empty space does nothing on purpose: leaving a bundle is the back button
    // or Escape only. Backing out on a stray click made the canvas hostile to pan and poke.
    const n = down.node;
    if (n && view.level === 'bundles') { view = { level: 'concepts', bundle: n.id }; build(); }
    else if (n) openPanel(n);
  }
  down = null;
};
cv.onmousemove = e => {
  if (panning) { tx = e.clientX - panning.x; ty = e.clientY - panning.y; cv.style.cursor = 'grabbing'; return; }
  if (drag) { const p = toWorld(e.clientX, e.clientY); drag.x = p.x; drag.y = p.y; drag.vx = drag.vy = 0; return; }
  hover = at(e.clientX, e.clientY);
  cv.style.cursor = hover ? 'pointer' : 'grab';
};
cv.onmouseleave = () => { drag = null; panning = null; down = null; hover = null; };
cv.onwheel = e => {
  e.preventDefault();
  const ns = Math.min(4, Math.max(0.15, scale * Math.exp(-e.deltaY * 0.0015)));
  const k = ns / scale;                       // keep the point under the cursor put
  tx = e.clientX - (e.clientX - tx) * k;
  ty = e.clientY - (e.clientY - ty) * k;
  scale = ns;
};

$('refresh').onclick = async () => {
  const btn = $('refresh');
  btn.disabled = true;
  try {
    DATA = await (await fetch('/api/graph?rebuild=1')).json();
    if (view.level !== 'bundles' && !DATA.bundleGraphs[view.bundle]) view = { level: 'bundles', bundle: null };
    build();
  } finally { btn.disabled = false; }
};

// Tell the server someone's still looking, so it can shut itself down once we're gone.
fetch('/api/heartbeat').catch(() => {});
setInterval(() => fetch('/api/heartbeat').catch(() => {}), 3000);
addEventListener('pagehide', () => navigator.sendBeacon('/api/close'));

build();
(function loop(){ step(); draw(); requestAnimationFrame(loop); })();
</script>`;
}
