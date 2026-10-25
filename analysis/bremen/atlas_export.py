import json

import numpy as np
import polars as pl

from .codes import KLDB_SECTORS_SHORT
from .export import clean
from .m3_geografie import CORRIDOR_CATEGORIES, haversine_km
from .paths import WEB_DATA

ATLAS = WEB_DATA / "atlas"
BREMEN = {"name": "Bremen", "lat": 53.0758196, "lon": 8.8071646}
EASTERN_EUROPE = ["PL", "UA", "RO", "HU", "SK", "CZ", "LT", "LV", "EE", "BY", "RU", "RS", "HR", "SI", "BA", "BG", "MD"]
COORDINATE_DIGITS = 3


def write(name: str, payload: dict) -> None:
    ATLAS.mkdir(parents=True, exist_ok=True)
    text = json.dumps(clean(payload), ensure_ascii=False, separators=(",", ":"))
    (ATLAS / f"{name}.json").write_text(text, encoding="utf-8")


def emigrants(df: pl.DataFrame) -> pl.DataFrame:
    return df.filter(pl.col("reiseart") == "Überfahrt", pl.col("jahr").is_between(1830, 1939))


def place_year_counts(df: pl.DataFrame, name: str, lat: str, lon: str) -> tuple[dict, dict]:
    rounded = df.with_columns(pl.col(lat).round(COORDINATE_DIGITS), pl.col(lon).round(COORDINATE_DIGITS))
    places = (
        rounded.group_by(lat, lon)
        .agg(pl.col(name).mode().first().alias("name"), pl.len().alias("n"))
        .sort("n", descending=True)
        .with_row_index("i")
    )
    counts = rounded.join(places.select(lat, lon, "i"), on=[lat, lon]).group_by("i", "jahr").agg(pl.len().alias("n")).sort("i", "jahr")
    return (
        {"name": places["name"].to_list(), "lat": places[lat].to_list(), "lon": places[lon].to_list()},
        {"i": counts["i"].to_list(), "jahr": counts["jahr"].to_list(), "n": counts["n"].to_list()},
    )


def baseline(df: pl.DataFrame) -> dict:
    base = emigrants(df)
    origins, origin_counts = place_year_counts(base.filter(pl.col("herkunft_geo_precision") == "ort"), "herkunft_ort", "herkunft_lat", "herkunft_lon")
    years = base.group_by("jahr").agg(pl.len().alias("n")).sort("jahr")
    return {
        "orte": origins,
        "zaehlung": origin_counts,
        "jahre": {"jahr": years["jahr"].to_list(), "n": years["n"].to_list()},
    }


def ports(df: pl.DataFrame) -> dict:
    located = df.filter(pl.col("ankunft_lat").is_not_null(), pl.col("port_of_arrival_cleaned").is_not_null())
    table = (
        located.group_by("port_of_arrival_cleaned")
        .agg(
            pl.col("ankunft_lat").first().alias("lat"),
            pl.col("ankunft_lon").first().alias("lon"),
            pl.col("hafen_region").drop_nulls().first().alias("region") if "hafen_region" in df.columns else pl.lit(None).alias("region"),
            pl.len().alias("n"),
        )
        .sort("n", descending=True)
    )
    return {
        "bremen": BREMEN,
        "haefen": {"name": table["port_of_arrival_cleaned"].to_list(), "lat": table["lat"].to_list(), "lon": table["lon"].to_list(), "region": table["region"].to_list(), "n": table["n"].to_list()},
    }


def corridors(geografie: dict) -> dict:
    chained = geografie["corridors"].filter("kettenmigration").with_row_index("id")
    rows = []
    for row in chained.iter_rows(named=True):
        years, counts = np.unique(np.array(row["jahre_der_gruppen"]), return_counts=True)
        rows.append({
            "id": row["id"],
            "herkunft": row["herkunft_ort"],
            "herkunft_land": row["herkunft_land_heute"],
            "herkunft_lat": row["herkunft_lat"],
            "herkunft_lon": row["herkunft_lon"],
            "ziel": row["ziel_ort_gruppe"],
            "ziel_land": row["ziel_land"],
            "ziel_lat": row["ziel_lat"],
            "ziel_lon": row["ziel_lon"],
            "gruppen": row["y"],
            "personen": row["personen"],
            "jahrgaenge": row["jahre"],
            "von": row["erstes_jahr"],
            "bis": row["letztes_jahr"],
            "z": row["z"],
            "pmi": row["pmi"],
            "beruf": row["haeufigster_beruf"],
            "kategorie": row["kategorie"],
            "frauenanteil": row["frauenanteil"],
            "familienanteil": row["anteil_familiengruppen"],
            "jahre": [[int(y), int(c)] for y, c in zip(years, counts)],
        })
    return {"kategorien": CORRIDOR_CATEGORIES, "korridore": rows}


def share_in(df: pl.DataFrame, column: str, values: list[str], period: str) -> float:
    part = df.filter(pl.col("zeitraum") == period, pl.col(column).is_not_null())
    return float(part[column].is_in(values).mean())


def top_regions(df: pl.DataFrame, period: str, n: int = 3) -> list[dict]:
    part = df.filter(pl.col("zeitraum") == period, pl.col("state_or_province_cleaned").is_not_null())
    counts = part.group_by("state_or_province_cleaned").len().sort("len", descending=True).head(n)
    total = len(part)
    return [{"name": r["state_or_province_cleaned"], "anteil": r["len"] / total} for r in counts.iter_rows(named=True)]


def chapter_numbers(df: pl.DataFrame, results: dict) -> dict:
    base = emigrants(df)
    located = base.filter(pl.col("herkunft_geo_precision") == "ort")
    countries = base.filter(pl.col("herkunft_land_heute").is_not_null())
    sectors = results["berufe"]["sector_period"]
    agriculture = sectors.filter(pl.col("zeitraum") == "1907–1914", pl.col("sektor") == 1)["anteil"].item()
    chained = results["geografie"]["corridors"].filter("kettenmigration")
    religious = chained.filter(pl.col("kategorie") == "Orden")
    trades = chained.filter(pl.col("kategorie") == "Handwerk und Industrie", pl.col("haeufigster_beruf") != "Hausfrau")
    shanghai = base.filter(pl.col("ziel_ort_gruppe") == "Shanghai")
    late = shanghai.filter(pl.col("jahr") >= 1938)
    with_religion = late.filter(pl.col("religion_cleaned").is_not_null())
    centroids = results["geografie"]["yearly_centroids"]
    first, last = centroids.row(0, named=True), centroids.row(-1, named=True)
    shift = float(haversine_km(np.array([last["lat"]]), np.array([last["lon"]]), first["lat"], first["lon"])[0])
    corridor = lambda frame, n: [{"herkunft": r["herkunft_ort"], "ziel": r["ziel_ort_gruppe"], "personen": r["personen"], "von": r["erstes_jahr"], "bis": r["letztes_jahr"], "beruf": r["haeufigster_beruf"]} for r in frame.head(n).iter_rows(named=True)]
    return {
        "alle": {
            "eintraege": len(located),
            "orte": located.select(pl.struct(pl.col("herkunft_lat").round(3), pl.col("herkunft_lon").round(3))).n_unique(),
            "laender": located["herkunft_land_heute"].n_unique(),
            "korridore": len(chained),
            "ziele": base.filter(pl.col("ziel_geo_precision") == "ort").select(pl.struct("ziel_ort_gruppe", "ziel_land")).n_unique(),
        },
        "osten": {
            "anteil_osteuropa_vorkrieg": share_in(countries, "herkunft_land_heute", EASTERN_EUROPE, "1907–1914"),
            "anteil_osteuropa_dreissiger": share_in(countries, "herkunft_land_heute", EASTERN_EUROPE, "1930–1939"),
            "anteil_landwirtschaft_vorkrieg": agriculture,
            "regionen": top_regions(base, "1907–1914"),
        },
        "reich": {
            "anteil_de_zwanziger": share_in(countries, "herkunft_land_heute", ["DE"], "1919–1929"),
            "anteil_de_dreissiger": share_in(countries, "herkunft_land_heute", ["DE"], "1930–1939"),
            "regionen": top_regions(base, "1919–1929"),
        },
        "orden": {
            "korridore": len(religious),
            "personen": int(religious["personen"].sum()),
            "beispiele": corridor(religious, 4),
        },
        "gewerbe": {"beispiele": corridor(trades, 4)},
        "shanghai": {
            "vor_1938": len(shanghai.filter(pl.col("jahr") < 1938)),
            "1938": len(shanghai.filter(pl.col("jahr") == 1938)),
            "1939": len(shanghai.filter(pl.col("jahr") == 1939)),
            "mit_religion": len(with_religion),
            "mosaisch": len(with_religion.filter(pl.col("religion_cleaned") == "mosaisch")),
            "herkunft": [{"name": r["herkunft_ort"], "n": r["len"]} for r in late.filter(pl.col("herkunft_ort").is_not_null(), pl.col("herkunft_ort") != "Shanghai").group_by("herkunft_ort").len().sort("len", descending=True).head(3).iter_rows(named=True)],
        },
        "schwerpunkt": {
            "von": {"jahr": first["jahr"], "lat": first["lat"], "lon": first["lon"]},
            "bis": {"jahr": last["jahr"], "lat": last["lat"], "lon": last["lon"]},
            "km": shift,
        },
    }


def run(df: pl.DataFrame, results: dict) -> dict:
    if not results["geografie"].get("available"):
        return {"available": False}
    write("basis", baseline(df))
    write("haefen", ports(df))
    write("korridore", corridors(results["geografie"]))
    write("kapitel", chapter_numbers(df, results))
    write("sektoren", {str(k): v for k, v in KLDB_SECTORS_SHORT.items()})
    return {"available": True}
