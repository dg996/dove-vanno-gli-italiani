import { generateText } from 'ai';
import { readFileSync } from 'node:fs';

const AGG = JSON.parse(readFileSync(new URL('./_data/aggregates.json', import.meta.url), 'utf8'));
const FLOWS = JSON.parse(readFileSync(new URL('./_data/flows_agg.json', import.meta.url), 'utf8'));
const IDX = JSON.parse(readFileSync(new URL('./_data/comuni_index.json', import.meta.url), 'utf8'));
const MODEL = process.env.AI_GATEWAY_MODEL || 'google/gemini-2.5-flash-lite';

const norm = (s) => ' ' + s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim() + ' ';

// region aliases
const REG_ALIAS = {
  '02': ['valle d aosta', 'val d aosta', 'aosta valley'], '04': ['trentino', 'alto adige', 'sudtirol'],
  '06': ['friuli'], '08': ['emilia', 'romagna'], '16': ['puglie'],
};
const regTerms = [];
for (const [code, r] of Object.entries(AGG.regioni)) {
  regTerms.push([norm(r.nome.split('/')[0]), code]);
  for (const a of REG_ALIAS[code] || []) regTerms.push([` ${a} `, code]);
}
const provTerms = Object.entries(AGG.province).map(([c, p]) => [norm(p.nome.split('/')[0]), c]);
const STOP = new Set(['bella', 'calcio', 'bene', 'paese', 'piazza', 'castello', 'campo', 'monte', 'italia', 'regione', 'santa', 'valle', 'porto']);
const comTerms = Object.entries(IDX)
  .map(([c, v]) => [norm(v[0].split('/')[0]), c])
  .filter(([t]) => t.trim().length >= 4 && !STOP.has(t.trim()));

function findAreas(q) {
  const nq = norm(q);
  const regioni = [...new Set(regTerms.filter(([t]) => nq.includes(t)).map(([, c]) => c))];
  const province = [...new Set(provTerms.filter(([t]) => nq.includes(t)).map(([, c]) => c))];
  const provNames = new Set(province.map((p) => norm(AGG.province[p].nome)));
  const regNames = new Set(regioni.map((r) => norm(AGG.regioni[r].nome)));
  let comuni = comTerms.filter(([t]) => nq.includes(t) && !regNames.has(t)).map(([, c]) => c);
  // prefer longer names (e.g. "Reggio di Calabria" over "Reggio")
  comuni = comuni.sort((a, b) => IDX[b][0].length - IDX[a][0].length).slice(0, 4);
  return { regioni: regioni.slice(0, 4), province: province.slice(0, 4), comuni };
}

const fmtSerie = (s) => Object.fromEntries(Object.entries(s).filter(([y]) => ['2002', '2008', '2012', '2014', '2019', '2022', '2025', '2026'].includes(y)));
const slim = (a) => ({ ...a, serie: fmtSerie(a.serie) });

function buildFacts(areas) {
  const rank = Object.values(AGG.regioni).map((r) => [r.nome, r.var_pct_2002_2025]).sort((a, b) => a[1] - b[1]);
  const facts = {
    nota: AGG.note,
    italia: slim({ ...AGG.italia, peggiori_pct: undefined, migliori_pct: undefined, piu_persi_ass: undefined, piu_guadagnati_ass: undefined }),
    classifica_regioni_var_pct_2002_2025: rank,
  };
  if (areas.regioni.length) facts.regioni = areas.regioni.map((c) => slim(AGG.regioni[c]));
  if (areas.province.length) facts.province = areas.province.map((c) => slim(AGG.province[c]));
  if (areas.comuni.length) facts.comuni = areas.comuni.map((c) => {
    const [n, r, p, a, b, e] = IDX[c];
    return { nome: n, provincia: AGG.province[p]?.nome, regione: AGG.regioni[r]?.nome, pop_2002: a, pop_2025: b, pop_2026_stima: e, var_pct_2002_2025: a && b ? +((b - a) / a * 100).toFixed(1) : null };
  });
  if (!areas.regioni.length && !areas.province.length && !areas.comuni.length) {
    const pr = Object.values(AGG.province).map((p) => [`${p.nome} (${p.regione})`, p.var_pct_2002_2025]).sort((a, b) => a[1] - b[1]);
    facts.province_piu_in_calo = pr.slice(0, 8);
    facts.province_piu_in_crescita = pr.slice(-8).reverse();
    facts.italia_comuni_peggiori = AGG.italia.peggiori_pct;
  }
  return facts;
}

const FLOW_RE = /\b(va|vanno|vada|andat\w*|andar\w*|spost\w*|trasfer\w*|emigr\w*|immigr\w*|migra\w*|lascia\w*|partit\w*|parton\w*|arriv\w*|flussi|fuga|fuggon\w*|ester[oi])\b/i;
function flowRegion(areas) {
  if (areas.regioni.length) return areas.regioni[0];
  if (areas.province.length) return String(Object.entries(AGG.regioni).find(([, r]) => r.nome === AGG.province[areas.province[0]].regione)?.[0] || '') || null;
  if (areas.comuni.length) return String(IDX[areas.comuni[0]][1]);
  return null;
}

function highlightFor(areas) {
  if (areas.comuni.length && !areas.regioni.length && !areas.province.length) return { level: 'comune', codes: areas.comuni, label: areas.comuni.map((c) => IDX[c][0]).join(', ') };
  if (areas.province.length && !areas.regioni.length) return { level: 'provincia', codes: areas.province, label: areas.province.map((c) => AGG.province[c].nome).join(', ') };
  if (areas.regioni.length) return { level: 'regione', codes: areas.regioni, label: areas.regioni.map((c) => AGG.regioni[c].nome).join(', ') };
  return null;
}

// simple per-instance rate limit: 6 req/min per IP, 300/hour per instance
const hits = new Map();
let hourWindow = { t: Date.now(), n: 0 };
function limited(ip) {
  const now = Date.now();
  if (now - hourWindow.t > 3600e3) hourWindow = { t: now, n: 0 };
  if (++hourWindow.n > 300) return true;
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60e3);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 6;
}

const SYSTEM = `Sei l'assistente di "L'Italia che si svuota", una mappa dei dati ISTAT sulla popolazione residente dei comuni italiani (2002-2026).
Regole:
- Rispondi in italiano, in modo chiaro e coinvolgente, massimo 110 parole, senza titoli né elenchi lunghi.
- Usa SOLO i numeri presenti nei DATI forniti. Non inventare cifre, cause certe o fonti esterne. Arrotonda in modo leggibile (es. "-10,1%", "circa 31 mila persone").
- I dati di popolazione (serie, var_pct...) sono stock: da soli NON mostrano dove le persone si sono trasferite. Se mancano i dati "spostamenti_*" e la domanda chiede "dove è andata la gente", dillo esplicitamente in una frase e indica invece quali aree nei DATI sono cresciute, presentandole come contrasto e non come destinazione certa.
- Il 2026 è una stima provvisoria ISTAT: per i confronti usa 2002-2025.
- Se nei DATI ci sono "spostamenti_*" (trasferimenti di residenza ISTAT, solo a livello di regione), usali per dire dove vanno e da dove arrivano le persone: cita le principali regioni di destinazione con i numeri, il saldo, e gli italiani emigrati all'estero. Specifica il periodo (2002-2025, con 2025 provvisorio, oppure un singolo anno). In questo caso i dati SONO di destinazione, quindi non dire che mancano. Distingui sempre gli "italiani" (solo cittadini italiani) dai totali (italiani e stranieri) e parla di "residenti" che si trasferiscono.
- Se i DATI non bastano per rispondere, dillo.`;

function factNumbers(obj, out = []) {
  if (typeof obj === 'number') out.push(Math.abs(obj));
  else if (Array.isArray(obj)) obj.forEach((v) => factNumbers(v, out));
  else if (obj && typeof obj === 'object') Object.entries(obj).forEach(([k, v]) => { if (/^\d{4}$/.test(k)) out.push(+k); factNumbers(v, out); });
  return out;
}
// every number in the answer must come from the facts (allowing rounding like "1,28 milioni" or "circa 31 mila")
function ungrounded(text, nums) {
  const bad = [];
  for (const m of text.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g)) {
    const n = parseFloat(m[0].replace(/\./g, '').replace(',', '.'));
    if (n >= 1990 && n <= 2030 && Number.isInteger(n)) continue;
    if (n <= 12 && Number.isInteger(n)) continue;
    const ok = nums.some((f) => Math.abs(n - f) <= Math.max(0.051, f * 0.005) || Math.abs(n - f / 1e3) <= 0.51 || Math.abs(n - f / 1e6) <= 0.0051);
    if (!ok) bad.push(m[0]);
  }
  return bad;
}

const f = (n) => Math.abs(n).toLocaleString('it-IT', { useGrouping: 'always' });
const sgn = (n) => (n < 0 ? '−' : '+') + f(n);
// deterministic, template-based answer used only when the model's numbers can't be verified
function fallbackAnswer(areas, isFlow, fr) {
  if (isFlow && fr && FLOWS.regioni[fr]) {
    const r = FLOWS.regioni[fr], p = r.periodo_2002_2025;
    return `Tra il 2002 e il 2025 (2025 provvisorio) ${f(p.trasferiti_verso_altre_regioni)} residenti hanno lasciato ${r.nome} per un'altra regione e ${f(p.arrivati_da_altre_regioni)} sono arrivati (saldo ${sgn(p.saldo_interno)}). Le mete principali: ${p.principali_destinazioni.slice(0, 3).map(([n, v]) => `${n} (${f(v)})`).join(', ')}. Italiani emigrati all'estero: ${f(p.italiani_emigrati_estero)}, rientrati: ${f(p.italiani_rientrati_dall_estero)}.`;
  }
  if (isFlow) {
    const h = FLOWS.nazionale;
    return `Tra il 2002 e il 2025 (2025 provvisorio) ${f(h.sud_verso_centronord)} residenti si sono trasferiti dal Sud e Isole al Centro-Nord e ${f(h.centronord_verso_sud)} in senso opposto: saldo per il Sud ${sgn(h.saldo_sud)}. Gli italiani emigrati all'estero sono stati ${f(h.italiani_emigrati)}, quelli rientrati ${f(h.italiani_rimpatriati)}.`;
  }
  const a = areas.regioni[0] ? AGG.regioni[areas.regioni[0]] : areas.province[0] ? AGG.province[areas.province[0]] : null;
  if (a) return `${a.nome}: ${f(a.serie['2002'])} residenti nel 2002 e ${f(a.serie['2025'])} nel 2025 (${a.var_pct_2002_2025 > 0 ? '+' : ''}${String(a.var_pct_2002_2025).replace('.', ',')}%). ${f(a.comuni_in_calo)} comuni su ${f(a.n_comuni)} sono in calo.`;
  if (areas.comuni[0]) { const [n, , , x, y] = IDX[areas.comuni[0]]; return `${n}: ${f(x)} residenti nel 2002 e ${f(y)} nel 2025.`; }
  const i = AGG.italia;
  return `L'Italia aveva ${f(i.serie['2002'])} residenti nel 2002 e ${f(i.serie['2025'])} nel 2025; ${f(i.comuni_in_calo)} comuni su ${f(i.n_comuni)} sono in calo.`;
}

export async function POST(request) {
  const ip = (request.headers.get('x-forwarded-for') || 'x').split(',')[0].trim();
  if (limited(ip)) return Response.json({ error: 'Troppe domande in poco tempo: riprova tra un minuto.' }, { status: 429 });
  let q = '';
  try { q = String((await request.json()).q || '').slice(0, 300).trim(); } catch {}
  if (q.length < 3) return Response.json({ error: 'Scrivi una domanda.' }, { status: 400 });
  const areas = findAreas(q);
  const facts = buildFacts(areas);
  const isFlow = FLOW_RE.test(q);
  let flowRegionCode = null;
  if (isFlow) {
    facts.spostamenti_nota = FLOWS.note;
    facts.spostamenti_nazionali = FLOWS.nazionale;
    const regs = new Set(areas.regioni);
    const fr = flowRegion(areas); if (fr) regs.add(fr);
    flowRegionCode = fr;
    if (regs.size) facts.spostamenti_regioni = [...regs].slice(0, 3).map((r) => FLOWS.regioni[r]).filter(Boolean);
    else facts.spostamenti_saldo_interno_regioni_2002_2025 = Object.values(FLOWS.regioni).map((r) => [r.nome, r.periodo_2002_2025.saldo_interno]).sort((a, b) => a[1] - b[1]);
  }
  const highlight = highlightFor(areas);
  try {
    const nums = factNumbers(facts);
    const ask = (model, extra = '') => generateText({
      model,
      system: SYSTEM,
      prompt: `DATI (JSON, calcolati dai file ISTAT; i numeri grandi sono scritti con il punto delle migliaia):\n${JSON.stringify(facts, (k, v) => (typeof v === 'number' && Number.isInteger(v) && Math.abs(v) >= 1000 && !(v >= 1990 && v <= 2030) ? v.toLocaleString('it-IT', { useGrouping: 'always' }) : v))}\n\nDOMANDA: ${q}${extra}`,
      maxOutputTokens: 320,
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(20000),
      providerOptions: { gateway: { models: ['openai/gpt-4.1-nano'], tags: ['italia-che-si-svuota'] } },
    });
    let { text } = await ask(MODEL);
    let bad = ungrounded(text, nums);
    if (bad.length) {
      console.warn('ungrounded numbers, retrying', bad.join(' '));
      ({ text } = await ask(MODEL, `\n\nATTENZIONE: nella bozza precedente questi numeri non erano nei DATI: ${bad.join(', ')}. Copia i numeri esattamente dai DATI.`));
      bad = ungrounded(text, nums);
      if (bad.length) return Response.json({ answer: fallbackAnswer(areas, isFlow, flowRegionCode), highlight, mode: isFlow ? 'flows' : 'pop', flowRegion: flowRegionCode, fallback: true }, { headers: { 'cache-control': 'no-store' } });
    }
    return Response.json({ answer: text.trim(), highlight, mode: isFlow ? 'flows' : 'pop', flowRegion: flowRegionCode }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('ai error', e?.name, e?.message?.slice(0, 200));
    return Response.json({ error: "L'AI non è disponibile in questo momento.", highlight, mode: 'error' }, { status: 503 });
  }
}
