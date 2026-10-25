# Geocodierung der Zielangaben

`geocode_ziele.py` erzeugt aus Roh-CSV, GeoNames (cities500 sowie Dumps US, CA, BR, AR, CL, PY, UY, DE, AT, CH) und `manual/` die Dateien `ziel_geo.parquet`, `ankunftshafen.csv` und `aufenthaltsort_geo.csv`. Der Lauf dauert etwa 1 Minute und ist deterministisch.

## Methode

- **Zerlegen:** Adressteile (Hausnummer, Straßenwort) und Personenangaben fallen weg. Zusätze wie `MB`, `Ill.`, `L.I.`, `D` oder `Kanada` (`ziel_qualifier.csv`) begrenzen den Suchraum; mehrdeutige Kürzel wie `E` oder `C` wirken nur schwach.
- **Normalisieren:** Diakritika und Umlaute werden aufgelöst, dazu St./Mt./So./Neu/Pto.-Varianten und zusammengeschriebene Namen.
- **Abgleich:** Haupt- und Alternativnamen sowie Länder-, Staaten- und Regionsnamen. Gewertet werden log(Einwohner), ein Hauptnamen-Bonus und ein Bonus für das Hafenland (für die USA ohne Staatsangabe halb, DE als Herkunftsland). Ein Kandidat gilt nur, wenn er den nächsten klar übertrifft.
- **Reihenfolge:**
  1. Overrides (`ziel_overrides.csv`, handgeprüft, Vorrang).
  2. Zusatz-Gebiet, dann `US_state_cleaned`, dann weltweit.
  3. Fuzzy und Präfix, nur innerhalb von Staat oder Hafenland und nur bewohnte Orte.
  4. Rückfall auf Staat oder Land, dann mit `ziel_ort` leer.
  5. Widerspricht der Staat einem Ort anderswo, bleibt der Punkt leer.
- **Regeln:**
  - Steht „NY“ bei einem zehnmal größeren Ort im Ballungsraum NJ/NY, wird der Staat korrigiert (`staat_korrigiert`).
  - Ohne Staat (`uneindeutig`) wird der Staat übernommen, den mindestens 80 % der übrigen Zeilen mit gleichem Text nennen (`staat_aus_korpus`).
  - Die fünf Boroughs samt Stadtteilen bilden `ziel_ort_gruppe` „New York City“; `ziel_metro` umfasst auch die Nachbar-Counties.
- **Häfen:** Die Datensatzkoordinaten bleiben unverändert. Fehlende Punkte kommen aus `ankunftshafen_manual.csv`: Routen erhalten den letzten Hafen, Kreuzfahrten und Großregionen keinen Punkt. Abweichungen über 50 km von GeoNames stehen in `koordinaten_hinweis`.

## Abdeckung (703.728 Zeilen, 46.648 Schlüssel, 34.783 Texte)

| geo_precision | Zeilen | Schlüssel | Texte¹ |
|---|---|---|---|
| ort | 92,8 % | 66,5 % | 62,2 % |
| bundesstaat | 3,3 % | 20,6 % | 25,2 % |
| land | 2,3 % | 4,6 % | 4,2 % |
| keine | 1,6 % | 8,4 % | 8,5 % |

| Methode | Zeilen | Schlüssel |
|---|---|---|
| exakt | 68,5 % | 43,1 % |
| Alternativname² | 18,6 % | 4,4 % |
| normalisiert/Variante | 3,3 % | 4,2 % |
| Override | 1,2 % | 0,6 % |
| Fuzzy/Präfix | 1,8 % | 11,3 % |
| Staatsregeln³ | 1,9 % | 3,7 % |
| Staat/Land (Rückfall, Kürzel, mehrdeutig) | 3,1 % | 24,4 % |
| ohne Punkt (mehrdeutig, Widerspruch, kein Treffer) | 0,9 % | 8,1 % |
| kein Ort („Rundreise“, „See Col. 11“) | 0,7 % | 0,3 % |

¹ häufigster Schlüssel je Text. ² vor allem „New York“ → New York City (101.000 Zeilen) und deutsche Exonyme. ³ `staat_korrigiert`, `staat_aus_korpus`, `name_gegen_staat`.

**Mehrdeutig** (`geo_ambiguous`) sind 4,0 % der Zeilen und 12,0 % der Schlüssel. 2,8 % der Zeilen behalten trotzdem einen Ortspunkt, weil der beste Kandidat klar vorne lag.

## Stichprobe

200 Zeilen, zeilengewichtet aus 692.707 Zeilen mit Punkt (Seed 20261025, `manual/stichprobe_ziele.csv`):

- **196 richtig, 0 falsch, 4 unsicher** (Petersburg ohne Staat → VA, Bietigheim, Marbach, Morristown „NY“ → NJ).
- 188 Punkte auf Ortsebene, 9 auf Staats-, 3 auf Landesebene.
- Ein früherer Probelauf fand einen Fehler, inzwischen per Override behoben: South Bethlehem landete beim Weiler im Armstrong County statt beim Viertel von Bethlehem.
- Von 60 zufälligen Fuzzy-Schlüsseln sind 56 plausibel richtig und 4 unsicher.

Typische Fehler: kleine Namensvettern schlagen historische Stadtteile ohne Einwohnerzahl, falsche Staatsangaben, häufige deutsche Ortsnamen.

## Bekannte Schwächen

- **Moderner Gazetteer:**
  - Umbenannte Orte (Allegheny, West Hoboken, Barmen, Lehe) werden nur über Alternativnamen oder Overrides gefunden.
  - Ostgebiete erscheinen unter dem heutigen Staat (Breslau → PL).
  - 84 % der US-Orte haben keine Einwohnerzahl; Gleichstände fallen auf den Staat zurück.
- **Heuristiken** (Staatsregeln, `historischer_name`, Fuzzy) sind über `geo_method`, `geo_confidence` und `geo_ambiguous` filterbar.
- **Grobe Punkte:**
  - Landespunkte sind repräsentative Orte (Median der GeoNames-Orte), keine Flächenmitten.
  - Regionen sind angenähert (Südbrasilien = Santa Catarina).
- **Ortsstatistik:** `geo_precision = 'ort'` verwenden und nach `geonames_id` gruppieren; `ziel_ort` ist der GeoNames-Name.
- **Kreuzfahrten** (9.730 Zeilen) über `ankunftshafen.reise_typ` ausschließen; ihre Ziele sind Heimatorte oder „Rundreise“.
- **Häfen:**
  - 2.860 Zeilen ohne bereinigten Hafen (Rohwert meist „NY“) bleiben `unbekannt`.
  - Grobe Datensatzkoordinaten bleiben unverändert: Quebec (631 km), Rio Grande (688 km, liegt in Paraná), Valparaíso, Veracruz, San José de Guatemala; Tien-Tsin (Shanxi) wurde nicht automatisch erkannt.
- **Aufenthaltsorte** (4.113 Zeilen, 93,5 % auf Ortsebene) nutzen den Ziel-Staat nur schwach.
