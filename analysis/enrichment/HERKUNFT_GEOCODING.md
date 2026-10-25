# Geokodierung des Herkunftsorts (`previous_residence`)

**Aufruf:** `.venv/Scripts/python.exe -I analysis/enrichment/geocode_herkunft.py` (etwa 75 s). Ergebnis: `data/enrichment/herkunft_geo.parquet` (eine Zeile je Schlüssel `previous_residence` × `state_or_province_cleaned` × `nationality_cleaned`, 135 273 Schlüssel) und `data/enrichment/region_geo.csv` (alle 956 Regionswerte). Datengrundlage: GeoNames `cities500` plus 33 Länderdumps (Europa, US, CA, AR, BR) und die alternateNames-Dateien (nur für die heutigen Amtsnamen), Stand 24./25.10.2026. Fehlende GeoNames-Dateien werden heruntergeladen, danach läuft das Skript offline und deterministisch.

## Methode

1. **Bereinigung:** Postbezirke und Hausnummern, „(?)“, Zusätze wie `a/M`, `a.d.S.`, `i/W`, `O/S`, `(Ostfr.)`, `b.`/`bei`, `Kr.`, Kommazusätze und Ortsteilkomposita (`Berlin-Charlottenburg`) werden zerlegt. Abkürzungen löst `manual/herkunft_zusaetze.csv` auf (`/M` → „Frankfurt am Main“, `Kl.` → Klein, `Vel.` → Veľké …). Strings mit unleserlichen Zeichen (`??enbach`) werden nicht abgeglichen.
2. **Kandidaten:** Abgleich gegen GeoNames-Namen, -Alternativnamen und Kurzformen („Halle“ ← „Halle (Saale)“), dann normalisiert (Umlaute, Kompaktschreibung, alte Orthographie c→k, deutsch→englische Transliteration für Wolgakolonien), zuletzt fuzzy (Levenshtein 1 ab 7 Zeichen, 2 ab 12 Zeichen, nur innerhalb von Region bzw. Nationalität und nur bei eindeutigem Treffer).
3. **Kontextstufen:** zuerst Zusatz bzw. Bezugsort, dann historische Region (`manual/regionen.csv`: Region → heutige Länder und Admin-1/2-Codes, z. B. Westfalen → drei Regierungsbezirke, Saratow → Oblaste Saratow und Wolgograd), dann Nationalität mit historischer Ausdehnung (`manual/herkunft_laender.csv`: Deutschland = DE, PL, Königsberger Gebiet, Memelland; Ungarn = Königreich Ungarn vor 1920 …), zuletzt Großstädte bzw. Aufnahmeländer. Innerhalb einer Stufe entscheidet die Einwohnerzahl, aber nur bei mindestens fünffacher Dominanz. Sonst gilt `geo_ambiguous = true`: bei zwei Kandidaten wird der größere mit reduzierter Konfidenz gewählt, bei drei oder mehr erfolgt der Rückfall auf Region bzw. Land.
4. **Overrides:** `manual/herkunft_overrides.csv` (108 Zeilen, `quelle = manuell`) korrigiert häufige Fälle wie Lehe, Barmen, Rüstringen, die Wolgakolonien Norka und Hussenbach sowie Görlitz, Steyl und M.-Gladbach. Bis Rang 520 wurden alle Strings von Hand geprüft, bis Rang 4 000 nur die als unsicher markierten Ergebnisse (mehrdeutig, fuzzy, Rückfall, ausländische Alternativnamen).
5. **Rückfall:** Ist der Ort nicht bestimmbar, gilt die Region (`region`), bei reinen Länderangaben wie „USA“ oder „Ungarn“ das Land (`land`). Eine Nationalität allein führt nie zu Koordinaten.

## Abdeckung

| Genauigkeit | Datensätze | Anteil | Schlüssel | Strings¹ |
|---|---:|---:|---:|---:|
| ort | 433 499 | 79,2 % | 57,3 % | 50,8 % |
| region | 34 168 | 6,2 % | 14,2 % | 15,4 % |
| land | 21 017 | 3,8 % | 5,0 % | 5,0 % |
| keine | 58 372 | 10,7 % | 23,6 % | 28,9 % |

¹ 99 253 verschiedene Strings, jeweils mit der besten in irgendeinem Kontext erreichten Genauigkeit.

**Nach Methode (Datensätze / Schlüssel):** exakt 53,2 % / 34,3 %, alternativname 15,6 % / 8,3 %, fuzzy 4,4 % / 10,4 %, override 3,6 % / 0,6 % (165 Schreibungen), normalisiert 2,0 % / 3,1 %, stadtteil 0,2 % / 0,3 %, kurzform 0,2 % / 0,2 %, region 6,2 % / 14,2 %, land 3,8 % / 5,0 %.

**Mehrdeutigkeit:** 5,9 % der Datensätze (7,7 % der Schlüssel) tragen `geo_ambiguous`, bei Ortstreffern sind es 4,0 %. 82 % der Ortstreffer haben eine Konfidenz ≥ 0,8.

## Stichprobe (200 Datensätze, zeilengewichtet)

Gezogen mit Seed 20261025 über alle Datensätze. Geprüft wurden die ersten 200 mit Koordinaten, jeder einzeln von Hand. Ergebnis: **183 richtig, 15 unsicher, 2 falsch.** Beide Fehler gingen auf Regeln zurück und sind behoben: Zbaraz mit Region „Übriges Österreich“ landete in Österreich statt in Galizien, Balatonfüred mit Region „Tschechoslowakei“ fiel auf CZ zurück. Auf der Endfassung ergibt dieselbe Stichprobe 185 / 15 / 0, ist dadurch aber nicht mehr unabhängig. Eine frühere unabhängige Stichprobe ergab 183 / 14 / 3: Osterfeld (bis 1929 westfälisch) landete bei Herford, Dyersville (Iowa) fehlt in GeoNames und wurde zu Dyersburg (Tennessee), Tilsit mit falscher Region „Westpreußen“ fiel auf die Region zurück. Realistisch sind also etwa 1–1,5 % falsch und 7 % unsicher. Unsicher sind vor allem gleichnamige Dörfer in einer Region (Malsch, Talheim, Westheim, Chlum, Grądy) und Fuzzy-Treffer galizischer oder litauischer Dörfer.

## Bekannte Schwächen

- **Unbestimmte Orte:** Ohne Treffer bleiben vor allem kleine Orte in Ungarn, der Tschechoslowakei, Galizien, Litauen und Russland (ungarische Namensformen, Verschreibungen, fehlende GeoNames-Einträge). Nach Nationalität: Ungarn 15 000, ČSR 9 400, Österreich 7 900, Russland 5 700 Datensätze.
- **Region ≠ Wohnort:** Der Regionswert beschreibt nicht immer den Wohnort. Ein falscher Regionswert führt dann zu falschen Regionskoordinaten.
- **Regionspunkte:** Die Punkte sind ADM-1/2-Repräsentativpunkte oder von Hand gesetzte Näherungen, keine Flächenschwerpunkte. Moderne Admin-Grenzen bilden historische Grenzen nur grob ab (Rheinprovinz, Pfalz und Rheinhessen liegen alle in RLP).
- **Alternativnamen:** GeoNames führt frühere Namen, etwa bei US-Orten (Brooklyn → Oshkosh). Das ist durch Regeln und Overrides eingedämmt, aber nicht beseitigt. Fuzzy-Treffer (Konfidenz 0,59–0,65) sollten für Kettenwanderungsstatistiken gefiltert werden.
- **Stadtteile:** Ehemals selbständige Städte (Lehe, Geestemünde, Barmen, Charlottenburg) liegen auf dem heutigen Stadtteilpunkt. Für Aggregationen nach heutiger Gemeinde sollten diese Punkte zusammengefasst werden.
- **Länder- und Namensangaben:** Länderpunkte von Vielvölkerstaaten (ČSR, Russland, Jugoslawien) tragen `geo_ambiguous`. `herkunft_ort_heute` ist der bevorzugte GeoNames-Name in Landessprache, bei kyrillischer Schrift die lateinische GeoNames-Form.
