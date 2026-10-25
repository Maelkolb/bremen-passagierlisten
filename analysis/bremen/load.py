import hashlib
import urllib.request

import polars as pl

from .codes import KLDB_SECTORS_SHORT, PERIODS, TRAINING_LEVELS
from .gruppen import with_travel_groups
from .phonetik import koelner_phonetik
from .paths import ENRICHMENT, GEONAMES_CITIES, RAW_CSV, WORK, ZENODO_MD5, ZENODO_URL

PREPARED = WORK / "passagiere.parquet"
UMLAUT_FOLD = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "é": "e", "è": "e", "á": "a", "ó": "o", "í": "i", "ú": "u"}
CRUISE_PORT_NAMES = ["Gesellschaftsreise"]
CRUISE_NOTES = ["Irland-Englandfahrt", "Ostseefahrt", "Kreuzfahrt", "Rundreise"]
PORT_SHIFT_KM = 100


def ensure_raw_csv() -> None:
    if RAW_CSV.exists():
        return
    RAW_CSV.parent.mkdir(parents=True, exist_ok=True)
    partial = RAW_CSV.with_suffix(".part")
    urllib.request.urlretrieve(ZENODO_URL, partial)
    digest = hashlib.md5(partial.read_bytes()).hexdigest()
    if digest != ZENODO_MD5:
        raise RuntimeError(f"MD5 mismatch for downloaded CSV: {digest}")
    partial.rename(RAW_CSV)


def read_raw() -> pl.DataFrame:
    ensure_raw_csv()
    df = pl.read_csv(RAW_CSV, separator="@", infer_schema=False, quote_char=None)
    return df.with_columns(pl.all().str.strip_chars().replace("", None))


def period_expr(year: pl.Expr) -> pl.Expr:
    expr = pl.lit(None, dtype=pl.String)
    for label, start, end in reversed(PERIODS):
        expr = pl.when(year.is_between(start, end)).then(pl.lit(label)).otherwise(expr)
    return expr


def normalized_surname(col: pl.Expr) -> pl.Expr:
    folded = col.str.to_lowercase()
    for umlaut, replacement in UMLAUT_FOLD.items():
        folded = folded.str.replace_all(umlaut, replacement, literal=True)
    return folded.str.replace_all(r"[^a-z]", "")


def typed(df: pl.DataFrame) -> pl.DataFrame:
    to_float = lambda name: pl.col(name).cast(pl.Float64, strict=False)
    return df.with_columns(
        pl.col("id").cast(pl.Int64),
        pl.col("date_of_departure_cleaned").str.to_date(strict=False).alias("abfahrt"),
        to_float("age_cleaned").cast(pl.Int16).alias("alter"),
        pl.col("gender_cleaned").replace({"uneindeutig": None}).alias("geschlecht"),
        to_float("occupation_hisco_nr").cast(pl.Int32).alias("hisco"),
        to_float("occupation_sector").cast(pl.Int8).alias("sektor"),
        to_float("occupation_training_level").cast(pl.Int8).alias("niveau"),
        to_float("port_of_arrival_LAT").alias("ankunft_lat_quelle"),
        to_float("port_of_arrival_LON").alias("ankunft_lon_quelle"),
        to_float("nr").cast(pl.Int32, strict=False).alias("nr_quelle"),
        normalized_surname(pl.col("last_name")).alias("nachname_norm"),
    )


def with_labels(df: pl.DataFrame) -> pl.DataFrame:
    return df.with_columns(
        pl.col("sektor").replace_strict(KLDB_SECTORS_SHORT, default=None, return_dtype=pl.String).alias("sektor_name"),
        pl.col("niveau").replace_strict(TRAINING_LEVELS, default=None, return_dtype=pl.String).alias("niveau_name"),
    )


def with_phonetics(df: pl.DataFrame) -> pl.DataFrame:
    names = df.select(pl.col("last_name").unique().drop_nulls()).to_series().to_list()
    codes = pl.DataFrame({"last_name": names, "nachname_phonetik": [koelner_phonetik(n) for n in names]})
    return df.join(codes, on="last_name", how="left")


def join_optional(df: pl.DataFrame, file_name: str, keys: list[str], prefix: str) -> pl.DataFrame:
    path = ENRICHMENT / file_name
    if not path.exists():
        return df
    table = pl.read_parquet(path) if path.suffix == ".parquet" else pl.read_csv(path, infer_schema_length=0)
    table = table.drop([c for c in ["n_records"] if c in table.columns])
    generic = [c for c in table.columns if c.startswith("geo_") or c == "geonames_id"]
    table = table.rename({c: f"{prefix}_{c}" for c in generic})
    table = table.drop([c for c in table.columns if c in df.columns and c not in keys])
    table = table.with_columns([pl.col(k).cast(df.schema[k]) for k in keys]).unique(subset=keys, keep="first")
    return df.join(table, on=keys, how="left", nulls_equal=True)


def port_corrections() -> pl.DataFrame | None:
    ports_path = ENRICHMENT / "ankunftshafen.csv"
    if not ports_path.exists() or not GEONAMES_CITIES.exists():
        return None
    flagged = (
        pl.read_csv(ports_path, infer_schema_length=0)
        .filter(pl.col("koordinaten_hinweis").is_not_null())
        .with_columns(
            pl.col("koordinaten_hinweis").str.extract(r"^(\d+) km").cast(pl.Int32).alias("km"),
            pl.col("koordinaten_hinweis").str.extract(r"\((\d+)\)").cast(pl.Int64).alias("geonameid"),
        )
        .filter(pl.col("km") >= PORT_SHIFT_KM)
        .select("port_of_arrival_cleaned", "geonameid")
        .unique()
    )
    cities = pl.read_csv(GEONAMES_CITIES, separator="\t", has_header=False, quote_char=None, infer_schema=False).select(
        pl.col("column_0").cast(pl.Int64).alias("geonameid"),
        pl.col("column_4").cast(pl.Float64).alias("korrektur_lat"),
        pl.col("column_5").cast(pl.Float64).alias("korrektur_lon"),
    )
    return flagged.join(cities, on="geonameid").drop("geonameid")


def with_port_corrections(df: pl.DataFrame) -> pl.DataFrame:
    corrections = port_corrections()
    if corrections is None:
        return df
    return df.join(corrections, on="port_of_arrival_cleaned", how="left")


def with_enrichment(df: pl.DataFrame) -> pl.DataFrame:
    df = join_optional(df, "herkunft_geo.parquet", ["previous_residence", "state_or_province_cleaned", "nationality_cleaned"], "herkunft")
    df = join_optional(df, "ziel_geo.parquet", ["emigration_destination", "US_state_cleaned", "port_of_arrival_country"], "ziel")
    df = join_optional(df, "ankunftshafen.csv", ["port_of_arrival_cleaned", "port_of_arrival_country"], "hafen")
    df = join_optional(df, "sparse_cleaned.parquet", ["id"], "sparse")
    return with_port_corrections(df)


def with_resolved_fields(df: pl.DataFrame) -> pl.DataFrame:
    schema = df.schema
    date = pl.coalesce("departure_date_corrected", "abfahrt") if "departure_date_corrected" in schema else pl.col("abfahrt")
    nr = pl.coalesce("nr_int", "nr_quelle") if "nr_int" in schema else pl.col("nr_quelle")
    lat_sources = [c for c in ["korrektur_lat", "hafen_lat"] if c in schema]
    lon_sources = [c for c in ["korrektur_lon", "hafen_lon"] if c in schema]
    lat = pl.coalesce([pl.col(c).cast(pl.Float64, strict=False) for c in lat_sources] + [pl.col("ankunft_lat_quelle")])
    lon = pl.coalesce([pl.col(c).cast(pl.Float64, strict=False) for c in lon_sources] + [pl.col("ankunft_lon_quelle")])
    cruise = pl.col("port_of_arrival_cleaned").is_in(CRUISE_PORT_NAMES).fill_null(False)
    if "reise_typ" in schema:
        cruise = cruise | (pl.col("reise_typ") == "kreuzfahrt").fill_null(False)
    if "notes_reiseart" in schema:
        cruise = cruise | pl.col("notes_reiseart").is_in(CRUISE_NOTES).fill_null(False)
    df = df.with_columns(
        date.alias("abfahrt"),
        nr.cast(pl.Int32).alias("nr_liste"),
        lat.alias("ankunft_lat"),
        lon.alias("ankunft_lon"),
        cruise.fill_null(False).alias("ist_kreuzfahrt"),
    )
    return df.with_columns(
        pl.col("abfahrt").dt.year().alias("jahr"),
        pl.col("abfahrt").dt.month().alias("monat"),
        period_expr(pl.col("abfahrt").dt.year()).alias("zeitraum"),
        pl.when(pl.col("ist_kreuzfahrt")).then(pl.lit("Kreuzfahrt"))
        .when(pl.col("nationality_cleaned") == "USA").then(pl.lit("US-Staatsangehörige"))
        .otherwise(pl.lit("Überfahrt")).alias("reiseart"),
    )


def build_prepared() -> pl.DataFrame:
    df = read_raw()
    df = typed(df)
    df = with_labels(df)
    df = with_phonetics(df)
    df = with_enrichment(df)
    df = with_resolved_fields(df)
    return df


def prepared(rebuild: bool = False) -> pl.DataFrame:
    if PREPARED.exists() and not rebuild:
        return pl.read_parquet(PREPARED)
    df = with_travel_groups(build_prepared())
    PREPARED.parent.mkdir(parents=True, exist_ok=True)
    df.write_parquet(PREPARED)
    return df
