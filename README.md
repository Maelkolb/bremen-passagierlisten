# 735.000 Schicksale

Auswertung und Webportal zu den Bremer Passagierlisten 1830–1939, für die Ehrenamtlichen von *Die MAUS – Gesellschaft für Familienforschung e. V. Bremen*, die die Listen transkribiert haben.

Datengrundlage: Perschl, Schmidt, Gassner, Rehbein (2025), *A Dataset of 735,000 Migration Records (Bremen, 1830-1939)*, Zenodo, [10.5281/zenodo.17977460](https://doi.org/10.5281/zenodo.17977460), CC BY 4.0.

| | |
|---|---|
| `SCHEMA_AND_EDA_PLAN.md` | Spalten, Füllgrade, Zuordnung der Begriffe, Analyseplan |
| `FORSCHUNGSBERICHT_MAUS.md` | Forschungsbericht mit allen Tabellen und Tests (erzeugt) |
| `analysis/` | Python-Pipeline (polars, statsmodels, scipy) |
| `analysis/enrichment/` | Bereinigung und Geokodierung der nicht normalisierten Spalten, mit Methodenberichten |
| `analysis/output/` | Ergebnistabellen als CSV |
| `data/enrichment/` | Nachschlagetabellen der Anreicherung |
| `web/` | Website (Vite, TypeScript, Tailwind, ECharts, MapLibre und deck.gl, DuckDB-Wasm) |
| `web/public/data/` | JSON-Aggregate und `passagiere.parquet` (alle Einträge) für die Website |

## Analyse neu rechnen

Python 3.13 und [uv](https://docs.astral.sh/uv/):

```bash
uv venv .venv --python 3.13
uv pip install --python .venv polars duckdb pyarrow numpy scipy statsmodels rapidfuzz unidecode jellyfish pandas
```

Die Anreicherung arbeitet offline gegen [GeoNames](https://download.geonames.org/export/dump/) in `data/external/geonames/`: `cities500.txt` (entpackt), `admin1CodesASCII.txt`, `admin2Codes.txt`, `countryInfo.txt` und Länderdateien `countries/<CC>.zip`. `geocode_herkunft.py` lädt fehlende Länder- und Alternativnamendateien selbst nach; `geocode_ziele.py` erwartet zusätzlich `CL.zip`, `PY.zip` und `UY.zip`. Reihenfolge:

```bash
.venv/Scripts/python -I analysis/enrichment/clean_sparse.py
.venv/Scripts/python -I analysis/enrichment/geocode_herkunft.py
.venv/Scripts/python -I analysis/enrichment/geocode_ziele.py
.venv/Scripts/python analysis/run_all.py --rebuild
```

`run_all.py` lädt die Zenodo-Datei nach `data/raw/`, falls sie fehlt, und prüft die MD5-Summe. Danach rechnet es alle fünf Module, schreibt `analysis/output/`, `web/public/data/` und den Forschungsbericht. Laufzeit unter einer Minute.

## Website lokal ansehen

Die Seite ist eine statische Website, die noch nirgends veröffentlicht ist. Die Werkbank lädt eine Datenbank als WebAssembly; das funktioniert nicht über `file://`, sondern nur über einen lokalen Webserver.

```bash
cd web
npm install
npm run build
npm run preview        # http://localhost:4173
```

Entwicklung mit automatischem Neuladen: `npm run dev`. Alternativ jeder statische Server im Ordner `web/dist`, z. B. `python -m http.server 8000 --directory web/dist`.

Für eine spätere Veröffentlichung genügt es, den Inhalt von `web/dist` auf einen beliebigen statischen Host zu legen (GitHub Pages, Netlify, Vercel, eigener Server). Alle Pfade sind relativ.

## Lizenz und Dank

Daten: CC BY 4.0 (Zenodo-Datensatz), Ortskoordinaten: GeoNames (CC BY 4.0), Küstenlinien: Natural Earth (gemeinfrei). Die Transkription verdanken wir den Ehrenamtlichen der MAUS Bremen, der Handelskammer Bremen und dem Staatsarchiv Bremen ([passagierlisten.de](https://passagierlisten.de/)).
