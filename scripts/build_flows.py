"""Build migration-flow JSON from ISTAT esploradati SDMX dataflows 28_185_DF_DCIS_MIGRAZIONI_{1,4,6,7}.
Region-to-region origin/destination matrix (the finest OD level ISTAT publishes), 2002-2025 (2025 provisional).
Abroad: emigrants (cancellati per l'estero) by region of origin and immigrants (iscritti dall'estero) by region of destination,
Italian citizens and total; Italian emigrants by destination country (national)."""
import csv, json, os, collections
D = os.path.join(os.path.dirname(__file__), '..')
M = f'{D}/raw/mig'
NUTS = {'ITC1': '1', 'ITC2': '2', 'ITC4': '3', 'ITDA': '4', 'ITD3': '5', 'ITD4': '6', 'ITC3': '7', 'ITD5': '8', 'ITE1': '9', 'ITE2': '10',
        'ITE3': '11', 'ITE4': '12', 'ITF1': '13', 'ITF2': '14', 'ITF3': '15', 'ITF4': '16', 'ITF5': '17', 'ITF6': '18', 'ITG1': '19', 'ITG2': '20'}
regs = {r['COD_REG']: r['DEN_REG'] for r in csv.DictReader(open(f'{D}/raw/reg.csv', encoding='utf-8'))}
SOUTH = {str(i) for i in range(13, 21)}
paesi = json.load(open(f'{M}/paesi.json', encoding='utf-8'))

od = collections.defaultdict(dict)  # year -> (o,d) -> v
for x in csv.DictReader(open(f'{M}/od_regioni.csv')):
    o, d = NUTS.get(x['REF_AREA']), NUTS.get(x['TERRITORY_NEXT_RESID'])
    if o and d and o != d and x['OBS_VALUE']:
        od[int(x['TIME_PERIOD'])][(o, d)] = int(float(x['OBS_VALUE']))
years = sorted(od)
abroad = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0, 0, 0]))  # y -> r -> [emiIT, emiTOT, immIT, immTOT]
for f, k in (('emi_prov.csv', 'REF_AREA'), ('imm_prov.csv', 'TERRITORY_NEXT_RESID')):
    for x in csv.DictReader(open(f'{M}/{f}')):
        area = x[k]; r = NUTS.get(area) or ('IT' if area == 'IT' else None)
        if not r or not x['OBS_VALUE']: continue
        idx = (0 if f.startswith('emi') else 2) + (0 if x['CITIZENSHIP'] == 'IT' else 1)
        abroad[int(x['TIME_PERIOD'])][r][idx] = int(float(x['OBS_VALUE']))
countries = collections.defaultdict(list)
for x in csv.DictReader(open(f'{M}/emi_paesi.csv')):
    c = x['COUNTRY_NEXT_RESID']
    if x['CITIZENSHIP'] == 'IT' and len(c) == 2 and x['OBS_VALUE']:
        countries[int(x['TIME_PERIOD'])].append((paesi.get(c, c), int(float(x['OBS_VALUE']))))
for y in countries: countries[y] = sorted(countries[y], key=lambda t: -t[1])[:8]

assert years == sorted(abroad), (years, sorted(abroad))
# headline numbers (2002-2025 inclusive; 2025 provisional)
s2n = sum(v for y in years for (o, d), v in od[y].items() if o in SOUTH and d not in SOUTH)
n2s = sum(v for y in years for (o, d), v in od[y].items() if o not in SOUTH and d in SOUTH)
emi_it = sum(abroad[y]['IT'][0] for y in years); imm_it = sum(abroad[y]['IT'][2] for y in years)
south_emi_it = sum(abroad[y][r][0] for y in years for r in SOUTH)
head = dict(anni=[years[0], years[-1]], sud_verso_centronord=s2n, centronord_verso_sud=n2s, saldo_sud=n2s - s2n,
            italiani_emigrati=emi_it, italiani_rimpatriati=imm_it, saldo_italiani_estero=imm_it - emi_it,
            italiani_emigrati_dal_sud=south_emi_it)
print(json.dumps(head, indent=1))

out = dict(years=years, provisional=[2025], regions={r: regs[r] for r in NUTS.values()}, head=head,
           od={y: [[o, d, v] for (o, d), v in sorted(od[y].items(), key=lambda t: -t[1])] for y in years},
           abroad={y: dict(abroad[y]) for y in years},
           countries={y: countries[y] for y in years})
json.dump(out, open(f'{D}/public/data/flows.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

# aggregates for the AI function
def region_facts(r):
    def block(ys):
        out_ = collections.Counter(); in_ = collections.Counter(); a = [0, 0, 0, 0]
        for y in ys:
            for (o, d), v in od[y].items():
                if o == r: out_[regs[d]] += v
                if d == r: in_[regs[o]] += v
            a = [p + q for p, q in zip(a, abroad[y][r])]
        tout, tin = sum(out_.values()), sum(in_.values())
        return dict(trasferiti_verso_altre_regioni=tout, arrivati_da_altre_regioni=tin, saldo_interno=tin - tout,
                    principali_destinazioni=out_.most_common(6), principali_provenienze=in_.most_common(6),
                    italiani_emigrati_estero=a[0], emigrati_estero_totale=a[1], italiani_rientrati_dall_estero=a[2], immigrati_dall_estero_totale=a[3])
    return dict(nome=regs[r], periodo_2002_2025=block(years), anno_2024=block([2024]), anno_2025_provvisorio=block([2025]))
agg = dict(note="ISTAT, Trasferimenti di residenza (esploradati 28_185 DCIS_MIGRAZIONI): matrice origine-destinazione solo tra regioni, 2002-2025 (2025 provvisorio). Dati per persone che cambiano residenza anagrafica.",
           nazionale=dict(**head, italiani_emigrati_per_anno={y: abroad[y]['IT'][0] for y in years},
                          paesi_principali_italiani_2024=countries[2024], paesi_principali_italiani_2025_provv=countries[2025]),
           regioni={r: region_facts(r) for r in NUTS.values()})
json.dump(agg, open(f'{D}/api/_data/flows_agg.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('calabria top dest 2002-2025', agg['regioni']['18']['periodo_2002_2025']['principali_destinazioni'][:4])
