import numpy as np
import polars as pl
import statsmodels.formula.api as smf
from statsmodels.genmod.families import Poisson
from statsmodels.tsa.seasonal import STL

from .export import write_table, write_web_json

MISSINGNESS_COLUMNS = {
    "last_name": "Nachname",
    "first_name": "Vorname",
    "gender_cleaned": "Geschlecht",
    "age_cleaned": "Alter",
    "marital_status_cleaned": "Familienstand",
    "nationality_cleaned": "Staatsangehörigkeit",
    "previous_residence": "Wohnort",
    "state_or_province_cleaned": "Region",
    "occupation": "Beruf",
    "occupation_hisco_nr": "HISCO",
    "occupation_sector": "KldB-Bereich",
    "occupation_training_level": "Anforderungsniveau",
    "travel_class_cleaned": "Reiseklasse",
    "port_of_arrival_cleaned": "Ankunftshafen",
    "emigration_destination": "Reiseziel",
    "US_state_cleaned": "US-Bundesstaat",
    "religion_cleaned": "Religion",
    "ethnicity_cleaned": "Ethnie",
    "literacy": "Lese-/Schreibfähigkeit",
    "amount_of_money": "Bargeld",
    "relative": "Angehörige",
    "reference_person": "Kontaktperson",
    "captain": "Kapitän",
    "notes": "Bemerkungen",
}

MIN_MONTHS_FOR_SEASONALITY = 10
STL_RANGE = (1930, 1938)


def yearly_counts(df: pl.DataFrame) -> pl.DataFrame:
    dated = df.filter(pl.col("jahr").is_not_null())
    totals = dated.group_by("jahr", maintain_order=True).agg(
        pl.len().alias("datensaetze"),
        pl.col("archive_id").n_unique().alias("listen"),
        pl.struct("ship_cleaned", "abfahrt").n_unique().alias("reisen"),
        pl.col("monat").n_unique().alias("monate"),
        (pl.col("reiseart") == "Überfahrt").sum().alias("ueberfahrt"),
        (pl.col("reiseart") == "US-Staatsangehörige").sum().alias("us_staatsangehoerige"),
        (pl.col("reiseart") == "Kreuzfahrt").sum().alias("kreuzfahrt"),
    )
    all_years = pl.DataFrame({"jahr": list(range(1830, 1940))}, schema={"jahr": pl.Int32})
    return all_years.join(totals, on="jahr", how="left").fill_null(0).sort("jahr")


def monthly_counts(df: pl.DataFrame) -> pl.DataFrame:
    return (
        df.filter(pl.col("jahr").is_not_null())
        .group_by("jahr", "monat", maintain_order=True).agg(pl.len().alias("n"))
        .sort("jahr", "monat")
    )


def gaps(yearly: pl.DataFrame) -> list[list[int]]:
    empty_years = yearly.filter(pl.col("datensaetze") == 0)["jahr"].to_list()
    runs = []
    for year in empty_years:
        if runs and runs[-1][1] == year - 1:
            runs[-1][1] = year
        else:
            runs.append([year, year])
    return [run for run in runs if run[1] - run[0] >= 2]


def missingness(df: pl.DataFrame, by: str) -> pl.DataFrame:
    return (
        df.filter(pl.col(by).is_not_null())
        .group_by(by, maintain_order=True)
        .agg([pl.len().alias("n")] + [pl.col(c).is_not_null().mean().alias(label) for c, label in MISSINGNESS_COLUMNS.items()])
        .sort(by)
    )


def archive_series(df: pl.DataFrame) -> pl.DataFrame:
    if "archive_series" in df.columns:
        series = pl.col("archive_series")
    else:
        series = pl.col("archive_id").str.extract(r"^([A-Za-z]+)")
    return (
        df.filter(pl.col("jahr").is_not_null())
        .group_by(series.fill_null("ohne").alias("serie"), "jahr", maintain_order=True)
        .agg(pl.len().alias("n"))
        .sort("serie", "jahr")
    )


def seasonal_index(monthly: pl.DataFrame) -> dict:
    coverage = monthly.group_by("jahr", maintain_order=True).agg(pl.len().alias("monate"))
    years = coverage.filter(pl.col("monate") >= MIN_MONTHS_FOR_SEASONALITY)["jahr"].to_list()
    grid = pl.DataFrame({"jahr": years}).join(pl.DataFrame({"monat": list(range(1, 13))}, schema={"monat": pl.Int8}), how="cross")
    grid = grid.with_columns(pl.col("jahr").cast(pl.Int32), pl.col("monat").cast(pl.Int8))
    counts = grid.join(monthly.with_columns(pl.col("monat").cast(pl.Int8)), on=["jahr", "monat"], how="left").fill_null(0)
    model = smf.glm("n ~ C(jahr) + C(monat)", data=counts.to_pandas(), family=Poisson()).fit(scale="X2")
    names = [f"C(monat)[T.{m}]" for m in range(2, 13)]
    beta = np.concatenate([[0.0], model.params[names].to_numpy()])
    cov = np.zeros((12, 12))
    cov[1:, 1:] = model.cov_params().loc[names, names].to_numpy()
    centered = beta - beta.mean()
    rows = []
    for m in range(12):
        contrast = -np.full(12, 1 / 12)
        contrast[m] += 1
        se = float(np.sqrt(contrast @ cov @ contrast))
        rows.append({
            "monat": m + 1,
            "index": float(np.exp(centered[m])),
            "unten": float(np.exp(centered[m] - 1.96 * se)),
            "oben": float(np.exp(centered[m] + 1.96 * se)),
        })
    return {"jahre": years, "monate": rows, "dispersion": float(model.scale)}


def stl_decomposition(monthly: pl.DataFrame) -> dict:
    start, end = STL_RANGE
    grid = pl.DataFrame({"jahr": [y for y in range(start, end + 1) for _ in range(12)], "monat": list(range(1, 13)) * (end - start + 1)})
    grid = grid.with_columns(pl.col("jahr").cast(pl.Int32), pl.col("monat").cast(pl.Int8))
    series = grid.join(monthly.with_columns(pl.col("monat").cast(pl.Int8)), on=["jahr", "monat"], how="left").fill_null(0)
    fit = STL(series["n"].to_numpy().astype(float), period=12, robust=True).fit()
    seasonal_by_month = [float(np.mean(fit.seasonal[m::12])) for m in range(12)]
    return {
        "zeitraum": [start, end],
        "jahr": series["jahr"].to_list(),
        "monat": series["monat"].to_list(),
        "beobachtet": series["n"].to_list(),
        "trend": fit.trend.tolist(),
        "saison": fit.seasonal.tolist(),
        "rest": fit.resid.tolist(),
        "saison_mittel_je_monat": seasonal_by_month,
    }


def date_conflicts(df: pl.DataFrame) -> pl.DataFrame | None:
    if "date_archive_conflict" not in df.columns:
        return None
    series = pl.col("archive_series") if "archive_series" in df.columns else pl.lit("?")
    return (
        df.filter(pl.col("date_archive_conflict").fill_null(False))
        .group_by(series.alias("serie"), maintain_order=True)
        .agg(pl.len().alias("n"), pl.col("archive_id").n_unique().alias("listen"))
        .sort("n", descending=True)
    )


def conflict_summary(df: pl.DataFrame) -> dict | None:
    if "date_archive_conflict" not in df.columns:
        return None
    return {
        "zeilen": int(df["date_archive_conflict"].fill_null(False).sum()),
        "korrigiert": int(df["departure_date_corrected"].is_not_null().sum()),
    }


def duplicate_summary(df: pl.DataFrame) -> dict | None:
    if "dup_candidate" not in df.columns:
        return None
    flagged = df.filter(pl.col("dup_candidate").fill_null(False))
    return {
        "zeilen": len(flagged),
        "gruppen": flagged["dup_group"].n_unique(),
        "als_doppelt_vermerkt": int(df["notes_doppelt"].fill_null(False).sum()) if "notes_doppelt" in df.columns else None,
    }


def outside_range(df: pl.DataFrame) -> int:
    return int(df.filter(pl.col("jahr") > 1939).height)


def decade(df: pl.DataFrame) -> pl.DataFrame:
    return df.with_columns(((pl.col("jahr") // 10) * 10).alias("jahrzehnt"))


def run(df: pl.DataFrame) -> dict:
    yearly = yearly_counts(df)
    monthly = monthly_counts(df)
    by_year = missingness(df, "jahr")
    by_decade = missingness(decade(df), "jahrzehnt")
    series = archive_series(df)
    season = seasonal_index(monthly)
    season_by_kind = {
        kind: seasonal_index(monthly_counts(df.filter(pl.col("reiseart") == kind)))
        for kind in ["Überfahrt", "US-Staatsangehörige"]
    }
    stl = stl_decomposition(monthly)
    conflicts = date_conflicts(df)

    write_table("m1_jahre", yearly)
    write_table("m1_fehlwerte_jahrzehnt", by_decade)
    write_table("m1_archivserien", series)
    write_web_json("quellen", {
        "jahre": yearly,
        "monate": monthly,
        "luecken": gaps(yearly),
        "fehlwerte": {"spalten": list(MISSINGNESS_COLUMNS.values()), "jahre": by_year},
        "archivserien": series,
        "saison": season,
        "saison_nach_reiseart": season_by_kind,
        "stl": stl,
        "ohne_datum": int(df["jahr"].is_null().sum()),
        "nach_1939": outside_range(df),
        "datumskonflikte": conflict_summary(df),
        "dubletten": duplicate_summary(df),
    })
    return {
        "yearly": yearly,
        "by_decade": by_decade,
        "series": series,
        "season": season,
        "season_by_kind": season_by_kind,
        "stl": stl,
        "conflicts": conflicts,
        "conflict_summary": conflict_summary(df),
        "duplicates": duplicate_summary(df),
        "after_1939": outside_range(df),
        "undated": int(df["jahr"].is_null().sum()),
        "gaps": gaps(yearly),
    }
