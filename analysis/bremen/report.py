from datetime import date

import polars as pl

from .codes import ERAS, KLDB_SECTORS, KLDB_SECTORS_SHORT, PERIODS, TRAINING_LEVELS
from .load import port_corrections
from .paths import REPORT

MAIN_PERIODS = ["1907–1914", "1919–1929", "1930–1939"]
ALL_PERIODS = [label for label, _, _ in PERIODS]
MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]


def n0(value) -> str:
    if value is None:
        return "–"
    return f"{round(value):,}".replace(",", ".")


def n1(value) -> str:
    if value is None:
        return "–"
    return f"{value:,.1f}".replace(",", "X").replace(".", ",").replace("X", ".")


def n2(value) -> str:
    if value is None:
        return "–"
    return f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def pct(share, digits: int = 1) -> str:
    if share is None:
        return "–"
    return f"{share * 100:.{digits}f} %".replace(".", ",")


def p_value(p: float) -> str:
    return "< 0,001" if p < 0.001 else n2(p)


def table(header: list[str], body: list[list], align: str | None = None) -> str:
    align = align or "l" + "r" * (len(header) - 1)
    rule = "|" + "|".join("---:" if a == "r" else "---" for a in align) + "|"
    lines = ["| " + " | ".join(header) + " |", rule]
    lines += ["| " + " | ".join(str(c) for c in row) + " |" for row in body]
    return "\n".join(lines)


def lookup(df: pl.DataFrame, value_column: str, **keys):
    filtered = df
    for column, value in keys.items():
        filtered = filtered.filter(pl.col(column) == value)
    return filtered[value_column].item() if len(filtered) == 1 else None


def period_label(period: str) -> str:
    return f"{ERAS[period]} {period}"


def summary_section(df: pl.DataFrame, r: dict) -> str:
    q, b, d, s = r["quellen"], r["berufe"], r["demografie"], r["schifffahrt"]
    agri_before = lookup(b["sector_period"], "anteil", zeitraum="1907–1914", sektor=1)
    agri_after = lookup(b["sector_period"], "anteil", zeitraum="1930–1939", sektor=1)
    house_after = lookup(b["sector_period"], "anteil", zeitraum="1930–1939", sektor=8)
    season_us = max(r["quellen"]["season_by_kind"]["US-Staatsangehörige"]["monate"], key=lambda m: m["index"])
    season_em = max(r["quellen"]["season_by_kind"]["Überfahrt"]["monate"], key=lambda m: m["index"])
    yearly = d["yearly"].filter(pl.col("n") >= 1000)
    ratio_first = yearly.row(0, named=True)
    ratio_last = yearly.row(-1, named=True)
    ages = d["yearly"].filter(pl.col("n") >= 10_000, pl.col("jahr") >= 1919)
    families_before = lookup(d["persons_period"], "anteil", zeitraum="1907–1914", gruppe_typ="Familie/Gruppe 3+")
    families_after = lookup(d["persons_period"], "anteil", zeitraum="1930–1939", gruppe_typ="Familie/Gruppe 3+")
    ny = s["port_year"].filter(pl.col("hafen") == "New York")["n"].sum() / s["port_year"]["n"].sum()
    kinds = df.group_by("reiseart", maintain_order=True).len()
    us_share = lookup(kinds, "len", reiseart="US-Staatsangehörige") / len(df)
    entropy = b["entropy_occ"]
    bullets = [
        f"**Überlieferung.** {n0(len(df))} Einträge, davon {n0(len(df) - q['undated'])} datiert. {pct(df.filter(pl.col('jahr') >= 1907).height / len(df))} stammen aus den Jahren ab 1907; aus 1830–1869 sind {n0(df.filter(pl.col('zeitraum') == '1830–1869').height)} Einträge erhalten, für {gap_text(q['gaps'])} keine.",
        f"**Nicht nur Auswanderer.** {pct(us_share)} der Einträge betreffen US-Staatsangehörige, überwiegend Rückreisende; {n0(lookup(kinds, 'len', reiseart='Kreuzfahrt'))} Einträge gehören zu Kreuzfahrten. Die Analysen zu Beruf, Herkunft und Demografie beschränken sich auf die übrigen {n0(lookup(kinds, 'len', reiseart='Überfahrt'))} Einträge.",
        f"**Saison.** Die Spitze der Abfahrten im August und September geht auf US-Staatsangehörige zurück (Index {n1(season_us['index'])} im {MONTHS[season_us['monat'] - 1]}, 1 = Monatsmittel). Bei den übrigen Reisenden liegt das Maximum bei {n2(season_em['index'])} ({MONTHS[season_em['monat'] - 1]}).",
        f"**Von der Landarbeit zum Haushalt.** Der Anteil der Landwirtschaft an allen klassifizierten Berufsangaben fiel von {pct(agri_before)} (1907–1914) auf {pct(agri_after)} (1930–1939); Hauswirtschaft und Soziales (KldB-Bereich 8) erreichten in den Dreißigern {pct(house_after)}.",
        f"**Vielfalt der Berufe.** Die Shannon-Entropie der Berufsbezeichnungen (Stichproben von je {n0(entropy['stichprobe'].drop_nulls()[0])}) stieg von {n2(lookup(entropy, 'H_rarefiziert', zeitraum='1907–1914'))} vor dem Krieg auf {n2(lookup(entropy, 'H_rarefiziert', zeitraum='1919–1929'))} in den Zwanzigern und lag in den Dreißigern bei {n2(lookup(entropy, 'H_rarefiziert', zeitraum='1930–1939'))}.",
        f"**Geschlecht und Alter.** {ratio_first['jahr']} kamen auf 100 Frauen {n0(ratio_first['maenner_je_100_frauen'])} Männer, {ratio_last['jahr']} {n0(ratio_last['maenner_je_100_frauen'])}. Das Medianalter stieg von {n0(ages.row(0, named=True)['median_alter'])} ({ages.row(0, named=True)['jahr']}) auf {n0(ages.row(-1, named=True)['median_alter'])} Jahre ({ages.row(-1, named=True)['jahr']}).",
        f"**Reisegruppen.** In Gruppen ab drei Personen reisten {pct(families_before)} der Auswanderer 1907–1914 und {pct(families_after)} 1930–1939.",
        f"**Routen.** {pct(ny)} aller datierten Einträge führen nach New York.",
    ]
    if r["geografie"].get("available"):
        g = r["geografie"]
        c = g["yearly_centroids"]
        first, last = c.row(0, named=True), c.row(-1, named=True)
        chained = g["corridors"].filter("kettenmigration")
        bullets.append(
            f"**Herkunft und Ketten.** Der Mittelpunkt der europäischen Herkunftsorte lag {first['jahr']} bei {n1(first['lat'])}° N, {n1(first['lon'])}° O und {last['jahr']} bei {n1(last['lat'])}° N, {n1(last['lon'])}° O. {n0(len(chained))} Herkunft-Ziel-Korridore erfüllen die Kriterien wiederkehrender, überzufälliger Kettenmigration."
        )
    return "## Zusammenfassung\n\n" + "\n".join(f"- {b}" for b in bullets)


def gap_text(gaps: list[list[int]]) -> str:
    return ", ".join(f"{a}–{b}" for a, b in gaps)


def section_quellen(df: pl.DataFrame, r: dict) -> str:
    q = r["quellen"]
    by_period = (
        df.filter(pl.col("zeitraum").is_not_null())
        .group_by("zeitraum", maintain_order=True)
        .agg(
            pl.len().alias("n"),
            pl.col("jahr").n_unique().alias("jahrgaenge"),
            pl.col("archive_id").n_unique().alias("listen"),
            pl.struct("ship_cleaned", "abfahrt").n_unique().alias("reisen"),
            (pl.col("reiseart") == "Überfahrt").sum().alias("ueberfahrt"),
            (pl.col("reiseart") == "US-Staatsangehörige").sum().alias("us"),
            (pl.col("reiseart") == "Kreuzfahrt").sum().alias("kreuz"),
        )
        .sort("zeitraum")
    )
    period_rows = [[period_label(p["zeitraum"]), n0(p["n"]), n0(p["jahrgaenge"]), n0(p["listen"]), n0(p["reisen"]), n0(p["ueberfahrt"]), n0(p["us"]), n0(p["kreuz"])] for p in by_period.iter_rows(named=True)]
    series = q["series"].with_columns(
        pl.when(pl.col("jahr") < 1870).then(pl.lit("1830–1869")).when(pl.col("jahr") < 1915).then(pl.lit("1907–1914")).otherwise(pl.lit("1919–1939")).alias("block")
    ).group_by("serie", "block", maintain_order=True).agg(pl.col("n").sum()).pivot(on="block", index="serie", values="n").fill_null(0)
    series = series.with_columns(pl.sum_horizontal([c for c in series.columns if c != "serie"]).alias("summe")).sort("summe", descending=True)
    blocks = [c for c in ["1830–1869", "1907–1914", "1919–1939"] if c in series.columns]
    series_rows = [[row["serie"], *[n0(row[b]) for b in blocks], n0(row["summe"])] for row in series.iter_rows(named=True)]

    season = q["season"]
    by_kind = q["season_by_kind"]
    season_rows = []
    for m in range(12):
        all_m = season["monate"][m]
        em = by_kind["Überfahrt"]["monate"][m]
        us = by_kind["US-Staatsangehörige"]["monate"][m]
        season_rows.append([MONTHS[m], f"{n2(all_m['index'])} ({n2(all_m['unten'])}–{n2(all_m['oben'])})", f"{n2(em['index'])} ({n2(em['unten'])}–{n2(em['oben'])})", f"{n2(us['index'])} ({n2(us['unten'])}–{n2(us['oben'])})"])
    stl = q["stl"]
    amplitude = max(stl["saison_mittel_je_monat"]) - min(stl["saison_mittel_je_monat"])
    peak_month = MONTHS[stl["saison_mittel_je_monat"].index(max(stl["saison_mittel_je_monat"]))]
    trough_month = MONTHS[stl["saison_mittel_je_monat"].index(min(stl["saison_mittel_je_monat"]))]

    decade = q["by_decade"]
    fields = ["Beruf", "Wohnort", "Region", "Alter", "Familienstand", "Reiseziel", "Religion", "Lese-/Schreibfähigkeit"]
    decade_rows = [[f"{row['jahrzehnt']}er", n0(row["n"]), *[pct(row[f], 0) for f in fields]] for row in decade.iter_rows(named=True) if row["n"] >= 100]

    conflicts = q.get("conflict_summary")
    duplicates = q.get("duplicates")
    parts = [
        "## 1 Quellenkritik und Überlieferungsdichte",
        "### Zeitliche Verteilung",
        f"Der Datensatz enthält {n0(len(df))} Einträge. {n0(q['undated'])} haben kein Abfahrtsdatum, {n0(q['after_1939'])} sind nach der Korrektur des Archivdatums 1945 datiert und fallen aus dem Untersuchungszeitraum. Leere Jahresfolgen von mindestens drei Jahren: {gap_text(q['gaps'])}. Die Zenodo-Dokumentation nennt die Vernichtung der Listen 1875–1907 nach damaliger Aufbewahrungspraxis und Verluste im Zweiten Weltkrieg, die die Jahrgänge 1924 und 1929 unvollständig hinterlassen haben ({n0(lookup(q['yearly'], 'datensaetze', jahr=1924))} und {n0(lookup(q['yearly'], 'datensaetze', jahr=1929))} Einträge gegenüber {n0(lookup(q['yearly'], 'datensaetze', jahr=1927))} im Jahr 1927).",
        table(["Zeitraum", "Einträge", "Jahrgänge", "Archivlisten", "Reisen", "Überfahrt", "US-Staatsang.", "Kreuzfahrt"], period_rows),
        "*Reisen* zählt verschiedene Kombinationen aus Schiff und Abfahrtsdatum. *Überfahrt* umfasst alle Reisenden ohne US-Staatsangehörigkeit auf Linienfahrten; darin sind neben Auswanderern auch Geschäftsreisende und in Übersee ansässige Nichtamerikaner enthalten. Ein eigenes Kennzeichen für Auswanderer (`emigrant` = „A“) gibt es nur 1937–1939.",
        "### Archivserien",
        "Die Präfixe des Archivkürzels zeigen, aus welchen Beständen die Abschriften stammen. Die Serie AIII 15 der Handelskammer trägt die Zwischenkriegszeit, die Vorkriegsjahre stammen aus den Serien STAB und FSI, die Segelschiffzeit aus kleinen Sammlungen.",
        table(["Serie", *blocks, "Summe"], series_rows),
        "### Saisonalität",
        f"Die Monatsfigur wurde als Poisson-Regression mit Jahres- und Monatseffekten geschätzt (Quasi-Poisson, Dispersion {n0(season['dispersion'])}), für die {len(season['jahre'])} Jahre mit mindestens zehn belegten Monaten ({season['jahre'][0]}–{season['jahre'][-1]}). Der Index ist der exponierte, auf das geometrische Monatsmittel zentrierte Monatseffekt mit 95-%-Intervall.",
        table(["Monat", "alle Einträge", "Überfahrt", "US-Staatsangehörige"], season_rows),
        f"Die Gesamtfigur mit dem Maximum im Spätsommer entsteht vor allem durch US-Staatsangehörige, die nach dem Sommer in Europa zurückreisten. Ohne sie ist die Saison flach, mit einem Frühjahrsplateau und einem Septembergipfel. Die STL-Zerlegung der durchgehenden Monatsreihe {stl['zeitraum'][0]}–{stl['zeitraum'][1]} bestätigt das Muster: mittlere Saisonkomponente maximal im {peak_month}, minimal im {trough_month}, Spannweite {n0(amplitude)} Einträge je Monat.",
        "### Fehlende Werte",
        "Füllgrad ausgewählter Felder je Jahrzehnt (Jahrzehnte mit mindestens 100 Einträgen):",
        table(["Jahrzehnt", "Einträge", *fields], decade_rows),
        "Fehlende Werte sind an Formulare gebunden, nicht zufällig verteilt. Die Berufsangabe nimmt nach 1914 ab, die Felder des US-Einwanderungsformulars (Lese- und Schreibfähigkeit, Bargeld, Angehörige) gibt es fast nur 1935–1937. Vergleiche über Zeiträume beziehen sich deshalb immer auf die Einträge mit Angabe; der jeweilige Füllgrad wird mitgeteilt.",
    ]
    if conflicts:
        parts += [
            "### Datumskonflikte und Dubletten",
            f"Bei {n0(conflicts['zeilen'])} Einträgen widerspricht das bereinigte Abfahrtsdatum dem Datum im Archivkürzel. {n0(conflicts['korrigiert'])} davon (Liste `KW-28.02.1945_N`, Schiff *Merkur*, Wohnorte u. a. Bromberg und Kolberg, Geburtsjahre bis 1941) sind um genau hundert Jahre zu früh datiert und wurden auf den 28.02.1945 korrigiert; die übrigen bleiben unverändert und sind markiert.",
        ]
    if duplicates:
        parts.append(
            f"{n0(duplicates['zeilen'])} Einträge in {n0(duplicates['gruppen'])} Gruppen stimmen in normalisiertem Namen, Vornamen, Alter, Schiff und Datum überein; ein Teil davon steht auf den Listen mehrerer Agenturen derselben Reise. {n0(duplicates['als_doppelt_vermerkt'])} Einträge tragen in der Abschrift den Vermerk „doppelt“. Dubletten bleiben im Datensatz und sind gekennzeichnet; ihr Anteil ({pct(duplicates['zeilen'] / len(df), 2)}) verändert keine der hier berichteten Anteile sichtbar."
        )
    return "\n\n".join(parts)


def section_berufe(r: dict) -> str:
    b = r["berufe"]
    coverage_rows = [[period_label(row["zeitraum"]), n0(row["personen"]), pct(row["mit_beruf"]), pct(row["mit_hisco"]), pct(row["mit_sektor"]), pct(row["mit_niveau"])] for row in b["coverage"].iter_rows(named=True)]
    sector_wide = b["sector_period"].pivot(on="zeitraum", index="sektor", values="anteil").sort("sektor")
    sector_rows = [[f"{row['sektor']} {KLDB_SECTORS[row['sektor']]}", *[pct(row.get(p)) for p in ALL_PERIODS]] for row in sector_wide.iter_rows(named=True)]
    level_wide = b["level_period"].pivot(on="zeitraum", index="niveau", values="anteil").sort("niveau")
    level_rows = [[f"{row['niveau']} {TRAINING_LEVELS[row['niveau']]}", *[pct(row.get(p)) for p in ALL_PERIODS]] for row in level_wide.iter_rows(named=True)]
    entropy_rows = []
    for name, frame in [("Berufsbezeichnungen", b["entropy_occ"]), ("HISCO-Codes", b["entropy_hisco"])]:
        for row in frame.iter_rows(named=True):
            interval = f"{n2(row['H_rarefiziert'])} ({n2(row['H_unten'])}–{n2(row['H_oben'])})" if row.get("H_rarefiziert") is not None else "–"
            entropy_rows.append([name, period_label(row["zeitraum"]), n0(row["n"]), n0(row["verschiedene"]), n2(row["H"]), interval, n0(row.get("hill_rarefiziert"))])
    mover_parts = []
    for key, (rising, falling) in b["movers"].items():
        before, after = key.split("|")
        rows = []
        for direction, frame in [("steigend", rising.head(8)), ("fallend", falling.head(8))]:
            for row in frame.iter_rows(named=True):
                rows.append([direction, f"{row['hisco']:05d} {row['bezeichnung'] or ''}", pct(row["anteil_vorher"], 2), pct(row["anteil_nachher"], 2), n2(row["differenz_pp"]), n2(row["log2_verhaeltnis"])])
        mover_parts += [f"**{before} → {after}**", table(["Richtung", "HISCO (häufigste Bezeichnung)", f"Anteil {before}", f"Anteil {after}", "Differenz (pp)", "log₂-Verhältnis"], rows, "llrrrr")]
    tab_rows = [[name.replace("_", " × "), n0(t["n"]), n0(t["chi2"]), str(t["df"]), p_value(t["p"]), n2(t["cramers_v"])] for name, t in b["tabs"].items()]
    port_tab = b["tabs"]["sektor_hafen"]
    residual_rows = []
    for i, sector in enumerate(port_tab["zeilen"]):
        for j, port in enumerate(port_tab["spalten"]):
            residual_rows.append((port_tab["residuen"][i][j], sector, port, port_tab["beobachtet"][i][j]))
    top_pos = sorted(residual_rows, reverse=True)[:8]
    residual_table = table(["Berufsbereich", "Hafen", "Personen", "adj. Residuum"], [[KLDB_SECTORS_SHORT[s], p, n0(n), n1(res)] for res, s, p, n in top_pos], "llrr")
    women = b["women_by_sector"].filter(pl.col("zeitraum").is_in(MAIN_PERIODS)).pivot(on="zeitraum", index="sektor", values="frauenanteil").sort("sektor")
    women_rows = [[KLDB_SECTORS_SHORT[row["sektor"]], *[pct(row.get(p), 0) for p in MAIN_PERIODS]] for row in women.iter_rows(named=True)]
    sailing = ", ".join(f"{row['occupation_cleaned']} ({row['n']})" for row in b["sailing"].head(10).iter_rows(named=True))
    return "\n\n".join([
        "## 2 Berufsstruktur und Qualifikationswandel",
        "Grundlage sind die Einträge der Kategorie *Überfahrt* (ohne US-Staatsangehörige und Kreuzfahrten). Berufe sind nach KldB 2010 (Berufsbereich 0–9, Anforderungsniveau 1–4) und nach HISCO klassifiziert; HISCO `-1` markiert vorhandene, aber nicht klassifizierbare Angaben, meist Angehörige („Landwirtschaft Tagelöhner Angehörig“).",
        table(["Zeitraum", "Personen", "mit Beruf", "mit HISCO", "mit KldB-Bereich", "mit Niveau"], coverage_rows),
        "### Berufsbereiche (KldB 2010)",
        "Anteile an allen Einträgen mit Berufsbereich:",
        table(["Berufsbereich", *ALL_PERIODS], sector_rows),
        "Der Wandel ist stark: Vor dem Krieg dominieren landwirtschaftliche Tagelöhner, in der Zwischenkriegszeit Haushalt, Handwerk und Handel. Ein Teil des Wandels liegt in der Listenführung: „Hausfrau“ erscheint in den Vorkriegslisten kaum, Ehefrauen und Kinder stehen dort als Angehörige (HISCO `-1`). Der Anstieg von Bereich 8 ist deshalb zum Teil eine Änderung der Notierung, nicht nur der Wanderung.",
        "### Anforderungsniveau",
        table(["Niveau", *ALL_PERIODS], level_rows),
        "### Vielfalt der Berufe",
        "Shannon-Entropie *H* der Verteilung über Berufsbezeichnungen bzw. HISCO-Codes. Weil *H* mit der Stichprobengröße wächst, sind die Zeiträume über Rarefaction vergleichbar gemacht: 200 Ziehungen ohne Zurücklegen von je 10.000 Einträgen, Mittelwert und 2,5–97,5-%-Perzentil. Die Hill-Zahl exp(*H*) ist die Zahl gleich häufiger Berufe mit derselben Entropie.",
        table(["Merkmal", "Zeitraum", "n", "verschiedene", "H", "H rarefiziert (95 %)", "Hill rarefiziert"], entropy_rows, "llrrrrr"),
        f"Die Segelschiffzeit ist zu dünn belegt für einen Vergleich; die häufigsten Angaben dort sind {sailing}.",
        "### Steigende und fallende Berufe",
        f"Für jeden HISCO-Code mit mindestens 30 Nennungen in beiden Zeiträumen zusammen: Anteile, Differenz in Prozentpunkten, log₂-Verhältnis der Anteile (Haldane-Korrektur 0,5) und Zwei-Stichproben-z-Test mit Bonferroni-Korrektur über alle getesteten Codes. Gezeigt werden die acht größten signifikanten Zu- und Abnahmen nach Prozentpunkten (p < 0,05 nach Korrektur).",
        *mover_parts,
        "### Kreuztabellen",
        "χ²-Unabhängigkeitstests mit Cramérs *V*; Berufsbereich gegen Zielhafen (sieben größte Häfen und Sonstige), Geschlecht und Altersgruppe sowie Anforderungsniveau gegen Zielhafen.",
        table(["Tabelle", "n", "χ²", "df", "p", "Cramérs V"], tab_rows),
        "Bei diesen Fallzahlen ist jeder Test signifikant; aussagekräftig ist die Effektstärke. Das Geschlecht hängt sehr stark mit dem Berufsbereich zusammen (Haushalt und Pflege vs. Produktion und Bau). Zwischen Berufsbereich und Hafen ist der Zusammenhang moderat. Die größten positiven adjustierten Residuen, also Kombinationen, die häufiger vorkommen als bei Unabhängigkeit erwartet:",
        residual_table,
        "Frauenanteil je Berufsbereich:",
        table(["Berufsbereich", *MAIN_PERIODS], women_rows),
    ])


def section_geografie(r: dict) -> str:
    g = r["geografie"]
    if not g.get("available"):
        return "## 3 Geografische Dynamik und Kettenmigration\n\nDie Geokodierung der Herkunfts- und Zielorte lag bei der Erstellung dieses Berichts nicht vor."
    coverage = g["coverage_origin"].pivot(on="zeitraum", index="genauigkeit", values="anteil")
    coverage_rows = [[row["genauigkeit"], *[pct(row.get(p)) for p in ALL_PERIODS]] for row in coverage.iter_rows(named=True)]
    coverage_dest = g["coverage_destination"].pivot(on="zeitraum", index="genauigkeit", values="anteil")
    coverage_dest_rows = [[row["genauigkeit"], *[pct(row.get(p)) for p in ALL_PERIODS]] for row in coverage_dest.iter_rows(named=True)]
    countries = g["origin_countries"].filter(pl.col("zeitraum").is_in(MAIN_PERIODS))
    country_rows = []
    for period in MAIN_PERIODS:
        top = countries.filter(pl.col("zeitraum") == period).head(6)
        country_rows.append([period, ", ".join(f"{row['herkunft_land_heute']} {pct(row['anteil'], 0)}" for row in top.iter_rows(named=True))])
    region_rows = []
    for period in MAIN_PERIODS:
        top = g["regions"].filter(pl.col("zeitraum") == period).head(6)
        region_rows.append([period, ", ".join(f"{row['state_or_province_cleaned']} {pct(row['anteil'], 0)}" for row in top.iter_rows(named=True))])
    centroid_rows = [[period_label(row["zeitraum"]), n0(row["n"]), n2(row["lat"]), n2(row["lon"]), n0(row["standarddistanz_km"])] for row in g["period_centroids"].iter_rows(named=True)]
    yearly_rows = [[str(row["jahr"]), n0(row["n"]), n2(row["lat"]), n2(row["lon"]), n0(row["standarddistanz_km"])] for row in g["yearly_centroids"].iter_rows(named=True)]
    chained = g["corridors"].filter("kettenmigration")
    corridor_rows = [[
        f"{row['herkunft_ort']} ({row['herkunft_land_heute']})", f"{row['ziel_ort_gruppe']} ({row['ziel_land']})",
        n0(row["y"]), n0(row["personen"]), f"{row['erstes_jahr']}–{row['letztes_jahr']}", str(row["jahre"]), n1(row["z"]), n1(row["pmi"]),
        row["haeufigster_beruf"] or "–", pct(row["frauenanteil"], 0),
    ] for row in chained.head(25).iter_rows(named=True)]
    religious = chained.filter(pl.col("anteil_ordensleute") > 0.5)
    religious_top = chained.head(25).filter(pl.col("anteil_ordensleute") > 0.5)
    religious_examples = ", ".join(f"{row['herkunft_ort']} → {row['ziel_ort_gruppe']}" for row in religious_top.head(6).iter_rows(named=True))
    share_rows = [[period_label(row["zeitraum"]), n0(row["gruppen"]), pct(row["anteil_in_korridoren"])] for row in g["chain_share"].iter_rows(named=True)]
    region_port_rows = [[row["region"], row["hafen"], n0(row["y"]), n1(row["z"])] for row in g["region_ports"].head(12).iter_rows(named=True)]
    return "\n\n".join([
        "## 3 Geografische Dynamik und Kettenmigration",
        "Der Datensatz geokodiert nur Häfen. Herkunfts- und Zielorte wurden für diesen Bericht gegen GeoNames abgeglichen (Methode und Stichprobenprüfung in `analysis/enrichment/HERKUNFT_GEOCODING.md` und `ZIELE_GEOCODING.md`). Grundlage ist wieder die Kategorie *Überfahrt*.",
        "Genauigkeit der Herkunftsangabe je Zeitraum:",
        table(["Genauigkeit", *ALL_PERIODS], coverage_rows),
        "Genauigkeit der Zielangabe je Zeitraum:",
        table(["Genauigkeit", *ALL_PERIODS], coverage_dest_rows),
        "### Herkunft",
        "Häufigste Herkunftsländer (heutige Grenzen, ISO-Code) und historische Regionen nach Anteil an den zugeordneten Einträgen:",
        table(["Zeitraum", "Länder"], country_rows, "ll"),
        table(["Zeitraum", "Regionen (Angabe der Liste)"], region_rows, "ll"),
        "Schwerpunkt (sphärisches Mittel) und Standarddistanz (quadratisches Mittel der Großkreisdistanzen zum Schwerpunkt) aller in Europa gelegenen, auf Ortsebene geokodierten Herkunftsorte:",
        table(["Zeitraum", "Einträge", "Breite", "Länge", "Standarddistanz (km)"], centroid_rows),
        table(["Jahr", "Einträge", "Breite", "Länge", "Standarddistanz (km)"], yearly_rows),
        "### Kettenmigration",
        f"Einheit ist die rekonstruierte Reisegruppe, nicht die Person; eine große Familie zählt einmal. Berücksichtigt sind Reisegruppen mit sicher zugeordnetem Herkunftsort in Europa und Zielort in Übersee (Ortsgenauigkeit, ohne unscharfe oder mehrdeutige Treffer, ohne gleichnamige Herkunfts- und Zielorte, die meist auf Verwechslungen beruhen); Rück- und Geschäftsreisen mit europäischem Ziel fallen so heraus. Jeder Korridor erhält eine Kategorie: *Orden*, wenn mehr als die Hälfte der Reisenden Ordensleute sind, sonst den häufigsten Berufsbereich der Reisenden (ohne Hausfrauen). Für jedes Paar aus Herkunftsort und Zielort wurde das gewichtete log-odds-Verhältnis mit informativem Dirichlet-Prior (Monroe, Colaresi und Quinn 2008; Priorstärke 500) gegen alle anderen Herkunftsorte berechnet, dazu die punktweise Transinformation (PMI). Als Korridor der Kettenmigration gilt ein Paar mit mindestens fünf Reisegruppen in mindestens drei verschiedenen Jahrgängen und z ≥ 3. Das trifft auf {n0(len(chained))} von {n0(len(g['corridors']))} Paaren zu, gebildet aus {n0(g['units'])} Reisegruppen.",
        table(["Herkunft", "Ziel", "Gruppen", "Personen", "Jahre", "Jahrgänge", "z", "PMI", "häufigster Beruf", "Frauen"], corridor_rows, "llrrlrrrlr"),
        f"Unter den 25 stärksten Korridoren werden {len(religious_top)} überwiegend von Ordensleuten getragen (Berufsangabe Schwester, Ordensschwester, Nonne, Missionar; Anteil über 50 %), etwa {religious_examples}. Insgesamt gilt das für {n0(len(religious))} der {n0(len(chained))} Korridore. Wahrscheinlich sind es Entsendungen zwischen Mutterhäusern und Niederlassungen von Orden in Nordamerika; sie erfüllen die statistischen Kriterien wiederkehrender Wanderung, beruhen aber nicht auf Familiennetzen. Daneben stehen Verbindungen der Unterweserorte (Lehe, Bremerhaven, Wesermünde) nach Hoboken und New York, gewerbliche Korridore (Weber aus Thalheim nach Dover und Philadelphia, Bergleute aus Herdorf und Neunkirchen) und die Flucht nach Shanghai, deren Einträge aus Berlin und Breslau sich auf 1938 und 1939 konzentrieren.",
        "Anteil der Reisegruppen, die in einem dieser Korridore reisten:",
        table(["Zeitraum", "Gruppen", "in Korridoren"], share_rows),
        "Überrepräsentierte Kombinationen aus Region (Angabe der Liste) und Ankunftshafen, gleiche Methode, mindestens 20 Reisegruppen; Regionen im Land des Ankunftshafens (Heimreisen) ausgenommen:",
        table(["Region", "Hafen", "Gruppen", "z"], region_port_rows, "llrr"),
    ])


def section_demografie(r: dict) -> str:
    d = r["demografie"]
    pyramids = d["pyramids"]
    age_rows = []
    for period in ALL_PERIODS:
        part = pyramids.filter(pl.col("zeitraum") == period)
        total = part["n"].sum()
        if not total:
            continue
        share = lambda low, high: part.filter(pl.col("altersklasse").is_between(low, high))["n"].sum() / total
        men = part.filter(pl.col("geschlecht") == "m")["n"].sum()
        women = part.filter(pl.col("geschlecht") == "w")["n"].sum()
        age_rows.append([period_label(period), n0(total), pct(share(0, 14)), pct(share(15, 29)), pct(share(30, 44)), pct(share(45, 59)), pct(share(60, 200)), n0(100 * men / women)])
    sector_rows = [[period_label(row["zeitraum"]), KLDB_SECTORS_SHORT[row["sektor"]], n0(row["n"]), f"{n0(row['median_alter'])} ({n0(row['q25_alter'])}–{n0(row['q75_alter'])})", pct(row["frauenanteil"], 0)] for row in d["sectors"].filter(pl.col("zeitraum").is_in(MAIN_PERIODS), pl.col("n") >= 500).iter_rows(named=True)]
    marital = d["marital"].filter(pl.col("zeitraum").is_in(MAIN_PERIODS), pl.col("marital_status_cleaned").is_in(["ledig", "verheiratet", "verwitwet"]))
    marital_rows = []
    for period in MAIN_PERIODS:
        row = [period_label(period)]
        for sex in ["m", "w"]:
            for status in ["ledig", "verheiratet", "verwitwet"]:
                row.append(pct(lookup(marital, "anteil", zeitraum=period, geschlecht=sex, marital_status_cleaned=status), 0))
        marital_rows.append(row)
    group_rows = []
    sensitivity = d["sensitivity"]
    for period in ALL_PERIODS:
        cells = []
        for kind in ["allein", "zu zweit", "Familie/Gruppe 3+"]:
            rec = lookup(sensitivity, "anteil_rekonstruiert", zeitraum=period, typ=kind)
            simple = lookup(sensitivity, "anteil_einfach", zeitraum=period, typ=kind)
            cells.append(f"{pct(rec)} ({pct(simple)})")
        group_rows.append([period_label(period), *cells])
    units = d["units"].filter(pl.col("gruppe_typ") == "Familie/Gruppe 3+")
    unit_rows = [[period_label(row["zeitraum"]), n0(row["gruppen"]), n1(row["mittlere_groesse"]), pct(row["anteil_mit_kindern"])] for row in units.iter_rows(named=True)]
    nat = d["by_nationality"].filter(pl.col("gruppe_typ") == "Familie/Gruppe 3+").sort("anteil", descending=True)
    nat_rows = [[row["nationality_cleaned"], pct(row["anteil"])] for row in nat.iter_rows(named=True)]
    largest_rows = [[row["nachname"], n0(row["personen"]), row["schiff"], row["abfahrt"].strftime("%d.%m.%Y") if row["abfahrt"] else "–", row["wohnort"] or "–", row["ziel"] or "–"] for row in d["largest"].head(8).iter_rows(named=True)]
    return "\n\n".join([
        "## 4 Demografie und Reisegruppen",
        "### Alter und Geschlecht",
        table(["Zeitraum", "mit Alter und Geschlecht", "0–14", "15–29", "30–44", "45–59", "60+", "Männer je 100 Frauen"], age_rows),
        f"Zum Vergleich: Das Medianalter der US-Staatsangehörigen liegt bei {n0(d['us_median_age'])} Jahren, das der übrigen Reisenden bei {n0(d['base_median_age'])}. Medianalter (Quartile) und Frauenanteil je Berufsbereich, Bereiche mit mindestens 500 Einträgen:",
        table(["Zeitraum", "Berufsbereich", "n", "Medianalter (Quartile)", "Frauenanteil"], sector_rows, "llrrr"),
        "Familienstand der Personen ab 15 Jahren:",
        table(["Zeitraum", "Männer ledig", "verheiratet", "verwitwet", "Frauen ledig", "verheiratet", "verwitwet"], marital_rows),
        "### Rekonstruktion von Reisegruppen",
        "Die Listen verzeichnen keine Haushalte. Eine Reisegruppe wird hier rekonstruiert aus aufeinanderfolgenden Einträgen derselben Archivliste (Reihenfolge der Abschrift) mit gleichem normalisiertem Nachnamen (Umlaute, ß und Satzzeichen vereinheitlicht) und einem Abstand der Passagiernummern von höchstens zwei. Jede Liste enthält mehrere nach Klasse getrennte Teillisten, deren Nummerierung neu beginnt; die Nummernbedingung trennt sie. Ehefrauen mit eigenem Namen oder Kinder aus anderen Ehen fallen so heraus, nicht verwandte Personen gleichen Namens direkt hintereinander werden zusammengefasst.",
        "Anteil der Personen nach Gruppentyp; in Klammern die einfache Gruppierung nach Nachname, Schiff und Datum ohne Reihenfolge als Sensitivitätsprüfung:",
        table(["Zeitraum", "allein", "zu zweit", "Gruppe ab drei"], group_rows),
        "Die einfache Gruppierung fasst bei häufigen Namen Fremde zusammen und überschätzt Gruppen deutlich; die Richtung des Wandels ist bei beiden Verfahren gleich: Gruppen ab drei Personen werden in den Dreißigerjahren seltener, Paare häufiger.",
        "Gruppen ab drei Personen als Einheiten:",
        table(["Zeitraum", "Gruppen", "mittlere Größe", "mit Kind unter 15"], unit_rows),
        "Anteil der Personen in Gruppen ab drei nach Staatsangehörigkeit (1919–1939, zehn häufigste Staatsangehörigkeiten):",
        table(["Staatsangehörigkeit", "Anteil"], nat_rows),
        f"Die größten rekonstruierten Gruppen umfassen meist mehrere Familien gleichen Namens aus einem Ort; ob und wie sie verwandt waren, sagen die Listen nicht. {n0(d['alphabetical_lists'])} Listen sind in der Abschrift überwiegend alphabetisch sortiert; dort werden Namensgleiche nur zusammengefasst, wenn auch der Wohnort übereinstimmt.",
        table(["Name", "Personen", "Schiff", "Abfahrt", "Wohnort", "Ziel"], largest_rows, "lrllll"),
    ])


def section_schifffahrt(r: dict) -> str:
    s = r["schifffahrt"]
    ports = s["port_year"].with_columns(
        pl.when(pl.col("jahr") < 1870).then(pl.lit("1830–1869")).when(pl.col("jahr") < 1915).then(pl.lit("1907–1914")).when(pl.col("jahr") < 1930).then(pl.lit("1919–1929")).otherwise(pl.lit("1930–1939")).alias("zeitraum")
    ).group_by("zeitraum", "hafen", maintain_order=True).agg(pl.col("n").sum())
    ports = ports.with_columns((pl.col("n") / pl.col("n").sum().over("zeitraum")).alias("anteil"))
    port_names = ports.group_by("hafen", maintain_order=True).agg(pl.col("n").sum()).sort("n", descending=True)["hafen"].to_list()
    port_rows = [[name, *[pct(lookup(ports, "anteil", zeitraum=p, hafen=name)) for p in ALL_PERIODS]] for name in port_names]
    agents = s["agent_year"].with_columns(
        pl.when(pl.col("jahr") < 1870).then(pl.lit("1830–1869")).when(pl.col("jahr") < 1915).then(pl.lit("1907–1914")).when(pl.col("jahr") < 1930).then(pl.lit("1919–1929")).otherwise(pl.lit("1930–1939")).alias("zeitraum")
    ).group_by("zeitraum", "reederei", maintain_order=True).agg(pl.col("n").sum())
    agents = agents.with_columns((pl.col("n") / pl.col("n").sum().over("zeitraum")).alias("anteil"))
    agent_names = agents.group_by("reederei", maintain_order=True).agg(pl.col("n").sum()).sort("n", descending=True)["reederei"].to_list()
    agent_rows = [[name, *[pct(lookup(agents, "anteil", zeitraum=p, reederei=name)) for p in ALL_PERIODS]] for name in agent_names]
    stats_rows = [[period_label(row["zeitraum"]), n0(row["reisen"]), n0(row["passagiere"]), n0(row["median"]), n0(row["mittel"]), n0(row["p90"]), n0(row["maximum"])] for row in s["stats"].iter_rows(named=True)]
    ship_rows = [[row["ship_cleaned"], n0(row["passagiere"]), n0(row["reisen"]), f"{row['erstes_jahr']}–{row['letztes_jahr']}", n0(row["groesste_reise"]), row["reederei"] or "–"] for row in s["ships"].head(15).iter_rows(named=True)]
    class_years = [1922, 1926, 1930, 1934, 1938]
    classes = s["classes"].filter(pl.col("jahr").is_in(class_years))
    class_names = ["3. Klasse", "Touristenklasse", "2. Klasse", "Kabinenklasse", "1. Klasse", "Mittelklasse"]
    class_rows = [[str(year), n0(classes.filter(pl.col("jahr") == year)["n"].sum()), *[pct(lookup(classes, "anteil", jahr=year, klasse=c), 0) for c in class_names]] for year in class_years]
    month = s["month_by_period"].filter(pl.col("reiseart") == "Überfahrt", pl.col("zeitraum").is_in(MAIN_PERIODS))
    month_rows = [[period_label(p), *[pct(lookup(month, "anteil", zeitraum=p, reiseart="Überfahrt", monat=m), 0) for m in range(1, 13)]] for p in MAIN_PERIODS]
    return "\n\n".join([
        "## 5 Schifffahrt und Routen",
        "### Ankunftshäfen",
        port_correction_text(),
        "Anteil an allen datierten Einträgen des Zeitraums (neun häufigste Häfen, alle Reisearten):",
        table(["Hafen", *ALL_PERIODS], port_rows),
        "### Reedereien und Agenturen",
        table(["Reederei/Agentur", *ALL_PERIODS], agent_rows),
        "### Reisen und Schiffe",
        "Eine Reise ist eine Kombination aus Schiff und Abfahrtsdatum.",
        table(["Zeitraum", "Reisen", "Einträge", "Median", "Mittel", "90-%-Quantil", "Maximum"], stats_rows),
        small_voyage_text(s),
        table(["Schiff", "Einträge", "Reisen", "Jahre", "größte Reise", "Reederei"], ship_rows, "lrrlrl"),
        "### Reiseklassen",
        "Anteil an den Einträgen mit Klassenangabe in ausgewählten Jahren. Vor dem Ersten Weltkrieg ist die Klasse nur selten notiert. Die Touristenklasse wächst ab Mitte der Zwanzigerjahre und löst die 2. Klasse weitgehend ab; die 3. Klasse bleibt bei rund der Hälfte.",
        table(["Jahr", "mit Klasse", *class_names], class_rows),
        "### Abfahrtsmonate",
        "Verteilung der Überfahrten (ohne US-Staatsangehörige und Kreuzfahrten) über die Monate:",
        table(["Zeitraum", *MONTHS], month_rows),
    ])


def port_correction_text() -> str:
    corrections = port_corrections()
    if corrections is None or corrections.is_empty():
        return ""
    names = ", ".join(sorted(corrections["port_of_arrival_cleaned"].to_list()))
    return f"Die Hafenkoordinaten stammen aus dem Datensatz und sind für fehlende Häfen ergänzt. Bei {names} weichen sie um mehr als 100 km vom Ort ab; für Karte und Atlas gelten dort die Koordinaten aus GeoNames."


def small_voyage_text(s: dict) -> str:
    profile = s["size_profile"].filter(pl.col("zeitraum") == "1930–1939").row(0, named=True)
    ports = ", ".join(f"{row['hafen']} ({row['reisen']})" for row in s["small_ports"].head(6).iter_rows(named=True))
    return (
        f"Der niedrige Median der Dreißigerjahre kommt von {n0(profile['kleine_reisen'])} Reisen mit weniger als 20 Einträgen "
        f"({pct(profile['anteil_kleine_reisen'], 0)} aller Reisen, aber nur {pct(profile['anteil_passagiere_kleine'])} der Einträge). "
        f"Es sind vor allem Fahrten kleinerer Schiffe in Nord- und Ostsee, nach West- und Südeuropa sowie Frachtschiffe nach Übersee; häufigste Ziele: {ports}. "
        f"{pct(profile['anteil_passagiere_grosse'], 0)} der Einträge dieser Jahre entfallen auf Reisen mit mindestens 500 Passagieren."
    )


def section_methods(r: dict) -> str:
    size = r["web"]["parquet_bytes"]
    return "\n\n".join([
        "## Methoden, Grenzen, Reproduktion",
        "- **Einheiten.** Wo nicht anders angegeben, ist die Einheit der Eintrag. Einträge sind Passagiere auf einer Liste; dieselbe Person kann mehrfach reisen, und einige Reisen stehen auf den Listen mehrerer Agenturen.",
        "- **Basis.** Quellenkritik und Schifffahrt verwenden alle Einträge, Berufe, Geografie und Demografie die Kategorie *Überfahrt* (ohne US-Staatsangehörige, ohne Kreuzfahrten).",
        "- **Zeiträume.** Segelschiffzeit 1830–1869, Vorkriegsjahre 1907–1914, Zwanziger Jahre 1919–1929, Dreißiger Jahre 1930–1939. Die Segelschiffzeit ist zu dünn und zu selektiv überliefert für Vergleiche und wird nur beschrieben.",
        "- **Tests.** Bei Fallzahlen im Hunderttausenderbereich sind fast alle Unterschiede signifikant. Berichtet werden deshalb Effektgrößen (Prozentpunkte, log-Verhältnisse, Cramérs V, z-Werte) und Konfidenz- bzw. Perzentilintervalle; Mehrfachtests sind Bonferroni-korrigiert.",
        "- **Anreicherung.** Herkunfts- und Zielorte, Hafenkoordinaten, Freitextfelder und Archivkürzel wurden in eigenen Schritten bereinigt; die Methodenberichte liegen in `analysis/enrichment/`, die Nachschlagetabellen in `data/enrichment/`.",
        "- **Reproduktion.** `python analysis/run_all.py --rebuild` lädt die Zenodo-Datei (MD5-Prüfung), baut die angereicherte Tabelle, rechnet alle Module, schreibt die Tabellen nach `analysis/output/`, die Webdaten nach `web/public/data/` und diesen Bericht.",
        f"- **Webdatenbank.** `web/public/data/passagiere.parquet` enthält alle Einträge in {r['web']['parquet_columns']} Spalten, wörterbuchkodiert und ZSTD-komprimiert, {n1(size / 1e6)} MB.",
    ])


def write(df: pl.DataFrame, results: dict) -> None:
    header = "\n\n".join([
        "# Forschungsbericht: 735.545 Einträge der Bremer Passagierlisten 1830–1939",
        f"Stand {date.today().strftime('%d.%m.%Y')}. Erzeugt von `analysis/run_all.py` aus Perschl, Schmidt, Gassner, Rehbein (2025), *A Dataset of 735,000 Migration Records (Bremen, 1830-1939)*, Zenodo, [10.5281/zenodo.17977460](https://doi.org/10.5281/zenodo.17977460), CC BY 4.0.",
        "Die Einträge wurden von Ehrenamtlichen der *MAUS – Gesellschaft für Familienforschung e. V. Bremen* gemeinsam mit der Handelskammer Bremen und dem Staatsarchiv Bremen transkribiert ([passagierlisten.de](https://passagierlisten.de/)). Alle Zahlen dieses Berichts beruhen auf ihrer Arbeit.",
    ])
    sections = [
        header,
        summary_section(df, results),
        section_quellen(df, results),
        section_berufe(results),
        section_geografie(results),
        section_demografie(results),
        section_schifffahrt(results),
        section_methods(results),
    ]
    REPORT.write_text("\n\n".join(sections) + "\n", encoding="utf-8")
