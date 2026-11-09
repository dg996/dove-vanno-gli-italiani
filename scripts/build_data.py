"""Build static population JSON on current (1/1/2026) ISTAT municipal boundaries.
Sources: ISTAT Ricostruzione popolazione 2002-2019 (demo.istat.it RIC), ISTAT POSAS 2020-2026,
ISTAT Variazioni amministrative dal 1991, Elenco comuni soppressi, confini 01/01/2026."""
import csv, glob, json, re, os, unicodedata, collections
R = os.path.join(os.path.dirname(__file__), '..', 'raw')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')

def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    s = s.split('/')[0]
    return re.sub(r'[^a-z]', '', s)

# current comuni
cur = {}
for row in csv.DictReader(open(f'{R}/comuni_attrs.csv', encoding='utf-8')):
    cur[row['id']] = row
regs = {r['COD_REG']: r['DEN_REG'] for r in csv.DictReader(open(f'{R}/reg.csv', encoding='utf-8'))}
provs = {r['COD_UTS']: dict(n=r['DEN_UTS'], s=r['SIGLA'], r=r['COD_REG']) for r in csv.DictReader(open(f'{R}/prov.csv', encoding='utf-8'))}

pop = collections.defaultdict(dict)   # year -> code -> pop
names = {}
# Ricostruzione 2002-2019
for f in sorted(glob.glob(f'{R}/ric/*.csv')):
    cit = year = sex = None
    for line in open(f, encoding='utf-8', errors='replace'):
        line = line.rstrip('\n\r')
        m = re.search(r'"(.+?) - Anno: (\d{4})', line)
        if m:
            cit, year = m.group(1), int(m.group(2)); continue
        if line.startswith('Codice comune'):
            sex = line.split(';')[2]; continue
        if cit != 'Tutte le cittadinanze' or sex != 'Totale': continue
        p = line.split(';')
        if len(p) > 50 and re.fullmatch(r'\d{6}', p[0]):
            pop[year][p[0]] = sum(int(x or 0) for x in p[2:])
            names.setdefault(p[0], p[1])
# POSAS 2020-2026 (age 999 = total)
for f in sorted(glob.glob(f'{R}/posas/POSAS_*_it_Comuni.csv')):
    y = int(re.search(r'POSAS_(\d{4})', f).group(1))
    if y < 2020: continue
    rd = csv.reader(open(f, encoding='utf-8', errors='replace'), delimiter=';')
    for p in rd:
        if len(p) > 3 and p[2] == '999' and re.fullmatch(r'\d{6}', p[0]):
            pop[y][p[0]] = int(p[-1]); names.setdefault(p[0], p[1])

years = sorted(pop)
print('years', years, {y: len(pop[y]) for y in years})

# variations: code -> successor codes (CD=name change, CS? code change, ES=estinzione/fusione, etc.)
succ = collections.defaultdict(set)
vf = glob.glob(f'{R}/Variazioni*/*.csv')[0]
txt = open(vf, encoding='latin1').read()
tipi = collections.Counter()
for p in csv.DictReader(txt.splitlines(), delimiter=';'):
    k = {kk.strip(): v for kk, v in p.items() if kk}
    t = k['Tipo variazione']; tipi[t] += 1
    a = k['Codice Comune formato alfanumerico']; b = k['Codice del Comune associato alla variazione o nuovo codice Istat del Comune']
    if t in ('ES', 'CS', 'AQES', 'AQ') and False: pass
    if t.strip() in ('ES', 'AP') and a and b and a != b:
        succ[a].add(b)
sf = glob.glob(f'{R}/Elenco comuni soppressi/*.csv')[0]
for p in csv.reader(open(sf, encoding='latin1'), delimiter=';'):
    if len(p) > 8 and re.fullmatch(r'\d{6}', p[3] or '') and re.fullmatch(r'\d{6}', p[7] or '') and not p[5].strip():
        if p[3] != p[7]: succ[p[3]].add(p[7])
print('variation types', dict(tipi))

cur_by_name = collections.defaultdict(list)
for c, row in cur.items(): cur_by_name[norm(row['n'])].append(c)

def resolve(code, depth=0):
    if code in cur: return code
    if depth < 8:
        for s in sorted(succ.get(code, ())):
            r = resolve(s, depth + 1)
            if r: return r
    nm = names.get(code)
    if nm:
        cands = cur_by_name.get(norm(nm), [])
        if len(cands) > 1:
            cands = [x for x in cands if not any(x in pop[y] for y in years)]
        if len(cands) == 1: return cands[0]
    return None

mapping, unresolved = {}, set()
for y in years:
    for c in pop[y]:
        if c not in mapping:
            r = resolve(c); mapping[c] = r
            if r is None: unresolved.add(c)
remap = {c: r for c, r in mapping.items() if r and r != c}
print('remapped codes', len(remap), 'unresolved', [(c, names[c]) for c in unresolved])

series = {}
merged_into = collections.defaultdict(set)
for c, r in remap.items(): merged_into[r].add(c)
for c in cur:
    row = []
    for y in years:
        tot, have = 0, False
        for src in pop[y]:
            pass
        row.append(None)
    series[c] = row
agg = {c: [0]*len(years) for c in cur}
seen = {c: [False]*len(years) for c in cur}
for i, y in enumerate(years):
    for c, v in pop[y].items():
        r = mapping.get(c)
        if r: agg[r][i] += v; seen[r][i] = True
# a current comune created by splitting (no predecessors data) -> null for those years
for c in cur:
    series[c] = [agg[c][i] if seen[c][i] else None for i in range(len(years))]
missing_cur = [c for c in cur if all(v is None for v in series[c])]
print('current comuni without any data', missing_cur)
# split detection: comuni whose first year > first year -> source comune shrinks; flag them
partial = {c: years[next(i for i, v in enumerate(series[c]) if v is not None)] for c in cur if series[c][0] is None and c not in missing_cur}
print('comuni with late start (newly created):', {c: (cur[c]['n'], y) for c, y in partial.items()})

out = dict(years=years, estimateYears=[2026] if 2026 in years else [],
           regions=regs, provinces=provs,
           comuni={c: dict(n=cur[c]['n'], r=cur[c]['r'], p=cur[c]['p'], v=series[c],
                           **({'m': sorted(names.get(x, x) for x in merged_into[c])} if merged_into.get(c) else {}))
                   for c in cur},
           notes=dict(merged=sum(1 for c in merged_into if merged_into[c]), newComuni=partial))
json.dump(out, open(f'{OUT}/pop.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
# totals sanity
for i, y in enumerate(years):
    print(y, sum(v[i] or 0 for v in series.values()), sum(pop[y].values()))

# ---- aggregates for the AI function (server-side grounding) ----
B, L = 0, years.index(2025)  # base 2002, last consolidated year 2025 (2026 = stima)
def pct(a, b): return None if not a or b is None else round((b - a) / a * 100, 1)
def agg_series(codes):
    return [sum((series[c][i] or 0) for c in codes) for i in range(len(years))]
def area_facts(codes):
    s = agg_series(codes)
    ch = [(c, pct(series[c][B], series[c][L])) for c in codes if series[c][B] and series[c][L]]
    ch.sort(key=lambda x: x[1])
    abs_ = sorted(((c, series[c][L] - series[c][B]) for c in codes if series[c][B] and series[c][L]), key=lambda x: x[1])
    nm = lambda c: f"{cur[c]['n']} ({provs[cur[c]['p']]['s']})"
    peak_i = max(range(len(years)), key=lambda i: s[i])
    return dict(serie={str(y): s[i] for i, y in enumerate(years)},
                var_pct_2002_2025=pct(s[B], s[L]), var_ass_2002_2025=s[L] - s[B],
                anno_picco=years[peak_i], pop_picco=s[peak_i],
                n_comuni=len(codes), comuni_in_calo=sum(1 for _, v in ch if v < 0), comuni_in_crescita=sum(1 for _, v in ch if v > 0),
                comuni_persi_oltre_20pct=sum(1 for _, v in ch if v <= -20),
                peggiori_pct=[(nm(c), v, series[c][B], series[c][L]) for c, v in ch[:6]],
                migliori_pct=[(nm(c), v, series[c][B], series[c][L]) for c, v in ch[::-1][:6]],
                piu_persi_ass=[(nm(c), v) for c, v in abs_[:5]],
                piu_guadagnati_ass=[(nm(c), v) for c, v in abs_[::-1][:5]])
by_reg = collections.defaultdict(list); by_prov = collections.defaultdict(list)
for c in cur: by_reg[cur[c]['r']].append(c); by_prov[cur[c]['p']].append(c)
aggs = dict(years=years, note='Popolazione residente al 1 gennaio, ISTAT; 2002-2019 ricostruzione intercensuaria, 2020-2025 POSAS, 2026 stima. Confini comunali al 1/1/2026.',
            italia=area_facts(list(cur)),
            regioni={r: dict(nome=regs[r], **area_facts(cs)) for r, cs in by_reg.items()},
            province={p: dict(nome=provs[p]['n'], sigla=provs[p]['s'], regione=regs[provs[p]['r']], **area_facts(cs)) for p, cs in by_prov.items()})
os.makedirs(os.path.join(os.path.dirname(__file__), '..', 'api', '_data'), exist_ok=True)
json.dump(aggs, open(os.path.join(os.path.dirname(__file__), '..', 'api', '_data', 'aggregates.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
# compact comuni index for server (name, region, prov, pop 2002/2025/2026)
idx = {c: [cur[c]['n'], cur[c]['r'], cur[c]['p'], series[c][B], series[c][L], series[c][-1]] for c in cur}
json.dump(idx, open(os.path.join(os.path.dirname(__file__), '..', 'api', '_data', 'comuni_index.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('italia', aggs['italia']['var_pct_2002_2025'], 'molise', aggs['regioni']['14']['var_pct_2002_2025'], 'basilicata', aggs['regioni']['17']['var_pct_2002_2025'])
