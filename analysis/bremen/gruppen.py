import polars as pl

MAX_NUMBER_GAP = 2
CHILD_AGE = 15
ALPHABETICAL_SHARE = 0.8
MIN_LIST_SIZE = 30


def group_type(size: pl.Expr) -> pl.Expr:
    return (
        pl.when(size == 1).then(pl.lit("allein"))
        .when(size == 2).then(pl.lit("zu zweit"))
        .otherwise(pl.lit("Familie/Gruppe 3+"))
    )


def alphabetical_lists(ordered: pl.DataFrame) -> pl.Expr:
    ascending = (pl.col("nachname_norm") >= pl.col("nachname_norm").shift(1)).over("liste")
    return (ascending.mean().over("liste") > ALPHABETICAL_SHARE) & (pl.len().over("liste") >= MIN_LIST_SIZE)


def with_travel_groups(df: pl.DataFrame) -> pl.DataFrame:
    list_key = pl.concat_str([pl.col("archive_id").fill_null("?"), pl.col("abfahrt").cast(pl.String).fill_null("?"), pl.col("ship_cleaned").fill_null("?")], separator="|")
    ordered = df.with_columns(list_key.alias("liste")).sort(["liste", "id"])
    ordered = ordered.with_columns(alphabetical_lists(ordered).alias("liste_alphabetisch"))
    same_list = pl.col("liste") == pl.col("liste").shift(1)
    same_name = (pl.col("nachname_norm") == pl.col("nachname_norm").shift(1)) & (pl.col("nachname_norm").str.len_chars() > 0)
    gap = pl.col("nr_liste") - pl.col("nr_liste").shift(1)
    close_numbers = gap.is_null() | gap.is_between(0, MAX_NUMBER_GAP)
    same_residence = (pl.col("previous_residence") == pl.col("previous_residence").shift(1)).fill_null(False)
    trustworthy_order = ~pl.col("liste_alphabetisch") | same_residence
    continues = (same_list & same_name & close_numbers & trustworthy_order).fill_null(False)
    grouped = ordered.with_columns((~continues).cum_sum().cast(pl.Int32).alias("gruppe_id"))
    grouped = grouped.with_columns(
        pl.len().over("gruppe_id").cast(pl.Int16).alias("gruppe_groesse"),
        (pl.col("alter") < CHILD_AGE).any().over("gruppe_id").fill_null(False).alias("gruppe_mit_kindern"),
        pl.len().over(["ship_cleaned", "abfahrt", "nachname_norm"]).cast(pl.Int16).alias("gruppe_groesse_einfach"),
    )
    grouped = grouped.with_columns(
        group_type(pl.col("gruppe_groesse")).alias("gruppe_typ"),
        group_type(pl.col("gruppe_groesse_einfach")).alias("gruppe_typ_einfach"),
    )
    return grouped.sort("id")
