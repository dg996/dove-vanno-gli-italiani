// Scroll-driven charts and tables below the map. Everything is computed from the same
// ISTAT-derived files used by the map (public/data/pop.json, public/data/flows.json).
import * as d3 from 'd3';
const INK = '#1a1a1a', GREY = '#9a9a9a', LIGHT = '#d6d2c8', LOSS = '#b54a14', GAIN = '#245d8f';

export function initStory(o) {
  const { years, vals, base, N, NY, data, natTot, lossCount, pop, flows: FL, regPop, SOUTH, fmt, fmtPct } = o;
  const $ = (id) => document.getElementById(id);
  const FY = FL.years, lastFY = FY[FY.length - 1];
  const regName = (r) => (pop.regions[r] || FL.regions[r]).split('/')[0];
  const shortReg = (r) => ({ '4': 'Trentino-A. A.', '6': 'Friuli-V. G.', '8': 'Emilia-Rom.', '2': "Valle d'Aosta" }[r] || regName(r));
  const signed = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt.format(Math.abs(Math.round(v)));
  const mln = (v, d = 2) => (v / 1e6).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' milioni';
  const isEst = (y) => pop.estimateYears.includes(y);
  const isProv = (y) => FL.provisional.includes(y);
  const flowYearOf = (y) => Math.min(y, lastFY);

  // ---------- derived series ----------
  const sud = FY.map((y) => {
    let s2n = 0, n2s = 0;
    FL.od[y].forEach(([a, b, v]) => { if (SOUTH.has(a) && !SOUTH.has(b)) s2n += v; if (!SOUTH.has(a) && SOUTH.has(b)) n2s += v; });
    return { y, s2n, n2s, net: s2n - n2s };
  });
  const abroad = FY.map((y) => ({ y, emi: FL.abroad[y].IT[0], imm: FL.abroad[y].IT[2] }));
  const REGS = Object.keys(regPop);
  const jPeak = d3.maxIndex(natTot.slice(0, years.indexOf(2025) + 1));

  // ---------- year bar ----------
  const ybYear = $('ybYear'), ybSlider = $('ybSlider'), ybTag = $('ybTag'), ybPlay = $('ybPlay');
  ybSlider.max = NY - 1;
  ybSlider.addEventListener('input', () => o.jumpYear(+ybSlider.value));
  $('ybPrev').onclick = () => o.jumpYear(Math.max(0, curJ - 1));
  $('ybNext').onclick = () => o.jumpYear(Math.min(NY - 1, curJ + 1));
  ybPlay.onclick = () => o.togglePlay();

  // ---------- scrolly steps ----------
  const step = (y, html) => ({ y, html });
  const popSteps = [
    step(2002, `Al 1° gennaio 2002 in Italia risiedevano <b>${fmt.format(natTot[0])}</b> persone (sommando i comuni nei confini di oggi).`),
    step(years[jPeak], `La popolazione cresce fino al ${years[jPeak]}: <b>${fmt.format(natTot[jPeak])}</b> residenti, ${signed(natTot[jPeak] - natTot[0])} rispetto al 2002.`),
    step(2020, `Da allora cala ogni anno. Al 1° gennaio 2020 i residenti sono <b>${fmt.format(natTot[years.indexOf(2020)])}</b>. Tra 2019 e 2020 cambia anche la fonte (dati del censimento permanente), con una piccola discontinuità.`),
    step(2025, `Al 1° gennaio 2025: <b>${fmt.format(natTot[years.indexOf(2025)])}</b> residenti, ${signed(natTot[years.indexOf(2025)] - natTot[jPeak])} rispetto al ${years[jPeak]}. <b>${fmt.format(lossCount[years.indexOf(2025)])}</b> comuni su ${fmt.format(N)} hanno meno abitanti che nel 2002.`),
    step(2026, `Per il 2026 ISTAT stima <b>${fmt.format(natTot[NY - 1])}</b> residenti. È un dato provvisorio.`),
  ];
  const minNet = d3.least(sud, (d) => d.net), maxNet = d3.greatest(sud, (d) => d.net);
  const cumS2N = d3.sum(sud, (d) => d.s2n), cumN2S = d3.sum(sud, (d) => d.n2s);
  const sudSteps = [
    step(FY[0], `Nel ${FY[0]} <b>${fmt.format(sud[0].s2n)}</b> persone si sono trasferite da una regione del Sud e Isole a una del Centro-Nord; <b>${fmt.format(sud[0].n2s)}</b> hanno fatto il percorso inverso. Saldo per il Sud: <b>${signed(-sud[0].net)}</b>.`),
    step(minNet.y, `Il saldo più basso del periodo è nel ${minNet.y}: ${signed(-minNet.net)}. Anche nell'anno migliore il Sud perde residenti verso il Centro-Nord.`),
    step(maxNet.y, `Il più alto è nel ${maxNet.y}: <b>${fmt.format(maxNet.s2n)}</b> partenze verso il Centro-Nord, <b>${fmt.format(maxNet.n2s)}</b> arrivi, saldo ${signed(-maxNet.net)}.`),
    step(lastFY, `Dal ${FY[0]} al ${lastFY}: <b>${fmt.format(cumS2N)}</b> trasferimenti dal Sud e Isole al Centro-Nord e <b>${fmt.format(cumN2S)}</b> in senso opposto. Saldo: <b>${signed(cumN2S - cumS2N)}</b> (il ${lastFY} è provvisorio).`),
  ];
  const cross = abroad.find((d) => d.emi > d.imm);
  const maxEmi = d3.greatest(abroad, (d) => d.emi);
  const cumEmi = d3.sum(abroad, (d) => d.emi), cumImm = d3.sum(abroad, (d) => d.imm);
  const abSteps = [
    step(FY[0], `Nel ${FY[0]} si cancellano dall'anagrafe per trasferirsi all'estero <b>${fmt.format(abroad[0].emi)}</b> cittadini italiani; ne rientrano <b>${fmt.format(abroad[0].imm)}</b>.`),
    step(cross.y, `Dal ${cross.y} gli italiani che partono superano quelli che rientrano: ${fmt.format(cross.emi)} contro ${fmt.format(cross.imm)}.`),
    step(maxEmi.y, `Il massimo è nel ${maxEmi.y}: <b>${fmt.format(maxEmi.emi)}</b> italiani cancellati per l'estero, <b>${fmt.format(maxEmi.imm)}</b> rientrati.`),
    step(lastFY, `In totale, dal ${FY[0]} al ${lastFY}: <b>${fmt.format(cumEmi)}</b> partenze e <b>${fmt.format(cumImm)}</b> rientri, un saldo di <b>${signed(cumImm - cumEmi)}</b>. Sono solo i cambi di residenza registrati: chi parte senza cancellarsi non è contato.`),
  ];
  function renderSteps(el, list) {
    el.innerHTML = list.map((s) => `<div class="step" data-year="${s.y}"><div><span class="sy">${s.y}</span>${s.html}</div></div>`).join('');
  }
  renderSteps($('stepsPop'), popSteps); renderSteps($('stepsSud'), sudSteps); renderSteps($('stepsAbroad'), abSteps);
  let activeStep = null;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting || e.target === activeStep) return;
      activeStep?.classList.remove('on'); activeStep = e.target; activeStep.classList.add('on');
      const j = years.indexOf(+e.target.dataset.year);
      if (j >= 0 && j !== curJ) o.setYear(j);
    });
  }, { rootMargin: '-48% 0px -48% 0px' });
  document.querySelectorAll('.step').forEach((s) => io.observe(s));

  // ---------- chart helpers ----------
  const M = { t: 14, r: 64, b: 26, l: 8 };
  function frame(el, h) {
    const w = Math.max(280, el.clientWidth);
    el.innerHTML = '';
    const svg = d3.select(el).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('width', w).attr('height', h);
    return { svg, w, h };
  }
  const yearAxis = (g, x, h, every) => g.attr('class', 'ax').attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).tickValues(x.domain().length ? null : null).ticks(every).tickFormat(d3.format('d')).tickSizeOuter(0));
  const chartH = () => (innerWidth <= 820 ? 230 : 330);

  function drawKey(svg, x0, y0, maxX, items) {
    const key = svg.append('g'); let xx = x0, yy = y0;
    items.forEach(([t, c, k]) => {
      const g = key.append('g');
      if (k === 'l') g.append('line').attr('x1', 0).attr('x2', 16).attr('stroke', c).attr('stroke-width', 2);
      else g.append('rect').attr('y', -5).attr('width', 12).attr('height', 10).attr('fill', c).attr('opacity', k === 'a' ? 0.25 : 1);
      const tx = g.append('text').attr('x', 20).attr('dy', '.35em').text(t);
      const wd = 26 + tx.node().getComputedTextLength();
      if (xx + wd > maxX && xx > x0) { xx = x0; yy += 17; }
      g.attr('transform', `translate(${xx},${yy})`); xx += wd + 10;
    });
    return yy;
  }

  // population line
  let popC;
  function drawPop() {
    const el = $('chartPop'); const { svg, w, h } = frame(el, chartH());
    const x = d3.scaleLinear([years[0], years[NY - 1]], [M.l + 44, w - M.r]);
    const ext = d3.extent(natTot); const y = d3.scaleLinear([ext[0] - 4e5, ext[1] + 3e5], [h - M.b, M.t]);
    svg.append('g').attr('class', 'grid').selectAll('line').data(y.ticks(5)).join('line').attr('x1', x.range()[0]).attr('x2', w - M.r).attr('y1', y).attr('y2', y);
    svg.append('g').attr('class', 'ax').attr('transform', `translate(${x.range()[0]},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(6).tickFormat((v) => (v / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' mln')).call((g) => g.select('.domain').remove());
    svg.append('g').call((g) => yearAxis(g, x, h - M.b, innerWidth <= 820 ? 5 : 8));
    const pts = years.map((yy, j) => [yy, natTot[j]]);
    const L = d3.line((d) => x(d[0]), (d) => y(d[1]));
    svg.append('path').attr('d', L(pts.slice(0, NY - 1))).attr('fill', 'none').attr('stroke', INK).attr('stroke-width', 2);
    svg.append('path').attr('d', L(pts.slice(NY - 2))).attr('fill', 'none').attr('stroke', INK).attr('stroke-width', 2).attr('stroke-dasharray', '3 3');
    svg.append('text').attr('x', x(years[NY - 1]) + 6).attr('y', y(natTot[NY - 1]) + 16).text('stima').attr('class', 'ax').style('fill', '#6b6b6b');
    const mk = svg.append('g');
    mk.append('line').attr('class', 'vr').attr('stroke', LIGHT).attr('y1', M.t).attr('y2', h - M.b);
    mk.append('circle').attr('r', 4.5).attr('fill', '#fff').attr('stroke', INK).attr('stroke-width', 2);
    mk.append('text').attr('class', 'lbl lblb').attr('dy', -10);
    popC = { x, y, mk };
  }
  function updPop(tt) {
    if (!popC) return;
    const j = Math.floor(tt), f = tt - j; const v = j >= NY - 1 ? natTot[NY - 1] : natTot[j] + (natTot[j + 1] - natTot[j]) * f;
    const yy = years[0] + tt; const X = popC.x(yy), Y = popC.y(v);
    popC.mk.select('line').attr('x1', X).attr('x2', X);
    popC.mk.select('circle').attr('cx', X).attr('cy', Y);
    const right = X > popC.x.range()[1] - 90;
    popC.mk.select('text').attr('x', X).attr('y', Y).attr('text-anchor', right ? 'end' : 'middle').text(fmt.format(Math.round(v)));
  }

  // regions bars
  let regC;
  function drawReg() {
    const el = $('chartReg'); const bh = innerWidth <= 820 ? 19 : 21; const h = REGS.length * bh + 30;
    const { svg, w } = frame(el, h);
    const lw = innerWidth <= 820 ? 108 : 150;
    const x = d3.scaleLinear([-16, 16], [lw + 44, w - 50]);
    svg.append('g').attr('class', 'grid').selectAll('line').data(x.ticks(8)).join('line').attr('x1', x).attr('x2', x).attr('y1', 18).attr('y2', h - 4);
    svg.append('g').attr('class', 'ax').attr('transform', 'translate(0,14)').call(d3.axisTop(x).ticks(innerWidth <= 820 ? 4 : 8).tickSize(0).tickFormat((v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '%')).call((g) => g.select('.domain').remove());
    svg.append('line').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 18).attr('y2', h - 4).attr('stroke', INK);
    regC = { svg, x, bh, lw, g: svg.append('g') };
  }
  function updReg(j) {
    if (!regC) return;
    const { x, bh, lw, g } = regC;
    const rows = REGS.map((r) => ({ r, pc: (regPop[r][j] / regPop[r][0] - 1) * 100 })).sort((a, b) => a.pc - b.pc);
    const pos = new Map(rows.map((d, i) => [d.r, 22 + i * bh]));
    const sel = g.selectAll('g.row').data(rows, (d) => d.r).join((en) => {
      const gg = en.append('g').attr('class', 'row').attr('transform', (d) => `translate(0,${pos.get(d.r)})`);
      gg.append('text').attr('class', 'lbl').attr('x', lw - 8).attr('y', bh / 2).attr('dy', '.35em').attr('text-anchor', 'end').text((d) => (innerWidth <= 820 ? shortReg(d.r) : regName(d.r)));
      gg.append('rect').attr('y', 3).attr('height', bh - 6);
      gg.append('text').attr('class', 'val').attr('y', bh / 2).attr('dy', '.35em');
      return gg;
    });
    sel.transition().duration(450).attr('transform', (d) => `translate(0,${pos.get(d.r)})`);
    sel.select('rect').attr('x', (d) => x(Math.min(0, d.pc))).attr('width', (d) => Math.abs(x(d.pc) - x(0))).attr('fill', (d) => (d.pc < 0 ? LOSS : GAIN));
    sel.select('text.val').attr('x', (d) => (d.pc < 0 ? x(d.pc) - 4 : x(d.pc) + 4)).attr('text-anchor', (d) => (d.pc < 0 ? 'end' : 'start')).attr('class', 'val lbl').text((d) => fmtPct(d.pc));
    $('regTitle').textContent = `Variazione dei residenti per regione, 2002–${years[j]}`;
    $('regNote').textContent = j === 0 ? 'Scegli un anno successivo al 2002 per vedere le variazioni.' : `Residenti al 1° gennaio ${years[j]}${isEst(years[j]) ? ' (stima)' : ''} rispetto al 1° gennaio 2002, ordinati dalla variazione più negativa.`;
  }

  // Sud -> Centro-Nord net bars
  let sudC;
  function drawSud() {
    const el = $('chartSud'); const { svg, w, h } = frame(el, chartH());
    const x = d3.scaleBand(FY, [M.l + 44, w - M.r]).padding(0.25);
    const kb = drawKey(svg, M.l + 44, M.t, w - 8, [['dal Sud al Centro-Nord', INK, 'l'], ['dal Centro-Nord al Sud', GREY, 'l'], ['saldo netto', LIGHT, 'b']]);
    const y = d3.scaleLinear([0, d3.max(sud, (d) => d.s2n) * 1.05], [h - M.b, kb + 56]);
    svg.append('g').attr('class', 'grid').selectAll('line').data(y.ticks(5)).join('line').attr('x1', x.range()[0]).attr('x2', w - M.r).attr('y1', y).attr('y2', y);
    svg.append('g').attr('class', 'ax').attr('transform', `translate(${x.range()[0]},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(6).tickFormat((v) => fmt.format(v))).call((g) => g.select('.domain').remove());
    const every = innerWidth <= 820 ? 6 : 3;
    svg.append('g').attr('class', 'ax').attr('transform', `translate(0,${h - M.b})`).call(d3.axisBottom(x).tickValues(FY.filter((yy) => (yy - FY[0]) % every === 0 || yy === lastFY)).tickSizeOuter(0));
    const bars = svg.append('g').selectAll('rect').data(sud).join('rect').attr('x', (d) => x(d.y)).attr('width', x.bandwidth()).attr('y', (d) => y(d.net)).attr('height', (d) => y(0) - y(d.net)).attr('fill', LIGHT);
    const L = (k) => d3.line((d) => x(d.y) + x.bandwidth() / 2, (d) => y(d[k]));
    svg.append('path').attr('d', L('s2n')(sud)).attr('fill', 'none').attr('stroke', INK).attr('stroke-width', 1.8);
    svg.append('path').attr('d', L('n2s')(sud)).attr('fill', 'none').attr('stroke', GREY).attr('stroke-width', 1.8);
    const lab = svg.append('g');
    sudC = { x, y, bars, lab };
  }
  function updSud(j) {
    if (!sudC) return;
    const fy = flowYearOf(years[j]); const d = sud.find((s) => s.y === fy);
    sudC.bars.attr('fill', (b) => (b.y === fy ? '#7a7a7a' : LIGHT));
    const { x, y, lab } = sudC; const cx = x(fy) + x.bandwidth() / 2;
    const right = cx > x.range()[1] - 150;
    lab.selectAll('*').remove();
    lab.append('line').attr('x1', cx).attr('x2', cx).attr('y1', y(d.s2n) - 4).attr('y2', y(d.s2n) - 16).attr('stroke', INK);
    const t = lab.append('text').attr('class', 'lbl').attr('x', cx).attr('y', y(d.s2n) - 34).attr('text-anchor', right ? 'end' : 'start');
    t.append('tspan').attr('class', 'lblb').text(`${fy}${isProv(fy) ? ' (provv.)' : ''}: saldo ${signed(-d.net)}`);
    t.append('tspan').attr('x', cx).attr('dy', 15).text(`${fmt.format(d.s2n)} partiti, ${fmt.format(d.n2s)} arrivati`);
  }

  // abroad lines
  let abC;
  function drawAbroad() {
    const el = $('chartAbroad'); const { svg, w, h } = frame(el, chartH());
    const x = d3.scaleLinear([FY[0], lastFY], [M.l + 44, w - M.r]);
    const kb = drawKey(svg, M.l + 44, M.t, w - 8, [['italiani cancellati per l\'estero', INK, 'l'], ['italiani rientrati', GREY, 'l'], ['differenza', LOSS, 'a']]);
    const y = d3.scaleLinear([0, d3.max(abroad, (d) => d.emi) * 1.05], [h - M.b, kb + 56]);
    svg.append('g').attr('class', 'grid').selectAll('line').data(y.ticks(5)).join('line').attr('x1', x.range()[0]).attr('x2', w - M.r).attr('y1', y).attr('y2', y);
    svg.append('g').attr('class', 'ax').attr('transform', `translate(${x.range()[0]},0)`).call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(6).tickFormat((v) => fmt.format(v))).call((g) => g.select('.domain').remove());
    svg.append('g').call((g) => yearAxis(g, x, h - M.b, innerWidth <= 820 ? 5 : 8));
    svg.append('path').attr('d', d3.area((d) => x(d.y), (d) => y(Math.max(d.emi, d.imm)), (d) => y(d.imm)).defined((d) => d.emi >= d.imm)(abroad)).attr('fill', LOSS).attr('opacity', 0.14);
    svg.append('path').attr('d', d3.line((d) => x(d.y), (d) => y(d.emi))(abroad)).attr('fill', 'none').attr('stroke', INK).attr('stroke-width', 2);
    svg.append('path').attr('d', d3.line((d) => x(d.y), (d) => y(d.imm))(abroad)).attr('fill', 'none').attr('stroke', GREY).attr('stroke-width', 2);
    const mk = svg.append('g');
    abC = { x, y, mk, h, kb };
  }
  function updAbroad(j) {
    if (!abC) return;
    const fy = flowYearOf(years[j]); const d = abroad.find((s) => s.y === fy);
    const { x, y, mk, h, kb } = abC; const X = x(fy);
    mk.selectAll('*').remove();
    mk.append('line').attr('x1', X).attr('x2', X).attr('y1', kb + 22).attr('y2', h - M.b).attr('stroke', LIGHT);
    mk.append('circle').attr('cx', X).attr('cy', y(d.emi)).attr('r', 4).attr('fill', '#fff').attr('stroke', INK).attr('stroke-width', 2);
    mk.append('circle').attr('cx', X).attr('cy', y(d.imm)).attr('r', 4).attr('fill', '#fff').attr('stroke', GREY).attr('stroke-width', 2);
    const right = X > x.range()[1] - 150;
    const t = mk.append('text').attr('class', 'lbl').attr('x', X + (right ? -8 : 8)).attr('y', y(d.emi) - 22).attr('text-anchor', right ? 'end' : 'start');
    t.append('tspan').attr('class', 'lblb').text(`${fy}${isProv(fy) ? ' (provv.)' : ''}: ${fmt.format(d.emi)} partiti`);
    t.append('tspan').attr('x', X + (right ? -8 : 8)).attr('dy', 15).text(`${fmt.format(d.imm)} rientrati`);
  }

  // ---------- sortable tables ----------
  function table(el, cols, rows, st) {
    const sorted = rows.slice();
    if (st.key) { const c = cols.find((c) => c.k === st.key); sorted.sort((a, b) => { const va = c.sv ? c.sv(a) : a[c.k], vb = c.sv ? c.sv(b) : b[c.k]; return (typeof va === 'string' ? va.localeCompare(vb, 'it') : va - vb) * st.dir; }); }
    el.innerHTML = `<thead><tr>${cols.map((c) => `<th data-k="${c.k}" class="${c.cls || ''}" aria-sort="${st.key === c.k ? (st.dir > 0 ? 'ascending' : 'descending') : 'none'}">${c.h}<span class="ar">${st.key === c.k ? (st.dir > 0 ? '↑' : '↓') : ''}</span></th>`).join('')}</tr></thead>
      <tbody>${sorted.map((r) => `<tr class="${r._cls || ''}">${cols.map((c) => `<td class="${c.cls || ''}">${c.f ? c.f(r) : r[c.k]}</td>`).join('')}</tr>`).join('')}</tbody>`;
    el.querySelectorAll('th').forEach((th) => (th.onclick = () => { const k = th.dataset.k; st.dir = st.key === k ? -st.dir : (k === 'name' || k === 'o' || k === 'd' ? 1 : -1); st.key = k; table(el, cols, rows, st); }));
  }
  const stLoss = { key: null, dir: 1 }, stGain = { key: null, dir: -1 }, stOD = { key: 'v', dir: -1 };
  ['comBase', 'comMin', 'comMetric'].forEach((id) => $(id).addEventListener('change', () => { stLoss.key = stGain.key = null; updCom(curJ); }));
  function updCom(j) {
    const prev = $('comBase').value === 'prev'; const min = +$('comMin').value; const metric = $('comMetric').value;
    const jr = prev ? j - 1 : 0; const refY = years[Math.max(0, jr)];
    $('comTitle').textContent = `I comuni che perdono e guadagnano più residenti, ${prev ? `${refY}–${years[j]}` : `2002–${years[j]}`}`;
    if (j === 0 || jr < 0) { ['tblLoss', 'tblGain'].forEach((id) => ($(id).innerHTML = '<tbody><tr><td class="sub">Scegli un anno successivo al 2002.</td></tr></tbody>')); return; }
    const rows = [];
    for (let i = 0; i < N; i++) {
      const a = vals[i * NY + jr], b = vals[i * NY + j];
      if (!(a > 0) || b !== b || a < min) continue;
      const d = data[i]; const pv = pop.provinces[d.p];
      rows.push({ name: d.n, prov: pv ? pv.s : '', a, b, abs: b - a, pct: (b / a - 1) * 100 });
    }
    const key = metric === 'abs' ? 'abs' : 'pct';
    rows.sort((x, y) => x[key] - y[key]);
    const cols = [
      { k: 'name', h: 'Comune', f: (r) => `${r.name} <span class="sub">${r.prov}</span>` },
      { k: 'a', h: String(refY), cls: 'r hm', f: (r) => fmt.format(r.a) },
      { k: 'b', h: years[j] + (isEst(years[j]) ? '*' : ''), cls: 'r', f: (r) => fmt.format(r.b) },
      { k: 'abs', h: 'Var.', cls: 'r', f: (r) => `<span class="${r.abs < 0 ? 'neg' : 'pos'}">${signed(r.abs)}</span>` },
      { k: 'pct', h: 'Var. %', cls: 'r', f: (r) => `<span class="${r.pct < 0 ? 'neg' : 'pos'}">${fmtPct(r.pct)}</span>` },
    ];
    if (!stLoss.key) { stLoss.key = key; stLoss.dir = 1; }
    if (!stGain.key) { stGain.key = key; stGain.dir = -1; }
    table($('tblLoss'), cols, rows.slice(0, 10), stLoss);
    table($('tblGain'), cols, rows.slice(-10).reverse(), stGain);
  }
  function updOD(j) {
    const fy = flowYearOf(years[j]);
    $('odTitle').textContent = `I 15 spostamenti più frequenti tra regioni, ${fy}${isProv(fy) ? ' (provvisorio)' : ''}`;
    const kind = (a, b) => (SOUTH.has(a) && !SOUTH.has(b) ? 'dal Sud al Centro-Nord' : !SOUTH.has(a) && SOUTH.has(b) ? 'dal Centro-Nord al Sud' : SOUTH.has(a) ? 'nel Sud e Isole' : 'nel Centro-Nord');
    const rows = FL.od[fy].slice().sort((a, b) => b[2] - a[2]).slice(0, 15).map(([a, b, v], i) => ({ rank: i + 1, o: regName(a), d: regName(b), v, k: kind(a, b), _cls: SOUTH.has(a) && !SOUTH.has(b) ? 's2n' : '' }));
    table($('tblOD'), [
      { k: 'rank', h: '#', cls: 'r' },
      { k: 'o', h: 'Da' }, { k: 'd', h: 'Verso' },
      { k: 'v', h: 'Persone', cls: 'r', f: (r) => fmt.format(r.v) },
      { k: 'k', h: 'Tipo', cls: 'hm', f: (r) => `<span class="sub">${r.k}</span>` },
    ], rows, stOD);
  }

  // ---------- update loop ----------
  let curJ = -1, lastT = -1;
  function update(tt) {
    lastT = tt;
    updPop(tt);
    const j = Math.min(NY - 1, Math.round(tt));
    if (j === curJ) return;
    curJ = j;
    ybYear.textContent = years[j]; ybSlider.value = j;
    ybTag.textContent = isEst(years[j]) ? 'stima ISTAT' : years[j] > lastFY ? `flussi: ${lastFY}` : isProv(years[j]) ? 'flussi provvisori' : '';
    updReg(j); updCom(j); updSud(j); updAbroad(j); updOD(j);
  }
  function drawAll() { drawPop(); drawReg(); drawSud(); drawAbroad(); const j = curJ; curJ = -1; update(lastT < 0 ? 0 : lastT); if (j < 0) return; }
  drawAll();
  let rt, lastW = $('chartPop').clientWidth;
  new ResizeObserver(() => { const w = $('chartPop').clientWidth; if (w === lastW) return; lastW = w; clearTimeout(rt); rt = setTimeout(drawAll, 150); }).observe(document.querySelector('.story'));

  window.__story = { sud, abroad, natTot, get year() { return years[curJ]; } };
  return { update, setPlaying: (p) => (ybPlay.textContent = p ? 'Pausa' : 'Riproduci') };
}
