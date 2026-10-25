# Schema und Analyseplan

Datensatz: Perschl, Schmidt, Gassner, Rehbein (2025), *A Dataset of 735,000 Migration Records (Bremen, 1830-1939)*, Zenodo, [10.5281/zenodo.17977460](https://doi.org/10.5281/zenodo.17977460), CC BY 4.0. Grundlage sind die Transkriptionen der Bremer Passagierlisten durch *Die MAUS – Gesellschaft für Familienforschung e. V. Bremen*, die Handelskammer Bremen und das Staatsarchiv Bremen.

## Datei

| | |
|---|---|
| Datei | `CHUP_Passengerlists.csv`, 272.193.270 Bytes, MD5 `41f6368bf50131b577f73943f8fee629` (geprüft) |
| Format | UTF-8, Trennzeichen `@`, keine Anführungszeichen, Kopfzeile |
| Umfang | 735.545 Zeilen, 62 Spalten |
| Einlesen | `pl.read_csv(path, separator="@", infer_schema=False, quote_char=None)`, danach alle Werte getrimmt und Leerstrings als fehlend |
| Typen | alles als Text gelesen; Zahlen (`age_cleaned`, `occupation_*`, Koordinaten) und Datum (`date_of_departure_cleaned`, ISO 8601) werden in der Pipeline typisiert |

## Zeitliche Struktur

Die Überlieferung ist nicht gleichmäßig. Sie zerfällt in vier Blöcke, und die Analyse folgt diesen Blöcken statt der Epochen des Projektbriefs:

| Zeitraum | Datensätze | Anteil | Charakter |
|---|---:|---:|---|
| 1830–1869 | 2.746 | 0,4 % | einzelne Listen aus Sammlungen (Archivkürzel F, HK, K, DAZ, STAB), Segelschiffzeit |
| 1870–1906 | 0 | | Listen 1875–1907 nach damaliger Aufbewahrungspraxis vernichtet |
| 1907–1914 | 97.019 | 13,2 % | Dampferzeit vor dem Ersten Weltkrieg (Archivkürzel STAB, FSI); 1909–1912 fast leer |
| 1919–1929 | 343.269 | 46,7 % | Zwischenkriegszeit, Archivserie AIII 15 der Handelskammer; 1924 und 1929 lückenhaft |
| 1930–1939 | 292.511 | 39,8 % | Weltwirtschaftskrise, NS-Zeit, Flucht; 1939 bis Kriegsbeginn |

412 Datensätze haben kein bereinigtes Abfahrtsdatum. Bei 19 Datensätzen des Schiffs *Merkur* (Archivkürzel `KW-28.02.1945_N`, Wohnorte Bromberg, Kolberg) steht im bereinigten Datum 1845, das Archivkürzel spricht für 1945. Solche Konflikte zwischen Archivkürzel und Datum werden eigens geprüft.

Der vom Brief vorgesehene Vergleich der Segelschiffzeit vor 1870 mit der Massenauswanderung der 1880er Jahre ist mit dieser Quelle nicht möglich. Die Epochen der Analyse sind deshalb **Segelschiffzeit 1830–1869** (wenige Listen, nur deskriptiv), **Vorkriegsjahre 1907–1914**, **Zwanziger Jahre 1919–1929** und **Dreißiger Jahre 1930–1939**.

## Was die Listen enthalten

Die Listen verzeichnen alle Passagiere eines Schiffs, nicht nur Auswanderer. 190.775 Personen (26 %) haben die Staatsangehörigkeit USA; das sind überwiegend Rückreisende, die meist ohne Wohnort in Europa eingetragen sind. Unter den Ankunftshäfen stehen Kreuzfahrten (9.558 Mal „Gesellschaftsreise“, dazu Nordkap-, Polar- und Madeirafahrten in `port_of_arrival_country`). Die Analyse unterscheidet deshalb Auswanderung (nicht-US-Staatsangehörigkeit, Überfahrt) von übrigem Reiseverkehr und weist beide getrennt aus.

## Zuordnung der Begriffe des Briefs zu Spalten

| Begriff im Brief | Spalte(n) | Befund |
|---|---|---|
| Abfahrtsdatum | `date_of_departure_cleaned` | 99,9 % gefüllt, ISO-Datum |
| Schiff, Reederei | `ship_cleaned` (512 Werte), `agent_cleaned` (81) | Norddeutscher Lloyd 80 % |
| Abfahrtshafen mit Koordinaten | `port_of_departure_cleaned`, `_LAT`, `_LON` | 98,5 % Bremen |
| Ankunftshafen mit Koordinaten | `port_of_arrival_cleaned`, `_LAT`, `_LON`, `_country`, `_US_state` | Koordinaten fehlen für 5,3 %, u. a. für Southampton (22.755) |
| Herkunftsort | `previous_residence` (99.264 Schreibungen), `state_or_province_cleaned` (956) | **nicht geokodiert und nicht normalisiert**; eigene Geokodierung gegen GeoNames (siehe unten) |
| Ziel | `emigration_destination` (35.094 Schreibungen), `US_state_cleaned` | nicht normalisiert; eigene Geokodierung |
| Name | `last_name`, `first_name` | 185.497 Nachnamen in Originalschreibung (Müller und Mueller getrennt) |
| Geschlecht | `gender_cleaned` (m, w, uneindeutig) | 98,6 % gefüllt |
| Alter | `age_cleaned` (0–110 Jahre) | 96,8 % gefüllt; Mittelwert 31,1, Median 29; ein Teil der Werte ist als „24.0“ gespeichert und muss über Gleitkomma gelesen werden |
| Familienstand | `marital_status_cleaned` | 84,2 % |
| Staatsangehörigkeit | `nationality_cleaned` (95) | 97,5 % |
| Beruf | `occupation` (Original), `occupation_cleaned` (7.108) | 57,8 %, nach Zeitraum 10 %, 87 %, 61 %, 46 % |
| HISCO | `occupation_hisco_nr` (251 Codes) | 54,3 %; `-1` = Beruf vorhanden, nicht klassifizierbar (35.599, meist Angehörige) |
| KldB 2010 Berufsbereich | `occupation_sector` (0–9) | 53,1 %; Hausfrau, Dienstmädchen fallen in Bereich 8 (Hauswirtschaft) |
| KldB 2010 Anforderungsniveau | `occupation_training_level` (1 Helfer, 2 Fachkraft, 3 Spezialist, 4 Experte) | 49,5 % |
| Reiseklasse | `travel_class_cleaned` (15) | 85,0 % |
| Passagiernummer | `nr` | 98,5 %, Reihenfolge auf der Liste, Grundlage der Reisegruppen |

## Fehlende Werte

Kernfelder (Datum, Schiff, Hafen, Name, Geschlecht, Alter) sind ab 1907 zu über 95 % gefüllt. Beruf und Herkunftsregion nehmen nach 1914 ab (Beruf 87 % → 61 % → 46 %; `state_or_province` insgesamt 42 %). Die Felder des US-Einwanderungsformulars (`literacy`, `ticket`, `who_paid`, `amount_of_money`, `previous_US_stay`) gibt es fast nur 1935–1937, je um 1 %. Religion und Ethnie sind zu 1–2 % gefüllt und auf 1937–1939 konzentriert. Die Listen vor 1870 enthalten fast nur Name, Schiff und Wohnort. Das Spaltenprofil am Ende führt die Füllgrade je Zeitraum für alle 62 Spalten.

## Anreicherung durch dieses Projekt

Drei Bausteine ergänzen, was der Datensatz nicht normalisiert hat. Die Ergebnisse liegen als Nachschlagetabellen in `data/enrichment/`, die Methodenberichte in `analysis/enrichment/`.

1. **Herkunft**: `previous_residence` mit `state_or_province_cleaned` und `nationality_cleaned` als Kontext gegen GeoNames (offline, Exonyme wie Breslau, Lemberg, Preßburg), Genauigkeit Ort, Region oder Land.
2. **Ziele und Häfen**: `emigration_destination` und `place_of_stay` gegen GeoNames mit US-Bundesstaat und Ankunftsland als Kontext; fehlende Hafenkoordinaten; Kennzeichnung von Kreuzfahrten.
3. **Seltene Spalten**: Notizen, Kapitäne, Verwandte, Kontaktpersonen, US-Formularfelder, Zerlegung des Archivkürzels, Prüfung Archivkürzel gegen Datum, Dubletten.

Die Pipeline selbst ergänzt normalisierte Nachnamen (Umlaute, ß), die Kölner Phonetik für die unscharfe Namenssuche und Reisegruppen aus Schiff, Datum, Nachname und aufeinanderfolgender Passagiernummer.

## Analyseplan

**Modul 1 – Quellenkritik und Überlieferungsdichte.** Jahres- und Monatsreihen der Datensätze; Saisonfiguren als Poisson-Modell mit Jahres- und Monatseffekten für alle Jahre mit mindestens zehn belegten Monaten, ergänzend STL-Zerlegung der durchgehenden Monatsreihe 1930–1939; Fehlwerte je Spalte und Jahr; Archivserien je Jahr; Datumskonflikte.

**Modul 2 – Berufsstruktur.** KldB-Berufsbereiche und Anforderungsniveaus je Zeitraum; Shannon-Entropie der Berufe je Zeitraum mit Rarefaction auf gleiche Stichprobengröße und Bootstrap-Intervall; steigende und fallende HISCO-Codes zwischen den Epochen (log-Verhältnis der Anteile mit Haldane-Korrektur, Zwei-Stichproben-Test, Bonferroni); Kreuztabellen Berufsbereich × Zielhafen, × Altersgruppe, × Geschlecht mit χ², Cramérs V und standardisierten Residuen.

**Modul 3 – Geografie und Kettenmigration.** Gewichtete Schwerpunkte der Herkunftsorte je Jahr und Zeitraum, Standarddistanz als Streuungsmaß; Herkunft-Ziel-Korridore gezählt über Reisegruppen statt Einzelpersonen (große Familien verzerren sonst), Kettenmigration als Korridore, die in mehreren Jahren wiederkehren und deren gewichtetes log-odds-Verhältnis mit informativem Dirichlet-Prior einen z-Wert über 3 erreicht; dazu PMI.

**Modul 4 – Demografie und Reisegruppen.** Alterspyramiden in Fünfjahresklassen je Zeitraum und Berufsbereich; Männer je 100 Frauen je Jahr; Rekonstruktion von Reisegruppen (gleiche Liste und gleiches Datum, normalisierter Nachname, Passagiernummern ohne größere Lücke) und Einteilung in Alleinreisende, Paare und Familiengruppen ab drei Personen, mit Sensitivitätsprüfung gegen eine einfache Gruppierung nach Nachname, Schiff und Datum.

**Modul 5 – Schifffahrt und Routen.** Marktanteile der Ankunftshäfen und Reedereien je Jahr; Abfahrten nach Monat und Jahr als Heatmap; Passagiere je Reise (Schiff und Abfahrtsdatum); Reiseklassen im Wandel (Zwischendeck und 3. Klasse, Touristenklasse ab 1931).

## Ergebnisse für die Website

`analysis/run_all.py` erzeugt `web/public/data/*.json` (Aggregate für Reportage, Atlas und Sankey), `web/public/data/passagiere.parquet` (alle 735.545 Datensätze, wörterbuchkodiert, ZSTD, für DuckDB-Wasm in der Forscher-Werkbank) und `FORSCHUNGSBERICHT_MAUS.md`.

## Spaltenprofil

Füllgrad insgesamt und je Zeitraum, Zahl der verschiedenen Werte, die drei häufigsten Werte (nach Trimmen der Leerzeichen).

| Spalte | gefüllt | verschieden | 1830–1869 | 1907–1914 | 1919–1929 | 1930–1939 | häufigste Werte |
|---|---|---|---|---|---|---|---|
| id | 100.0% | 735.545 | 100% | 100% | 100% | 100% | 1 (1); 2 (1); 3 (1) |
| archive_id | 100.0% | 4.702 | 100% | 100% | 100% | 100% | STAB_4,57/5-09_M (2.274); STAB_4,57/5-26_M (2.049); AIII15-22.09.1936_N (1.749) |
| agent | 100.0% | 115 | 97% | 100% | 100% | 100% | Nordd. Lloyd, Bremen (568.995); F. Missler, Bremen (76.615); United States Lines, Bremen (27.094) |
| agent_cleaned | 100.0% | 82 | 97% | 100% | 100% | 100% | Nordd. Lloyd, Bremen (588.109); F. J. Missler, Bremen (78.741); United States Lines, Bremen (27.099) |
| date_of_departure | 100.0% | 2.331 | 100% | 100% | 100% | 100% | 24 März 1907 (2.952); 14. Apr 07 (2.769); 21. Nov 08 (2.221) |
| date_of_departure_cleaned | 99.9% | 2.319 | 100% | 100% | 100% | 100% | 1907-03-24 (2.952); 1907-04-14 (2.769); 1908-11-21 (2.221) |
| sort_da | 100.0% | 2 | 100% | 100% | 100% | 100% | 0 (735.436); 19250613 (109) |
| ship | 100.0% | 519 | 100% | 100% | 100% | 100% | Bremen (107.423); Europa (91.660); Columbus (64.427) |
| ship_cleaned | 100.0% | 513 | 100% | 100% | 100% | 100% | Bremen (107.352); Europa (91.660); Columbus (64.427) |
| port_of_departure | 99.7% | 40 | 99% | 100% | 100% | 100% | Bremen (722.274); Hamburg (5.527); Bremen-Freihafen (2.173) |
| port_of_departure_cleaned | 99.6% | 18 | 98% | 100% | 99% | 100% | Bremen (724.397); Hamburg (5.527); Bremerhaven (1.086) |
| port_of_departure_LAT | 99.5% | 16 | 98% | 100% | 99% | 100% | 53.0758196 (724.397); 53.550341 (5.527); 53.5505392 (1.086) |
| port_of_departure_LON | 99.5% | 16 | 98% | 100% | 99% | 100% | 8.8071646 (724.397); 10.000654 (5.527); 8.5851945 (1.086) |
| port_of_departure_country | 99.5% | 11 | 98% | 100% | 99% | 100% | Deutschland (731.028); USA (715); Frankreich (74) |
| port_of_arrival | 99.9% | 338 | 86% | 100% | 100% | 100% | New York (559.715); Buenos Aires, Argentinien (45.107); Southampton, England (22.755) |
| port_of_arrival_cleaned | 99.5% | 298 | 86% | 100% | 99% | 100% | New York (559.646); Buenos Aires (45.107); Southampton (22.755) |
| port_of_arrival_LAT | 94.7% | 241 | 82% | 100% | 98% | 90% | 40.7127281 (559.646); -34.6083696 (45.107); 39.2908816 (19.328) |
| port_of_arrival_LON | 94.7% | 241 | 82% | 100% | 98% | 90% | -74.0060152 (559.646); -58.4440583 (45.107); -76.610759 (19.328) |
| port_of_arrival_country | 99.6% | 125 | 97% | 100% | 99% | 100% | USA (586.555); Argentinien (45.107); England (23.638) |
| port_of_arrival_US_state | 79.8% | 12 | 80% | 92% | 79% | 77% | NY (560.492); MD (19.328); TX (4.838) |
| captain | 2.1% | 142 | 99% | 0% | 0% | 4% | Jürgen Meyer (1.975); Ahrens, A. (1.602); W.Michaelsen (1.340) |
| travel_class | 85.0% | 141 | 72% | 4% | 100% | 95% | III. Klasse (168.520); 3. Klasse (106.216); Touristenklasse (88.488) |
| travel_class_cleaned | 85.0% | 16 | 72% | 4% | 100% | 95% | 3. Klasse (309.387); Touristenklasse (89.430); 2. Klasse (79.462) |
| nr | 98.5% | 53.088 | 3% | 100% | 100% | 98% | 1 (9.358); 2 (8.364); 3 (7.601) |
| last_name | 100.0% | 185.480 | 100% | 100% | 100% | 100% | Schmidt (3.841); Müller (3.326); Meyer (2.854) |
| first_name | 99.8% | 43.498 | 91% | 100% | 100% | 100% | Anna (24.423); Maria (14.477); Josef (12.849) |
| gender | 98.6% | 10 | 57% | 98% | 100% | 98% | m (363.894); w (305.899); M (24.942) |
| gender_cleaned | 98.6% | 4 | 57% | 98% | 100% | 98% | m (388.806); w (336.641); uneindeutig (10) |
| age | 97.1% | 15.487 | 24% | 98% | 99% | 95% | 24 (24.007); 25 (23.055); 26 (22.242) |
| age_cleaned | 96.8% | 195 | 24% | 98% | 99% | 94% | 24 (14.195); 25 (13.594); 23 (13.364) |
| marital_status | 84.2% | 49 | 1% | 88% | 85% | 83% | verh (283.529); led (249.537); Ww (25.043) |
| marital_status_cleaned | 84.2% | 7 | 1% | 88% | 85% | 83% | verheiratet (310.623); ledig (278.540); verwitwet (27.418) |
| previous_residence | 74.4% | 99.254 | 44% | 98% | 79% | 62% | Berlin (24.049); Bremen (14.498); New York (11.406) |
| nationality | 97.5% | 462 | 1% | 98% | 100% | 96% | Deutsch (292.226); USA (190.099); Ungarn (40.276) |
| nationality_cleaned | 97.5% | 96 | 1% | 98% | 100% | 96% | Deutschland (305.742); USA (190.775); Ungarn (40.383) |
| state_or_province | 42.3% | 1.718 | 58% | 28% | 55% | 32% | Bayern (30.804); Hannover (25.547); Brandenburg (23.725) |
| state_or_province_cleaned | 42.3% | 957 | 58% | 28% | 55% | 32% | Bayern (30.821); Hannover (25.564); Brandenburg (23.737) |
| occupation | 58.2% | 10.560 | 10% | 87% | 61% | 46% | Hausfrau (45.146); Landw. Tagel. (30.266); Landarbeiter (20.423) |
| occupation_cleaned | 57.8% | 7.031 | 10% | 87% | 61% | 45% | Landwirtschaft Tagelöhner (61.730); Hausfrau (47.635); Landwirtschaft Arbeiter (22.977) |
| occupation_hisco_nr | 54.3% | 252 | 7% | 83% | 57% | 42% | 62110.0 (64.667); 22460.0 (46.777); 54020.0 (36.039) |
| occupation_sector | 53.1% | 11 | 7% | 82% | 56% | 40% | 8.0 (116.065); 1.0 (115.887); 2.0 (77.281) |
| occupation_training_level | 49.5% | 5 | 7% | 68% | 54% | 39% | 2.0 (160.910); 1.0 (158.580); 3.0 (26.558) |
| emigration_destination | 95.7% | 34.784 | 4% | 98% | 99% | 92% | New York (112.200); Buenos Aires (43.667); Chicago (42.889) |
| US_state | 70.2% | 141 | 2% | 89% | 75% | 59% | NY (199.500); IL (50.797); PA (49.733) |
| US_state_cleaned | 70.2% | 54 | 2% | 89% | 75% | 59% | NY (199.663); IL (51.011); PA (49.784) |
| notes | 3.3% | 8.844 | 25% | 2% | 1% | 6% | gestrichen (4.433); Irland-Englandfahrt (1.602); russischer Flüchtling (536) |
| emigrant | 1.3% | 95 | 0% | 0% | 0% | 3% | A (9.139); gestrichen (47); geb.in Idafehn (2) |
| ethnicity | 2.3% | 349 | 0% | 0% | 0% | 6% | german (6.409); Deutsch (1.771); Jude (1.461) |
| ethnicity_cleaned | 2.3% | 82 | 0% | 0% | 0% | 6% | deutsch (9.819); jüdisch (2.165); slowakisch (1.403) |
| religion | 1.2% | 118 | 0% | 0% | 0% | 3% | mos. (1.364); kath. (1.101); Mos. (1.057) |
| religion_cleaned | 1.2% | 28 | 0% | 0% | 0% | 3% | mosaisch (3.186); katholisch (2.477); evangelisch (1.936) |
| literacy | 1.1% | 124 | 0% | 0% | 0% | 3% | y german y (6.491); y slovak y (232); y english y (128) |
| relative | 1.1% | 7.557 | 0% | 0% | 0% | 3% | Berlin (8); none (6); Convent: Toechter des Allerh. Erloesers, Wuerzburg (6) |
| ticket | 1.0% | 11 | 0% | 0% | 0% | 3% | y (6.761); n (764); no (19) |
| who_paid | 1.1% | 86 | 0% | 0% | 0% | 3% | self (6.477); father (285); son (113) |
| amount_of_money | 0.8% | 139 | 0% | 0% | 0% | 2% | 25 (2.775); 4 (718); y (617) |
| previous_US_stay | 1.0% | 8 | 0% | 0% | 0% | 2% | y (4.388); n (2.564); no (227) |
| duration_of_stay | 0.8% | 847 | 57% | 0% | 0% | 1% | 1929-1936 (226); 1928-1936 (216); 1927-1936 (166) |
| duration_of_stay_cleaned | 0.7% | 547 | 48% | 0% | 0% | 1% | 1929_1936 (287); 1928_1936 (252); 1927_1936 (196) |
| place_of_stay | 0.6% | 625 | 0% | 0% | 0% | 1% | New York (1.464); Chicago (302); Brooklyn (281) |
| reference_person | 2.2% | 11.416 | 0% | 0% | 0% | 5% | firm: North German Lloyd, 57-Broadway, NYC (115); New York, NY (61); Machine & Tool Show, Cleveland, OH (52) |
| pfd | 0.1% | 49 | 13% | 0% | 0% | 0% | NEW ERA_1854 (221); NY (207); SHENANDOAH_1834 (134) |
