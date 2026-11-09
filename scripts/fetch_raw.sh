#!/usr/bin/env bash
# Scarica i dati grezzi ISTAT in raw/ e prepara confini + attributi.
# Uso: bash scripts/fetch_raw.sh  (poi: python3 scripts/build_data.py && python3 scripts/build_flows.py)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p raw/ric raw/posas raw/mig public/data
cd raw

# 1) Popolazione: ricostruzione intercensuaria 2002-2019 + POSAS 2019-2026 (1 gennaio)
curl -fsSLO https://demo.istat.it/data/ricostruzione/PopolazioneEta-Territorio-Comuni.zip
unzip -oq PopolazioneEta-Territorio-Comuni.zip -d ric
for y in 2019 2020 2021 2022 2023 2024 2025 2026; do
  curl -fsSLO "https://demo.istat.it/data/posas/POSAS_${y}_it_Comuni.zip"
  unzip -oq "POSAS_${y}_it_Comuni.zip" -d posas
done

# 2) Confini amministrativi generalizzati al 1/1/2026 + codici e variazioni
curl -fsSLO https://www.istat.it/storage/cartografia/confini_amministrativi/generalizzati/2026/Limiti01012026_g.zip
curl -fsSLO https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-soppressi.zip
curl -fsSLO https://www.istat.it/storage/codici-unita-amministrative/Variazioni-amministrative-e-territoriali-dal-1991.zip
unzip -oq Limiti01012026_g.zip; unzip -oq Elenco-comuni-soppressi.zip; unzip -oq Variazioni-amministrative-e-territoriali-dal-1991.zip

# 3) TopoJSON semplificato + attributi (mapshaper è una devDependency: npm install)
MS="npx mapshaper"
$MS Com01012026_g/Com01012026_g_WGS84.shp -proj wgs84 -simplify 6% weighted keep-shapes -clean \
  -each 'id=PRO_COM_T, n=COMUNE, r=COD_REG, p=COD_UTS' -filter-fields id,n,r,p -rename-layers comuni \
  -o ../public/data/comuni.topo.json format=topojson id-field=id quantization=1e5
$MS Com01012026_g/Com01012026_g_WGS84.shp -each 'id=PRO_COM_T,n=COMUNE,r=COD_REG,p=COD_UTS' -filter-fields id,n,r,p -o comuni_attrs.csv
$MS ProvCM01012026_g/ProvCM01012026_g_WGS84.shp -filter-fields COD_REG,COD_UTS,DEN_UTS,SIGLA -o prov.csv
$MS Reg01012026_g/Reg01012026_g_WGS84.shp -filter-fields COD_REG,DEN_REG -o reg.csv

# 4) Trasferimenti di residenza (esploradati SDMX, dataflow 28_185 DCIS_MIGRAZIONI)
H="Accept: application/vnd.sdmx.data+csv;version=1.0.0"
B="https://esploradati.istat.it/SDMXWS/rest/data/IT1,28_185_DF_DCIS_MIGRAZIONI"
curl -fsS -m 300 -H "$H" "${B}_1,1.0/A..CORE.ALL.TOTAL.9.TOTAL..X1033.X1033" -o mig/od_regioni.csv
curl -fsS -m 300 -H "$H" "${B}_7,1.0/A..TDEREG.FREIGN.IT+TOTAL.9.TOTAL.ITTOT.X1033.X1033" -o mig/emi_prov.csv
curl -fsS -m 300 -H "$H" "${B}_4,1.0/A.ITTOT.TREG.FREIGN.IT+TOTAL.9.TOTAL..X1033.X1033" -o mig/imm_prov.csv
curl -fsS -m 300 -H "$H" "${B}_6,1.0/A.IT.TDEREG.FREIGN.IT+TOTAL.9.TOTAL.ITTOT.X1033." -o mig/emi_paesi.csv
# nomi dei paesi (codelist CL_PAESI)
curl -fsS -m 300 "https://esploradati.istat.it/SDMXWS/rest/dataflow/IT1/28_185_DF_DCIS_MIGRAZIONI_1/1.0?references=all" -o mig/structure.xml
python3 - <<'PY'
import re, json
s = open('mig/structure.xml', encoding='utf-8', errors='ignore').read()
m = re.search(r'<structure:Codelist [^>]*id="CL_PAESI"[^>]*>(.*?)</structure:Codelist>', s, re.S)
codes = dict(re.findall(r'<structure:Code id="([^"]+)"[^>]*>.*?<common:Name xml:lang="it">([^<]*)', m.group(1), re.S))
json.dump(codes, open('mig/paesi.json', 'w'), ensure_ascii=False)
print('paesi', len(codes))
PY
echo "Fatto. Ora: python3 scripts/build_data.py && python3 scripts/build_flows.py"
