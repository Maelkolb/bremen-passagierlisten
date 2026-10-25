# Dünn besetzte Spalten: Bereinigung

Skript: `analysis/enrichment/clean_sparse.py`, Ausgabe: `data/enrichment/sparse_cleaned.parquet` (735.545 Zeilen, eine je `id`). Mapping-Tabellen: `analysis/enrichment/manual/sparse_*.csv`. Was nicht eindeutig lesbar ist, bleibt leer und steht in `unparsed_fields` (Feldnamen, durch `;` getrennt). Parse-Rate = Anteil der nicht leeren Rohwerte, aus denen das Hauptergebnis abgeleitet wurde.

## Spalten

| Feld | Bedeutung, Jahre | Regel | Rate |
|---|---|---|---|
| `archive_id` | Fundstelle; Präfix = Reihe (AIII 634.355, STAB 52.663, FSI 44.308, F 1.975, KW 996, AIV 483, HK 437, K 279, DAZ 38, KB 10), Datum `TT.MM.JJJJ` (auch `10.2.1926`), Suffix = Agentur (N Lloyd, M Missler, U US Lines, K Karesch & Stotzky, A HAPAG, W White Star, P Argo, D Neptun) | Regex; 3 Zeilen mit Fremd-Anführungszeichen bereinigt. STAB-Signaturen (52.432) tragen kein Datum. 338 Daten mit `00` bleiben ohne `archive_date`, `archive_year` ist gesetzt | 100 % (1 Zeile ohne ID) |
| `nr` | Nummer in der Liste. Nur 89,6 % sind Ganzzahlen (`1.0` = 1). Der Rest ist Seite-Zeile: `61-3`, `1/5`, `Bl.2-4` (18.913), ferner 10.486 durch Excel zerstörte Werte (`01. Jan`, `Jan 13` = Seite 1, Zeile 1/13; die Folge `01. Jan … 01. Dez, Jan 13` belegt das) und 44.292 `FSI_` plus 9 Ziffern | `nr_int`, `nr_page`, `nr_line`, `nr_form`; FSI-Kennungen nur markiert | 99,8 % |
| `literacy` | „lesen / Sprache / schreiben“, 1935–37 (Einzelfälle 1925, 1938/39) | `y/n/no` → `literacy_reads/_writes`; 54 Sprachschreibweisen → Deutsch usw. („germany“ → Deutsch) | 99,2 %, Sprache 98,0 %. Offen: „gestrichen“ (49), „x“, Austria, Switzerland |
| `ticket` | Fahrkarte bis Ziel, 1935–37 | y/Y/n/no | 99,9 % (9 verschobene Verwandtenangaben) |
| `who_paid` | Zahler der Passage, 1935–37; auf 10 Zeichen gekürzt („grandmothe“) | 85 Werte → 38 Kategorien (selbst, Vater, Ehemann, Firma, Kloster, Norddeutscher Lloyd …) | 99,9 % (11 offen: „y“, „n“, Personennamen) |
| `amount_of_money` | US-Frage „$ 50 in Besitz, sonst wie viel?“, 1935–37. „y“ = hat genug, keine Summe (620); Beträge (25: 2.776; 4: 718) sind der Restbetrag | `money_usd`, `money_stated_no_amount`; Dollar ist plausibel, nicht belegt | 99,7 % (17 offen: „n“, „self“ …) |
| `previous_US_stay` | früherer US-Aufenthalt, 1935–37 | y/n/no; Jahresspanne → `previous_us_stay_years` (nur 1 Fall) | 99,9 % („25“, „8.0“ offen) |
| `emigrant` | „A“ 9.139 Zeilen, nur 1937–39 (12,6 % der Zeilen 1937–39); daneben „geb. in …“ (94) und „gestrichen“ (47) | `emigrant_flag`. „A“ = vermutlich „Auswanderer“: Anteil bei Schanghai-Reisen 84 %, tschechoslowakischen Staatsangehörigen 72 %, US-Bürgern 0,08 %; 861 von 1.289 Reisen ohne jedes „A“. Nicht bestätigt | 100 % |
| `notes` | Freitext, nicht nur Dubletten. Mischung aus Streichung, Dublette („doppelt, s. NDL“ = Duplikat zur Lloyd-Liste, nur AIII), Geburtsort, Flüchtling, Reiseart, Havarie 1834/1854 („gestrandet mit der Shenandoah“), Transkriptionsvermerken, Ticketnummern. Breit über 1832–1939 | Flags, `notes_geburtsort` (11.075, inkl. `emigrant`), `notes_reiseart`, 15 Kategorien per geordneten Regeln. Streichung steht vor Dublette | 97,3 % (647 „Sonstiges“) |
| `captain` | 1830–1939 mit Lücken | Leerzeichen, „Name, V.“ → „V. Name“, „v.“ → „von“; gleiche Initiale und Nachname zusammen, längster Vorname gewinnt; reiner Nachname nur bei gleichem Schiff. 142 → 127 Namen | 100 % |
| `relative` | Verwandter in der Heimat, 1935–37 | Relationswort (EN, Tippfehler, „i.l.“, „gr.“, „step“) → Deutsch, dann Name und Ort (Straße und Land entfernt, „Frankfurt/M.“ → Frankfurt am Main) | Relation 93,1 %, Name 89,6 %, Ort 97,6 % |
| `reference_person` | Kontakt am Ziel, 1935–39. Die Hälfte sind reine Adressen ohne Relation | wie oben; Wohnadresse, c/o, Hotel, Firma als Relation; Ort mit US-Staat („Brooklyn, NY“) | Relation 50,8 %, Name 35,3 %, Ort 97,9 % |
| `pfd` | 437× `SCHIFF_JAHR` (1834, 1854, 1860): Verweis auf das havarierte Vorschiff, Fahrgäste wechselten auf ein anderes Schiff (belegt durch `notes`). 1935–39: verschobene Zielangabe (209 Kürzel, meist NY; 31 Adressen; 24 „in transit to …“) | `pfd_kategorie`: Schiffsverweis, Zielkürzel, Zieladresse, Transit | 99,7 % |

## Datumskonflikte

Das bereinigte Abfahrtsdatum folgt fast überall dem Archivdatum (682.624 von 682.701 vergleichbaren Zeilen gleich, 40× +1 Tag, Toleranz 3 Tage). **37 Konflikte**: KW 19, FSI 15, F 1, AIII 1, HK 1 (22× anderes Jahr, 15× mehr als 3 Tage). Beispiele: `KW-28.02.1945_N`, Merkur: Abfahrt 1845-02-28; in der Liste stehen Geburten 1939 und 1941, Wohnorte Bromberg und Kolberg. Daher Jahrhundertfehler, `departure_date_corrected` = 1945-02-28 (19 Zeilen, nur diese Regel: Tag und Monat gleich, Jahr genau 100 weniger). `FSI-11.09.1908_N` Kaiser Wilhelm der Grosse: Abfahrt 11.08. (9 Zeilen); `FSI-27.11.1913_N` Neckar: 1914; `HK_AIII1C-02.11.1854_STI` Julius: 1855-05-15; `AIII15-01.09.1925_N`: 1919 (das einzige Jahr-1919-Datum, Schiffsname im Rohtext „Ameruuuuuuuica“). Diese 18 bleiben ohne Korrektur. Das Jahr 1945 liegt außerhalb der Datensatzbeschreibung 1830–1939. 412 Zeilen ohne Abfahrtsdatum: 73 hätten ein volles Archivdatum, nicht eingetragen.

## Dubletten

`dup_candidate`: gleicher normalisierter Nachname, Vorname, Alter (`age_cleaned`, sonst `age`), Schiff und Abfahrtsdatum, alle fünf nicht leer. **2.964 Zeilen in 1.479 Gruppen** (1.475 Paare, 2 Dreier, 2 Vierer); AIII 2.267, FSI 565, STAB 130, AIV 2. 617 Gruppen verbinden verschiedene Listen derselben Fahrt (Lloyd, Missler, K&S), die übrigen stehen in derselben Liste. 393 Gruppen enthalten „doppelt“, 319 „gestrichen“. Von 660 Zeilen mit „doppelt“ erfasst der Schlüssel 473.

## Stichprobe

Vier Zufallsziehungen à 50 (17 `relative`, 17 `reference_person`, 12 `notes`, 4 `captain`). Die ersten drei fanden 8, 6 und 5 Fehler; die Regeln wurden danach angepasst (Straßen ohne Suffix, Länder am Ortsende, „i.l.“). Letzte Ziehung (Seed 4242): **4 Fehler in 50** (je 1× falsche Relation, Name „as above“, Ort „Herrenmuehle“ statt Radeburg, Ort „Ohio“ statt Cincinnati). Fehler konzentrieren sich auf Orte in Freitext; Kategorien und Flags der letzten Ziehung waren fehlerfrei.

## Auffälligkeiten in bereinigten Spalten

Keine Fahrten 1861–1906, 1910–12, 1915–18. 138 Zeilen „verheiratet“ mit Alter unter 14. In 1.825 Zeilen mit Geburtsdatum in `age` ist `age_cleaned` leer.
