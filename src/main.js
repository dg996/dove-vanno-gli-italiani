import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import './style.css';
import { initStory } from './story.js';
import * as d3 from 'd3';
import { feature, mesh, merge } from 'topojson-client';

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('it-IT', { useGrouping: 'always' });
const fmtPct = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + '%';

const DOMAIN = 30; // ±30% clamp
const NB = 121;
// colour-blind-safe diverging scale: orange = loss, blue = growth, light grey = no change
const PALETTE = ['#8f3a0f', '#c25a1f', '#e9a57a', '#e4e1da', '#9fc2dc', '#4f86b4', '#1f4f7a'];
const interp = d3.piecewise(d3.interpolateLab, PALETTE);
const LUT = d3.range(NB).map((i) => d3.color(interp(i / (NB - 1))).formatHex());
const NULLC = '#cfcbc2';

async function main() {
  const [topo, pop, flows] = await Promise.all([
    fetch('/data/comuni.topo.json').then((r) => r.json()),
    fetch('/data/pop.json').then((r) => r.json()),
    fetch('/data/flows.json').then((r) => r.json()),
  ]);
  const years = pop.years;
  const NY = years.length;
  const obj = topo.objects.comuni;
  const feats = feature(topo, obj).features;
  const N = feats.length;
  const data = feats.map((f) => pop.comuni[f.id]);
  const vals = new Float64Array(N * NY).fill(NaN);
  data.forEach((d, i) => d && d.v.forEach((v, j) => { if (v != null) vals[i * NY + j] = v; }));
  const base = new Float64Array(N).map((_, i) => vals[i * NY]);
  const natTot = years.map((_, j) => { let s = 0; for (let i = 0; i < N; i++) { const v = vals[i * NY + j]; if (v === v) s += v; } return s; });

  const meshComuni = mesh(topo, obj, (a, b) => a !== b);
  const meshProv = mesh(topo, obj, (a, b) => a !== b && a.properties.p !== b.properties.p);
  const meshReg = mesh(topo, obj, (a, b) => a !== b && a.properties.r !== b.properties.r);
  const meshCoast = mesh(topo, obj, (a, b) => a === b);

  const canvas = $('map');
  const appEl = $('app');
  let mapVisible = true, pendingDraw = false;
  const ctx = canvas.getContext('2d');
  const hitCtx = document.createElement('canvas').getContext('2d');
  let W, H, dpr, paths, bounds, grid, GS = 16, gw, gh, P = {}, projection;
  let transform = d3.zoomIdentity;
  let t = 0; // fractional year index
  let hover = -1, pinned = -1;
  let hl = null; // {set:Set(index), outline:Path2D}
  let story = { update() {}, setPlaying() {} };

  function mapRect() {
    const mobile = W <= 820;
    const hero = document.querySelector('.hero'); const hb = hero.offsetTop + hero.offsetHeight;
    return mobile ? [[12, hb + 44], [W - 12, H - 170]] : [[W > 1180 ? 370 : 20, 24], [W - (W > 1180 ? 390 : 20), H - 96]];
  }

  function layout() {
    const hero = document.querySelector('.hero'); const hb = hero.offsetTop + hero.offsetHeight;
    document.documentElement.style.setProperty('--hb', Math.round(hb) + 'px');
  }
  function setup() {
    layout();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    projection = d3.geoConicConformal().parallels([38, 46]).rotate([-12.5, 0]).fitExtent(mapRect(), { type: 'FeatureCollection', features: feats });
    const gp = d3.geoPath(projection);
    paths = new Array(N); bounds = new Array(N);
    for (let i = 0; i < N; i++) {
      const p = new Path2D(); d3.geoPath(projection, p)(feats[i]); paths[i] = p; bounds[i] = gp.bounds(feats[i]);
    }
    for (const [k, m] of Object.entries({ com: meshComuni, prov: meshProv, reg: meshReg, coast: meshCoast })) {
      const p = new Path2D(); d3.geoPath(projection, p)(m); P[k] = p;
    }
    gw = Math.ceil(W / GS) + 1; gh = Math.ceil(H / GS) + 1;
    grid = Array.from({ length: gw * gh }, () => []);
    bounds.forEach(([[x0, y0], [x1, y1]], i) => {
      for (let gx = Math.max(0, Math.floor(x0 / GS)); gx <= Math.min(gw - 1, Math.floor(x1 / GS)); gx++)
        for (let gy = Math.max(0, Math.floor(y0 / GS)); gy <= Math.min(gh - 1, Math.floor(y1 / GS)); gy++) grid[gy * gw + gx].push(i);
    });
    if (hl) hl = makeHighlight(hl.level, hl.codes);
    if (typeof setupFlows === 'function') setupFlows();
  }

  function valueAt(i, tt) {
    const j = Math.floor(tt), f = tt - j;
    const a = vals[i * NY + j];
    if (f === 0 || j >= NY - 1) return a;
    const b = vals[i * NY + j + 1];
    if (a !== a) return f > 0.5 ? b : NaN;
    if (b !== b) return a;
    return a + (b - a) * f;
  }
  function pctAt(i, tt) {
    const b = base[i];
    if (!(b > 0)) {
      // comuni without 2002 data: compare with first available year
      let j0 = 0; while (j0 < NY && vals[i * NY + j0] !== vals[i * NY + j0]) j0++;
      if (j0 >= NY || tt < j0) return NaN;
      const v = valueAt(i, tt); return (v / vals[i * NY + j0] - 1) * 100;
    }
    const v = valueAt(i, tt);
    return v === v ? (v / b - 1) * 100 : NaN;
  }
  const bucket = (pc) => pc !== pc ? -1 : Math.round((Math.max(-DOMAIN, Math.min(DOMAIN, pc)) + DOMAIN) / (2 * DOMAIN) * (NB - 1));

  const groups = Array.from({ length: NB + 1 }, () => []);
  let raf = 0;
  const requestDraw = () => { if (!raf) raf = requestAnimationFrame(draw); };
  function draw() {
    raf = 0;
    if (!mapVisible) { pendingDraw = true; return; }
    if (mode === 'flows') { if (!flowRaf) flowRaf = requestAnimationFrame(flowLoop); return; }
    const k = transform.k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * transform.x, dpr * transform.y);
    for (const g of groups) g.length = 0;
    for (let i = 0; i < N; i++) groups[bucket(pctAt(i, t)) + 1].push(i);
    ctx.fillStyle = NULLC; ctx.fill(P.coast);
    for (let g = 0; g <= NB; g++) {
      const arr = groups[g]; if (!arr.length) continue;
      ctx.fillStyle = g === 0 ? NULLC : LUT[g - 1];
      if (hl) {
        for (const i of arr) { ctx.globalAlpha = hl.set.has(i) ? 1 : 0.25; ctx.fill(paths[i]); }
        ctx.globalAlpha = 1;
      } else for (const i of arr) ctx.fill(paths[i]);
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 0.3 / k; ctx.stroke(P.com);
    ctx.strokeStyle = 'rgba(40,40,40,.18)'; ctx.lineWidth = 0.5 / k; ctx.stroke(P.prov);
    ctx.strokeStyle = 'rgba(30,30,30,.55)'; ctx.lineWidth = 0.8 / k; ctx.stroke(P.reg);
    ctx.strokeStyle = 'rgba(30,30,30,.6)'; ctx.lineWidth = 0.8 / k; ctx.stroke(P.coast);
    if (hl) { ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2 / k; ctx.stroke(hl.outline); }
    const sel = pinned >= 0 ? pinned : hover;
    if (sel >= 0) { ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2 / k; ctx.stroke(paths[sel]); }
  }

  // ---- UI: year, stats ----
  const yearEl = $('year'), yearTag = $('yearTag'), statPop = $('statPop'), statLoss = $('statLoss');
  const lossCount = years.map((_, j) => { let c = 0; for (let i = 0; i < N; i++) { const v = vals[i * NY + j]; if (base[i] > 0 && v === v && v < base[i]) c++; } return c; });
  function updateUI() {
    const j = Math.min(NY - 1, Math.round(t));
    yearEl.textContent = years[j];
    yearTag.textContent = pop.estimateYears.includes(years[j]) ? 'stima ISTAT' : '1° gennaio';
    const jf = Math.floor(t), f = t - jf;
    const tot = jf >= NY - 1 ? natTot[NY - 1] : natTot[jf] + (natTot[jf + 1] - natTot[jf]) * f;
    statPop.textContent = (tot / 1e6).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' mln';
    statLoss.textContent = fmt.format(lossCount[j]) + ' su ' + fmt.format(N);
    slider.value = t;
    ticks.querySelectorAll('span').forEach((s, i) => s.classList.toggle('on', i === j));
    const sel = pinned >= 0 ? pinned : hover;
    if (mode === 'flows') { updateFlowHero(); if (selReg) renderFlowPanel(); }
    else if (sel >= 0) renderTooltip(sel);
    story.update(t);
  }
  function setT(v) { t = Math.max(0, Math.min(NY - 1, v)); updateUI(); requestDraw(); }

  // legend
  const lg = $('legendBar').getContext('2d');
  LUT.forEach((c, i) => { lg.fillStyle = c; lg.fillRect(i * 260 / NB, 0, 260 / NB + 1, 8); });

  // ---- timeline ----
  const slider = $('slider'), ticks = $('ticks'), playBtn = $('play');
  slider.max = NY - 1;
  years.forEach((y, j) => {
    const s = document.createElement('span');
    s.textContent = "'" + String(y).slice(2);
    if (j === 0 || j === NY - 1 || (y - years[0]) % 6 === 0) { s.classList.add('major'); s.textContent = y; }
    s.style.left = (j / (NY - 1) * 100) + '%';
    s.onclick = () => { stop(); animateTo(j); };
    ticks.appendChild(s);
  });
  slider.addEventListener('input', () => { stop(); setT(+slider.value); });
  let playing = false, last = 0;
  const SPEED = 1 / 650; // years per ms
  function loop(ts) {
    if (!playing) return;
    const dt = Math.min(64, ts - (last || ts)); last = ts;
    const nt = t + dt * SPEED;
    if (nt >= NY - 1) { setT(NY - 1); stop(); return; }
    setT(nt); requestAnimationFrame(loop);
  }
  function play() { if (t >= NY - 1) setT(0); playing = true; last = 0; playBtn.textContent = 'Pausa'; story.setPlaying(true); requestAnimationFrame(loop); }
  function stop() { playing = false; animId++; playBtn.textContent = 'Riproduci'; story.setPlaying(false); }
  playBtn.onclick = () => (playing ? stop() : play());
  let animId = 0;
  function animateTo(j) {
    const t0 = t; const st = performance.now(); const id = ++animId;
    const step = (now) => { if (id !== animId) return; const p = Math.min(1, (now - st) / 600); setT(t0 + (j - t0) * d3.easeCubicInOut(p)); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  window.addEventListener('keydown', (e) => {
    if ((e.target.tagName === 'INPUT' && e.target.type !== 'range') || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); playing ? stop() : play(); }
    if (e.code === 'ArrowRight') { stop(); setT(Math.floor(t) + 1); }
    if (e.code === 'ArrowLeft') { stop(); setT(Math.ceil(t) - 1); }
  });

  // ---- zoom ----
  // the page scrolls normally: wheel zooms only with Ctrl/Cmd, touch pans/zooms with two fingers (or one, once zoomed in)
  const zoom = d3.zoom().scaleExtent([1, 80])
    .filter((e) => {
      if (e.type === 'wheel') return e.ctrlKey || e.metaKey;
      if (e.type === 'touchstart') return e.touches.length > 1 || transform.k > 1.05;
      return !e.button;
    })
    .on('zoom', (e) => {
    transform = e.transform; $('resetZoom').hidden = transform.k < 1.05; canvas.style.touchAction = transform.k > 1.05 ? 'none' : 'pan-y'; requestDraw();
  });
  const sel = d3.select(canvas).call(zoom);
  $('zoomIn').onclick = () => sel.transition().duration(300).call(zoom.scaleBy, 1.6);
  $('zoomOut').onclick = () => sel.transition().duration(300).call(zoom.scaleBy, 1 / 1.6);
  $('resetZoom').onclick = () => { clearHighlight(); sel.transition().duration(900).call(zoom.transform, d3.zoomIdentity); };
  function zoomToIdx(idxs) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const i of idxs) { const b = bounds[i]; x0 = Math.min(x0, b[0][0]); y0 = Math.min(y0, b[0][1]); x1 = Math.max(x1, b[1][0]); y1 = Math.max(y1, b[1][1]); }
    let [[rx0, ry0], [rx1, ry1]] = mapRect();
    if (W <= 820) ry1 = Math.max(ry0 + 120, H - (H * 0.40 + 84) - 8);
    const k = Math.max(1, Math.min(40, 0.85 / Math.max((x1 - x0) / (rx1 - rx0), (y1 - y0) / (ry1 - ry0))));
    const cx = (rx0 + rx1) / 2, cy = (ry0 + ry1) / 2;
    sel.transition().duration(1400).ease(d3.easeCubicInOut).call(zoom.transform, d3.zoomIdentity.translate(cx, cy).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
  }

  // ---- hover / tap ----
  function pick(cx, cy) {
    const [x, y] = transform.invert([cx, cy]);
    const gx = Math.floor(x / GS), gy = Math.floor(y / GS);
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return -1;
    for (const i of grid[gy * gw + gx]) {
      const b = bounds[i];
      if (x >= b[0][0] && x <= b[1][0] && y >= b[0][1] && y <= b[1][1] && hitCtx.isPointInPath(paths[i], x, y)) return i;
    }
    return -1;
  }
  const tip = $('tooltip');
  let tipPos = [0, 0];
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    const r = canvas.getBoundingClientRect();
    if (mode === 'flows') { const rg = regionAt(e.clientX - r.left, e.clientY - r.top); if (rg !== hoverReg) { hoverReg = rg; canvas.style.cursor = rg ? 'pointer' : ''; } return; }
    const i = pick(e.clientX - r.left, e.clientY - r.top);
    tipPos = [e.clientX, e.clientY];
    if (i !== hover) { hover = i; requestDraw(); }
    if (pinned < 0) { if (i >= 0) renderTooltip(i); else tip.hidden = true; }
  });
  canvas.addEventListener('pointerleave', () => { hover = -1; if (pinned < 0) tip.hidden = true; requestDraw(); });
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    if (mode === 'flows') { const rg = regionAt(e.clientX - r.left, e.clientY - r.top); selectRegion(rg && rg !== selReg ? rg : null); return; }
    const i = pick(e.clientX - r.left, e.clientY - r.top);
    tipPos = [e.clientX, e.clientY];
    pinned = i === pinned ? -1 : i;
    if (pinned >= 0) renderTooltip(pinned); else if (e.pointerType !== 'mouse') tip.hidden = true;
    requestDraw();
  });

  function renderTooltip(i) {
    const d = data[i]; if (!d) return;
    const j = Math.min(NY - 1, Math.round(t));
    const v = vals[i * NY + j];
    const pc = pctAt(i, j);
    const prov = pop.provinces[d.p];
    const reg = pop.regions[d.r];
    const series = years.map((y, k) => [y, vals[i * NY + k]]).filter(([, v]) => v === v);
    const w = 210, h = 46;
    const x = d3.scaleLinear([years[0], years[NY - 1]], [3, w - 3]);
    const y = d3.scaleLinear(d3.extent(series, (s) => s[1]), [h - 4, 4]).nice();
    const line = d3.line((s) => x(s[0]), (s) => y(s[1]))(series);
    const area = d3.area((s) => x(s[0]), h, (s) => y(s[1]))(series);
    const col = pc < 0 ? '#b54a14' : '#245d8f';
    const merged = d.m ? `<div class="note">Include i comuni fusi: ${d.m.join(', ')}</div>` : '';
    tip.innerHTML = `<h4>${d.n}</h4><div class="sub">${prov ? prov.n + ' (' + prov.s + ')' : ''} · ${reg || ''}</div>
      <div class="row"><span>Residenti ${years[j]}${pop.estimateYears.includes(years[j]) ? ' (stima)' : ''}</span><b>${v === v ? fmt.format(v) : 'n.d.'}</b></div>
      <div class="row"><span>Residenti ${years[0]}</span><span>${base[i] > 0 ? fmt.format(base[i]) : 'n.d.'}</span></div>
      <div class="row"><span>Variazione</span><span class="${pc < 0 ? 'neg' : 'pos'}">${pc === pc ? fmtPct(pc) : 'n.d.'}</span></div>
      <svg width="${w}" height="${h}"><line x1="0" x2="${w}" y1="${h}" y2="${h}" stroke="#d6d2c8"/><path d="${line}" fill="none" stroke="${col}" stroke-width="1.5"/>
      ${v === v ? `<circle cx="${x(years[j])}" cy="${y(v)}" r="3" fill="#fff" stroke="#1a1a1a" stroke-width="1.5"/>` : ''}</svg>${merged}`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const ar = appEl.getBoundingClientRect(); const px = tipPos[0] - ar.left, py = tipPos[1] - ar.top;
    let left = px + 16, top = py + 16;
    if (left + tw > W - 8) left = px - tw - 16;
    if (top + th > H - 8) top = py - th - 16;
    tip.style.left = Math.max(8, left) + 'px'; tip.style.top = Math.max(8, top) + 'px';
  }

  // ================= SPOSTAMENTI (flows) =================
  const FL = flows;
  const FY = FL.years;
  const REG = Object.keys(FL.regions);
  const SOUTH = new Set(['13', '14', '15', '16', '17', '18', '19', '20']);
  const regFeat = {}; const regPath = {}; const regC = {};
  REG.forEach((r) => { regFeat[r] = merge(topo, obj.geometries.filter((g) => String(g.properties.r) === r)); });
  // region population per year (from the population series) for per-1000 rates
  const regPop = {}; REG.forEach((r) => (regPop[r] = years.map(() => 0)));
  for (let i = 0; i < N; i++) { const r = String(data[i].r); for (let j = 0; j < NY; j++) { const v = vals[i * NY + j]; if (v === v) regPop[r][j] += v; } }
  // cumulative matrix
  const cum = new Map(); const cumAb = {}; REG.forEach((r) => (cumAb[r] = [0, 0, 0, 0]));
  FY.forEach((y) => { FL.od[y].forEach(([o, d, v]) => cum.set(o + '>' + d, (cum.get(o + '>' + d) || 0) + v)); REG.forEach((r) => FL.abroad[y][r].forEach((v, k) => (cumAb[r][k] += v))); });
  const cumOD = [...cum].map(([k, v]) => [...k.split('>'), v]).sort((a, b) => b[2] - a[2]);
  const maxYearFlow = Math.max(...FY.map((y) => Math.max(FL.od[y][0][2], ...REG.map((r) => FL.abroad[y][r][0]))));
  const maxCumFlow = Math.max(cumOD[0][2], ...REG.map((r) => cumAb[r][0]));
  let mode = 'pop', selReg = null, period = 'year', hoverReg = null;
  // one muted hue: dark ink for the flows that matter, grey for the rest; abroad is dashed
  const COL = { s2n: '#1a1a1a', n2s: '#7d7d7d', same: '#7d7d7d', abroad: '#1a1a1a', out: '#1a1a1a', in: '#8a8a8a' };
  const ABROAD_LL = [15.9, 47.3];
  function setupFlows() {
    const gp = d3.geoPath(projection);
    REG.forEach((r) => { const p = new Path2D(); d3.geoPath(projection, p)(regFeat[r]); regPath[r] = p; regC[r] = gp.centroid(regFeat[r]); });
    // nicer anchors for oddly-shaped regions (still inside the region)
    const adj = { '12': [12.6, 41.9], '15': [14.6, 40.9], '16': [16.6, 41.0], '7': [8.9, 44.4], '20': [9.0, 40.1] };
    for (const [r, ll] of Object.entries(adj)) regC[r] = projection(ll);
  }
  const flowYear = () => { const y = years[Math.min(NY - 1, Math.round(t))]; return Math.min(y, FY[FY.length - 1]); };
  function currentFlows() {
    const y = flowYear(); const all = period === 'all';
    const od = all ? cumOD : FL.od[y];
    const ab = (r) => (all ? cumAb[r] : FL.abroad[y][r]);
    const mobile = W <= 820; let list = [];
    if (selReg) {
      od.forEach(([o, d, v]) => { if (o === selReg) list.push({ o, d, v, c: COL.out }); else if (d === selReg) list.push({ o, d, v, c: COL.in }); });
      list.push({ o: selReg, d: 'X', v: ab(selReg)[0], c: COL.abroad });
    } else {
      list = od.slice(0, mobile ? 28 : 55).map(([o, d, v]) => ({ o, d, v, c: SOUTH.has(o) && !SOUTH.has(d) ? COL.s2n : !SOUTH.has(o) && SOUTH.has(d) ? COL.n2s : COL.same }));
      REG.map((r) => ({ o: r, d: 'X', v: ab(r)[0], c: COL.abroad })).sort((a, b) => b.v - a.v).slice(0, mobile ? 8 : 12).forEach((f) => list.push(f));
    }
    return { list, max: all ? maxCumFlow : maxYearFlow, y };
  }
  function anchorScreen() {
    const p = transform.apply(projection(ABROAD_LL));
    const top = W <= 820 ? (document.getElementById('modeToggle').getBoundingClientRect().bottom + 20) : 30;
    return [Math.max(26, Math.min(W - 26, p[0])), Math.max(top, Math.min(H - 120, p[1]))];
  }
  function regNet(r, j) {
    const y = Math.min(years[j], FY[FY.length - 1]);
    let net = FL.abroad[y][r][3] - FL.abroad[y][r][1];
    FL.od[y].forEach(([o, d, v]) => { if (d === r) net += v; if (o === r) net -= v; });
    return net / regPop[r][years.indexOf(y)] * 1000;
  }
  let particlesT0 = performance.now();
  function drawFlows(now) {
    const k = transform.k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * transform.x, dpr * transform.y);
    ctx.fillStyle = NULLC; ctx.fill(P.coast);
    const j = Math.min(NY - 1, Math.round(t));
    REG.forEach((r) => {
      const n = regNet(r, j); const b = Math.round((Math.max(-10, Math.min(10, n)) + 10) / 20 * (NB - 1));
      ctx.globalAlpha = selReg && selReg !== r ? 0.35 : 0.75; ctx.fillStyle = LUT[b]; ctx.fill(regPath[r]);
    });
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 / k; ctx.stroke(P.reg); ctx.strokeStyle = 'rgba(30,30,30,.55)'; ctx.lineWidth = 0.8 / k; ctx.stroke(P.coast);
    if (selReg) { ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2 / k; ctx.stroke(regPath[selReg]); }
    else if (hoverReg) { ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.4 / k; ctx.stroke(regPath[hoverReg]); }
    // arcs in screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { list, max } = currentFlows();
    const X = anchorScreen();
    const pt = (r) => (r === 'X' ? X : transform.apply(regC[r]));
    const sum = list.reduce((s, f) => s + f.v, 0) || 1;
    const budget = W <= 820 ? 420 : 900;
    const time = (now - particlesT0) / 1000;
    ctx.lineCap = 'round';
    const geo = list.map((f) => {
      const a = pt(f.o), b = pt(f.d); const dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1;
      const c = [(a[0] + b[0]) / 2 - dy * 0.22, (a[1] + b[1]) / 2 + dx * 0.22];
      return { ...f, a, b, q: c, len, w: 0.5 + 7 * Math.sqrt(f.v / max), strong: f.d !== 'X' && (f.c === COL.s2n || f.c === COL.out) };
    });
    geo.sort((x, y) => x.strong - y.strong); // emphasised flows on top
    for (const g of geo) {
      ctx.strokeStyle = g.c; ctx.globalAlpha = (g.strong ? 0.28 : 0.16) + 0.3 * Math.sqrt(g.v / max); ctx.lineWidth = g.w;
      ctx.setLineDash(g.d === 'X' ? [4, 4] : []);
      ctx.beginPath(); ctx.moveTo(g.a[0], g.a[1]); ctx.quadraticCurveTo(g.q[0], g.q[1], g.b[0], g.b[1]); ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const g of geo) {
      const n = Math.max(1, Math.min(30, Math.round(g.v / sum * budget)));
      const speed = 55 / g.len; ctx.fillStyle = g.c; ctx.globalAlpha = g.strong ? 0.85 : 0.6;
      const sz = Math.min(2.6, 1.2 + g.w * 0.15);
      for (let i = 0; i < n; i++) {
        const u = (i / n + time * speed) % 1; const v1 = 1 - u;
        const x = v1 * v1 * g.a[0] + 2 * v1 * u * g.q[0] + u * u * g.b[0];
        const y = v1 * v1 * g.a[1] + 2 * v1 * u * g.q[1] + u * u * g.b[1];
        ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1;
    // abroad anchor
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(X[0] - 4, X[1] - 4, 8, 8);
    ctx.font = '600 12.5px "IBM Plex Sans", sans-serif'; ctx.fillStyle = '#1a1a1a'; ctx.textAlign = 'left'; ctx.fillText('Estero', X[0] + 9, X[1] + 4);
    // labels for top destinations of the selected region
    if (selReg) {
      ctx.font = '500 12px "IBM Plex Sans", sans-serif'; ctx.textAlign = 'center';
      geo.filter((g) => g.o === selReg && g.d !== 'X').sort((a, b) => b.v - a.v).slice(0, 5).forEach((g) => {
        const s = FL.regions[g.d].split('/')[0] + ' ' + fmt.format(g.v); const w = ctx.measureText(s).width + 12;
        ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.fillRect(g.b[0] - w / 2, g.b[1] - 24, w, 18);
        ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 0.8; ctx.strokeRect(g.b[0] - w / 2 + .5, g.b[1] - 23.5, w - 1, 17);
        ctx.fillStyle = '#1a1a1a'; ctx.fillText(s, g.b[0], g.b[1] - 11);
      });
    }
  }
  let flowRaf = 0;
  function flowLoop(now) { flowRaf = 0; if (mode !== 'flows' || !mapVisible) return; drawFlows(now); flowRaf = requestAnimationFrame(flowLoop); }
  const fpanel = $('flowPanel');
  let panelSuppressed = false;
  function renderFlowPanel() {
    if (!selReg || panelSuppressed) { fpanel.hidden = true; return; }
    const y = flowYear(); const all = period === 'all'; const r = selReg;
    const od = all ? cumOD : FL.od[y]; const ab = all ? cumAb[r] : FL.abroad[y][r];
    const outs = od.filter((f) => f[0] === r).sort((a, b) => b[2] - a[2]);
    const ins = od.filter((f) => f[1] === r).sort((a, b) => b[2] - a[2]);
    const tout = d3.sum(outs, (f) => f[2]), tin = d3.sum(ins, (f) => f[2]);
    const net = tin - tout;
    const li = (arr, i) => arr.slice(0, 6).map((f) => `<li><span>${FL.regions[f[i]].split('/')[0]}</span><b>${fmt.format(f[2])}</b></li>`).join('');
    const label = all ? `${FY[0]}–${FY[FY.length - 1]}` : y + (FL.provisional.includes(y) ? ' (provv.)' : '');
    fpanel.innerHTML = `<button class="close" id="fpClose" aria-label="Chiudi">×</button>
      <div class="fp-head"><h3>${FL.regions[r].split('/')[0]}</h3>
      <div class="seg small-seg"><button data-p="year" class="${all ? '' : 'on'}">${y}</button><button data-p="all" class="${all ? 'on' : ''}">${FY[0]}–${FY[FY.length - 1]}</button></div></div>
      <div class="fp-net">Saldo con le altre regioni (${label}): <b class="${net < 0 ? 'neg' : 'pos'}">${net > 0 ? '+' : net < 0 ? '−' : ''}${fmt.format(Math.abs(net))}</b></div>
      <div class="fp-cols"><div><h5>Partiti verso: ${fmt.format(tout)}</h5><ol>${li(outs, 1)}</ol></div>
      <div><h5>Arrivati da: ${fmt.format(tin)}</h5><ol>${li(ins, 0)}</ol></div></div>
      <div class="fp-abroad"><span>Italiani emigrati all'estero</span><b>${fmt.format(ab[0])}</b></div>
      <div class="fp-abroad"><span>Italiani rientrati dall'estero</span><b>${fmt.format(ab[2])}</b></div>
      <div class="fp-abroad mut"><span>Totale cancellati per l'estero / iscritti dall'estero (anche stranieri)</span><b>${fmt.format(ab[1])} / ${fmt.format(ab[3])}</b></div>`;
    fpanel.hidden = false;
    $('fpClose').onclick = () => selectRegion(null);
    fpanel.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { period = b.dataset.p; renderFlowPanel(); }));
  }
  function selectRegion(r, quiet = false) { selReg = r; panelSuppressed = quiet; document.body.classList.toggle('sel', !!r); if (!r) period = 'year'; renderFlowPanel(); updateFlowHero(); drawLegend(); }
  const H0 = FL.head;
  function updateFlowHero() {
    if (mode !== 'flows') return;
    const y = flowYear(); let s2n = 0, n2s = 0;
    FL.od[y].forEach(([o, d, v]) => { if (SOUTH.has(o) && !SOUTH.has(d)) s2n += v; if (!SOUTH.has(o) && SOUTH.has(d)) n2s += v; });
    $('flowYearLine').innerHTML = `Nel ${y}${FL.provisional.includes(y) ? ' (provvisorio)' : ''}: ${fmt.format(s2n)} dal Sud al Centro-Nord, ${fmt.format(n2s)} in senso opposto; ${fmt.format(FL.abroad[y].IT[0])} italiani cancellati per l'estero.`;
  }
  const mln = (v) => (v / 1e6).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' mln';
  $('statNetSud').textContent = '−' + mln(-H0.saldo_sud);
  $('statEmi').textContent = mln(H0.italiani_emigrati);
  function setMode(m) {
    if (m === mode) return;
    mode = m; document.body.classList.toggle('flows', m === 'flows'); layout();
    document.querySelectorAll('#modeToggle button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    tip.hidden = true; pinned = -1; hover = -1; hoverReg = null;
    if (m === 'flows') { hl = null; updateFlowHero(); renderFlowPanel(); if (!flowRaf) flowRaf = requestAnimationFrame(flowLoop); }
    else { selectRegion(null); fpanel.hidden = true; requestDraw(); }
    drawLegend();
  }
  document.querySelectorAll('#modeToggle button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  function drawLegend() {
    const f = mode === 'flows';
    $('legendTitle').textContent = f ? 'Saldo migratorio totale, per 1.000 residenti' : 'Variazione dei residenti rispetto al 2002';
    $('legendLabels').innerHTML = f ? '<span>−10‰</span><span>0</span><span>+10‰</span>' : '<span>−30%</span><span>0</span><span>+30%</span>';
    $('legendFlows').hidden = !f;
    const sw = (c, dash, w = 2.5) => `<svg width="22" height="6"><line x1="1" x2="21" y1="3" y2="3" stroke="${c}" stroke-width="${w}" ${dash ? 'stroke-dasharray="4 3"' : ''}/></svg>`;
    $('legendFlows').innerHTML = selReg
      ? `<span>${sw(COL.out)}partenze dalla regione</span><span>${sw(COL.in)}arrivi nella regione</span><span>${sw('#1a1a1a', 1)}verso l'estero</span>`
      : `<span>${sw(COL.s2n)}dal Sud e Isole al Centro-Nord</span><span>${sw(COL.same)}altri spostamenti tra regioni</span><span>${sw('#1a1a1a', 1)}italiani verso l'estero</span>`;
  }
  function regionAt(cx, cy) { const i = pick(cx, cy); return i >= 0 ? String(data[i].r) : null; }

  // ---- highlight + AI ----
  function makeHighlight(level, codes) {
    const cs = new Set(codes.map(String));
    const test = level === 'regione' ? (p) => cs.has(String(p.r)) : level === 'provincia' ? (p) => cs.has(String(p.p)) : null;
    const inH = (g) => (test ? test(g.properties) : cs.has(String(g.id)));
    const set = new Set(); feats.forEach((f, i) => { if (inH(f)) set.add(i); });
    const outline = new Path2D();
    d3.geoPath(projection, outline)(mesh(topo, obj, (a, b) => (a === b ? inH(a) : inH(a) !== inH(b))));
    return { level, codes, set, outline };
  }
  function clearHighlight() { hl = null; requestDraw(); }
  window.__map = { setT, play, years, get t() { return t; }, pick, feats, data, zoomToIdx, get hl() { return hl; }, project: (lonlat) => transform.apply(projection(lonlat)), screenOf: (id) => { const i = feats.findIndex((f) => f.id === id); const c = transform.apply(d3.geoPath(projection).centroid(feats[i]));
      if (pick(c[0], c[1]) === i) return c; const [[x0, y0], [x1, y1]] = bounds[i];
      for (let a = 1; a < 20; a++) for (let b = 1; b < 20; b++) { const p = transform.apply([x0 + (x1 - x0) * a / 20, y0 + (y1 - y0) * b / 20]); if (pick(p[0], p[1]) === i) return p; } return c; }, stop, setMode, selectRegion, get mode() { return mode; }, get selReg() { return selReg; }, regC: () => Object.fromEntries(REG.map((r) => [r, transform.apply(regC[r])])), currentFlows: () => currentFlows() };

  const form = $('askForm'), input = $('askInput'), btn = $('askBtn'), ans = $('answer');
  $('chips').querySelectorAll('button').forEach((b) => (b.onclick = () => { input.value = b.textContent; form.requestSubmit(); }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim(); if (q.length < 3) return;
    btn.disabled = true; ans.hidden = false; ans.className = 'answer'; ans.innerHTML = '<span class="meta">Sto leggendo i dati ISTAT…</span>';
    try {
      const r = await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q }) });
      const j = await r.json().catch(() => ({}));
      if (j.mode === 'flows') {
        setMode('flows'); stop(); animateTo(years.indexOf(FY[FY.length - 1]) - 1);
        sel.transition().duration(900).call(zoom.transform, d3.zoomIdentity);
        period = 'all'; selectRegion(j.flowRegion || null, W <= 820);
      } else if (j.highlight) {
        setMode('pop');
        hl = makeHighlight(j.highlight.level, j.highlight.codes); requestDraw();
        if (hl.set.size) zoomToIdx([...hl.set]);
        stop(); animateTo(years.indexOf(2025));
      } else { clearHighlight(); sel.transition().duration(900).call(zoom.transform, d3.zoomIdentity); }
      if (!r.ok || !j.answer) throw new Error(j.error || 'Errore');
      ans.innerHTML = '<button class="ans-close" aria-label="Chiudi risposta">×</button>' + (j.highlight ? `<div class="area">${j.highlight.label}</div>` : '') + '<div class="txt"></div><div class="meta">Risposta generata dall’AI usando solo aggregati calcolati dai dati ISTAT. Controlla sempre la mappa.</div>';
      ans.querySelector('.ans-close').onclick = () => { ans.hidden = true; clearHighlight(); sel.transition().duration(900).call(zoom.transform, d3.zoomIdentity); };
      const el = ans.querySelector('.txt'); const txt = j.answer; let n = 0;
      const tick = () => { n = Math.min(txt.length, n + 4); el.textContent = txt.slice(0, n); if (n < txt.length) requestAnimationFrame(tick); };
      tick();
    } catch (err) {
      ans.className = 'answer err'; ans.textContent = err.message || 'Errore di rete';
    } finally { btn.disabled = false; }
  });

  // map drawing pauses while the map is scrolled out of view
  new IntersectionObserver(([e]) => {
    mapVisible = e.isIntersecting;
    if (mapVisible) { if (mode === 'flows') { if (!flowRaf) flowRaf = requestAnimationFrame(flowLoop); } else if (pendingDraw) { pendingDraw = false; requestDraw(); } }
  }).observe(appEl);

  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { setup(); requestDraw(); }, 150); });
  story = initStory({ years, vals, base, N, NY, data, natTot, lossCount, pop, flows: FL, regPop, SOUTH, LUT, NB, fmt, fmtPct,
    setYear: (j) => { stop(); animateTo(j); }, jumpYear: (j) => { stop(); setT(j); }, togglePlay: () => (playing ? stop() : play()) });
  setup(); drawLegend(); updateUI(); draw();
  if (new URLSearchParams(location.search).get('mode') === 'flows') setMode('flows');
  $('loading').classList.add('done');
  window.__ready = true;
  if (!new URLSearchParams(location.search).has('noplay')) setTimeout(play, 900);
}

main().catch((e) => { console.error(e); $('loading').innerHTML = '<span>Errore nel caricamento dei dati.</span>'; });
