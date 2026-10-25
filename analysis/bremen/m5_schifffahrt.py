import numpy as np
import polars as pl

from .export import write_table, write_web_json

TOP_PORTS = 9
TOP_AGENTS = 6
TOP_SHIPS = 25
VOYAGE_SIZE_BINS = [1, 10, 50, 100, 250, 500, 1000, 1500, 2000, 3000]


def top_or_other(df: pl.DataFrame, column: str, n: int) -> pl.Expr:
    top = df.group_by(column).len().drop_nulls().sort("len", descending=True).head(n)[column]
    return pl.when(pl.col(column).is_in(top.implode())).then(pl.col(column)).otherwise(pl.lit("Sonstige"))


def yearly_shares(df: pl.DataFrame, column: str, n: int, name: str) -> pl.DataFrame:
    grouped = df.filter(pl.col("jahr").is_not_null()).with_columns(top_or_other(df, column, n).alias(name))
    counts = grouped.group_by("jahr", name).agg(pl.len().alias("n"))
    return counts.with_columns((pl.col("n") / pl.col("n").sum().over("jahr")).alias("anteil")).sort("jahr", name)


def voyages(df: pl.DataFrame) -> pl.DataFrame:
    return (
        df.filter(pl.col("abfahrt").is_not_null(), pl.col("ship_cleaned").is_not_null())
        .group_by("ship_cleaned", "abfahrt")
        .agg(
            pl.len().alias("passagiere"),
            pl.col("zeitraum").first(),
            pl.col("jahr").first(),
            pl.col("agent_cleaned").mode().first().alias("reederei"),
            pl.col("port_of_arrival_cleaned").mode().first().alias("hafen"),
            pl.col("ist_kreuzfahrt").any().alias("kreuzfahrt"),
        )
        .sort("abfahrt")
    )


def voyage_size_histogram(trips: pl.DataFrame) -> pl.DataFrame:
    edges = VOYAGE_SIZE_BINS + [10**6]
    rows = []
    for period in trips["zeitraum"].drop_nulls().unique().sort().to_list():
        sizes = trips.filter(pl.col("zeitraum") == period)["passagiere"].to_numpy()
        counts, _ = np.histogram(sizes, bins=edges)
        for low, high, count in zip(edges[:-1], edges[1:], counts):
            rows.append({"zeitraum": period, "von": low, "bis": high - 1, "reisen": int(count)})
    return pl.DataFrame(rows)


def voyage_stats(trips: pl.DataFrame) -> pl.DataFrame:
    return (
        trips.filter(pl.col("zeitraum").is_not_null())
        .group_by("zeitraum")
        .agg(
            pl.len().alias("reisen"),
            pl.col("passagiere").sum().alias("passagiere"),
            pl.col("passagiere").median().alias("median"),
            pl.col("passagiere").mean().alias("mittel"),
            pl.col("passagiere").quantile(0.9).alias("p90"),
            pl.col("passagiere").max().alias("maximum"),
        )
        .sort("zeitraum")
    )


def voyage_size_profile(trips: pl.DataFrame, small: int = 20, large: int = 500) -> pl.DataFrame:
    return (
        trips.filter(pl.col("zeitraum").is_not_null())
        .group_by("zeitraum")
        .agg(
            (pl.col("passagiere") < small).sum().alias("kleine_reisen"),
            (pl.col("passagiere") < small).mean().alias("anteil_kleine_reisen"),
            (pl.col("passagiere").filter(pl.col("passagiere") < small).sum() / pl.col("passagiere").sum()).alias("anteil_passagiere_kleine"),
            (pl.col("passagiere").filter(pl.col("passagiere") >= large).sum() / pl.col("passagiere").sum()).alias("anteil_passagiere_grosse"),
        )
        .sort("zeitraum")
    )


def small_voyage_ports(trips: pl.DataFrame, small: int = 20) -> pl.DataFrame:
    return (
        trips.filter(pl.col("passagiere") < small, pl.col("zeitraum") == "1930–1939", pl.col("hafen").is_not_null())
        .group_by("hafen").agg(pl.len().alias("reisen"))
        .sort("reisen", descending=True)
        .head(8)
    )


def ships(df: pl.DataFrame, trips: pl.DataFrame) -> pl.DataFrame:
    per_ship = trips.group_by("ship_cleaned").agg(
        pl.len().alias("reisen"),
        pl.col("passagiere").sum().alias("passagiere"),
        pl.col("jahr").min().alias("erstes_jahr"),
        pl.col("jahr").max().alias("letztes_jahr"),
        pl.col("reederei").mode().first().alias("reederei"),
        pl.col("passagiere").max().alias("groesste_reise"),
    )
    return per_ship.sort("passagiere", descending=True).head(TOP_SHIPS)


def ship_years(df: pl.DataFrame, top_ships: pl.DataFrame) -> pl.DataFrame:
    return (
        df.filter(pl.col("ship_cleaned").is_in(top_ships["ship_cleaned"].implode()), pl.col("jahr").is_not_null())
        .group_by("ship_cleaned", "jahr").agg(pl.len().alias("n"))
        .sort("ship_cleaned", "jahr")
    )


def month_heatmap(df: pl.DataFrame, trips: pl.DataFrame) -> pl.DataFrame:
    persons = df.filter(pl.col("jahr").is_not_null()).group_by("jahr", "monat").agg(pl.len().alias("passagiere"))
    departures = trips.group_by(pl.col("abfahrt").dt.year().alias("jahr"), pl.col("abfahrt").dt.month().alias("monat")).agg(pl.len().alias("abfahrten"))
    return persons.join(departures, on=["jahr", "monat"], how="left").sort("jahr", "monat")


def month_by_period(df: pl.DataFrame) -> pl.DataFrame:
    counts = df.filter(pl.col("zeitraum").is_not_null()).group_by("zeitraum", "reiseart", "monat").agg(pl.len().alias("n"))
    return counts.with_columns((pl.col("n") / pl.col("n").sum().over("zeitraum", "reiseart")).alias("anteil")).sort("zeitraum", "reiseart", "monat")


def class_shares(df: pl.DataFrame) -> pl.DataFrame:
    known = df.filter(pl.col("travel_class_cleaned").is_not_null(), ~pl.col("travel_class_cleaned").is_in(["ohne Angabe", "uneindeutig"]))
    return yearly_shares(known, "travel_class_cleaned", 7, "klasse")


def port_coordinates(df: pl.DataFrame) -> pl.DataFrame:
    return (
        df.filter(pl.col("ankunft_lat").is_not_null())
        .group_by("port_of_arrival_cleaned")
        .agg(pl.col("ankunft_lat").first().alias("lat"), pl.col("ankunft_lon").first().alias("lon"), pl.len().alias("n"))
        .sort("n", descending=True)
    )


def run(df: pl.DataFrame) -> dict:
    trips = voyages(df)
    port_year = yearly_shares(df, "port_of_arrival_cleaned", TOP_PORTS, "hafen")
    agent_year = yearly_shares(df, "agent_cleaned", TOP_AGENTS, "reederei")
    region_year = yearly_shares(df, "hafen_region", 7, "region") if "hafen_region" in df.columns else None
    top_ships = ships(df, trips)
    stats_by_period = voyage_stats(trips)
    classes = class_shares(df)

    write_table("m5_haefen_jahr", port_year)
    write_table("m5_reedereien_jahr", agent_year)
    write_table("m5_reisen", trips)
    write_table("m5_reisen_statistik", stats_by_period)
    write_table("m5_schiffe", top_ships)
    write_web_json("schifffahrt", {
        "haefen_jahr": port_year,
        "regionen_jahr": region_year,
        "reedereien_jahr": agent_year,
        "klassen_jahr": classes,
        "heatmap": month_heatmap(df, trips),
        "monat_zeitraum": month_by_period(df),
        "reisen_histogramm": voyage_size_histogram(trips),
        "reisen_statistik": stats_by_period,
        "reisen": trips.select("abfahrt", "ship_cleaned", "passagiere", "hafen", "kreuzfahrt").with_columns(pl.col("abfahrt").cast(pl.String)),
        "schiffe": top_ships,
        "schiffe_jahre": ship_years(df, top_ships),
        "hafen_koordinaten": port_coordinates(df),
    })
    return {
        "port_year": port_year,
        "agent_year": agent_year,
        "region_year": region_year,
        "trips": trips,
        "stats": stats_by_period,
        "ships": top_ships,
        "classes": classes,
        "month_by_period": month_by_period(df),
        "size_profile": voyage_size_profile(trips),
        "small_ports": small_voyage_ports(trips),
    }
