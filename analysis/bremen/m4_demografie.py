import polars as pl

from .codes import PERIODS
from .export import write_table, write_web_json

AGE_BIN = 5
OLDEST_BIN = 80
GROUP_TYPES = ["allein", "zu zweit", "Familie/Gruppe 3+"]
TOP_NATIONALITIES = 10


def age_bin(age: pl.Expr) -> pl.Expr:
    return pl.min_horizontal((age // AGE_BIN) * AGE_BIN, pl.lit(OLDEST_BIN)).cast(pl.Int16)


def pyramid(df: pl.DataFrame, by: str) -> pl.DataFrame:
    return (
        df.filter(pl.col("alter").is_not_null(), pl.col("geschlecht").is_not_null(), pl.col(by).is_not_null())
        .group_by(by, age_bin(pl.col("alter")).alias("altersklasse"), "geschlecht", maintain_order=True)
        .agg(pl.len().alias("n"))
        .sort(by, "altersklasse", "geschlecht")
    )


def yearly_profile(df: pl.DataFrame) -> pl.DataFrame:
    return (
        df.filter(pl.col("jahr").is_not_null())
        .group_by("jahr", maintain_order=True)
        .agg(
            pl.len().alias("n"),
            (pl.col("geschlecht") == "m").sum().alias("maenner"),
            (pl.col("geschlecht") == "w").sum().alias("frauen"),
            pl.col("alter").median().alias("median_alter"),
            pl.col("alter").mean().alias("mittel_alter"),
            (pl.col("alter") < 15).mean().alias("anteil_kinder"),
            (pl.col("alter") >= 60).mean().alias("anteil_60plus"),
        )
        .with_columns((100 * pl.col("maenner") / pl.col("frauen")).alias("maenner_je_100_frauen"))
        .sort("jahr")
    )


def sector_profile(df: pl.DataFrame) -> pl.DataFrame:
    return (
        df.filter(pl.col("sektor").is_not_null(), pl.col("zeitraum").is_not_null())
        .group_by("zeitraum", "sektor", maintain_order=True)
        .agg(
            pl.len().alias("n"),
            pl.col("alter").median().alias("median_alter"),
            pl.col("alter").quantile(0.25).alias("q25_alter"),
            pl.col("alter").quantile(0.75).alias("q75_alter"),
            (pl.col("geschlecht") == "w").sum().alias("frauen"),
            pl.col("geschlecht").is_not_null().sum().alias("mit_geschlecht"),
        )
        .with_columns((pl.col("frauen") / pl.col("mit_geschlecht")).alias("frauenanteil"))
        .sort("zeitraum", "sektor")
    )


def marital_status(df: pl.DataFrame) -> pl.DataFrame:
    counts = (
        df.filter(pl.col("marital_status_cleaned").is_not_null(), pl.col("geschlecht").is_not_null(), pl.col("zeitraum").is_not_null(), pl.col("alter") >= 15)
        .group_by("zeitraum", "geschlecht", "marital_status_cleaned", maintain_order=True)
        .agg(pl.len().alias("n"))
    )
    return counts.with_columns((pl.col("n") / pl.col("n").sum().over("zeitraum", "geschlecht")).alias("anteil")).sort("zeitraum", "geschlecht", "marital_status_cleaned")


def persons_by_group_type(df: pl.DataFrame, by: str, type_column: str = "gruppe_typ") -> pl.DataFrame:
    counts = df.filter(pl.col(by).is_not_null()).group_by(by, type_column, maintain_order=True).agg(pl.len().alias("personen"))
    return counts.with_columns((pl.col("personen") / pl.col("personen").sum().over(by)).alias("anteil")).sort(by, type_column)


def groups_as_units(df: pl.DataFrame) -> pl.DataFrame:
    units = (
        df.filter(pl.col("zeitraum").is_not_null())
        .group_by("gruppe_id", maintain_order=True)
        .agg(
            pl.col("zeitraum").first(),
            pl.col("gruppe_typ").first(),
            pl.col("gruppe_groesse").first(),
            pl.col("gruppe_mit_kindern").first(),
        )
    )
    return (
        units.group_by("zeitraum", "gruppe_typ", maintain_order=True)
        .agg(
            pl.len().alias("gruppen"),
            pl.col("gruppe_groesse").mean().alias("mittlere_groesse"),
            pl.col("gruppe_mit_kindern").mean().alias("anteil_mit_kindern"),
        )
        .with_columns((pl.col("gruppen") / pl.col("gruppen").sum().over("zeitraum")).alias("anteil"))
        .sort("zeitraum", "gruppe_typ")
    )


def sensitivity(df: pl.DataFrame) -> pl.DataFrame:
    reconstructed = persons_by_group_type(df, "zeitraum").rename({"gruppe_typ": "typ", "anteil": "anteil_rekonstruiert"}).drop("personen")
    simple = persons_by_group_type(df, "zeitraum", "gruppe_typ_einfach").rename({"gruppe_typ_einfach": "typ", "anteil": "anteil_einfach"}).drop("personen")
    return reconstructed.join(simple, on=["zeitraum", "typ"], how="full", coalesce=True).sort("zeitraum", "typ")


def group_type_by_nationality(df: pl.DataFrame) -> pl.DataFrame:
    top = df.group_by("nationality_cleaned", maintain_order=True).len().drop_nulls().sort("len", descending=True).head(TOP_NATIONALITIES)["nationality_cleaned"]
    subset = df.filter(pl.col("nationality_cleaned").is_in(top.implode()), pl.col("zeitraum").is_in(["1919–1929", "1930–1939"]))
    return persons_by_group_type(subset, "nationality_cleaned")


def largest_groups(df: pl.DataFrame, n: int = 12) -> pl.DataFrame:
    return (
        df.filter(pl.col("gruppe_groesse") >= 8)
        .group_by("gruppe_id", maintain_order=True)
        .agg(
            pl.col("last_name").first().alias("nachname"),
            pl.len().alias("personen"),
            pl.col("ship_cleaned").first().alias("schiff"),
            pl.col("abfahrt").first(),
            pl.col("previous_residence").drop_nulls().first().alias("wohnort"),
            pl.col("emigration_destination").drop_nulls().first().alias("ziel"),
            pl.col("alter").min().alias("juengste"),
            pl.col("alter").max().alias("aelteste"),
        )
        .sort("personen", descending=True)
        .head(n)
    )


def run(df: pl.DataFrame) -> dict:
    base = df.filter(pl.col("reiseart") == "Überfahrt")
    us = df.filter(pl.col("reiseart") == "US-Staatsangehörige")
    pyramids = pyramid(base, "zeitraum")
    pyramid_us = pyramid(us.with_columns(pl.lit("US-Staatsangehörige").alias("gruppe")), "gruppe")
    yearly = yearly_profile(base)
    yearly_all = yearly_profile(df)
    sectors = sector_profile(base)
    marital = marital_status(base)
    persons_year = persons_by_group_type(base, "jahr")
    persons_period = persons_by_group_type(base, "zeitraum")
    units = groups_as_units(base)
    check = sensitivity(base)
    by_nationality = group_type_by_nationality(base)

    write_table("m4_pyramiden", pyramids)
    write_table("m4_jahre", yearly)
    write_table("m4_sektoren", sectors)
    write_table("m4_gruppen_personen", persons_period)
    write_table("m4_gruppen_einheiten", units)
    write_table("m4_gruppen_sensitivitaet", check)
    write_web_json("demografie", {
        "zeitraeume": [label for label, _, _ in PERIODS],
        "pyramiden": pyramids,
        "pyramide_us": pyramid_us,
        "jahre": yearly,
        "jahre_alle": yearly_all,
        "sektoren": sectors,
        "familienstand": marital,
        "gruppen_jahr": persons_year,
        "gruppen_zeitraum": persons_period,
        "gruppen_einheiten": units,
        "gruppen_sensitivitaet": check,
        "gruppen_nationalitaet": by_nationality,
    })
    return {
        "pyramids": pyramids,
        "yearly": yearly,
        "sectors": sectors,
        "marital": marital,
        "persons_period": persons_period,
        "units": units,
        "sensitivity": check,
        "by_nationality": by_nationality,
        "largest": largest_groups(base),
        "alphabetical_lists": df.filter(pl.col("liste_alphabetisch"))["liste"].n_unique(),
        "us_median_age": us["alter"].median(),
        "base_median_age": base["alter"].median(),
    }
