import re
import sys
from pathlib import Path

import polars as pl
from unidecode import unidecode

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "CHUP_Passengerlists.csv"
MANUAL = Path(__file__).resolve().parent / "manual"
OUT = ROOT / "data" / "enrichment" / "sparse_cleaned.parquet"

ROW_COUNT = 735_545
DATE_TOLERANCE_DAYS = 3
SERIES_PATTERN = r"^(AIII|AIV|STAB|FSI|F|KW|HK|K|DAZ|KB)[._\-\d]"
NON_LANGUAGE_REMARKS = {"child", "infant", "none", "returning alien"}
COUNTRY_WORDS = {
    "germany", "germ", "deutschland", "deutschl", "d", "poland", "polen", "cz-sl", "csr", "yougoslavia",
    "jugoslawien", "norway", "usa", "austria", "oesterreich", "schweiz", "switzerland", "czechoslovakia",
    "hungary", "italy", "france", "belgium", "sweden", "denmark", "holland", "ungarn",
}
US_STATES = set(
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC "
    "ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split()
)
STREET_WORDS = (
    r"(?:\w*str(?:\.|asse|aße)?|\w*ave\.|street|ave(?:nue)?|road|rd|place|pl|blvd|boulevard|drive|dr|lane|"
    r"broadway|bldg|building|platz|weg|allee|gasse|damm|ufer|chaussee)"
)
STREET_END = re.compile(rf"^(.*?\b{STREET_WORDS}\b\.?)(?:\s+|(?=\d)|$)(.*)$", re.IGNORECASE)
GERMAN_STREET = re.compile(r"\w+(?:str\.?|strasse|straße|platz|weg|allee|gasse|ring|damm|ufer|chaussee)\b\.?", re.IGNORECASE)


def read_manual(name: str) -> pl.DataFrame:
    return pl.read_csv(MANUAL / name, infer_schema=False)


def read_raw() -> pl.DataFrame:
    raw = pl.read_csv(RAW, separator="@", infer_schema=False, quote_char=None)
    stripped = [
        pl.when(pl.col(c).str.strip_chars() == "").then(None).otherwise(pl.col(c).str.strip_chars()).alias(c)
        for c in raw.columns
    ]
    return raw.with_columns(stripped)


def parse_unique(series: pl.Series, parser, schema: dict) -> pl.DataFrame:
    uniques = series.drop_nulls().unique()
    parsed = pl.DataFrame([parser(value) for value in uniques], schema=schema)
    parsed = parsed.with_columns(uniques.alias("_raw"))
    return series.to_frame("_raw").join(parsed, on="_raw", how="left", maintain_order="left").drop("_raw")


def archive_columns(df: pl.DataFrame) -> pl.DataFrame:
    archive_id = pl.col("archive_id").str.replace_all('"', "")
    parts = archive_id.str.extract_groups(r"(\d{1,2})\.(\d{1,2})\.(\d{4})")
    day = parts.struct[0].cast(pl.Int32)
    month = parts.struct[1].cast(pl.Int32)
    year = parts.struct[2].cast(pl.Int32)
    departure = pl.col("date_of_departure_cleaned").str.to_date("%Y-%m-%d", strict=False)
    has_full_date = (day > 0) & (month > 0)
    archive_date = pl.format("{}-{}-{}", year, month, day).str.to_date("%Y-%m-%d", strict=False)
    gap_days = (departure - archive_date).dt.total_days()
    same_month = pl.when(month > 0).then(departure.dt.month() == month).otherwise(True)
    kind = (
        pl.when(year.is_null() | departure.is_null()).then(None)
        .when(departure.dt.year() != year).then(pl.lit("Jahr"))
        .when(has_full_date & (gap_days.abs() > DATE_TOLERANCE_DAYS)).then(pl.lit("Tage"))
        .when(~same_month).then(pl.lit("Monat"))
        .otherwise(None)
    )
    century_shift = (
        has_full_date & (departure.dt.year() == year - 100)
        & (departure.dt.month() == month) & (departure.dt.day() == day)
    )
    return df.select(
        archive_id.str.extract(SERIES_PATTERN).alias("archive_series"),
        archive_date.alias("archive_date"),
        year.cast(pl.Int16).alias("archive_year"),
        archive_id.str.extract(r"[_-]([A-Za-z]+)$").alias("archive_suffix"),
        kind.is_not_null().alias("date_archive_conflict"),
        kind.alias("date_conflict_kind"),
        pl.when(century_shift).then(archive_date).otherwise(None).alias("departure_date_corrected"),
    )


MONTHS = {m: i for i, m in enumerate("Jan Feb Mrz Apr Mai Jun Jul Aug Sep Okt Nov Dez".split(), start=1)}


def parse_nr(value: str) -> dict:
    empty = {"nr_int": None, "nr_page": None, "nr_line": None, "nr_form": None}
    if found := re.fullmatch(r"(\d+)(?:\.0+)?", value):
        return {**empty, "nr_int": int(found.group(1)), "nr_form": "Ganzzahl"}
    if found := re.fullmatch(r"(\d+)[-/](\d+)", value):
        return {**empty, "nr_page": int(found.group(1)), "nr_line": int(found.group(2)), "nr_form": "Seite-Zeile"}
    if found := re.fullmatch(r"(\d{2})\. (" + "|".join(MONTHS) + ")", value):
        return {**empty, "nr_page": int(found.group(1)), "nr_line": MONTHS[found.group(2)], "nr_form": "Seite-Zeile (Excel-Datum)"}
    if found := re.fullmatch("(" + "|".join(MONTHS) + r") (\d{2})", value):
        return {**empty, "nr_page": MONTHS[found.group(1)], "nr_line": int(found.group(2)), "nr_form": "Seite-Zeile (Excel-Datum)"}
    if found := re.fullmatch(r"Bl\.(\d+)-(\d+)", value):
        return {**empty, "nr_page": int(found.group(1)), "nr_line": int(found.group(2)), "nr_form": "Seite-Zeile (Blatt)"}
    if found := re.fullmatch(r"(\d+)[a-z]", value):
        return {**empty, "nr_int": int(found.group(1)), "nr_form": "Ganzzahl mit Buchstabe"}
    if re.fullmatch(r"FSI_\d{9}", value):
        return {**empty, "nr_form": "FSI-Kennung"}
    return empty


def nr_columns(df: pl.DataFrame) -> pl.DataFrame:
    schema = {"nr_int": pl.Int64, "nr_page": pl.Int64, "nr_line": pl.Int64, "nr_form": pl.String}
    return parse_unique(df["nr"], parse_nr, schema)


LANGUAGES = dict(read_manual("sparse_languages.csv").iter_rows())


def parse_literacy(value: str) -> dict:
    flags = re.fullmatch(r"(y|no|n)\s*(.*?)\s*(y|no|n|s)", value.lower().strip())
    if not flags:
        return {"literacy_reads": None, "literacy_writes": None, "literacy_language": None, "_language_unmapped": False}
    reads, middle, writes = flags.groups()
    names = [part.strip() for part in re.split(r"[,/]", middle) if part.strip()]
    is_language_text = bool(names) and not re.fullmatch(r"[-–—_ ]*", middle) and middle not in NON_LANGUAGE_REMARKS and not middle.startswith("joins")
    mapped = [LANGUAGES.get(name) for name in names] if is_language_text else []
    unmapped = any(m is None for m in mapped)
    language = None if unmapped or not mapped else ", ".join(dict.fromkeys(mapped))
    return {
        "literacy_reads": reads == "y",
        "literacy_writes": None if writes == "s" else writes == "y",
        "literacy_language": language,
        "_language_unmapped": unmapped,
    }


def literacy_columns(df: pl.DataFrame) -> pl.DataFrame:
    schema = {
        "literacy_reads": pl.Boolean, "literacy_writes": pl.Boolean,
        "literacy_language": pl.String, "_language_unmapped": pl.Boolean,
    }
    return parse_unique(df["literacy"], parse_literacy, schema)


def ticket_column(df: pl.DataFrame) -> pl.DataFrame:
    lowered = pl.col("ticket").str.to_lowercase()
    paid = pl.when(lowered == "y").then(True).when(lowered.is_in(["n", "no"])).then(False).otherwise(None)
    return df.select(paid.alias("ticket_paid"))


def money_columns(df: pl.DataFrame) -> pl.DataFrame:
    amount = pl.col("amount_of_money").str.replace(",", ".").str.extract(r"^(\d+(?:\.\d+)?)$").cast(pl.Float64)
    return df.select(
        amount.alias("money_usd"),
        (pl.col("amount_of_money").str.to_lowercase() == "y").fill_null(False).alias("money_stated_no_amount"),
    )


def previous_stay_columns(df: pl.DataFrame) -> pl.DataFrame:
    lowered = pl.col("previous_US_stay").str.to_lowercase()
    year_span = pl.col("previous_US_stay").str.contains(r"^\d{4}(?:-\d{4})?(?:&\d{4}(?:-\d{4})?)*$")
    stay = (
        pl.when(lowered == "y").then(True)
        .when(lowered.is_in(["n", "no"])).then(False)
        .when(year_span).then(True)
        .otherwise(None)
    )
    return df.select(
        stay.alias("previous_us_stay"),
        pl.when(year_span).then(pl.col("previous_US_stay")).otherwise(None).alias("previous_us_stay_years"),
    )


def who_paid_column(df: pl.DataFrame) -> pl.DataFrame:
    table = dict(read_manual("sparse_who_paid.csv").iter_rows())
    key = pl.col("who_paid").str.to_lowercase().str.replace_all(r"\s+", " ")
    return df.select(key.replace_strict(table, default=None, return_dtype=pl.String).alias("who_paid_cleaned"))


def birthplace(text: str | None) -> str | None:
    found = re.search(r"\bgeb(?:\.|ürtig)?\s*(?:in|aus)\s+(.+)$", text or "", re.IGNORECASE)
    if not found:
        return None
    place = re.sub(r"\s+", " ", found.group(1)).strip(" ,.;")
    place = re.sub(r",\s*(D\.?|Deutschl\.?|Deutschland|Germany)$", "", place, flags=re.IGNORECASE)
    return place or None


NOTE_CATEGORIES = list(read_manual("sparse_notes_kategorien.csv").iter_rows())
NOTE_TRAVEL_KINDS = list(read_manual("sparse_notes_reiseart.csv").iter_rows())


def parse_note(value: str) -> dict:
    lowered = value.lower()
    return {
        "notes_gestrichen": "gestrichen" in lowered,
        "notes_doppelt": "doppelt" in lowered,
        "notes_fluechtling": bool(re.search(r"fl(ü|ue)chtling", lowered)),
        "notes_reiseart": next((k for p, k in NOTE_TRAVEL_KINDS if re.search(p, value, re.IGNORECASE)), None),
        "notes_kategorie": next((k for p, k in NOTE_CATEGORIES if re.search(p, value, re.IGNORECASE)), "Sonstiges"),
    }


def notes_columns(df: pl.DataFrame) -> pl.DataFrame:
    schema = {
        "notes_gestrichen": pl.Boolean, "notes_doppelt": pl.Boolean, "notes_fluechtling": pl.Boolean,
        "notes_reiseart": pl.String, "notes_kategorie": pl.String,
    }
    parsed = parse_unique(df["notes"], parse_note, schema)
    struck_in_emigrant = df["emigrant"].str.to_lowercase().str.contains("gestrichen").fill_null(False)
    flags = parsed.with_columns(
        pl.col("notes_gestrichen").fill_null(False) | struck_in_emigrant,
        pl.col("notes_doppelt").fill_null(False),
        pl.col("notes_fluechtling").fill_null(False),
    )
    places = [birthplace(n) or birthplace(e) for n, e in zip(df["notes"], df["emigrant"])]
    return flags.with_columns(pl.Series("notes_geburtsort", places, dtype=pl.String))


def emigrant_column(df: pl.DataFrame) -> pl.DataFrame:
    return df.select(pl.when(pl.col("emigrant").is_null()).then(None).otherwise(pl.col("emigrant") == "A").alias("emigrant_flag"))


def split_captain(raw: str) -> tuple[str, str]:
    text = raw.strip()
    if "," in text:
        surname, given = text.split(",", 1)
        text = f"{given.strip()} {surname.strip()}"
    text = re.sub(r"\bv\.", "von ", text)
    text = re.sub(r"\.(?=\S)", ". ", text)
    tokens = re.sub(r"\s+", " ", text).strip().split(" ")
    cut = len(tokens) - 1
    while cut > 0 and tokens[cut - 1].lower() in {"de", "von", "van", "der"}:
        cut -= 1
    return " ".join(tokens[:cut]), " ".join(tokens[cut:])


def name_weight(given: str) -> tuple[int, int]:
    letters = given.replace(".", "").replace(" ", "")
    return len(letters), len(given)


def canonical_captain_names(df: pl.DataFrame) -> dict[str, str]:
    overrides = dict(read_manual("sparse_captains.csv").iter_rows())
    ships = dict(
        df.filter(pl.col("captain").is_not_null())
        .group_by("captain").agg(pl.col("ship_cleaned").drop_nulls().unique().alias("ships")).iter_rows()
    )
    parsed = {raw: split_captain(overrides.get(raw, raw)) for raw in ships}
    longest_given: dict[tuple[str, str], str] = {}
    ships_by_key: dict[tuple[str, str], set] = {}
    for raw, (given, surname) in parsed.items():
        if given:
            key = (given[0].upper(), surname)
            longest_given[key] = max(longest_given.get(key, ""), given, key=name_weight)
            ships_by_key.setdefault(key, set()).update(ships[raw])
    names = {}
    for raw, (given, surname) in parsed.items():
        if given:
            names[raw] = f"{longest_given[(given[0].upper(), surname)]} {surname}"
            continue
        sharing = [key for key in longest_given if key[1] == surname and ships_by_key[key] & set(ships[raw])]
        names[raw] = f"{longest_given[sharing[0]]} {surname}" if len(sharing) == 1 else surname
    return names


def captain_column(df: pl.DataFrame) -> pl.DataFrame:
    names = canonical_captain_names(df)
    return df.select(pl.col("captain").replace_strict(names, default=None, return_dtype=pl.String).alias("captain_cleaned"))


def relation_rules() -> list[dict]:
    rules = []
    for row in read_manual("sparse_relations.csv").iter_rows(named=True):
        prefix = r"(?P<gr>(?:great|grand|gr)[\s.\-]*|g)?(?P<step>(?:step|st)[\s.\-]*)?" if row["prefixable"] == "1" else ""
        in_law = r"(?P<il>[\s,]*(?:i\.?\s*l\b\.?|in[\s\-]*law|\s+law))?" if row["german_in_law"] else ""
        ending = r'(?P<sep>[\s:,._;\-"]+|$|(?<=\.)(?=[A-Za-zÄÖÜäöü]))'
        pattern = rf'^["\']?\s*{prefix}(?:{row["pattern"]}){in_law}{ending}'
        rules.append({**row, "regex": re.compile(pattern, re.IGNORECASE)})
    return rules


RELATION_RULES = relation_rules()


def german_relation(rule: dict, found: re.Match) -> str:
    groups = found.groupdict()
    if groups.get("il"):
        return rule["german_in_law"]
    if groups.get("step"):
        return "Stief" + rule["german"].lower()
    if groups.get("gr"):
        return "Groß" + rule["german"].lower()
    return rule["german"]


def clean_segment(segment: str) -> str:
    return re.sub(r"\s+", " ", segment).strip(" .;:-\"'()")


def is_country(segment: str) -> bool:
    return segment.lower().replace(" ", "").strip(".") in COUNTRY_WORDS


def state_code(segment: str) -> str | None:
    code = re.sub(r"[.\s]", "", segment).upper()
    return code if code in US_STATES else None


TRAILING_REGION = re.compile(
    r"(?:[\s,]+(?:germ|germany|westfl|wttbg|rhpf|oldenb|ofr|hann|schles|hungary|poland|yougoslavia|l\.\s?i)\.?)+$",
    re.IGNORECASE,
)
SKIPPED_PLACE = re.compile(
    r"\b(?:hotel|pension|gasthof|haus)\b|^(?:box|r\.?\s?[fd]\.?\s?d?\.?)\b|^(?:am|an|auf|im|zum|zur|bei)\s",
    re.IGNORECASE,
)
PERSON_NAME = re.compile(r"(?:(?:Mrs?|Dr|Frau|Herr)\.?\s+)?(?:[A-Z]\.\s?|[A-Z][a-zäöüß]+\s)+[A-Z][a-zäöüß]+")
TRAILING_STATE = re.compile(r"^(.*\S)[\s.,]+((?:[A-Za-z]\.?){2})\s*$")
HOUSE_NUMBER_THEN_PLACE = re.compile(r"^\D*?\s\d+[a-z]?\s+(\S.*)$", re.IGNORECASE)
ENDS_WITH_HOUSE_NUMBER = re.compile(r"[A-Za-zäöüß.]\s+\d+[a-z]?$")


def place_from_segment(segment: str, allow_numbered: bool) -> str | None:
    text = clean_segment(segment)
    if not text or is_country(text) or SKIPPED_PLACE.search(text):
        return None
    if "/" in text:
        head, tail = text.split("/", 1)
        text = head + (" am Main" if re.fullmatch(r"(m|main)\.?", tail.strip(), re.IGNORECASE) else "")
    text = re.sub(r"^.*\bnear\s+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bno\.?\s*\d+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^\s*(?:no\.?|nr\.?)?\s*\d[\d\-/ ]*[A-Za-z]?\b\.?\s*", "", text)
    street = STREET_END.match(text)
    if street:
        text = street.group(2)
    else:
        text = GERMAN_STREET.sub("", text)
        after_number = HOUSE_NUMBER_THEN_PLACE.match(text)
        if after_number:
            text = after_number.group(1)
        elif ENDS_WITH_HOUSE_NUMBER.search(text) and not allow_numbered:
            return None
    text = TRAILING_REGION.sub("", clean_segment(re.sub(r"\d+", "", text)))
    if not text or is_country(text) or re.fullmatch(r"(?:nr|no)\.?", text, re.IGNORECASE):
        return None
    return text


def split_trailing_state(segment: str) -> tuple[str, str | None]:
    found = TRAILING_STATE.match(clean_segment(segment))
    if found and state_code(found.group(2)):
        return found.group(1), state_code(found.group(2))
    return segment, None


def first_place(segments: list[str]) -> str | None:
    for allow_numbered in (False, True):
        for segment in segments:
            if not allow_numbered and starts_with_number(segment):
                continue
            if place := place_from_segment(segment, allow_numbered):
                return place
    return None


def extract_place(segments: list[str]) -> str | None:
    segments = [s for s in segments if not is_country(s)]
    if segments and state_code(segments[-1]):
        place = first_place(segments[-2::-1])
        return f"{place}, {state_code(segments[-1])}" if place else None
    if segments:
        text, state = split_trailing_state(segments[-1])
        if state and (place := first_place([text])):
            return f"{place}, {state}"
    return first_place(segments)


def starts_with_number(text: str) -> bool:
    return bool(re.match(r"^\s*[\"']?\s*(?:no\.?\s*)?\d", text))


def looks_like_name(segment: str) -> bool:
    return not (starts_with_number(segment) or STREET_END.match(segment) or GERMAN_STREET.search(segment) or state_code(segment))


def match_relation(text: str) -> tuple[str | None, str, str | None]:
    for rule in RELATION_RULES:
        found = rule["regex"].match(text)
        if not found:
            continue
        has_delimiter = bool(re.search(r"[:,]", found.group("sep") or ""))
        keeps_word_in_name = rule["kind"] in {"inst", "firm"} and not has_delimiter
        rest = text.strip('"') if keeps_word_in_name else text[found.end():]
        return german_relation(rule, found), rest, rule["kind"]
    return None, text.strip('"'), None


NAMED_KINDS = {"person", "firm", "inst", "care"}


def parse_contact(value: str) -> dict:
    relation, rest, kind = match_relation(value.strip())
    if kind in {"above", "transit"}:
        rest = ""
    segments = [clean_segment(s) for s in re.split(r"[,;]", rest) if clean_segment(s)]
    name = None
    person_then_address = (
        kind is None and len(segments) >= 3
        and PERSON_NAME.fullmatch(segments[0]) and not looks_like_name(segments[1])
    )
    if (kind in NAMED_KINDS and segments and looks_like_name(segments[0])) or person_then_address:
        name, segments = segments[0], segments[1:]
    place = extract_place(segments)
    return {"relation": relation, "name": name, "place": place}


def contact_columns(df: pl.DataFrame, column: str, prefix: str) -> pl.DataFrame:
    schema = {"relation": pl.String, "name": pl.String, "place": pl.String}
    parsed = parse_unique(df[column], parse_contact, schema)
    return parsed.rename({"relation": f"{prefix}_relation", "name": f"{prefix}_name", "place": f"{prefix}_place"})


def parse_pfd(value: str) -> str:
    if re.fullmatch(r".+_\d{4}", value):
        return "Schiffsverweis"
    if re.search(r"transit", value, re.IGNORECASE):
        return "Transit"
    if re.fullmatch(r"[A-Z]{2,3}\.?", value):
        return "Zielkürzel"
    if re.search(r"\d|,|\bstr\b|\bave\b|\bc/o\b", value, re.IGNORECASE):
        return "Zieladresse"
    return "Sonstiges"


def pfd_column(df: pl.DataFrame) -> pl.DataFrame:
    return parse_unique(df["pfd"], lambda v: {"pfd_kategorie": parse_pfd(v)}, {"pfd_kategorie": pl.String})


def normalise_name(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.lower()
    for umlaut, plain in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        text = text.replace(umlaut, plain)
    return re.sub(r"[^a-z]", "", unidecode(text)) or None


def normalised(df: pl.DataFrame, column: str) -> pl.Series:
    return parse_unique(df[column], lambda v: {"key": normalise_name(v)}, {"key": pl.String})["key"]


def duplicate_columns(df: pl.DataFrame) -> pl.DataFrame:
    keys = df.select(
        "id",
        normalised(df, "last_name").alias("last"),
        normalised(df, "first_name").alias("first"),
        pl.coalesce("age_cleaned", "age").alias("age_key"),
        pl.coalesce("ship_cleaned", "ship").alias("ship_key"),
        "date_of_departure_cleaned",
    ).drop_nulls()
    keys = keys.with_columns(pl.concat_str(pl.exclude("id"), separator="|").alias("key"))
    repeated = keys.filter(pl.len().over("key") > 1)
    groups = repeated.select("id", pl.col("key").rank("dense").cast(pl.Int64).alias("dup_group"))
    joined = df.select("id").join(groups, on="id", how="left", maintain_order="left")
    return joined.select(pl.col("dup_group").is_not_null().alias("dup_candidate"), "dup_group")


def unparsed_fields(df: pl.DataFrame, out: pl.DataFrame) -> pl.Series:
    filled = out["emigrant_flag"].fill_null(False)
    checks = {
        "archive_id": df["archive_id"].is_not_null() & out["archive_series"].is_null(),
        "nr": df["nr"].is_not_null() & out["nr_form"].is_null(),
        "literacy": df["literacy"].is_not_null() & out["literacy_reads"].is_null(),
        "literacy_language": out["_language_unmapped"],
        "ticket": df["ticket"].is_not_null() & out["ticket_paid"].is_null(),
        "who_paid": df["who_paid"].is_not_null() & out["who_paid_cleaned"].is_null(),
        "amount_of_money": df["amount_of_money"].is_not_null() & out["money_usd"].is_null() & ~out["money_stated_no_amount"],
        "previous_US_stay": df["previous_US_stay"].is_not_null() & out["previous_us_stay"].is_null(),
        "emigrant": df["emigrant"].is_not_null() & ~filled & ~out["notes_gestrichen"] & out["notes_geburtsort"].is_null(),
        "notes": out["notes_kategorie"] == "Sonstiges",
        "relative": df["relative"].is_not_null() & out["relative_relation"].is_null() & out["relative_name"].is_null() & out["relative_place"].is_null(),
        "relative_place": df["relative"].is_not_null() & out["relative_place"].is_null(),
        "reference_person": df["reference_person"].is_not_null() & out["reference_relation"].is_null() & out["reference_name"].is_null() & out["reference_place"].is_null(),
        "reference_place": df["reference_person"].is_not_null() & out["reference_place"].is_null(),
        "pfd": out["pfd_kategorie"] == "Sonstiges",
    }
    flags = pl.DataFrame({name: mask.fill_null(False) for name, mask in checks.items()})
    names = [pl.when(pl.col(name)).then(pl.lit(name)) for name in checks]
    joined = flags.select(pl.concat_list(names).list.drop_nulls().list.join(";").alias("unparsed"))["unparsed"]
    return pl.Series("unparsed_fields", [v or None for v in joined], dtype=pl.String)


OUTPUT_COLUMNS = [
    "id", "archive_series", "archive_date", "archive_year", "archive_suffix", "date_archive_conflict",
    "date_conflict_kind", "departure_date_corrected", "nr_int", "nr_page", "nr_line", "nr_form", "literacy_reads", "literacy_writes",
    "literacy_language", "ticket_paid", "who_paid_cleaned", "money_usd", "money_stated_no_amount",
    "previous_us_stay", "previous_us_stay_years", "emigrant_flag", "notes_gestrichen", "notes_doppelt",
    "notes_fluechtling", "notes_geburtsort", "notes_reiseart", "notes_kategorie", "captain_cleaned",
    "relative_relation", "relative_name", "relative_place", "reference_relation", "reference_name",
    "reference_place", "pfd_kategorie", "dup_candidate", "dup_group", "unparsed_fields",
]


def build(df: pl.DataFrame) -> pl.DataFrame:
    parts = [
        df.select(pl.col("id").cast(pl.Int64)),
        archive_columns(df),
        nr_columns(df),
        literacy_columns(df),
        ticket_column(df),
        who_paid_column(df),
        money_columns(df),
        previous_stay_columns(df),
        emigrant_column(df),
        notes_columns(df),
        captain_column(df),
        contact_columns(df, "relative", "relative"),
        contact_columns(df, "reference_person", "reference"),
        pfd_column(df),
        duplicate_columns(df),
    ]
    out = pl.concat(parts, how="horizontal")
    out = out.with_columns(unparsed_fields(df, out))
    return out.select(OUTPUT_COLUMNS)


def print_summary(df: pl.DataFrame, out: pl.DataFrame) -> None:
    main_output = {
        "archive_id": "archive_series", "nr": "nr_form", "literacy": "literacy_reads", "ticket": "ticket_paid",
        "who_paid": "who_paid_cleaned", "amount_of_money": "money_usd", "previous_US_stay": "previous_us_stay",
        "emigrant": "emigrant_flag", "notes": "notes_kategorie", "captain": "captain_cleaned",
        "relative": "relative_relation", "reference_person": "reference_relation", "pfd": "pfd_kategorie",
    }
    print("raw non-null rows and share with the main output filled")
    for raw_column, out_column in main_output.items():
        raw_rows = df[raw_column].is_not_null()
        filled = (out[out_column].is_not_null() & raw_rows).sum()
        print(f"  {raw_column:18s} {raw_rows.sum():>8,d} {filled / raw_rows.sum():7.1%}")
    for extra in ["archive_date", "literacy_language", "money_stated_no_amount", "relative_name", "relative_place",
                  "reference_name", "reference_place", "notes_geburtsort", "notes_reiseart", "previous_us_stay_years"]:
        print(f"  {extra:24s} filled {out[extra].is_not_null().sum():,d}")
    print("date conflicts", out["date_archive_conflict"].sum(), "corrected", out["departure_date_corrected"].is_not_null().sum())
    print(out.filter(pl.col("date_archive_conflict")).group_by("archive_series", "date_conflict_kind").len().sort("archive_series", "date_conflict_kind"))
    print(out["archive_series"].value_counts(sort=True))
    print("duplicate rows", out["dup_candidate"].sum(), "groups", out["dup_group"].drop_nulls().n_unique())
    print(out["notes_kategorie"].value_counts(sort=True))
    print(out["unparsed_fields"].str.split(";").explode().value_counts(sort=True))


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    pl.Config.set_tbl_rows(60)
    df = read_raw()
    out = build(df)
    assert out.height == df.height == ROW_COUNT and out["id"].is_unique().all()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out.write_parquet(OUT)
    print_summary(df, out)


if __name__ == "__main__":
    main()
