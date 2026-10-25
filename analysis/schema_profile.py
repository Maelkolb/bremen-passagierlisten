import sys
from pathlib import Path

import polars as pl

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "CHUP_Passengerlists.csv"
OUT = ROOT / "analysis" / "output" / "schema_profile.md"

PERIODS = [("1830–1869", 1830, 1869), ("1907–1914", 1907, 1914), ("1919–1929", 1919, 1929), ("1930–1939", 1930, 1939)]


def read_raw() -> pl.DataFrame:
    df = pl.read_csv(RAW, separator="@", infer_schema=False, quote_char=None)
    return df.with_columns(pl.all().str.strip_chars().replace("", None))


def de_int(n: int) -> str:
    return f"{n:,}".replace(",", ".")


def column_profile(df: pl.DataFrame) -> pl.DataFrame:
    year = pl.col("date_of_departure_cleaned").str.slice(0, 4).cast(pl.Int32, strict=False)
    rows = []
    for name in df.columns:
        col = df[name]
        top = col.drop_nulls().value_counts(sort=True).head(3)
        examples = "; ".join(f"{v} ({de_int(n)})" for v, n in top.rows())
        fill_by_period = []
        for _, start, end in PERIODS:
            part = df.filter(year.is_between(start, end))[name]
            fill_by_period.append(f"{part.is_not_null().mean():.0%}")
        rows.append({
            "Spalte": name,
            "gefüllt": f"{col.is_not_null().mean():.1%}",
            "verschieden": de_int(col.n_unique()),
            **{label: v for (label, _, _), v in zip(PERIODS, fill_by_period)},
            "häufigste Werte": examples.replace("|", "/"),
        })
    return pl.DataFrame(rows)


def to_markdown(table: pl.DataFrame) -> str:
    header = "| " + " | ".join(table.columns) + " |"
    rule = "|" + "|".join("---" for _ in table.columns) + "|"
    body = ["| " + " | ".join(str(v) for v in row) + " |" for row in table.rows()]
    return "\n".join([header, rule, *body]) + "\n"


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(to_markdown(column_profile(read_raw())), encoding="utf-8")
    print(OUT)
