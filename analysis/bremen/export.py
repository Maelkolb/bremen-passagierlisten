import json
import math

import polars as pl

from .paths import TABLES, WEB_DATA


def clean_number(value):
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return round(value, 4)
    return value


def clean(obj):
    if isinstance(obj, dict):
        return {str(k): clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, pl.DataFrame):
        return clean(columnar(obj))
    if hasattr(obj, "item") and not isinstance(obj, (str, bytes)):
        return clean_number(obj.item())
    return clean_number(obj)


def columnar(df: pl.DataFrame) -> dict:
    return {name: df[name].to_list() for name in df.columns}


def write_web_json(name: str, payload: dict) -> None:
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    text = json.dumps(clean(payload), ensure_ascii=False, separators=(",", ":"))
    (WEB_DATA / f"{name}.json").write_text(text, encoding="utf-8")


def write_table(name: str, df: pl.DataFrame) -> None:
    TABLES.mkdir(parents=True, exist_ok=True)
    df.write_csv(TABLES / f"{name}.csv")
