# Forschungsbericht: 735.545 Einträge der Bremer Passagierlisten 1830–1939

Stand 25.10.2026. Erzeugt von `analysis/run_all.py` aus Perschl, Schmidt, Gassner, Rehbein (2025), *A Dataset of 735,000 Migration Records (Bremen, 1830-1939)*, Zenodo, [10.5281/zenodo.17977460](https://doi.org/10.5281/zenodo.17977460), CC BY 4.0.

Die Einträge wurden von Ehrenamtlichen der *MAUS – Gesellschaft für Familienforschung e. V. Bremen* gemeinsam mit der Handelskammer Bremen und dem Staatsarchiv Bremen transkribiert ([passagierlisten.de](https://passagierlisten.de/)). Alle Zahlen dieses Berichts beruhen auf ihrer Arbeit.

## Zusammenfassung

- **Überlieferung.** 735.545 Einträge, davon 735.133 datiert. 99,6 % stammen aus den Jahren ab 1907; aus 1830–1869 sind 2.727 Einträge erhalten, für 1846–1848, 1861–1906, 1910–1912, 1915–1918 keine.
- **Nicht nur Auswanderer.** 25,9 % der Einträge betreffen US-Staatsangehörige, überwiegend Rückreisende; 11.615 Einträge gehören zu Kreuzfahrten. Die Analysen zu Beruf, Herkunft und Demografie beschränken sich auf die übrigen 533.214 Einträge.
- **Saison.** Die Spitze der Abfahrten im August und September geht auf US-Staatsangehörige zurück (Index 3,9 im Aug, 1 = Monatsmittel). Bei den übrigen Reisenden liegt das Maximum bei 1,43 (Sep).
- **Von der Landarbeit zum Haushalt.** Der Anteil der Landwirtschaft an allen klassifizierten Berufsangaben fiel von 75,0 % (1907–1914) auf 9,0 % (1930–1939); Hauswirtschaft und Soziales (KldB-Bereich 8) erreichten in den Dreißigern 43,5 %.
- **Vielfalt der Berufe.** Die Shannon-Entropie der Berufsbezeichnungen (Stichproben von je 10.000) stieg von 2,63 vor dem Krieg auf 4,76 in den Zwanzigern und lag in den Dreißigern bei 4,22.
- **Geschlecht und Alter.** 1907 kamen auf 100 Frauen 282 Männer, 1939 87. Das Medianalter stieg von 24 (1921) auf 38 Jahre (1939).
- **Reisegruppen.** In Gruppen ab drei Personen reisten 22,0 % der Auswanderer 1907–1914 und 12,7 % 1930–1939.
- **Routen.** 76,1 % aller datierten Einträge führen nach New York.
- **Herkunft und Ketten.** Der Mittelpunkt der europäischen Herkunftsorte lag 1907 bei 48,4° N, 19,8° O und 1939 bei 51,4° N, 11,5° O. 727 Herkunft-Ziel-Korridore erfüllen die Kriterien wiederkehrender, überzufälliger Kettenmigration.

## 1 Quellenkritik und Überlieferungsdichte

### Zeitliche Verteilung

Der Datensatz enthält 735.545 Einträge. 412 haben kein Abfahrtsdatum, 19 sind nach der Korrektur des Archivdatums 1945 datiert und fallen aus dem Untersuchungszeitraum. Leere Jahresfolgen von mindestens drei Jahren: 1846–1848, 1861–1906, 1910–1912, 1915–1918. Die Zenodo-Dokumentation nennt die Vernichtung der Listen 1875–1907 nach damaliger Aufbewahrungspraxis und Verluste im Zweiten Weltkrieg, die die Jahrgänge 1924 und 1929 unvollständig hinterlassen haben (1.463 und 6.465 Einträge gegenüber 67.944 im Jahr 1927).

| Zeitraum | Einträge | Jahrgänge | Archivlisten | Reisen | Überfahrt | US-Staatsang. | Kreuzfahrt |
|---|---:|---:|---:|---:|---:|---:|---:|
| Segelschiffzeit 1830–1869 | 2.727 | 21 | 61 | 56 | 2.690 | 2 | 35 |
| Vorkriegsjahre 1907–1914 | 97.019 | 5 | 1.168 | 397 | 95.427 | 1.592 | 0 |
| Zwanziger Jahre 1919–1929 | 343.269 | 11 | 1.204 | 768 | 262.572 | 80.312 | 385 |
| Dreißiger Jahre 1930–1939 | 292.099 | 10 | 2.256 | 2.240 | 172.127 | 108.781 | 11.191 |

*Reisen* zählt verschiedene Kombinationen aus Schiff und Abfahrtsdatum. *Überfahrt* umfasst alle Reisenden ohne US-Staatsangehörigkeit auf Linienfahrten; darin sind neben Auswanderern auch Geschäftsreisende und in Übersee ansässige Nichtamerikaner enthalten. Ein eigenes Kennzeichen für Auswanderer (`emigrant` = „A“) gibt es nur 1937–1939.

### Archivserien

Die Präfixe des Archivkürzels zeigen, aus welchen Beständen die Abschriften stammen. Die Serie AIII 15 der Handelskammer trägt die Zwischenkriegszeit, die Vorkriegsjahre stammen aus den Serien STAB und FSI, die Segelschiffzeit aus kleinen Sammlungen.

| Serie | 1830–1869 | 1907–1914 | 1919–1939 | Summe |
|---|---:|---:|---:|---:|
| AIII | 0 | 0 | 634.187 | 634.187 |
| STAB | 231 | 52.432 | 0 | 52.663 |
| FSI | 0 | 44.308 | 0 | 44.308 |
| F | 1.852 | 0 | 0 | 1.852 |
| KW | 0 | 279 | 717 | 996 |
| AIV | 0 | 0 | 483 | 483 |
| HK | 327 | 0 | 0 | 327 |
| K | 279 | 0 | 0 | 279 |
| DAZ | 38 | 0 | 0 | 38 |

### Saisonalität

Die Monatsfigur wurde als Poisson-Regression mit Jahres- und Monatseffekten geschätzt (Quasi-Poisson, Dispersion 647), für die 16 Jahre mit mindestens zehn belegten Monaten (1921–1938). Der Index ist der exponierte, auf das geometrische Monatsmittel zentrierte Monatseffekt mit 95-%-Intervall.

| Monat | alle Einträge | Überfahrt | US-Staatsangehörige |
|---|---:|---:|---:|
| Jan | 0,75 (0,59–0,97) | 0,86 (0,68–1,09) | 0,57 (0,40–0,79) |
| Feb | 0,69 (0,53–0,90) | 0,78 (0,61–1,00) | 0,50 (0,35–0,71) |
| Mär | 0,98 (0,79–1,23) | 1,15 (0,93–1,41) | 0,68 (0,50–0,92) |
| Apr | 0,93 (0,74–1,16) | 1,13 (0,91–1,39) | 0,52 (0,37–0,74) |
| Mai | 0,98 (0,78–1,22) | 1,14 (0,93–1,41) | 0,71 (0,52–0,96) |
| Jun | 0,83 (0,66–1,06) | 0,85 (0,67–1,07) | 0,93 (0,71–1,22) |
| Jul | 1,22 (1,00–1,49) | 1,06 (0,86–1,32) | 1,54 (1,24–1,91) |
| Aug | 1,76 (1,48–2,09) | 1,15 (0,94–1,42) | 3,88 (3,34–4,51) |
| Sep | 1,89 (1,60–2,23) | 1,43 (1,19–1,73) | 3,66 (3,13–4,27) |
| Okt | 1,29 (1,06–1,57) | 1,19 (0,97–1,46) | 1,90 (1,56–2,31) |
| Nov | 0,93 (0,74–1,16) | 1,02 (0,82–1,27) | 0,88 (0,67–1,16) |
| Dez | 0,53 (0,40–0,71) | 0,56 (0,42–0,75) | 0,42 (0,28–0,61) |

Die Gesamtfigur mit dem Maximum im Spätsommer entsteht vor allem durch US-Staatsangehörige, die nach dem Sommer in Europa zurückreisten. Ohne sie ist die Saison flach, mit einem Frühjahrsplateau und einem Septembergipfel. Die STL-Zerlegung der durchgehenden Monatsreihe 1930–1938 bestätigt das Muster: mittlere Saisonkomponente maximal im Sep, minimal im Feb, Spannweite 4.415 Einträge je Monat.

### Fehlende Werte

Füllgrad ausgewählter Felder je Jahrzehnt (Jahrzehnte mit mindestens 100 Einträgen):

| Jahrzehnt | Einträge | Beruf | Wohnort | Region | Alter | Familienstand | Reiseziel | Religion | Lese-/Schreibfähigkeit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1830er | 935 | 16 % | 44 % | 52 % | 44 % | 1 % | 1 % | 0 % | 0 % |
| 1840er | 1.128 | 8 % | 27 % | 81 % | 14 % | 1 % | 0 % | 0 % | 0 % |
| 1850er | 655 | 5 % | 72 % | 30 % | 9 % | 0 % | 10 % | 0 % | 0 % |
| 1900er | 66.204 | 83 % | 97 % | 27 % | 97 % | 85 % | 97 % | 0 % | 0 % |
| 1910er | 30.816 | 95 % | 99 % | 29 % | 100 % | 95 % | 99 % | 0 % | 0 % |
| 1920er | 343.268 | 61 % | 79 % | 55 % | 99 % | 85 % | 99 % | 0 % | 0 % |
| 1930er | 292.099 | 46 % | 62 % | 32 % | 94 % | 83 % | 92 % | 3 % | 3 % |

Fehlende Werte sind an Formulare gebunden, nicht zufällig verteilt. Die Berufsangabe nimmt nach 1914 ab, die Felder des US-Einwanderungsformulars (Lese- und Schreibfähigkeit, Bargeld, Angehörige) gibt es fast nur 1935–1937. Vergleiche über Zeiträume beziehen sich deshalb immer auf die Einträge mit Angabe; der jeweilige Füllgrad wird mitgeteilt.

### Datumskonflikte und Dubletten

Bei 37 Einträgen widerspricht das bereinigte Abfahrtsdatum dem Datum im Archivkürzel. 19 davon (Liste `KW-28.02.1945_N`, Schiff *Merkur*, Wohnorte u. a. Bromberg und Kolberg, Geburtsjahre bis 1941) sind um genau hundert Jahre zu früh datiert und wurden auf den 28.02.1945 korrigiert; die übrigen bleiben unverändert und sind markiert.

2.964 Einträge in 1.479 Gruppen stimmen in normalisiertem Namen, Vornamen, Alter, Schiff und Datum überein; ein Teil davon steht auf den Listen mehrerer Agenturen derselben Reise. 660 Einträge tragen in der Abschrift den Vermerk „doppelt“. Dubletten bleiben im Datensatz und sind gekennzeichnet; ihr Anteil (0,40 %) verändert keine der hier berichteten Anteile sichtbar.

## 2 Berufsstruktur und Qualifikationswandel

Grundlage sind die Einträge der Kategorie *Überfahrt* (ohne US-Staatsangehörige und Kreuzfahrten). Berufe sind nach KldB 2010 (Berufsbereich 0–9, Anforderungsniveau 1–4) und nach HISCO klassifiziert; HISCO `-1` markiert vorhandene, aber nicht klassifizierbare Angaben, meist Angehörige („Landwirtschaft Tagelöhner Angehörig“).

| Zeitraum | Personen | mit Beruf | mit HISCO | mit KldB-Bereich | mit Niveau |
|---|---:|---:|---:|---:|---:|
| Segelschiffzeit 1830–1869 | 2.690 | 10,3 % | 6,7 % | 6,7 % | 6,7 % |
| Vorkriegsjahre 1907–1914 | 95.427 | 87,1 % | 68,1 % | 82,4 % | 68,1 % |
| Zwanziger Jahre 1919–1929 | 262.572 | 77,8 % | 69,0 % | 71,4 % | 69,0 % |
| Dreißiger Jahre 1930–1939 | 172.127 | 72,0 % | 61,1 % | 64,4 % | 61,4 % |

### Berufsbereiche (KldB 2010)

Anteile an allen Einträgen mit Berufsbereich:

| Berufsbereich | 1830–1869 | 1907–1914 | 1919–1929 | 1930–1939 |
|---|---:|---:|---:|---:|
| 0 Militär | – | 0,0 % | 0,0 % | 0,2 % |
| 1 Land-, Forst-, Tierwirtschaft, Gartenbau | 18,3 % | 75,0 % | 24,2 % | 9,0 % |
| 2 Rohstoffe, Produktion, Fertigung | 33,3 % | 9,5 % | 25,7 % | 17,5 % |
| 3 Bau, Architektur, Gebäudetechnik | 10,0 % | 1,1 % | 2,9 % | 1,5 % |
| 4 Naturwissenschaft, Geografie, Informatik | – | 0,0 % | 0,2 % | 0,6 % |
| 5 Verkehr, Logistik, Schutz, Sicherheit | 25,6 % | 0,1 % | 0,9 % | 1,2 % |
| 6 Handel, Vertrieb, Hotel, Tourismus | 4,4 % | 2,8 % | 10,6 % | 15,5 % |
| 7 Unternehmensorganisation, Verwaltung, Recht | – | 0,2 % | 2,6 % | 3,7 % |
| 8 Gesundheit, Soziales, Lehre, Hauswirtschaft | 7,8 % | 10,8 % | 29,5 % | 43,5 % |
| 9 Geisteswissenschaft, Medien, Kunst, Kultur | 0,6 % | 0,4 % | 3,4 % | 7,2 % |

Der Wandel ist stark: Vor dem Krieg dominieren landwirtschaftliche Tagelöhner, in der Zwischenkriegszeit Haushalt, Handwerk und Handel. Ein Teil des Wandels liegt in der Listenführung: „Hausfrau“ erscheint in den Vorkriegslisten kaum, Ehefrauen und Kinder stehen dort als Angehörige (HISCO `-1`). Der Anstieg von Bereich 8 ist deshalb zum Teil eine Änderung der Notierung, nicht nur der Wanderung.

### Anforderungsniveau

| Niveau | 1830–1869 | 1907–1914 | 1919–1929 | 1930–1939 |
|---|---:|---:|---:|---:|
| 1 Helfer | 3,3 % | 81,5 % | 45,5 % | 20,6 % |
| 2 Fachkraft | 91,1 % | 15,2 % | 43,6 % | 61,4 % |
| 3 Spezialist | – | 2,8 % | 7,4 % | 9,2 % |
| 4 Experte | 5,6 % | 0,5 % | 3,5 % | 8,8 % |

### Vielfalt der Berufe

Shannon-Entropie *H* der Verteilung über Berufsbezeichnungen bzw. HISCO-Codes. Weil *H* mit der Stichprobengröße wächst, sind die Zeiträume über Rarefaction vergleichbar gemacht: 200 Ziehungen ohne Zurücklegen von je 10.000 Einträgen, Mittelwert und 2,5–97,5-%-Perzentil. Die Hill-Zahl exp(*H*) ist die Zahl gleich häufiger Berufe mit derselben Entropie.

| Merkmal | Zeitraum | n | verschiedene | H | H rarefiziert (95 %) | Hill rarefiziert |
|---|---|---:|---:|---:|---:|---:|
| Berufsbezeichnungen | Segelschiffzeit 1830–1869 | 275 | 80 | 3,60 | – | – |
| Berufsbezeichnungen | Vorkriegsjahre 1907–1914 | 83.050 | 1.293 | 2,67 | 2,63 (2,59–2,67) | 14 |
| Berufsbezeichnungen | Zwanziger Jahre 1919–1929 | 204.153 | 4.392 | 4,87 | 4,76 (4,72–4,80) | 117 |
| Berufsbezeichnungen | Dreißiger Jahre 1930–1939 | 121.367 | 3.079 | 4,32 | 4,22 (4,18–4,27) | 68 |
| HISCO-Codes | Segelschiffzeit 1830–1869 | 180 | 36 | 2,83 | – | – |
| HISCO-Codes | Vorkriegsjahre 1907–1914 | 65.005 | 176 | 1,75 | 1,74 (1,71–1,78) | 6 |
| HISCO-Codes | Zwanziger Jahre 1919–1929 | 181.185 | 248 | 3,57 | 3,55 (3,52–3,58) | 35 |
| HISCO-Codes | Dreißiger Jahre 1930–1939 | 105.218 | 223 | 3,35 | 3,34 (3,31–3,37) | 28 |

Die Segelschiffzeit ist zu dünn belegt für einen Vergleich; die häufigsten Angaben dort sind Matrose (40), Landmann (32), Ackersmann (15), Leichtmatrose (15), Ökonom (12), Zimmermann (12), Tischler (11), Schuhmacher (11), Kaufmann (8), Schneider (8).

### Steigende und fallende Berufe

Für jeden HISCO-Code mit mindestens 30 Nennungen in beiden Zeiträumen zusammen: Anteile, Differenz in Prozentpunkten, log₂-Verhältnis der Anteile (Haldane-Korrektur 0,5) und Zwei-Stichproben-z-Test mit Bonferroni-Korrektur über alle getesteten Codes. Gezeigt werden die acht größten signifikanten Zu- und Abnahmen nach Prozentpunkten (p < 0,05 nach Korrektur).

**1907–1914 → 1919–1929**

| Richtung | HISCO (häufigste Bezeichnung) | Anteil 1907–1914 | Anteil 1919–1929 | Differenz (pp) | log₂-Verhältnis |
|---|---|---:|---:|---:|---:|
| steigend | 22460 Hausfrau | 1,11 % | 9,15 % | 8,04 | 3,04 |
| steigend | 41025 Kaufmann | 2,31 % | 9,03 % | 6,72 | 1,97 |
| steigend | 22430 Haushälterin | 0,14 % | 4,57 % | 4,43 | 5,01 |
| steigend | 62105 Landwirtschaft Arbeiter | 4,21 % | 7,36 % | 3,14 | 0,80 |
| steigend | 84105 Schlosser Geselle | 0,87 % | 3,60 % | 2,73 | 2,05 |
| steigend | 84100 Mechaniker | 0,17 % | 2,29 % | 2,12 | 3,76 |
| steigend | 02000 Ingenieur | 0,13 % | 1,45 % | 1,32 | 3,43 |
| steigend | 77610 Bäcker Geselle | 0,52 % | 1,61 % | 1,08 | 1,62 |
| fallend | 62110 Landwirtschaft Tagelöhner | 63,26 % | 11,55 % | -51,71 | -2,45 |
| fallend | 79100 Schneiderin | 2,71 % | 2,44 % | -0,27 | -0,15 |
| fallend | 77310 Fleischer | 0,24 % | 0,13 % | -0,12 | -0,95 |
| fallend | 39320 Schreiber | 0,11 % | 0,04 % | -0,07 | -1,54 |
| fallend | 81925 Stellmacher | 0,16 % | 0,09 % | -0,06 | -0,76 |
| fallend | 72490 Eisengiesser | 0,03 % | 0,01 % | -0,03 | -2,15 |

**1919–1929 → 1930–1939**

| Richtung | HISCO (häufigste Bezeichnung) | Anteil 1919–1929 | Anteil 1930–1939 | Differenz (pp) | log₂-Verhältnis |
|---|---|---:|---:|---:|---:|
| steigend | 22460 Hausfrau | 9,15 % | 26,15 % | 17,00 | 1,52 |
| steigend | 41025 Kaufmann | 9,03 % | 13,76 % | 4,74 | 0,61 |
| steigend | 54010 Haus Angestellt | 0,38 % | 2,39 % | 2,01 | 2,67 |
| steigend | 02000 Ingenieur | 1,45 % | 3,37 % | 1,92 | 1,21 |
| steigend | 21110 Direktor | 0,71 % | 2,47 % | 1,77 | 1,81 |
| steigend | 99920 Tagelöhner | 0,23 % | 1,43 % | 1,20 | 2,62 |
| steigend | 07110 Krankenwärterin | 0,25 % | 1,23 % | 0,98 | 2,28 |
| steigend | 99930 Fabrik Arbeiter | 0,38 % | 1,13 % | 0,75 | 1,57 |
| fallend | 62110 Landwirtschaft Tagelöhner | 11,55 % | 2,13 % | -9,43 | -2,44 |
| fallend | 54020 Dienstmädchen | 12,05 % | 6,34 % | -5,71 | -0,93 |
| fallend | 22430 Haushälterin | 4,57 % | 1,01 % | -3,56 | -2,18 |
| fallend | 62105 Landwirtschaft Arbeiter | 7,36 % | 5,22 % | -2,14 | -0,50 |
| fallend | 84105 Schlosser Geselle | 3,60 % | 1,48 % | -2,13 | -1,29 |
| fallend | 61110 Landwirtschaft | 3,24 % | 1,70 % | -1,54 | -0,93 |
| fallend | 75600 Textil Arbeiter | 1,13 % | 0,14 % | -0,99 | -2,99 |
| fallend | 79100 Schneiderin | 2,44 % | 1,56 % | -0,88 | -0,64 |

**1907–1914 → 1930–1939**

| Richtung | HISCO (häufigste Bezeichnung) | Anteil 1907–1914 | Anteil 1930–1939 | Differenz (pp) | log₂-Verhältnis |
|---|---|---:|---:|---:|---:|
| steigend | 22460 Hausfrau | 1,11 % | 26,15 % | 25,04 | 4,55 |
| steigend | 41025 Kaufmann | 2,31 % | 13,76 % | 11,46 | 2,58 |
| steigend | 02000 Ingenieur | 0,13 % | 3,37 % | 3,24 | 4,65 |
| steigend | 21110 Direktor | 0,05 % | 2,47 % | 2,43 | 5,63 |
| steigend | 54010 Haus Angestellt | 0,00 % | 2,39 % | 2,39 | 11,60 |
| steigend | 84100 Mechaniker | 0,17 % | 1,51 % | 1,34 | 3,16 |
| steigend | 99920 Tagelöhner | 0,21 % | 1,43 % | 1,22 | 2,79 |
| steigend | 07110 Krankenwärterin | 0,03 % | 1,23 % | 1,20 | 5,36 |
| fallend | 62110 Landwirtschaft Tagelöhner | 63,26 % | 2,13 % | -61,13 | -4,89 |
| fallend | 54020 Dienstmädchen | 11,16 % | 6,34 % | -4,82 | -0,82 |
| fallend | 79100 Schneiderin | 2,71 % | 1,56 % | -1,15 | -0,79 |
| fallend | 61110 Landwirtschaft | 2,52 % | 1,70 % | -0,82 | -0,57 |
| fallend | 80110 Schuhmacher | 0,74 % | 0,27 % | -0,47 | -1,47 |
| fallend | 99910 Arbeiter | 0,60 % | 0,30 % | -0,30 | -0,99 |
| fallend | 71105 Bergmann | 0,45 % | 0,16 % | -0,29 | -1,47 |
| fallend | 83110 Schmiede Geselle | 0,53 % | 0,25 % | -0,28 | -1,09 |

### Kreuztabellen

χ²-Unabhängigkeitstests mit Cramérs *V*; Berufsbereich gegen Zielhafen (sieben größte Häfen und Sonstige), Geschlecht und Altersgruppe sowie Anforderungsniveau gegen Zielhafen.

| Tabelle | n | χ² | df | p | Cramérs V |
|---|---:|---:|---:|---:|---:|
| sektor × hafen | 377.036 | 64.503 | 63 | < 0,001 | 0,16 |
| sektor × geschlecht | 376.759 | 193.072 | 9 | < 0,001 | 0,72 |
| sektor × alter | 374.437 | 36.443 | 45 | < 0,001 | 0,14 |
| niveau × hafen | 351.968 | 30.009 | 21 | < 0,001 | 0,17 |

Bei diesen Fallzahlen ist jeder Test signifikant; aussagekräftig ist die Effektstärke. Das Geschlecht hängt sehr stark mit dem Berufsbereich zusammen (Haushalt und Pflege vs. Produktion und Bau). Zwischen Berufsbereich und Hafen ist der Zusammenhang moderat. Die größten positiven adjustierten Residuen, also Kombinationen, die häufiger vorkommen als bei Unabhängigkeit erwartet:

| Berufsbereich | Hafen | Personen | adj. Residuum |
|---|---|---:|---:|
| Landwirtschaft | Baltimore | 12.943 | 146,1 |
| Kultur, Bildung | Sonstige | 4.685 | 106,7 |
| Landwirtschaft | Halifax | 8.796 | 102,6 |
| Hauswirtschaft, Soziales | New York | 94.668 | 100,2 |
| Handel | Sonstige | 7.087 | 74,7 |
| Landwirtschaft | Galveston | 2.362 | 50,9 |
| Produktion | New York | 60.078 | 45,2 |
| Verwaltung | Sonstige | 1.873 | 43,3 |

Frauenanteil je Berufsbereich:

| Berufsbereich | 1907–1914 | 1919–1929 | 1930–1939 |
|---|---:|---:|---:|
| Militär | 0 % | 0 % | 0 % |
| Landwirtschaft | 23 % | 16 % | 7 % |
| Produktion | 26 % | 14 % | 12 % |
| Bau | 5 % | 1 % | 0 % |
| Naturwissenschaft | 9 % | 1 % | 2 % |
| Verkehr | 3 % | 7 % | 5 % |
| Handel | 19 % | 17 % | 7 % |
| Verwaltung | 9 % | 46 % | 39 % |
| Hauswirtschaft, Soziales | 96 % | 94 % | 92 % |
| Kultur, Bildung | 11 % | 28 % | 29 % |

## 3 Geografische Dynamik und Kettenmigration

Der Datensatz geokodiert nur Häfen. Herkunfts- und Zielorte wurden für diesen Bericht gegen GeoNames abgeglichen (Methode und Stichprobenprüfung in `analysis/enrichment/HERKUNFT_GEOCODING.md` und `ZIELE_GEOCODING.md`). Grundlage ist wieder die Kategorie *Überfahrt*.

Genauigkeit der Herkunftsangabe je Zeitraum:

| Genauigkeit | 1830–1869 | 1907–1914 | 1919–1929 | 1930–1939 |
|---|---:|---:|---:|---:|
| land | 0,7 % | 2,0 % | 2,8 % | 3,2 % |
| nicht zugeordnet | 62,3 % | 31,5 % | 8,6 % | 9,7 % |
| ort | 32,2 % | 53,6 % | 82,5 % | 84,2 % |
| region | 4,8 % | 12,9 % | 6,2 % | 2,9 % |

Genauigkeit der Zielangabe je Zeitraum:

| Genauigkeit | 1830–1869 | 1907–1914 | 1919–1929 | 1930–1939 |
|---|---:|---:|---:|---:|
| bundesstaat | 0,1 % | 1,6 % | 3,9 % | 2,5 % |
| land | 0,0 % | 2,8 % | 0,6 % | 5,6 % |
| nicht zugeordnet | 96,8 % | 2,6 % | 1,5 % | 6,9 % |
| ort | 3,0 % | 93,0 % | 94,0 % | 85,0 % |

### Herkunft

Häufigste Herkunftsländer (heutige Grenzen, ISO-Code) und historische Regionen nach Anteil an den zugeordneten Einträgen:

| Zeitraum | Länder |
|---|---|
| 1907–1914 | PL 25 %, UA 10 %, DE 9 %, RO 9 %, HU 7 %, CZ 6 % |
| 1919–1929 | DE 68 %, US 7 %, PL 4 %, AT 3 %, CZ 3 %, SK 3 % |
| 1930–1939 | DE 65 %, US 9 %, PL 3 %, AT 3 %, SK 2 %, GB 2 % |

| Zeitraum | Regionen (Angabe der Liste) |
|---|---|
| 1907–1914 | Galizien 12 %, Saratow 6 %, Lomza 6 %, Kawno 5 %, Wolhynien 4 %, Böhmen 4 % |
| 1919–1929 | Bayern 12 %, Hannover 9 %, Württemberg 8 %, Brandenburg 7 %, Sachsen 7 %, Baden 6 % |
| 1930–1939 | Brandenburg 11 %, Bayern 10 %, Hannover 8 %, Rheinland 7 %, Württemberg 7 %, Sachsen 7 % |

Schwerpunkt (sphärisches Mittel) und Standarddistanz (quadratisches Mittel der Großkreisdistanzen zum Schwerpunkt) aller in Europa gelegenen, auf Ortsebene geokodierten Herkunftsorte:

| Zeitraum | Einträge | Breite | Länge | Standarddistanz (km) |
|---|---:|---:|---:|---:|
| Segelschiffzeit 1830–1869 | 775 | 51,63 | 9,59 | 210 |
| Vorkriegsjahre 1907–1914 | 49.180 | 48,98 | 19,51 | 523 |
| Zwanziger Jahre 1919–1929 | 197.822 | 50,67 | 12,06 | 439 |
| Dreißiger Jahre 1930–1939 | 127.439 | 51,12 | 11,57 | 460 |

| Jahr | Einträge | Breite | Länge | Standarddistanz (km) |
|---|---:|---:|---:|---:|
| 1907 | 22.979 | 48,39 | 19,80 | 525 |
| 1908 | 10.050 | 50,38 | 17,84 | 572 |
| 1913 | 6.859 | 49,10 | 19,99 | 442 |
| 1914 | 9.292 | 48,83 | 20,16 | 458 |
| 1920 | 1.270 | 51,01 | 19,89 | 405 |
| 1921 | 7.681 | 50,26 | 15,05 | 472 |
| 1922 | 20.475 | 50,49 | 13,48 | 497 |
| 1923 | 29.851 | 50,66 | 12,04 | 442 |
| 1924 | 585 | 51,16 | 10,72 | 321 |
| 1925 | 24.717 | 50,94 | 11,43 | 396 |
| 1926 | 38.231 | 50,77 | 11,55 | 410 |
| 1927 | 39.737 | 50,69 | 11,67 | 420 |
| 1928 | 31.592 | 50,53 | 11,55 | 422 |
| 1929 | 3.683 | 50,44 | 13,82 | 525 |
| 1930 | 31.060 | 50,71 | 12,06 | 460 |
| 1931 | 12.960 | 51,05 | 12,26 | 491 |
| 1932 | 8.170 | 51,13 | 12,15 | 481 |
| 1933 | 11.969 | 51,12 | 11,73 | 441 |
| 1934 | 12.974 | 51,24 | 11,07 | 484 |
| 1935 | 10.385 | 51,31 | 10,56 | 470 |
| 1936 | 7.289 | 51,42 | 10,51 | 465 |
| 1937 | 7.899 | 51,46 | 11,32 | 425 |
| 1938 | 14.397 | 51,28 | 11,32 | 433 |
| 1939 | 10.336 | 51,38 | 11,47 | 409 |

### Kettenmigration

Einheit ist die rekonstruierte Reisegruppe, nicht die Person; eine große Familie zählt einmal. Berücksichtigt sind Reisegruppen mit sicher zugeordnetem Herkunftsort in Europa und Zielort in Übersee (Ortsgenauigkeit, ohne unscharfe oder mehrdeutige Treffer); Rück- und Geschäftsreisen mit europäischem Ziel fallen so heraus. Für jedes Paar aus Herkunftsort und Zielort wurde das gewichtete log-odds-Verhältnis mit informativem Dirichlet-Prior (Monroe, Colaresi und Quinn 2008; Priorstärke 500) gegen alle anderen Herkunftsorte berechnet, dazu die punktweise Transinformation (PMI). Als Korridor der Kettenmigration gilt ein Paar mit mindestens fünf Reisegruppen in mindestens drei verschiedenen Jahrgängen und z ≥ 3. Das trifft auf 727 von 73.905 Paaren zu, gebildet aus 195.134 Reisegruppen.

| Herkunft | Ziel | Gruppen | Personen | Jahre | Jahrgänge | z | PMI | häufigster Beruf | Frauen |
|---|---|---:|---:|---|---:|---:|---:|---|---:|
| Münster (DE) | Springfield (US) | 104 | 105 | 1921–1930 | 8 | 38,0 | 6,6 | Schwester | 99 % |
| Bremen (DE) | New York City (US) | 2.905 | 3.454 | 1860–1939 | 25 | 34,1 | 0,6 | Hausfrau | 52 % |
| Hiltrup (DE) | Reading (US) | 70 | 70 | 1921–1927 | 6 | 34,0 | 8,6 | Schwester | 81 % |
| Budapest (HU) | Montevideo (UY) | 166 | 217 | 1925–1934 | 10 | 31,2 | 3,8 | Hausfrau | 48 % |
| Lehe (DE) | Hoboken (US) | 114 | 137 | 1908–1936 | 12 | 28,5 | 4,3 | Hausfrau | 75 % |
| Berlin (DE) | Shanghai (CN) | 192 | 306 | 1922–1939 | 8 | 26,4 | 2,9 | Kaufmann | 45 % |
| Pforzheim (DE) | Newark (US) | 126 | 147 | 1923–1938 | 12 | 25,7 | 3,7 | Mechaniker | 58 % |
| Olpe (DE) | Lafayette (US) | 43 | 43 | 1923–1934 | 6 | 24,8 | 11,1 | Schwester | 100 % |
| Thalheim (DE) | Dover (US) | 39 | 52 | 1921–1928 | 7 | 24,6 | 7,7 | Weber | 44 % |
| Lehe (DE) | New York City (US) | 729 | 870 | 1907–1938 | 21 | 23,7 | 0,9 | Hausfrau | 63 % |
| Essen (DE) | Detroit (US) | 183 | 266 | 1922–1939 | 16 | 23,0 | 2,6 | Hausfrau | 50 % |
| Oppeln (PL) | Springfield (US) | 41 | 41 | 1921–1931 | 6 | 22,8 | 7,8 | Schwester | 100 % |
| Wesermünde (DE) | New York City (US) | 533 | 640 | 1925–1939 | 15 | 22,1 | 1,0 | Hausfrau | 67 % |
| Obersasbach (DE) | Milwaukee (US) | 76 | 79 | 1922–1928 | 4 | 21,9 | 6,0 | Schwester | 97 % |
| Paderborn (DE) | Wilmette (US) | 31 | 31 | 1922–1937 | 6 | 21,7 | 9,2 | Nonne | 81 % |
| Herdorf (DE) | Allentown (US) | 32 | 45 | 1926–1938 | 7 | 20,0 | 8,0 | Bergmann | 56 % |
| Vechta (DE) | Wauwatosa (US) | 22 | 22 | 1931–1934 | 3 | 19,9 | 9,9 | Schwester | 100 % |
| Limburg (DE) | Huntington (US) | 23 | 23 | 1926–1928 | 3 | 19,8 | 9,4 | Schwester | 100 % |
| Bremerhaven (DE) | Hoboken (US) | 67 | 86 | 1922–1937 | 10 | 19,8 | 4,0 | Hausfrau | 74 % |
| Solingen (DE) | Bridgeport (US) | 35 | 55 | 1923–1935 | 9 | 19,7 | 6,0 | Hausfrau | 44 % |
| Hamburg (DE) | Valparaíso (CL) | 73 | 113 | 1925–1939 | 13 | 19,5 | 3,5 | Kaufmann | 52 % |
| Breslau (PL) | Shanghai (CN) | 52 | 95 | 1936–1939 | 3 | 19,3 | 4,4 | Kaufmann | 46 % |
| Hamburg (DE) | Buenos Aires (AR) | 587 | 898 | 1907–1938 | 19 | 18,8 | 1,0 | Kaufmann Angestellt | 43 % |
| Neunkirchen (DE) | Kenosha (US) | 27 | 42 | 1925–1927 | 3 | 18,5 | 7,8 | Bergmann | 38 % |
| Thalheim (DE) | Philadelphia (US) | 104 | 130 | 1921–1934 | 10 | 18,4 | 3,4 | Weber | 29 % |

Unter den 25 stärksten Korridoren werden 8 überwiegend von Ordensleuten getragen (Berufsangabe Schwester, Ordensschwester, Nonne, Missionar; Anteil über 50 %), etwa Münster → Springfield, Hiltrup → Reading, Olpe → Lafayette, Oppeln → Springfield, Obersasbach → Milwaukee, Paderborn → Wilmette. Insgesamt gilt das für 21 der 727 Korridore. Wahrscheinlich sind es Entsendungen zwischen Mutterhäusern und Niederlassungen von Orden in Nordamerika; sie erfüllen die statistischen Kriterien wiederkehrender Wanderung, beruhen aber nicht auf Familiennetzen. Daneben stehen Verbindungen der Unterweserorte (Lehe, Bremerhaven, Wesermünde) nach Hoboken und New York, gewerbliche Korridore (Weber aus Thalheim nach Dover und Philadelphia, Bergleute aus Herdorf und Neunkirchen) und die Flucht nach Shanghai, deren Einträge aus Berlin und Breslau sich auf 1938 und 1939 konzentrieren.

Anteil der Reisegruppen, die in einem dieser Korridore reisten:

| Zeitraum | Gruppen | in Korridoren |
|---|---:|---:|
| Segelschiffzeit 1830–1869 | 16 | 18,8 % |
| Vorkriegsjahre 1907–1914 | 26.020 | 9,0 % |
| Zwanziger Jahre 1919–1929 | 115.164 | 21,8 % |
| Dreißiger Jahre 1930–1939 | 53.934 | 22,6 % |

Überrepräsentierte Kombinationen aus Region (Angabe der Liste) und Ankunftshafen, gleiche Methode, mindestens 20 Reisegruppen; Regionen im Land des Ankunftshafens (Heimreisen) ausgenommen:

| Region | Hafen | Gruppen | z |
|---|---|---:|---:|
| Hannover | New York | 18.691 | 129,3 |
| Württemberg | New York | 15.162 | 82,7 |
| Brandenburg | Southampton | 2.685 | 71,3 |
| Bayern | New York | 21.490 | 66,0 |
| Baden | New York | 11.124 | 65,3 |
| Litauen | Buenos Aires | 797 | 58,0 |
| Galizien | Baltimore | 367 | 48,7 |
| Bremen | Southampton | 1.375 | 44,9 |
| Hessen | New York | 3.709 | 43,2 |
| Litauen | Santos | 260 | 40,7 |
| Hamburg | Southampton | 716 | 38,5 |
| Rheinpfalz | New York | 1.285 | 38,2 |

## 4 Demografie und Reisegruppen

### Alter und Geschlecht

| Zeitraum | mit Alter und Geschlecht | 0–14 | 15–29 | 30–44 | 45–59 | 60+ | Männer je 100 Frauen |
|---|---:|---:|---:|---:|---:|---:|---:|
| Segelschiffzeit 1830–1869 | 520 | 10,8 % | 66,0 % | 17,5 % | 4,4 % | 1,3 % | 266 |
| Vorkriegsjahre 1907–1914 | 93.454 | 16,1 % | 53,8 % | 24,1 % | 5,5 % | 0,5 % | 188 |
| Zwanziger Jahre 1919–1929 | 260.322 | 12,4 % | 54,1 % | 24,0 % | 7,3 % | 2,2 % | 121 |
| Dreißiger Jahre 1930–1939 | 163.117 | 8,2 % | 36,2 % | 33,4 % | 15,2 % | 7,0 % | 89 |

Zum Vergleich: Das Medianalter der US-Staatsangehörigen liegt bei 39 Jahren, das der übrigen Reisenden bei 26. Medianalter (Quartile) und Frauenanteil je Berufsbereich, Bereiche mit mindestens 500 Einträgen:

| Zeitraum | Berufsbereich | n | Medianalter (Quartile) | Frauenanteil |
|---|---|---:|---:|---:|
| Vorkriegsjahre 1907–1914 | Landwirtschaft | 58.952 | 25 (18–33) | 23 % |
| Vorkriegsjahre 1907–1914 | Produktion | 7.479 | 25 (20–32) | 26 % |
| Vorkriegsjahre 1907–1914 | Bau | 902 | 28 (23–35) | 5 % |
| Vorkriegsjahre 1907–1914 | Handel | 2.213 | 26 (20–34) | 19 % |
| Vorkriegsjahre 1907–1914 | Hauswirtschaft, Soziales | 8.473 | 19 (17–23) | 96 % |
| Zwanziger Jahre 1919–1929 | Landwirtschaft | 45.313 | 26 (22–32) | 16 % |
| Zwanziger Jahre 1919–1929 | Produktion | 48.150 | 26 (22–32) | 14 % |
| Zwanziger Jahre 1919–1929 | Bau | 5.522 | 28 (23–36) | 1 % |
| Zwanziger Jahre 1919–1929 | Verkehr | 1.609 | 28 (23–36) | 7 % |
| Zwanziger Jahre 1919–1929 | Handel | 19.840 | 28 (22–37) | 17 % |
| Zwanziger Jahre 1919–1929 | Verwaltung | 4.834 | 25 (21–32) | 46 % |
| Zwanziger Jahre 1919–1929 | Hauswirtschaft, Soziales | 55.325 | 26 (21–34) | 94 % |
| Zwanziger Jahre 1919–1929 | Kultur, Bildung | 6.391 | 21 (14–31) | 28 % |
| Dreißiger Jahre 1930–1939 | Landwirtschaft | 10.015 | 28 (23–35) | 7 % |
| Dreißiger Jahre 1930–1939 | Produktion | 19.438 | 31 (25–39) | 12 % |
| Dreißiger Jahre 1930–1939 | Bau | 1.667 | 31 (25–40) | 0 % |
| Dreißiger Jahre 1930–1939 | Naturwissenschaft | 680 | 37 (31–44) | 2 % |
| Dreißiger Jahre 1930–1939 | Verkehr | 1.381 | 32 (27–42) | 5 % |
| Dreißiger Jahre 1930–1939 | Handel | 17.178 | 35 (27–45) | 7 % |
| Dreißiger Jahre 1930–1939 | Verwaltung | 4.117 | 34 (27–45) | 39 % |
| Dreißiger Jahre 1930–1939 | Hauswirtschaft, Soziales | 48.172 | 33 (26–43) | 92 % |
| Dreißiger Jahre 1930–1939 | Kultur, Bildung | 7.926 | 20 (16–29) | 29 % |

Familienstand der Personen ab 15 Jahren:

| Zeitraum | Männer ledig | verheiratet | verwitwet | Frauen ledig | verheiratet | verwitwet |
|---|---:|---:|---:|---:|---:|---:|
| Vorkriegsjahre 1907–1914 | 45 % | 54 % | 1 % | 52 % | 43 % | 5 % |
| Zwanziger Jahre 1919–1929 | 60 % | 39 % | 1 % | 53 % | 41 % | 5 % |
| Dreißiger Jahre 1930–1939 | 44 % | 53 % | 2 % | 37 % | 54 % | 8 % |

### Rekonstruktion von Reisegruppen

Die Listen verzeichnen keine Haushalte. Eine Reisegruppe wird hier rekonstruiert aus aufeinanderfolgenden Einträgen derselben Archivliste (Reihenfolge der Abschrift) mit gleichem normalisiertem Nachnamen (Umlaute, ß und Satzzeichen vereinheitlicht) und einem Abstand der Passagiernummern von höchstens zwei. Jede Liste enthält mehrere nach Klasse getrennte Teillisten, deren Nummerierung neu beginnt; die Nummernbedingung trennt sie. Ehefrauen mit eigenem Namen oder Kinder aus anderen Ehen fallen so heraus, nicht verwandte Personen gleichen Namens direkt hintereinander werden zusammengefasst.

Anteil der Personen nach Gruppentyp; in Klammern die einfache Gruppierung nach Nachname, Schiff und Datum ohne Reihenfolge als Sensitivitätsprüfung:

| Zeitraum | allein | zu zweit | Gruppe ab drei |
|---|---:|---:|---:|
| Segelschiffzeit 1830–1869 | 82,2 % (73,8 %) | 8,7 % (13,2 %) | 9,1 % (13,0 %) |
| Vorkriegsjahre 1907–1914 | 64,0 % (55,0 %) | 14,0 % (16,0 %) | 22,0 % (29,1 %) |
| Zwanziger Jahre 1919–1929 | 62,9 % (54,3 %) | 17,0 % (19,3 %) | 20,1 % (26,4 %) |
| Dreißiger Jahre 1930–1939 | 65,1 % (57,3 %) | 22,2 % (24,7 %) | 12,7 % (18,0 %) |

Die einfache Gruppierung fasst bei häufigen Namen Fremde zusammen und überschätzt Gruppen deutlich; die Richtung des Wandels ist bei beiden Verfahren gleich: Gruppen ab drei Personen werden in den Dreißigerjahren seltener, Paare häufiger.

Gruppen ab drei Personen als Einheiten:

| Zeitraum | Gruppen | mittlere Größe | mit Kind unter 15 |
|---|---:|---:|---:|
| Segelschiffzeit 1830–1869 | 61 | 4,0 | 36,1 % |
| Vorkriegsjahre 1907–1914 | 5.032 | 4,2 | 88,0 % |
| Zwanziger Jahre 1919–1929 | 14.571 | 3,7 | 86,6 % |
| Dreißiger Jahre 1930–1939 | 7.794 | 3,5 | 85,3 % |

Anteil der Personen in Gruppen ab drei nach Staatsangehörigkeit (1919–1939, zehn häufigste Staatsangehörigkeiten):

| Staatsangehörigkeit | Anteil |
|---|---:|
| Russland | 41,5 % |
| Polen | 33,4 % |
| Litauen | 31,9 % |
| Rumänien | 30,5 % |
| Jugoslawien | 28,8 % |
| Ungarn | 21,9 % |
| Tschechoslowakei | 18,6 % |
| Österreich | 16,3 % |
| Deutschland | 14,5 % |
| Großbritannien | 11,3 % |

Die größten rekonstruierten Gruppen umfassen meist mehrere Familien gleichen Namens aus einem Ort; ob und wie sie verwandt waren, sagen die Listen nicht. 194 Listen sind in der Abschrift überwiegend alphabetisch sortiert; dort werden Namensgleiche nur zusammengefasst, wenn auch der Wohnort übereinstimmt.

| Name | Personen | Schiff | Abfahrt | Wohnort | Ziel |
|---|---:|---|---|---|---|
| Martin | 24 | Brandenburg | 31.10.1907 | Atmagea | Fessenden |
| Schierholt | 18 | Sierra Cordoba | 13.03.1926 | Hausstette | Rio de Janeiro |
| Döll | 17 | Darmstadt | 17.10.1908 | Deutsch Chaginsk | Buenos Aires |
| Lind | 17 | Professor Woermann | 15.03.1907 | Dönhof | New Windsor |
| Pein, von | 17 | Crefeld | 17.02.1927 | Pittsworth | Brisbane |
| Posavad | 17 | Berlin | 19.05.1938 | Imsovci | Vinemount, ON |
| Pein von | 17 | Sierra Ventana | 23.10.1926 | Ritzeberg | Buenos Aires |
| Heinbichner | 16 | Aachen | 09.11.1908 | Karlsruh | Rio de Janeiro |

## 5 Schifffahrt und Routen

### Ankunftshäfen

Die Hafenkoordinaten stammen aus dem Datensatz und sind für fehlende Häfen ergänzt. Bei Puntarenas, Quebec, Rio Grande weichen sie um mehr als 100 km vom Ort ab; für Karte und Atlas gelten dort die Koordinaten aus GeoNames.

Anteil an allen datierten Einträgen des Zeitraums (neun häufigste Häfen, alle Reisearten):

| Hafen | 1830–1869 | 1907–1914 | 1919–1929 | 1930–1939 |
|---|---:|---:|---:|---:|
| New York | 69,6 % | 67,4 % | 78,6 % | 76,2 % |
| Buenos Aires | – | 4,0 % | 9,5 % | 3,0 % |
| Sonstige | 26,4 % | 2,1 % | 4,3 % | 7,9 % |
| Southampton | – | – | 1,1 % | 6,5 % |
| Baltimore | 4,0 % | 19,2 % | 0,0 % | 0,2 % |
| Halifax | – | 0,7 % | 2,9 % | 1,9 % |
| Rio de Janeiro | – | 2,4 % | 1,9 % | 0,6 % |
| Gesellschaftsreise | – | – | 0,1 % | 3,2 % |
| Santos | – | 0,1 % | 1,6 % | 0,4 % |
| Galveston | – | 4,1 % | 0,1 % | 0,2 % |

### Reedereien und Agenturen

| Reederei/Agentur | 1830–1869 | 1907–1914 | 1919–1929 | 1930–1939 |
|---|---:|---:|---:|---:|
| Nordd. Lloyd, Bremen | 7,6 % | 36,4 % | 80,9 % | 94,1 % |
| F. J. Missler, Bremen | – | 55,1 % | 7,3 % | 0,1 % |
| United States Lines, Bremen | – | – | 7,7 % | 0,2 % |
| Sonstige | 92,4 % | 3,0 % | 0,9 % | 2,5 % |
| Karesch & Stotzky, Bremen | – | 5,5 % | 2,3 % | – |
| Hamburg-Amerika Linie, Hamburg | – | – | – | 3,1 % |
| White Star Line, Bremen | – | – | 0,9 % | – |

### Reisen und Schiffe

Eine Reise ist eine Kombination aus Schiff und Abfahrtsdatum.

| Zeitraum | Reisen | Einträge | Median | Mittel | 90-%-Quantil | Maximum |
|---|---:|---:|---:|---:|---:|---:|
| Segelschiffzeit 1830–1869 | 56 | 2.727 | 26 | 49 | 131 | 199 |
| Vorkriegsjahre 1907–1914 | 397 | 97.019 | 92 | 244 | 732 | 2.952 |
| Zwanziger Jahre 1919–1929 | 767 | 343.268 | 394 | 448 | 909 | 1.616 |
| Dreißiger Jahre 1930–1939 | 2.240 | 292.099 | 10 | 130 | 469 | 1.749 |

Der niedrige Median der Dreißigerjahre kommt von 1.371 Reisen mit weniger als 20 Einträgen (61 % aller Reisen, aber nur 2,7 % der Einträge). Es sind vor allem Fahrten kleinerer Schiffe in Nord- und Ostsee, nach West- und Südeuropa sowie Frachtschiffe nach Übersee; häufigste Ziele: Kingston upon Hull (97), San Francisco (75), Baltimore (58), Valparaiso (53), Finnland (52), Antwerpen (42). 56 % der Einträge dieser Jahre entfallen auf Reisen mit mindestens 500 Passagieren.

| Schiff | Einträge | Reisen | Jahre | größte Reise | Reederei |
|---|---:|---:|---|---:|---|
| Bremen | 107.352 | 173 | 1907–1939 | 1.376 | Nordd. Lloyd, Bremen |
| Europa | 91.660 | 143 | 1930–1939 | 1.749 | Nordd. Lloyd, Bremen |
| Columbus | 64.427 | 86 | 1925–1939 | 1.602 | Nordd. Lloyd, Bremen |
| George Washington | 43.297 | 66 | 1913–1928 | 1.543 | Nordd. Lloyd, Bremen |
| Berlin | 37.449 | 82 | 1913–1938 | 1.009 | Nordd. Lloyd, Bremen |
| Stuttgart | 32.312 | 81 | 1907–1938 | 1.902 | Nordd. Lloyd, Bremen |
| München | 26.423 | 47 | 1923–1939 | 1.132 | Nordd. Lloyd, Bremen |
| America | 17.033 | 32 | 1919–1928 | 1.616 | Nordd. Lloyd, Bremen |
| Dresden | 16.729 | 56 | 1927–1939 | 897 | Nordd. Lloyd, Bremen |
| Yorck | 14.988 | 36 | 1908–1931 | 820 | Nordd. Lloyd, Bremen |
| Sierra Ventana | 12.737 | 36 | 1913–1932 | 1.035 | Nordd. Lloyd, Bremen |
| Seydlitz | 11.837 | 34 | 1907–1930 | 764 | Nordd. Lloyd, Bremen |
| Köln | 11.515 | 32 | 1907–1930 | 1.619 | Nordd. Lloyd, Bremen |
| General von Steuben | 10.731 | 39 | 1931–1939 | 560 | Nordd. Lloyd, Bremen |
| Sierra Cordoba | 10.693 | 32 | 1913–1933 | 702 | Nordd. Lloyd, Bremen |

### Reiseklassen

Anteil an den Einträgen mit Klassenangabe in ausgewählten Jahren. Vor dem Ersten Weltkrieg ist die Klasse nur selten notiert. Die Touristenklasse wächst ab Mitte der Zwanzigerjahre und löst die 2. Klasse weitgehend ab; die 3. Klasse bleibt bei rund der Hälfte.

| Jahr | mit Klasse | 3. Klasse | Touristenklasse | 2. Klasse | Kabinenklasse | 1. Klasse | Mittelklasse |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1922 | 37.889 | 54 % | – | 36 % | 0 % | 7 % | 3 % |
| 1926 | 63.586 | 50 % | 2 % | 21 % | 18 % | 6 % | 3 % |
| 1930 | 60.368 | 53 % | 18 % | 12 % | 8 % | 7 % | 2 % |
| 1934 | 25.848 | 52 % | 31 % | 1 % | 3 % | 12 % | 1 % |
| 1938 | 27.284 | 50 % | 30 % | 1 % | 14 % | 3 % | 2 % |

### Abfahrtsmonate

Verteilung der Überfahrten (ohne US-Staatsangehörige und Kreuzfahrten) über die Monate:

| Zeitraum | Jan | Feb | Mär | Apr | Mai | Jun | Jul | Aug | Sep | Okt | Nov | Dez |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Vorkriegsjahre 1907–1914 | 3 % | 2 % | 25 % | 23 % | 6 % | 2 % | 2 % | 3 % | 2 % | 10 % | 17 % | 5 % |
| Zwanziger Jahre 1919–1929 | 7 % | 7 % | 10 % | 9 % | 9 % | 6 % | 8 % | 7 % | 11 % | 10 % | 10 % | 7 % |
| Dreißiger Jahre 1930–1939 | 7 % | 6 % | 8 % | 10 % | 9 % | 9 % | 10 % | 12 % | 12 % | 8 % | 6 % | 3 % |

## Methoden, Grenzen, Reproduktion

- **Einheiten.** Wo nicht anders angegeben, ist die Einheit der Eintrag. Einträge sind Passagiere auf einer Liste; dieselbe Person kann mehrfach reisen, und einige Reisen stehen auf den Listen mehrerer Agenturen.

- **Basis.** Quellenkritik und Schifffahrt verwenden alle Einträge, Berufe, Geografie und Demografie die Kategorie *Überfahrt* (ohne US-Staatsangehörige, ohne Kreuzfahrten).

- **Zeiträume.** Segelschiffzeit 1830–1869, Vorkriegsjahre 1907–1914, Zwanziger Jahre 1919–1929, Dreißiger Jahre 1930–1939. Die Segelschiffzeit ist zu dünn und zu selektiv überliefert für Vergleiche und wird nur beschrieben.

- **Tests.** Bei Fallzahlen im Hunderttausenderbereich sind fast alle Unterschiede signifikant. Berichtet werden deshalb Effektgrößen (Prozentpunkte, log-Verhältnisse, Cramérs V, z-Werte) und Konfidenz- bzw. Perzentilintervalle; Mehrfachtests sind Bonferroni-korrigiert.

- **Anreicherung.** Herkunfts- und Zielorte, Hafenkoordinaten, Freitextfelder und Archivkürzel wurden in eigenen Schritten bereinigt; die Methodenberichte liegen in `analysis/enrichment/`, die Nachschlagetabellen in `data/enrichment/`.

- **Reproduktion.** `python analysis/run_all.py --rebuild` lädt die Zenodo-Datei (MD5-Prüfung), baut die angereicherte Tabelle, rechnet alle Module, schreibt die Tabellen nach `analysis/output/`, die Webdaten nach `web/public/data/` und diesen Bericht.

- **Webdatenbank.** `web/public/data/passagiere.parquet` enthält alle Einträge in 39 Spalten, wörterbuchkodiert und ZSTD-komprimiert, 21,4 MB.
