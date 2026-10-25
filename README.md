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
| `web/atlas.html` | eigenständiger Atlas der Auswanderung (`web/src/atlas/`) |
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

## Atlas

`atlas.html` ist eine eigene Anwendung neben der Reportage. Sie zeigt alle Ergebnisse mit räumlichem Bezug und hat fünf Ansichten:

- **Herkunft**: Orte, Dichte im Sechseckraster oder Überrepräsentation einer Auswahl je Ort (Lagequotient)
- **Ziele**: Ankunftshäfen und genannte Reiseziele
- **Wege**: stärkste Verbindungen von Herkunftsort zu Reiseziel
- **Ketten**: 717 Korridore der Kettenmigration in sechs Kategorien
- **Wandel**: Differenzkarte zweier Zeiträume mit Schwerpunkt je Jahr und Standardabweichungsellipsen

Alle Ansichten folgen einer Zeitleiste mit Abspielfunktion und den Filtern für Reiseart, Berufsbereich, Geschlecht, Alter, Staatsangehörigkeit, Nachname (auch Kölner Phonetik) und Beruf. Ein Klick auf einen Ort öffnet sein Profil mit Zielen bzw. Herkünften, Berufen, Nachnamen und Häfen; von dort führt ein Link zu den Einträgen in der Werkbank. Der Rundgang (`atlas.html#kapitel=1`) erzählt die Ergebnisse in sieben Kapiteln; seine Zahlen stammen aus `web/public/data/atlas/kapitel.json`.

Die Grundansicht kommt aus `web/public/data/atlas/basis.json` und erscheint sofort. Alle gefilterten Ansichten rechnet DuckDB-Wasm im Browser aus `passagiere.parquet`. Der Zustand steht in der Adresse (`#ansicht=ketten&von=1919&bis=1929`), sodass sich jede Ansicht verlinken lässt.

## Lizenz und Dank

Daten: CC BY 4.0 (Zenodo-Datensatz), Ortskoordinaten: GeoNames (CC BY 4.0), Küsten, Seen und Flüsse: Natural Earth (gemeinfrei). Die Transkription verdanken wir den Ehrenamtlichen der MAUS Bremen, der Handelskammer Bremen und dem Staatsarchiv Bremen ([passagierlisten.de](https://passagierlisten.de/)).
