import polars as pl

from .codes import KLDB_SECTORS_SHORT, TRAINING_LEVELS
from .export import write_web_json
from .paths import WEB_DATA

BREMEN = {"name": "Bremen", "lat": 53.0758196, "lon": 8.8071646}
SANKEY_PORTS = ["New York", "Buenos Aires", "Baltimore", "Halifax", "Rio de Janeiro", "Santos", "Galveston"]
PARQUET_ROW_GROUP = 64_000

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
    "occupation": "beruf",
    "occupation_cleaned": "beruf_norm",
    "hisco": "hisco",
    "sektor": "sektor",
    "niveau": "niveau",
    "emigration_destination": "ziel",
    "ziel_ort": "ziel_ort",
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
        "reiseart": dict(df.group_by("reiseart").len().iter_rows()),
    }


def index_of(values: pl.Series) -> dict:
    return {value: i for i, value in enumerate(values.to_list())}


def atlas(df: pl.DataFrame) -> dict:
    base = df.filter(pl.col("reiseart") == "Überfahrt", pl.col("jahr").is_not_null()).with_columns(pl.col("sektor").fill_null(-1))
    ports = (
        base.filter(pl.col("ankunft_lat").is_not_null())
        .group_by("port_of_arrival_cleaned")
        .agg(pl.col("ankunft_lat").first().alias("lat"), pl.col("ankunft_lon").first().alias("lon"), pl.len().alias("n"))
        .sort("n", descending=True)
    )
    port_index = index_of(ports["port_of_arrival_cleaned"])
    port_counts = (
        base.filter(pl.col("port_of_arrival_cleaned").is_in(ports["port_of_arrival_cleaned"].implode()))
        .group_by("port_of_arrival_cleaned", "jahr", "sektor").agg(pl.len().alias("n"))
        .with_columns(pl.col("port_of_arrival_cleaned").replace_strict(port_index, return_dtype=pl.Int32).alias("i"))
    )
    payload = {
        "bremen": BREMEN,
        "sektoren": {str(k): v for k, v in KLDB_SECTORS_SHORT.items()},
        "haefen": {"name": ports["port_of_arrival_cleaned"].to_list(), "lat": ports["lat"].to_list(), "lon": ports["lon"].to_list()},
        "hafen_zaehlung": {c: port_counts[c].to_list() for c in ["i", "jahr", "sektor", "n"]},
    }
    if "herkunft_lat" in df.columns:
        origins = point_layer(base.filter(pl.col("herkunft_geo_precision") == "ort"), "herkunft_ort", "herkunft_lat", "herkunft_lon")
        payload |= {"herkunft": origins[0], "herkunft_zaehlung": origins[1]}
    if "ziel_lat" in df.columns:
        targets = point_layer(base.filter(pl.col("ziel_geo_precision") == "ort"), "ziel_ort", "ziel_lat", "ziel_lon")
        payload |= {"ziele": targets[0], "ziel_zaehlung": targets[1]}
    return payload


def point_layer(df: pl.DataFrame, name: str, lat: str, lon: str) -> tuple[dict, dict]:
    rounded = df.with_columns(pl.col(lat).round(3), pl.col(lon).round(3))
    places = rounded.group_by(lat, lon).agg(pl.col(name).mode().first().alias("name"), pl.len().alias("n")).sort("n", descending=True)
    places = places.with_row_index("i")
    counts = rounded.join(places.select(lat, lon, "i"), on=[lat, lon]).group_by("i", "jahr", "sektor").agg(pl.len().alias("n")).sort("i", "jahr")
    return (
        {"name": places["name"].to_list(), "lat": places[lat].to_list(), "lon": places[lon].to_list()},
        {c: counts[c].to_list() for c in ["i", "jahr", "sektor", "n"]},
    )


def sankey(df: pl.DataFrame) -> dict:
    base = df.filter(pl.col("reiseart") == "Überfahrt", pl.col("sektor").is_not_null(), pl.col("zeitraum").is_not_null())
    flows = base.with_columns(
        pl.col("sektor").replace_strict(KLDB_SECTORS_SHORT, return_dtype=pl.String).alias("sektor_name"),
        pl.col("niveau").replace_strict(TRAINING_LEVELS, default=None, return_dtype=pl.String).fill_null("ohne Angabe").alias("niveau_name"),
        pl.when(pl.col("port_of_arrival_cleaned").is_in(SANKEY_PORTS)).then(pl.col("port_of_arrival_cleaned")).otherwise(pl.lit("Sonstige Häfen")).alias("hafen"),
    ).group_by("zeitraum", "sektor_name", "niveau_name", "hafen").agg(pl.len().alias("n")).sort("n", descending=True)
    return {
        "stufen": ["Zeitraum", "Berufsbereich", "Anforderungsniveau", "Zielhafen"],
        "fluesse": {"zeitraum": flows["zeitraum"].to_list(), "sektor": flows["sektor_name"].to_list(), "niveau": flows["niveau_name"].to_list(), "hafen": flows["hafen"].to_list(), "n": flows["n"].to_list()},
        "n": int(flows["n"].sum()),
    }


def werkbank_parquet(df: pl.DataFrame) -> tuple[int, int]:
    present = {source: target for source, target in WERKBANK_COLUMNS.items() if source in df.columns}
    table = df.select([pl.col(s).alias(t) for s, t in present.items()]).with_columns(
        pl.col("id").cast(pl.Int32),
        pl.col("jahr").cast(pl.Int16),
        pl.col("alter").cast(pl.Int16),
        pl.col("nr").cast(pl.Int32),
        pl.col("gruppe_id").cast(pl.Int32),
    )
    for column in ["herkunft_lat", "herkunft_lon"]:
        if column in table.columns:
            table = table.with_columns(pl.col(column).cast(pl.Float32))
    table = table.sort(["abfahrt", "liste", "id"], nulls_last=True)
    path = WEB_DATA / "passagiere.parquet"
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    table.write_parquet(path, compression="zstd", compression_level=19, row_group_size=PARQUET_ROW_GROUP, statistics=True)
    return path.stat().st_size, len(table.columns)


def run(df: pl.DataFrame) -> dict:
    figures = kennzahlen(df)
    write_web_json("kennzahlen", figures)
    write_web_json("atlas", atlas(df))
    write_web_json("sankey", sankey(df))
    size, columns = werkbank_parquet(df)
    return {"kennzahlen": figures, "parquet_bytes": size, "parquet_columns": columns}
