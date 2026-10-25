import numpy as np
import polars as pl
from scipy import stats

from .codes import KLDB_SECTORS, KLDB_SECTORS_SHORT, PERIODS, TRAINING_LEVELS
from .export import write_table, write_web_json

MAIN_PERIODS = [label for label, start, _ in PERIODS if start >= 1900]
COMPARISONS = [("1907–1914", "1919–1929"), ("1919–1929", "1930–1939"), ("1907–1914", "1930–1939")]
RAREFACTION_DRAWS = 200
RAREFACTION_SIZE = 10_000
MIN_CODE_COUNT = 30
TOP_PORTS = ["New York", "Buenos Aires", "Baltimore", "Halifax", "Rio de Janeiro", "Santos", "Galveston"]
AGE_GROUPS = [(0, 14, "0–14"), (15, 24, "15–24"), (25, 34, "25–34"), (35, 44, "35–44"), (45, 59, "45–59"), (60, 120, "60+")]
RNG = np.random.default_rng(1830)


def age_group(age: pl.Expr) -> pl.Expr:
    expr = pl.lit(None, dtype=pl.String)
    for low, high, label in reversed(AGE_GROUPS):
        expr = pl.when(age.is_between(low, high)).then(pl.lit(label)).otherwise(expr)
    return expr


def emigrants(df: pl.DataFrame) -> pl.DataFrame:
    return df.filter(pl.col("reiseart") == "Überfahrt", pl.col("zeitraum").is_not_null())


def shares(df: pl.DataFrame, by: str, category: str) -> pl.DataFrame:
    counts = df.filter(pl.col(category).is_not_null()).group_by(by, category).agg(pl.len().alias("n"))
    return counts.with_columns((pl.col("n") / pl.col("n").sum().over(by)).alias("anteil")).sort(by, category)


def coverage(df: pl.DataFrame, by: str) -> pl.DataFrame:
    return df.group_by(by).agg(
        pl.len().alias("personen"),
        pl.col("occupation").is_not_null().mean().alias("mit_beruf"),
        pl.col("sektor").is_not_null().mean().alias("mit_sektor"),
        pl.col("niveau").is_not_null().mean().alias("mit_niveau"),
        (pl.col("hisco").fill_null(-1) >= 0).mean().alias("mit_hisco"),
    ).sort(by)


def shannon(counts: np.ndarray) -> float:
    p = counts[counts > 0] / counts.sum()
    return float(-(p * np.log(p)).sum())


def rarefied_entropy(codes: np.ndarray, sample_size: int) -> tuple[float, float, float]:
    values = []
    for _ in range(RAREFACTION_DRAWS):
        sample = RNG.choice(codes, size=sample_size, replace=False)
        values.append(shannon(np.bincount(sample)))
    return float(np.mean(values)), float(np.percentile(values, 2.5)), float(np.percentile(values, 97.5))


def entropy_table(df: pl.DataFrame, column: str) -> pl.DataFrame:
    coded = df.filter(pl.col(column).is_not_null())
    if column == "hisco":
        coded = coded.filter(pl.col("hisco") >= 0)
    rows = []
    for label, _, _ in PERIODS:
        labels = coded.filter(pl.col("zeitraum") == label)[column].cast(pl.String).to_numpy()
        if len(labels) == 0:
            continue
        _, codes = np.unique(labels, return_inverse=True)
        counts = np.bincount(codes)
        row = {"zeitraum": label, "n": len(labels), "verschiedene": len(counts), "H": shannon(counts), "hill": float(np.exp(shannon(counts)))}
        if len(labels) >= RAREFACTION_SIZE:
            mean, low, high = rarefied_entropy(codes, RAREFACTION_SIZE)
            row |= {"H_rarefiziert": mean, "H_unten": low, "H_oben": high, "hill_rarefiziert": float(np.exp(mean)), "stichprobe": RAREFACTION_SIZE}
        rows.append(row)
    return pl.DataFrame(rows)


def hisco_labels(df: pl.DataFrame) -> pl.DataFrame:
    return (
        df.filter(pl.col("hisco") >= 0, pl.col("occupation_cleaned").is_not_null())
        .group_by("hisco", "occupation_cleaned").agg(pl.len().alias("n"))
        .sort("n", descending=True)
        .group_by("hisco").agg(pl.col("occupation_cleaned").first().alias("bezeichnung"), pl.col("n").sum().alias("gesamt"))
    )


def code_change(df: pl.DataFrame, before: str, after: str, labels: pl.DataFrame) -> pl.DataFrame:
    coded = df.filter(pl.col("hisco") >= 0, pl.col("zeitraum").is_in([before, after]))
    totals = coded.group_by("zeitraum").len()
    n_before = int(totals.filter(pl.col("zeitraum") == before)["len"].item())
    n_after = int(totals.filter(pl.col("zeitraum") == after)["len"].item())
    counts = coded.group_by("hisco").agg(
        (pl.col("zeitraum") == before).sum().alias("n_vorher"),
        (pl.col("zeitraum") == after).sum().alias("n_nachher"),
    ).filter((pl.col("n_vorher") + pl.col("n_nachher")) >= MIN_CODE_COUNT)
    tests = len(counts)
    a = counts["n_vorher"].to_numpy().astype(float)
    b = counts["n_nachher"].to_numpy().astype(float)
    p_before, p_after = a / n_before, b / n_after
    pooled = (a + b) / (n_before + n_after)
    z = (p_after - p_before) / np.sqrt(pooled * (1 - pooled) * (1 / n_before + 1 / n_after))
    p_values = 2 * stats.norm.sf(np.abs(z))
    log_ratio = np.log2(((b + 0.5) / (n_after + 1)) / ((a + 0.5) / (n_before + 1)))
    result = counts.with_columns(
        pl.Series("anteil_vorher", p_before),
        pl.Series("anteil_nachher", p_after),
        pl.Series("log2_verhaeltnis", log_ratio),
        pl.Series("differenz_pp", (p_after - p_before) * 100),
        pl.Series("z", z),
        pl.Series("p_bonferroni", np.minimum(p_values * tests, 1.0)),
    )
    return result.join(labels.select("hisco", "bezeichnung"), on="hisco", how="left").with_columns(
        pl.lit(before).alias("vorher"), pl.lit(after).alias("nachher")
    )


def rising_and_declining(change: pl.DataFrame, top: int = 12) -> tuple[pl.DataFrame, pl.DataFrame]:
    significant = change.filter(pl.col("p_bonferroni") < 0.05)
    rising = significant.filter(pl.col("differenz_pp") > 0).sort("differenz_pp", descending=True).head(top)
    declining = significant.filter(pl.col("differenz_pp") < 0).sort("differenz_pp").head(top)
    return rising, declining


def crosstab(df: pl.DataFrame, row: str, col: str) -> dict:
    table = df.filter(pl.col(row).is_not_null(), pl.col(col).is_not_null()).group_by(row, col).agg(pl.len().alias("n"))
    wide = table.pivot(on=col, index=row, values="n").fill_null(0).sort(row)
    col_names = [c for c in wide.columns if c != row]
    observed = wide.select(col_names).to_numpy().astype(float)
    chi2, p, dof, expected = stats.chi2_contingency(observed)
    n = observed.sum()
    row_share = observed.sum(axis=1, keepdims=True) / n
    col_share = observed.sum(axis=0, keepdims=True) / n
    residuals = (observed - expected) / np.sqrt(expected * (1 - row_share) * (1 - col_share))
    cramers_v = float(np.sqrt(chi2 / (n * (min(observed.shape) - 1))))
    return {
        "zeilen": wide[row].to_list(),
        "spalten": col_names,
        "beobachtet": observed.astype(int).tolist(),
        "residuen": residuals.round(2).tolist(),
        "chi2": float(chi2),
        "df": int(dof),
        "p": float(p),
        "cramers_v": cramers_v,
        "n": int(n),
    }


def sailing_era_occupations(df: pl.DataFrame) -> pl.DataFrame:
    early = df.filter(pl.col("zeitraum") == "1830–1869", pl.col("occupation_cleaned").is_not_null())
    return early.group_by("occupation_cleaned").agg(pl.len().alias("n")).sort("n", descending=True).head(15)


def run(df: pl.DataFrame) -> dict:
    base = emigrants(df)
    with_groups = base.with_columns(
        age_group(pl.col("alter")).alias("altersgruppe"),
        pl.when(pl.col("port_of_arrival_cleaned").is_in(TOP_PORTS)).then(pl.col("port_of_arrival_cleaned")).otherwise(pl.lit("Sonstige")).alias("hafen_gruppe"),
    )
    labels = hisco_labels(base)
    changes = pl.concat([code_change(base, a, b, labels) for a, b in COMPARISONS])
    movers = {f"{a}|{b}": rising_and_declining(changes.filter(pl.col("vorher") == a, pl.col("nachher") == b)) for a, b in COMPARISONS}
    sector_period = shares(base, "zeitraum", "sektor")
    sector_year = shares(base, "jahr", "sektor")
    level_period = shares(base, "zeitraum", "niveau")
    level_year = shares(base, "jahr", "niveau")
    sector_level = base.filter(pl.col("sektor").is_not_null(), pl.col("niveau").is_not_null()).group_by("zeitraum", "sektor", "niveau").agg(pl.len().alias("n")).sort("zeitraum", "sektor", "niveau")
    women_by_sector = base.filter(pl.col("sektor").is_not_null(), pl.col("geschlecht").is_not_null()).group_by("zeitraum", "sektor").agg((pl.col("geschlecht") == "w").mean().alias("frauenanteil"), pl.len().alias("n")).sort("zeitraum", "sektor")
    top_occupations = base.filter(pl.col("occupation_cleaned").is_not_null()).group_by("zeitraum", "occupation_cleaned").agg(pl.len().alias("n")).sort("n", descending=True).group_by("zeitraum").head(15).sort("zeitraum", "n", descending=[False, True])
    entropy_occ = entropy_table(base, "occupation_cleaned")
    entropy_hisco = entropy_table(base, "hisco")
    tabs = {
        "sektor_hafen": crosstab(with_groups, "sektor", "hafen_gruppe"),
        "sektor_geschlecht": crosstab(with_groups, "sektor", "geschlecht"),
        "sektor_alter": crosstab(with_groups, "sektor", "altersgruppe"),
        "niveau_hafen": crosstab(with_groups, "niveau", "hafen_gruppe"),
    }

    write_table("m2_sektoren_zeitraum", sector_period)
    write_table("m2_niveaus_zeitraum", level_period)
    write_table("m2_entropie_berufe", entropy_occ)
    write_table("m2_entropie_hisco", entropy_hisco)
    write_table("m2_hisco_wandel", changes)
    write_web_json("berufe", {
        "sektoren": {str(k): v for k, v in KLDB_SECTORS.items()},
        "sektoren_kurz": {str(k): v for k, v in KLDB_SECTORS_SHORT.items()},
        "niveaus": {str(k): v for k, v in TRAINING_LEVELS.items()},
        "abdeckung_zeitraum": coverage(base, "zeitraum"),
        "abdeckung_jahr": coverage(base, "jahr"),
        "sektor_zeitraum": sector_period,
        "sektor_jahr": sector_year,
        "niveau_zeitraum": level_period,
        "niveau_jahr": level_year,
        "sektor_niveau": sector_level,
        "frauen_sektor": women_by_sector,
        "top_berufe": top_occupations,
        "entropie_berufe": entropy_occ,
        "entropie_hisco": entropy_hisco,
        "wandel": {key: {"steigend": rising, "fallend": falling} for key, (rising, falling) in movers.items()},
        "kreuztabellen": tabs,
        "segelschiffzeit": sailing_era_occupations(base),
    })
    return {
        "coverage": coverage(base, "zeitraum"),
        "sector_period": sector_period,
        "level_period": level_period,
        "entropy_occ": entropy_occ,
        "entropy_hisco": entropy_hisco,
        "movers": movers,
        "tabs": tabs,
        "top_occupations": top_occupations,
        "women_by_sector": women_by_sector,
        "sailing": sailing_era_occupations(base),
    }
