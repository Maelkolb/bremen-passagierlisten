import polars as pl

from .codes import KLDB_SECTORS_SHORT, TRAINING_LEVELS
from .export import write_web_json
from .paths import WEB_DATA

SANKEY_PORTS = ["New York", "Buenos Aires", "Baltimore", "Halifax", "Rio de Janeiro", "Santos", "Galveston"]
PARQUET_ROW_GROUP = 64_000
EXCERPT_ERAS = [(1830, 1860), (1907, 1914), (1920, 1929), (1930, 1937), (1938, 1939)]
EXCERPTS_PER_ERA = 2
EXCERPT_ROWS = 12

WERKBANK_COLUMNS = {
    "id": "id",
    "archive_id": "liste",
    "abfahrt": "abfahrt",
    "jahr": "jahr",
    "ship_cleaned": "schiff",
    "agent_cleaned": "reederei",
    "port_of_arrival_cleaned": "ankunftshafen",
    "travel_class_cleaned": "klasse",
    "nr_liste": "nr",
    "last_name": "nachname",
    "first_name": "vorname",
    "nachname_norm": "nachname_norm",
    "nachname_phonetik": "phonetik",
    "geschlecht": "geschlecht",
    "alter": "alter",
    "marital_status_cleaned": "familienstand",
    "nationality_cleaned": "staatsangehoerigkeit",
    "previous_residence": "wohnort",
    "state_or_province_cleaned": "region",
    "herkunft_ort": "herkunft_ort",
    "herkunft_land_heute": "herkunft_land",
    "herkunft_lat": "herkunft_lat",
    "herkunft_lon": "herkunft_lon",
    "herkunft_geo_precision": "herkunft_genauigkeit",
    "herkunft_sicher": "herkunft_sicher",
    "occupation": "beruf",
    "occupation_cleaned": "beruf_norm",
    "hisco": "hisco",
    "sektor": "sektor",
    "niveau": "niveau",
    "emigration_destination": "ziel",
    "ziel_ort": "ziel_ort",
    "ziel_ort_gruppe": "ziel_ort_gruppe",
    "ziel_land": "ziel_land",
    "ziel_lat": "ziel_lat",
    "ziel_lon": "ziel_lon",
    "ziel_geo_precision": "ziel_genauigkeit",
    "ziel_sicher": "ziel_sicher",
    "US_state_cleaned": "us_staat",
    "reiseart": "reiseart",
    "gruppe_id": "gruppe_id",
    "gruppe_groesse": "gruppe_groesse",
    "gruppe_typ": "gruppe_typ",
    "religion_cleaned": "religion",
    "relative": "angehoerige",
    "reference_person": "kontaktperson",
    "notes": "bemerkung",
}


def kennzahlen(df: pl.DataFrame) -> dict:
    dated = df.filter(pl.col("jahr").is_not_null())
    places = df.filter(pl.col("herkunft_geo_precision") == "ort")["herkunft_ort"].n_unique() if "herkunft_geo_precision" in df.columns else None
    return {
        "datensaetze": len(df),
        "erstes_jahr": int(dated["jahr"].min()),
        "letztes_jahr": int(dated.filter(pl.col("jahr") <= 1939)["jahr"].max()),
        "jahre_mit_listen": int(dated.filter(pl.col("jahr") <= 1939)["jahr"].n_unique()),
        "schiffe": df["ship_cleaned"].n_unique(),
        "reisen": df.select(pl.struct("ship_cleaned", "abfahrt").n_unique()).item(),
        "listen": df["archive_id"].n_unique(),
        "berufe": df["occupation_cleaned"].n_unique(),
        "nachnamen": df["last_name"].n_unique(),
        "wohnorte_schreibungen": df["previous_residence"].n_unique(),
        "herkunftsorte": places,
        "staatsangehoerigkeiten": df["nationality_cleaned"].n_unique(),
        "ankunftshaefen": df["port_of_arrival_cleaned"].n_unique(),
        "reiseart": dict(df.group_by("reiseart", maintain_order=True).len().iter_rows()),
    }


def sankey(df: pl.DataFrame) -> dict:
    base = df.filter(pl.col("reiseart") == "Überfahrt", pl.col("sektor").is_not_null(), pl.col("zeitraum").is_not_null())
    flows = base.with_columns(
        pl.col("sektor").replace_strict(KLDB_SECTORS_SHORT, return_dtype=pl.String).alias("sektor_name"),
        pl.col("niveau").replace_strict(TRAINING_LEVELS, default=None, return_dtype=pl.String).fill_null("ohne Angabe").alias("niveau_name"),
        pl.when(pl.col("port_of_arrival_cleaned").is_in(SANKEY_PORTS)).then(pl.col("port_of_arrival_cleaned")).otherwise(pl.lit("Sonstige Häfen")).alias("hafen"),
    ).group_by("zeitraum", "sektor_name", "niveau_name", "hafen", maintain_order=True).agg(pl.len().alias("n")).sort("n", descending=True)
    return {
        "stufen": ["Zeitraum", "Berufsbereich", "Anforderungsniveau", "Zielhafen"],
        "fluesse": {"zeitraum": flows["zeitraum"].to_list(), "sektor": flows["sektor_name"].to_list(), "niveau": flows["niveau_name"].to_list(), "hafen": flows["hafen"].to_list(), "n": flows["n"].to_list()},
        "n": int(flows["n"].sum()),
    }


UNCERTAIN_METHODS = ["fuzzy", "praefix"]


def certainty(prefix: str) -> pl.Expr:
    return (
        (pl.col(f"{prefix}_geo_precision") == "ort")
        & ~pl.col(f"{prefix}_geo_method").is_in(UNCERTAIN_METHODS).fill_null(False)
        & ~pl.col(f"{prefix}_geo_ambiguous").fill_null(False)
    ).fill_null(False).alias(f"{prefix}_sicher")


def werkbank_table(df: pl.DataFrame) -> pl.DataFrame:
    df = df.with_columns([certainty(prefix) for prefix in ["herkunft", "ziel"] if f"{prefix}_geo_method" in df.columns])
    present = {source: target for source, target in WERKBANK_COLUMNS.items() if source in df.columns}
    table = df.select([pl.col(s).alias(t) for s, t in present.items()]).with_columns(
        pl.col("id").cast(pl.Int32),
        pl.col("jahr").cast(pl.Int16),
        pl.col("alter").cast(pl.Int16),
        pl.col("nr").cast(pl.Int32),
        pl.col("gruppe_id").cast(pl.Int32),
    )
    for column in ["herkunft_lat", "herkunft_lon", "ziel_lat", "ziel_lon"]:
        if column in table.columns:
            table = table.with_columns(pl.col(column).cast(pl.Float32))
    return table.sort(["abfahrt", "liste", "id"], nulls_last=True)


def werkbank_parquet(table: pl.DataFrame) -> tuple[int, int]:
    path = WEB_DATA / "passagiere.parquet"
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    table.write_parquet(path, compression="zstd", compression_level=19, row_group_size=PARQUET_ROW_GROUP, statistics=True)
    return path.stat().st_size, len(table.columns)


def list_excerpts(table: pl.DataFrame) -> list[dict]:
    complete = ["vorname", "alter", "beruf", "wohnort", "ziel"]
    crossings = table.filter(pl.col("reiseart") == "Überfahrt")
    candidates = (
        crossings.group_by("liste", maintain_order=True)
        .agg(
            pl.len().alias("n"),
            pl.col("jahr").first(),
            pl.mean_horizontal([pl.col(c).is_not_null().mean() for c in complete]).alias("vollstaendig"),
            (pl.col("gruppe_groesse") > 1).any().alias("gruppen"),
            pl.col("wohnort").n_unique().alias("orte"),
        )
        .filter((pl.col("n") >= EXCERPT_ROWS + 2) & pl.col("gruppen"))
        .sort(["vollstaendig", "orte", "liste"], descending=[True, True, False])
    )
    chosen = [
        name
        for first, last in EXCERPT_ERAS
        for name in candidates.filter(pl.col("jahr").is_between(first, last))["liste"].head(EXCERPTS_PER_ERA).to_list()
    ]
    excerpts = []
    for name in chosen:
        rows = crossings.filter(pl.col("liste") == name).sort("id")
        head = rows.row(0, named=True)
        excerpts.append({
            "liste": name,
            "schiff": head["schiff"],
            "abfahrt": head["abfahrt"].isoformat() if head["abfahrt"] else None,
            "jahr": head["jahr"],
            "hafen": head["ankunftshafen"],
            "eintraege": len(rows),
            "zeilen": rows.head(EXCERPT_ROWS).select(
                "id", "nr", "nachname", "vorname", "alter", "geschlecht", "beruf", "wohnort", "ziel",
                pl.when(pl.col("gruppe_groesse") > 1).then(pl.col("gruppe_id")).alias("gruppe"),
            ).to_dicts(),
        })
    return excerpts


def run(df: pl.DataFrame) -> dict:
    figures = kennzahlen(df)
    write_web_json("kennzahlen", figures)
    write_web_json("sankey", sankey(df))
    table = werkbank_table(df)
    size, columns = werkbank_parquet(table)
    write_web_json("listen", list_excerpts(table))
    return {"kennzahlen": figures, "parquet_bytes": size, "parquet_columns": columns}
