import numpy as np
import polars as pl

from .export import write_table, write_web_json
from .paths import ENRICHMENT

EARTH_RADIUS_KM = 6371.0
EUROPE = {"lat": (34.0, 72.0), "lon": (-25.0, 45.0)}
MIN_YEARLY_POINTS = 500
PRIOR_STRENGTH = 500.0
MIN_CORRIDOR_GROUPS = 5
MIN_CORRIDOR_YEARS = 3
MIN_Z = 3.0
UNCERTAIN_METHODS = ["fuzzy", "praefix"]
RELIGIOUS_OCCUPATION = r"(?i)ordens|nonne|kloster|novizin|missionar|pater|priester|^schwester$|^rel\.?\s?schwester"
RELIGIOUS_MAJORITY = 0.5


def has_origin(df: pl.DataFrame) -> bool:
    return "herkunft_lat" in df.columns


def has_destination(df: pl.DataFrame) -> bool:
    return "ziel_lat" in df.columns


def emigrants(df: pl.DataFrame) -> pl.DataFrame:
    return df.filter(pl.col("reiseart") == "Überfahrt", pl.col("zeitraum").is_not_null())


def precision_coverage(df: pl.DataFrame, column: str) -> pl.DataFrame:
    counts = df.group_by("zeitraum", pl.col(column).fill_null("nicht zugeordnet").alias("genauigkeit")).agg(pl.len().alias("n"))
    return counts.with_columns((pl.col("n") / pl.col("n").sum().over("zeitraum")).alias("anteil")).sort("zeitraum", "genauigkeit")


def in_europe(lat: str, lon: str) -> pl.Expr:
    return pl.col(lat).is_between(*EUROPE["lat"]) & pl.col(lon).is_between(*EUROPE["lon"])


def european_points(df: pl.DataFrame) -> pl.DataFrame:
    return df.filter(
        pl.col("herkunft_geo_precision") == "ort",
        pl.col("herkunft_lat").is_between(*EUROPE["lat"]),
        pl.col("herkunft_lon").is_between(*EUROPE["lon"]),
    )


def spherical_centroid(lat: np.ndarray, lon: np.ndarray) -> tuple[float, float, float]:
    phi, lam = np.radians(lat), np.radians(lon)
    xyz = np.stack([np.cos(phi) * np.cos(lam), np.cos(phi) * np.sin(lam), np.sin(phi)], axis=1)
    mean = xyz.mean(axis=0)
    c_lat = float(np.degrees(np.arctan2(mean[2], np.hypot(mean[0], mean[1]))))
    c_lon = float(np.degrees(np.arctan2(mean[1], mean[0])))
    distances = haversine_km(lat, lon, c_lat, c_lon)
    return c_lat, c_lon, float(np.sqrt(np.mean(distances**2)))


def haversine_km(lat: np.ndarray, lon: np.ndarray, lat0: float, lon0: float) -> np.ndarray:
    phi, phi0 = np.radians(lat), np.radians(lat0)
    dphi, dlam = phi - phi0, np.radians(lon - lon0)
    a = np.sin(dphi / 2) ** 2 + np.cos(phi) * np.cos(phi0) * np.sin(dlam / 2) ** 2
    return 2 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(a))


def centroids(points: pl.DataFrame, by: str) -> pl.DataFrame:
    rows = []
    for key, part in points.group_by(by):
        if len(part) < MIN_YEARLY_POINTS:
            continue
        lat, lon, spread = spherical_centroid(part["herkunft_lat"].to_numpy(), part["herkunft_lon"].to_numpy())
        rows.append({by: key[0], "n": len(part), "lat": lat, "lon": lon, "standarddistanz_km": spread})
    return pl.DataFrame(rows).sort(by)


def shares_of(df: pl.DataFrame, column: str, top: int) -> pl.DataFrame:
    counts = df.filter(pl.col(column).is_not_null()).group_by("zeitraum", column).agg(pl.len().alias("n"))
    counts = counts.with_columns((pl.col("n") / pl.col("n").sum().over("zeitraum")).alias("anteil"))
    return counts.sort("n", descending=True).group_by("zeitraum").head(top).sort("zeitraum", "n", descending=[False, True])


def group_units(df: pl.DataFrame) -> pl.DataFrame:
    located = df.filter(
        pl.col("herkunft_geo_precision") == "ort",
        pl.col("ziel_geo_precision") == "ort",
        in_europe("herkunft_lat", "herkunft_lon"),
        ~in_europe("ziel_lat", "ziel_lon"),
        ~pl.col("herkunft_geo_method").is_in(UNCERTAIN_METHODS),
        ~pl.col("ziel_geo_method").is_in(UNCERTAIN_METHODS),
        ~pl.col("herkunft_geo_ambiguous").fill_null(False),
        ~pl.col("ziel_geo_ambiguous").fill_null(False),
    )
    return located.group_by("gruppe_id").agg(
        pl.col("herkunft_ort").first(),
        pl.col("herkunft_land_heute").first(),
        pl.col("herkunft_lat").first(),
        pl.col("herkunft_lon").first(),
        pl.col("ziel_ort_gruppe").first(),
        pl.col("ziel_land").first(),
        pl.col("ziel_lat").first(),
        pl.col("ziel_lon").first(),
        pl.col("jahr").first(),
        pl.col("zeitraum").first(),
        pl.len().alias("personen"),
        pl.col("occupation_cleaned").drop_nulls().first().alias("beruf"),
        (pl.col("geschlecht") == "w").sum().alias("frauen"),
        pl.col("occupation_cleaned").str.contains(RELIGIOUS_OCCUPATION).fill_null(False).sum().alias("ordensleute"),
    )


def log_odds_with_prior(pairs: pl.DataFrame, origin: str, target: str) -> pl.DataFrame:
    total = float(pairs["y"].sum())
    pairs = pairs.with_columns(
        pl.col("y").sum().over(origin).alias("n_i"),
        pl.col("y").sum().over(target).alias("y_j"),
    )
    pairs = pairs.with_columns((PRIOR_STRENGTH * pl.col("y_j") / total).alias("alpha_j"))
    y, n_i, y_j, alpha = (pairs[c].to_numpy().astype(float) for c in ["y", "n_i", "y_j", "alpha_j"])
    y_rest, n_rest = y_j - y, total - n_i
    delta = np.log((y + alpha) / (n_i + PRIOR_STRENGTH - y - alpha)) - np.log((y_rest + alpha) / (n_rest + PRIOR_STRENGTH - y_rest - alpha))
    z = delta / np.sqrt(1 / (y + alpha) + 1 / (y_rest + alpha))
    pmi = np.log2(y * total / (n_i * y_j))
    return pairs.with_columns(pl.Series("log_odds", delta), pl.Series("z", z), pl.Series("pmi", pmi))


def corridors(units: pl.DataFrame) -> pl.DataFrame:
    pairs = units.group_by("herkunft_ort", "herkunft_land_heute", "ziel_ort_gruppe", "ziel_land").agg(
        pl.len().alias("y"),
        pl.col("personen").sum(),
        pl.col("jahr").n_unique().alias("jahre"),
        pl.col("jahr").min().alias("erstes_jahr"),
        pl.col("jahr").max().alias("letztes_jahr"),
        pl.col("herkunft_lat").first(),
        pl.col("herkunft_lon").first(),
        pl.col("ziel_lat").first(),
        pl.col("ziel_lon").first(),
        pl.col("beruf").drop_nulls().mode().first().alias("haeufigster_beruf"),
        (pl.col("frauen").sum() / pl.col("personen").sum()).alias("frauenanteil"),
        (pl.col("ordensleute").sum() / pl.col("personen").sum()).alias("anteil_ordensleute"),
    )
    pairs = pairs.with_columns(pl.concat_str(["herkunft_ort", "herkunft_land_heute"], separator="|").alias("origin_key"))
    scored = log_odds_with_prior(pairs, "origin_key", "ziel_ort_gruppe")
    chained = (pl.col("y") >= MIN_CORRIDOR_GROUPS) & (pl.col("jahre") >= MIN_CORRIDOR_YEARS) & (pl.col("z") >= MIN_Z)
    return scored.with_columns(chained.alias("kettenmigration")).drop("origin_key").sort("z", descending=True)


def chain_share_by_period(units: pl.DataFrame, scored: pl.DataFrame) -> pl.DataFrame:
    chained = scored.filter("kettenmigration").select("herkunft_ort", "herkunft_land_heute", "ziel_ort_gruppe", pl.lit(True).alias("im_korridor"))
    marked = units.join(chained, on=["herkunft_ort", "herkunft_land_heute", "ziel_ort_gruppe"], how="left").with_columns(pl.col("im_korridor").fill_null(False))
    return marked.group_by("zeitraum").agg(pl.len().alias("gruppen"), pl.col("im_korridor").mean().alias("anteil_in_korridoren")).sort("zeitraum")


def region_countries() -> pl.DataFrame:
    path = ENRICHMENT / "region_geo.csv"
    if not path.exists():
        return pl.DataFrame(schema={"state_or_province_cleaned": pl.String, "region_land": pl.String})
    return pl.read_csv(path, infer_schema_length=0).select("state_or_province_cleaned", pl.col("land_heute").alias("region_land"))


def region_port_profile(df: pl.DataFrame) -> pl.DataFrame:
    units = df.filter(pl.col("state_or_province_cleaned").is_not_null(), pl.col("port_of_arrival_cleaned").is_not_null()).group_by("gruppe_id").agg(
        pl.col("state_or_province_cleaned").first().alias("region"),
        pl.col("port_of_arrival_cleaned").first().alias("hafen"),
        pl.col("hafen_land").first(),
    )
    pairs = units.group_by("region", "hafen").agg(pl.len().alias("y"), pl.col("hafen_land").first())
    scored = log_odds_with_prior(pairs, "region", "hafen")
    scored = scored.join(region_countries().rename({"state_or_province_cleaned": "region"}), on="region", how="left")
    home_port = (pl.col("region_land") == pl.col("hafen_land")).fill_null(False)
    return scored.filter(pl.col("y") >= 20, pl.col("z") >= MIN_Z, ~home_port).sort("z", descending=True)


def run(df: pl.DataFrame) -> dict:
    if not has_origin(df) or not has_destination(df):
        return {"available": False}
    base = emigrants(df)
    points = european_points(base)
    yearly_centroids = centroids(points, "jahr")
    period_centroids = centroids(points, "zeitraum")
    origin_countries = shares_of(base.filter(pl.col("herkunft_geo_precision").is_in(["ort", "region"])), "herkunft_land_heute", 12)
    regions = shares_of(base, "state_or_province_cleaned", 15)
    places = shares_of(base.filter(pl.col("herkunft_geo_precision") == "ort"), "herkunft_ort", 15)
    destinations = shares_of(base.filter(pl.col("ziel_geo_precision") == "ort"), "ziel_ort_gruppe", 15)
    units = group_units(base)
    scored = corridors(units)
    chain_share = chain_share_by_period(units, scored)
    region_ports = region_port_profile(base)
    coverage_origin = precision_coverage(base, "herkunft_geo_precision")
    coverage_destination = precision_coverage(base, "ziel_geo_precision")

    write_table("m3_schwerpunkte_jahr", yearly_centroids)
    write_table("m3_korridore", scored.filter(pl.col("y") >= MIN_CORRIDOR_GROUPS))
    write_table("m3_region_hafen", region_ports)
    write_web_json("geografie", {
        "abdeckung_herkunft": coverage_origin,
        "abdeckung_ziel": coverage_destination,
        "schwerpunkte_jahr": yearly_centroids,
        "schwerpunkte_zeitraum": period_centroids,
        "herkunftslaender": origin_countries,
        "regionen": regions,
        "orte": places,
        "ziele": destinations,
        "korridore": scored.filter("kettenmigration").head(60),
        "korridor_anteil": chain_share,
        "region_hafen": region_ports.head(40),
    })
    return {
        "available": True,
        "coverage_origin": coverage_origin,
        "coverage_destination": coverage_destination,
        "yearly_centroids": yearly_centroids,
        "period_centroids": period_centroids,
        "origin_countries": origin_countries,
        "regions": regions,
        "places": places,
        "destinations": destinations,
        "corridors": scored,
        "chain_share": chain_share,
        "region_ports": region_ports,
        "units": len(units),
    }
