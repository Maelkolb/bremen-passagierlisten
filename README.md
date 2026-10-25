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

## Website

Veröffentlicht über GitLab Pages: <https://bremen-passagierlisten-2aa903.pages.fim.uni-passau.de/> (Atlas: [`atlas.html`](https://bremen-passagierlisten-2aa903.pages.fim.uni-passau.de/atlas.html)). Jeder Push auf `main` im GitLab-Projekt [perschl/bremen-passagierlisten](https://git.fim.uni-passau.de/perschl/bremen-passagierlisten) baut die Seite neu (`.gitlab-ci.yml`).

Die Werkbank lädt eine Datenbank als WebAssembly; das funktioniert nicht über `file://`, sondern nur über einen Webserver. Lokal:

```bash
cd web
npm install
npm run build
npm run preview        # http://localhost:4173
```

Entwicklung mit automatischem Neuladen: `npm run dev`. Alternativ jeder statische Server im Ordner `web/dist`, z. B. `python -m http.server 8000 --directory web/dist`. Alle Pfade sind relativ, `web/dist` läuft also auf jedem statischen Host.

## Atlas

`atlas.html` ist eine eigene Anwendung neben der Reportage, mit drei Ansichten der Überfahrten:

- **Herkunft**: Herkunftsorte, Kreisfläche nach Zahl der Einträge
- **Ziele**: genannte Reiseziele und die Seewege zu den Ankunftshäfen
- **Ketten**: 717 Korridore der Kettenmigration in sechs Kategorien

Alle drei folgen der Zeitleiste (Zeitraum aufziehen oder Jahr für Jahr abspielen) und der Namenssuche, auf Wunsch mit ähnlichen Schreibweisen (Kölner Phonetik). Die Namenssuche listet alle Einträge des Namens chronologisch, Reisegruppen sind verbunden. Ein Klick auf einen Ort öffnet sein Profil mit Zielen bzw. Herkünften, Nachnamen, Berufen und Einträgen, ein Klick auf einen Korridor die Liste der Reisenden. Jeder Eintrag öffnet sich als Karte mit allen Angaben der Liste, der Reisegruppe, weiteren Einträgen desselben Namens aus demselben Ort und dem Reiseweg auf der Karte (Herkunft, Bremen, Ankunftshafen, Ziel); die Adresse `#eintrag=<id>` verlinkt ihn direkt. Der Rundgang (`atlas.html#kapitel=1`) erzählt die Ergebnisse in sechs Kapiteln; seine Zahlen stammen aus `web/public/data/atlas/kapitel.json`.

Ohne Namenssuche kommen alle Ansichten aus den vorberechneten Dateien in `web/public/data/atlas/` und erscheinen sofort. Namenssuche, Profile und Reisendenlisten rechnet DuckDB-Wasm im Browser aus `passagiere.parquet`. Der Zustand steht in der Adresse (`#ansicht=ketten&von=1919&bis=1929&nachname=Hoffmann`), sodass sich jede Ansicht verlinken lässt.

## Lizenz und Dank

Daten: CC BY 4.0 (Zenodo-Datensatz), Ortskoordinaten: GeoNames (CC BY 4.0), Küsten, Seen und Flüsse: Natural Earth (gemeinfrei). Die Transkription verdanken wir den Ehrenamtlichen der MAUS Bremen, der Handelskammer Bremen und dem Staatsarchiv Bremen ([passagierlisten.de](https://passagierlisten.de/)).
