import csv
import io
import math
import os
import re
import urllib.request
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import polars as pl
from rapidfuzz import fuzz, process
from rapidfuzz.distance import Levenshtein
from unidecode import unidecode

ROOT = Path(__file__).resolve().parents[2]
RAW_CSV = ROOT / "data" / "raw" / "CHUP_Passengerlists.csv"
GEONAMES_DIR = ROOT / "data" / "external" / "geonames"
DUMP_DIR = GEONAMES_DIR / "countries"
ALTERNATE_NAMES_DIR = DUMP_DIR / "alternatenames"
MANUAL_DIR = Path(__file__).resolve().parent / "manual"
OUTPUT_DIR = ROOT / "data" / "enrichment"
GEONAMES_URL = "https://download.geonames.org/export/dump/"

KEY_COLUMNS = ["previous_residence", "state_or_province_cleaned", "nationality_cleaned"]
GEONAMES_COLUMNS = [
    "geonameid", "name", "asciiname", "alternatenames", "latitude", "longitude",
    "feature_class", "feature_code", "country_code", "cc2", "admin1_code", "admin2_code",
    "admin3_code", "admin4_code", "population", "elevation", "dem", "timezone", "modification_date",
]
ALTERNATE_NAME_COLUMNS = [
    "alternate_name_id", "geonameid", "language", "alternate_name",
    "is_preferred", "is_short", "is_colloquial", "is_historic", "valid_from", "valid_to",
]
DUMP_COUNTRIES = [
    "DE", "AT", "CH", "LI", "LU", "NL", "BE", "DK", "FR", "IT", "PL", "CZ", "SK", "HU", "RO",
    "RS", "HR", "SI", "BA", "ME", "MK", "BG", "LT", "LV", "EE", "UA", "BY", "MD", "RU",
    "US", "CA", "AR", "BR",
]
LOCAL_LANGUAGES = {
    "DE": ["de"], "AT": ["de"], "CH": ["de", "fr", "it"], "LI": ["de"], "LU": ["lb", "de", "fr"],
    "NL": ["nl"], "BE": ["nl", "fr", "de"], "DK": ["da"], "FR": ["fr"], "IT": ["it"], "PL": ["pl"],
    "CZ": ["cs"], "SK": ["sk"], "HU": ["hu"], "RO": ["ro"], "HR": ["hr"], "SI": ["sl"], "BA": ["bs", "hr"],
    "LT": ["lt"], "LV": ["lv"], "EE": ["et"], "SE": ["sv"], "NO": ["no", "nb"], "FI": ["fi", "sv"],
    "ES": ["es"], "PT": ["pt"],
}
GERMAN_SPEAKING = {"DE", "AT", "CH", "LI", "LU"}
RECEIVING_COUNTRIES = {"DE", "US", "CA"}
EUROPE = {
    "DE", "AT", "CH", "LI", "LU", "NL", "BE", "DK", "FR", "IT", "PL", "CZ", "SK", "HU", "RO", "RS", "HR", "SI",
    "BA", "ME", "MK", "BG", "LT", "LV", "EE", "UA", "BY", "MD", "RU", "GB", "IE", "SE", "NO", "FI", "IS", "ES",
    "PT", "GR", "AL", "XK", "MT", "MC", "SM", "AD",
}

KIND_WEIGHT = {"name": 1.0, "alt": 0.7, "kurzform": 0.5}
KIND_RANK = {"name": 0, "alt": 1, "kurzform": 2}
LABEL_RANK = {"zusatz": 0, "exakt": 1, "kompakt": 2, "variante": 3, "fuzzy": 4}
DEFAULT_POPULATION = {"PPLC": 100_000, "PPLA": 20_000, "PPLA2": 3_000, "PPLA3": 500, "PPLA4": 300, "PPL": 100, "PPLX": 100}
ALL_GROUPS = ("voll", "kern", "variante")
CONFIRMING_TIERS = {"zusatz", "region", "bezug", "stadtteil", "stadt"}
DIRECT_GROUPS = ("voll", "kern")
DOMINANCE = 5.0
CORE_BONUS = 3.0
SAME_PLACE_KM = 3.0
REFERENCE_RADIUS_KM = 40.0
DISTRICT_RADIUS_KM = 25.0
MAX_COMPARED = 40
TOWN = 5_000
CITY = 50_000
ESCAPE_CITY = 100_000
METROPOLIS = 500_000
RECEIVING_TOWN = 10_000
WORLD_CITY = 1_000_000
GENERIC_NAME_COUNT = 3
ESCAPE_RATIO = 20.0
REGION_NAME_CITY = 20_000
FUZZY_MIN_LENGTH = 7
FUZZY_TWO_EDITS_LENGTH = 12

METHOD_CONFIDENCE = {
    "override": 0.95, "exakt": 0.95, "alternativname": 0.9, "kurzform": 0.85,
    "normalisiert": 0.85, "stadtteil": 0.85, "fuzzy": 0.65,
}
TIER_CONFIDENCE = {
    "bezug": 1.0, "zusatz": 1.0, "region": 1.0, "region_land": 0.9, "nationalitaet": 0.9,
    "grossstadt": 0.8, "aufnahmeland": 0.7, "ausserhalb": 0.7, "ohne_kontext": 0.7, "stadtteil": 1.0, "stadt": 0.9,
}
AMBIGUOUS_FACTOR = 0.6
UNCERTAIN_FACTOR = 0.8
REGION_CONFIDENCE = 0.7
COUNTRY_NAME_CONFIDENCE = 0.9
AMBIGUOUS_COUNTRY_CONFIDENCE = 0.5

LATIN_TEXT = r"^[\p{Latin}\p{M}0-9 .,'’()/\-]*\p{Latin}[\p{Latin}\p{M}0-9 .,'’()/\-]*$"
SHORT_FORM_SUFFIX = (
    r"\s*(?:\(.*\)|/.*|,.*|\s(?:am|an der|an den|an|im|in der|in|ob der|auf der|auf|bei|vor der|unter der|unter|"
    r"a\. ?d\.|a\.|i\.) .+)$"
)
SPA_PREFIX = r"^(?:Bad|Ostseebad|Nordseebad|Seebad|Solbad) "
STANDALONE_QUESTION = re.compile(r"\(\s*\?\s*\)|(?<!\S)\?+(?!\S)")
POSTAL_SUFFIX = re.compile(r"[\s,]+(?:No\.?\s*)?(?:[A-Z]{1,2}\s*\.?\s*)?\d{1,4}\s*[a-z]?\.?\s*$")
UPPER_SILESIA = re.compile(r"\s*\(?\s+O\.?\s*[/.\-]?\s*S\.?\s*\)?$")
REFERENCE_PREFIX = re.compile(r"^(?:b\.|bei|b|Kr\.|Krs\.|Kreis|Bez\.|Bezirk|Post)\s*(?=\S)")
REFERENCE_INFIX = re.compile(r"[\s,]+(?:b\.|bei|b|Kr\.|Krs\.|Kreis|Bez\.|Bezirk|Post)\s*(?=[A-ZÄÖÜ])")
QUALIFIER = re.compile(
    r"^(?P<main>.*?[^\s/])\s*(?:"
    r"(?P<an>\s(?:a\.?\s*d\.|a\s*/\s*d\.?|a\s*[./]|am|an der|an den|an|auf der|auf|ob der|vor der))"
    r"|(?P<in>\s(?:i\.?\s*d\.|i\s*[./]|im|in der|in))"
    r"|(?P<slash>/\s*(?:a\.|a/|i\.|i/)?)"
    r")\s*/?\s*(?P<qual>[^\s/].*)$"
)
COMMA_QUALIFIER = re.compile(r",\s*(?=(?:a|i)\s*[./]|a\.?\s*d\.)")
PREFIX = re.compile(r"^(?P<prefix>[^\W\d_]{1,6})\.\s*-?\s*(?P<rest>\S.*)$")
CONNECTORS = {
    "an": ["am", "an der", "an den", "an", "auf", ""],
    "in": ["im", "in", "in der", "ob der", ""],
    "slash": ["am", "an der", "an", "auf", "im", "in", ""],
}


@dataclass(frozen=True)
class Place:
    geonameid: int
    name: str
    country: str
    admin1: str
    admin2: str
    lat: float
    lon: float
    population: int
    feature_code: str

    @property
    def codes(self) -> set[str]:
        return {self.country, self.admin1, self.admin2}


@dataclass(frozen=True)
class Candidate:
    place: Place
    text: str
    kind: str
    group: str
    label: str


@dataclass(frozen=True)
class Area:
    name: str
    kind: str
    scope: frozenset[str]
    town_scope: frozenset[str]
    core: str | None
    countries: tuple[str, ...]
    lat: float | None
    lon: float | None
    point_method: str
    ambiguous: bool = False

    def contains(self, place: Place) -> bool:
        return bool(place.codes & self.scope)

    def contains_town(self, place: Place) -> bool:
        return bool(place.codes & self.town_scope)

    def is_core(self, place: Place) -> bool:
        return self.core is not None and self.core in place.codes

    @property
    def is_country(self) -> bool:
        return self.kind == "land"

    @property
    def search_countries(self) -> tuple[str, ...]:
        return tuple(sorted({code.split(".")[0] for code in self.scope}))


@dataclass
class Parsed:
    raw: str
    display: str
    main: str
    expansions: list[str] = field(default_factory=list)
    hints: list[Area] = field(default_factory=list)
    reference: str | None = None
    district_of: str | None = None
    district: str | None = None
    uncertain: bool = False
    unreadable: bool = False


def official_name_only(candidate: Candidate) -> bool:
    return candidate.kind == "name"


def safe_far_from_context(candidate: Candidate) -> bool:
    if candidate.kind == "name":
        return True
    key = name_key(candidate.text)
    if len(compact(key)) < 4 or candidate.place.population < ESCAPE_CITY:
        return False
    if candidate.place.country in EUROPE:
        return True
    if candidate.place.country in RECEIVING_COUNTRIES:
        return candidate.place.population >= METROPOLIS
    return candidate.place.population >= WORLD_CITY and " " not in key


@dataclass(frozen=True)
class Tier:
    name: str
    accepts: Callable[[Place], bool]
    accepts_town: Callable[[Place], bool] = lambda place: False
    is_core: Callable[[Place], bool] = lambda place: False
    min_weight: float = 0.0
    accepts_match: Callable[[Candidate], bool] = lambda candidate: True
    country_wide: bool = False


@dataclass
class Pick:
    candidate: Candidate | None
    tier: str
    ambiguous: bool
    rivals: list[Candidate]
    top_weight: float = 0.0


@dataclass
class Result:
    herkunft_ort: str | None
    place: Place | None = None
    lat: float | None = None
    lon: float | None = None
    country: str | None = None
    admin1: str | None = None
    precision: str | None = None
    method: str | None = None
    confidence: float | None = None
    ambiguous: bool = False


def name_key(text: str) -> str:
    words = re.findall(r"[a-z0-9]+", unidecode(text).lower())
    return " ".join("st" if word in ("sankt", "saint") else word for word in words)


def compact(key: str) -> str:
    return key.replace(" ", "")


def german_fold(text: str) -> str:
    folded = text.lower().replace("ä", "a").replace("ö", "o").replace("ü", "u").replace("ß", "ss")
    return folded.replace("ae", "a").replace("oe", "o").replace("ue", "u")


def blank_to_null(column: str) -> pl.Expr:
    stripped = pl.col(column).str.strip_chars()
    return pl.when(stripped == "").then(None).otherwise(stripped).alias(column)


def distance_km(a: Place, b: Place) -> float:
    phi1, phi2 = math.radians(a.lat), math.radians(b.lat)
    h = math.sin((phi2 - phi1) / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(math.radians(b.lon - a.lon) / 2) ** 2
    return 12_742 * math.asin(math.sqrt(h))


def split_list(value: str | None) -> list[str]:
    return [part.strip() for part in (value or "").split(";") if part.strip()]


def optional_float(value: str | None) -> float | None:
    return float(value) if value not in (None, "") else None


def read_manual(name: str) -> list[dict[str, str]]:
    with open(MANUAL_DIR / name, encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def download(url: str, target: Path) -> Path:
    if target.exists():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(f"{target.name}.part{os.getpid()}")
    urllib.request.urlretrieve(url, partial)
    partial.replace(target)
    return target


def read_tsv(source, columns: list[str]) -> pl.DataFrame:
    return pl.read_csv(source, separator="\t", has_header=False, new_columns=columns, quote_char=None, infer_schema=False)


def read_zipped_tsv(path: Path, member: str, columns: list[str]) -> pl.DataFrame:
    with zipfile.ZipFile(path) as archive:
        return read_tsv(io.BytesIO(archive.read(member)), columns)


def read_passengers(columns: list[str]) -> pl.DataFrame:
    passengers = pl.read_csv(RAW_CSV, separator="@", infer_schema=False, quote_char=None, columns=columns)
    return passengers.with_columns(blank_to_null(column) for column in columns)


def load_residence_keys() -> pl.DataFrame:
    return (
        read_passengers(KEY_COLUMNS)
        .filter(pl.col("previous_residence").is_not_null())
        .group_by(KEY_COLUMNS)
        .agg(pl.len().alias("n_records"))
        .sort(["n_records", *KEY_COLUMNS], descending=[True, False, False, False], nulls_last=True)
    )


def load_region_counts() -> pl.DataFrame:
    return (
        read_passengers(["state_or_province_cleaned"])
        .filter(pl.col("state_or_province_cleaned").is_not_null())
        .group_by("state_or_province_cleaned")
        .agg(pl.len().alias("n_records"))
        .sort(["n_records", "state_or_province_cleaned"], descending=[True, False])
    )


def load_geonames_features() -> pl.DataFrame:
    tables = [read_tsv(GEONAMES_DIR / "cities500.txt", GEONAMES_COLUMNS)]
    for country in DUMP_COUNTRIES:
        archive = download(f"{GEONAMES_URL}{country}.zip", DUMP_DIR / f"{country}.zip")
        tables.append(read_zipped_tsv(archive, f"{country}.txt", GEONAMES_COLUMNS))
    features = pl.concat(tables).unique("geonameid", keep="first", maintain_order=True)
    return features.filter(pl.col("feature_class").is_in(["P", "A"])).select(
        pl.col("geonameid").cast(pl.Int64),
        "name",
        "asciiname",
        "alternatenames",
        pl.col("latitude").cast(pl.Float64).alias("lat"),
        pl.col("longitude").cast(pl.Float64).alias("lon"),
        "feature_class",
        "feature_code",
        pl.col("country_code").alias("country"),
        pl.concat_str(["country_code", "admin1_code"], separator=".").alias("admin1"),
        pl.concat_str(["country_code", "admin1_code", "admin2_code"], separator=".").alias("admin2"),
        pl.col("population").cast(pl.Int64, strict=False).fill_null(0),
    )


def geonames_name_table(places: pl.DataFrame) -> pl.DataFrame:
    texts = pl.concat([
        places.select("geonameid", pl.col("name").alias("text"), pl.lit("name").alias("kind")),
        places.select("geonameid", pl.col("asciiname").alias("text"), pl.lit("name").alias("kind")),
        places.select("geonameid", pl.col("alternatenames").str.split(",").alias("text"), pl.lit("alt").alias("kind")).explode("text"),
    ]).filter(pl.col("text").is_not_null() & pl.col("text").str.contains(LATIN_TEXT))
    short_forms = (
        texts.with_columns(
            pl.col("text").str.replace(SHORT_FORM_SUFFIX, "").str.replace(SPA_PREFIX, "").alias("match_text"),
            pl.lit("kurzform").alias("kind"),
        )
        .filter((pl.col("match_text") != pl.col("text")) & (pl.col("match_text").str.len_chars() >= 3))
    )
    table = pl.concat([texts.with_columns(pl.col("text").alias("match_text")), short_forms])
    keys = table.select("match_text").unique().with_columns(
        pl.col("match_text").map_elements(name_key, return_dtype=pl.String).alias("key")
    )
    return (
        table.join(keys, on="match_text")
        .filter(pl.col("key").str.len_chars() >= 2)
        .with_columns(
            pl.col("key").str.replace_all(" ", "").alias("compact"),
            pl.col("kind").replace_strict(KIND_RANK, return_dtype=pl.Int8).alias("kind_rank"),
            pl.col("text").str.contains(r"[^\x00-\x7F]").alias("decorated"),
        )
        .sort(["kind_rank", "decorated", "text"], descending=[False, True, False])
        .unique(["key", "geonameid"], keep="first", maintain_order=True)
        .join(places.select("geonameid", "country"), on="geonameid")
        .select("key", "compact", "geonameid", "country", "text", "kind")
    )


def place_lookup(places: pl.DataFrame) -> dict[int, Place]:
    return {
        row["geonameid"]: Place(
            row["geonameid"], row["name"], row["country"], row["admin1"] or "", row["admin2"] or "",
            row["lat"], row["lon"], row["population"], row["feature_code"] or "",
        )
        for row in places.iter_rows(named=True)
    }


def admin_points(features: pl.DataFrame) -> dict[str, tuple[float, float]]:
    points = {}
    for row in features.filter(pl.col("feature_code").is_in(["ADM1", "ADM2"])).iter_rows(named=True):
        code = row["admin1"] if row["feature_code"] == "ADM1" else row["admin2"]
        if code:
            points.setdefault(code, (row["lat"], row["lon"]))
    return points


def admin1_names() -> dict[str, tuple[str, int]]:
    table = read_tsv(GEONAMES_DIR / "admin1CodesASCII.txt", ["code", "name", "ascii", "geonameid"])
    return {code: (name, int(geonameid)) for code, name, _, geonameid in table.iter_rows()}


def load_countries() -> tuple[dict[str, Area], dict[str, tuple[float, float]]]:
    areas, points = {}, {}
    for row in read_manual("herkunft_laender.csv"):
        lat, lon = optional_float(row["lat"]), optional_float(row["lon"])
        scope = split_list(row["kandidaten"])
        countries = (row["land"],) if row["land"] else tuple(dict.fromkeys(code.split(".")[0] for code in scope))
        areas[row["name"]] = Area(
            row["name"], "land", frozenset(scope), frozenset(split_list(row["kandidaten_staedte"])), None,
            countries, lat, lon, "land", row["mehrdeutig"] == "1",
        )
        if row["land"] and lat is not None:
            points.setdefault(row["land"], (lat, lon))
    return areas, points


def load_regions(points_by_admin, country_points) -> dict[str, Area]:
    regions = {}
    for row in read_manual("regionen.csv"):
        admins = split_list(row["admin"])
        countries = tuple(split_list(row["laender"]))
        lat, lon, method = optional_float(row["lat"]), optional_float(row["lon"]), "manuell"
        if lat is None and admins and admins[0] in points_by_admin:
            (lat, lon), method = points_by_admin[admins[0]], "admin"
        if lat is None and countries and countries[0] in country_points:
            (lat, lon), method = country_points[countries[0]], "land"
        regions[row["region"]] = Area(
            row["region"], row["typ"], frozenset(admins or countries), frozenset(),
            admins[0] if len(admins) > 1 else None, countries, lat, lon, method,
        )
    return regions


def load_qualifiers() -> dict[tuple[str, str], list[str]]:
    return {(row["typ"], name_key(row["kuerzel"])): split_list(row["ausgeschrieben"]) for row in read_manual("herkunft_zusaetze.csv")}


class AreaIndex:
    def __init__(self, regions: dict[str, Area], countries: dict[str, Area]):
        overlap = set(regions) & set(countries)
        if overlap:
            raise ValueError(f"Bezeichnungen doppelt in regionen.csv und herkunft_laender.csv: {sorted(overlap)}")
        self.by_label = {**countries, **regions}
        self.by_key: dict[str, Area] = {}
        for label, area in self.by_label.items():
            self.by_key.setdefault(name_key(label), area)

    def label(self, label: str | None) -> Area | None:
        if label is None:
            return None
        return self.by_label.get(label) or self.by_key.get(name_key(label))

    def term(self, text: str) -> Area | None:
        return self.by_key.get(name_key(text))


def qualifier_words(qualifier: str, connector_type: str, qualifiers) -> list[str]:
    key = name_key(qualifier)
    for kind in (["an", "in"] if connector_type == "slash" else [connector_type]):
        if (kind, key) in qualifiers:
            return qualifiers[(kind, key)]
    return [qualifier.strip(" .")]


def prefix_expansions(text: str, qualifiers) -> list[str]:
    match = PREFIX.match(text)
    if not match:
        return []
    return [f"{word} {match['rest']}" for word in qualifiers.get(("praefix", name_key(match["prefix"])), [])]


def clean_text(raw: str) -> tuple[str, bool]:
    text = " ".join(raw.split())
    uncertain = bool(STANDALONE_QUESTION.search(text))
    text = POSTAL_SUFFIX.sub("", " ".join(STANDALONE_QUESTION.sub(" ", text).split()))
    return text.strip(" .,;:-'\""), uncertain


def parse_residence(raw: str, areas: AreaIndex, qualifiers) -> Parsed:
    text, uncertain = clean_text(raw)
    parsed = Parsed(raw=raw, display=text, main=text, uncertain=uncertain)
    if "?" in text or len(re.findall(r"[^\W\d_]", text)) < 2:
        parsed.unreadable = True
        return parsed
    main = COMMA_QUALIFIER.sub(" ", text)
    terms = []
    bracket = re.search(r"\(([^)]*)\)", main)
    if bracket:
        terms.append(bracket.group(1))
        main = (main[: bracket.start()] + " " + main[bracket.end():]).strip()
    if UPPER_SILESIA.search(main):
        main = UPPER_SILESIA.sub("", main)
        terms.append("Oberschlesien")
    infix = REFERENCE_INFIX.search(main)
    if infix and infix.start() > 1:
        parsed.reference = main[infix.end():].strip(" .,")
        main = main[: infix.start()]
    if "," in main:
        main, rest = (part.strip() for part in main.split(",", 1))
        prefix = REFERENCE_PREFIX.match(rest)
        if prefix:
            parsed.reference = rest[prefix.end():].strip(" .,")
        elif rest:
            terms.append(rest)
    qualifier = QUALIFIER.match(main)
    if qualifier and len(qualifier["main"]) >= 2:
        connector_type = "an" if qualifier["an"] else "in" if qualifier["in"] else "slash"
        base = qualifier["main"].strip(" .,")
        for word in qualifier_words(qualifier["qual"], connector_type, qualifiers):
            terms.append(word)
            parsed.expansions += [" ".join(f"{base} {connector} {word}".split()) for connector in CONNECTORS[connector_type]]
        main = base
    for term in terms:
        area = areas.term(term) or next(
            (areas.term(word) for word in qualifier_words(term, "in", qualifiers) if areas.term(word)), None
        )
        if area:
            parsed.hints.append(area)
        elif parsed.reference is None and len(name_key(term)) >= 3:
            parsed.reference = term.strip(" .,")
    main = main.strip(" .,;:-")
    if "-" in main:
        head, tail = (part.strip(" .") for part in main.split("-", 1))
        if len(head) >= 3 and len(tail) >= 3:
            parsed.district_of, parsed.district = head, tail
    parsed.main = main or text
    return parsed


def english_transliteration(key: str) -> str:
    for german, english in (("tsch", "ch"), ("sch", "sh"), ("ch", "kh"), ("w", "v"), ("j", "y"), ("ei", "ey")):
        key = key.replace(german, english)
    return key


def spelling_variants(key: str) -> set[str]:
    variants = {
        english_transliteration(key),
        key.replace("ae", "a").replace("oe", "o").replace("ue", "u"),
        re.sub(r"\bc(?=[aoulr])", "k", key),
        key.replace("th", "t"),
        key.replace("dt", "tt"),
        key.replace("w", "v"),
        key[4:] if key.startswith("bad ") else f"bad {key}",
    }
    variants.discard(key)
    return {variant for variant in variants if len(compact(variant)) >= 3}


def residence_queries(parsed: Parsed, qualifiers) -> list[tuple[str, str, str, str, bool]]:
    queries = []

    def add(role, group, label, text):
        key = name_key(text)
        if len(compact(key)) >= 2:
            queries.append((role, group, label, key, False))
            queries.append((role, group, "kompakt" if label == "exakt" else label, compact(key), True))

    def add_variants(role, text):
        texts = [text, *prefix_expansions(text, qualifiers)]
        for index, variant_text in enumerate(texts):
            if index:
                add(role, "variante", "variante", variant_text)
            for variant in spelling_variants(name_key(variant_text)):
                queries.append((role, "variante", "variante", variant, False))
                queries.append((role, "variante", "variante", compact(variant), True))

    if parsed.unreadable:
        return queries
    add("ort", "voll", "exakt", parsed.display)
    for expansion in parsed.expansions:
        add("ort", "voll", "zusatz", expansion)
    add("ort", "kern", "exakt", parsed.main)
    add_variants("ort", parsed.main)
    if parsed.reference:
        add("bezug", "voll", "exakt", parsed.reference)
        add_variants("bezug", parsed.reference)
    if parsed.district_of:
        add("bezug", "voll", "exakt", parsed.district_of)
        add("teil", "voll", "exakt", parsed.district)
        add_variants("teil", parsed.district)
    return queries


def candidate_index(parsed_by_residence: dict[str, Parsed], names: pl.DataFrame, places: dict[int, Place], qualifiers):
    rows = [
        (residence, *query)
        for residence, parsed in parsed_by_residence.items()
        for query in residence_queries(parsed, qualifiers)
    ]
    queries = pl.DataFrame(rows, schema=["residence", "role", "group", "label", "query", "by_compact"], orient="row").unique()
    columns = ["residence", "role", "group", "label", "geonameid", "text", "kind"]
    matches = pl.concat([
        queries.filter(~pl.col("by_compact")).join(names, left_on="query", right_on="key").select(columns),
        queries.filter(pl.col("by_compact")).join(names, left_on="query", right_on="compact").select(columns),
    ]).unique()
    index: dict[str, dict[str, list[Candidate]]] = defaultdict(lambda: defaultdict(list))
    for residence, role, group, label, geonameid, text, kind in matches.iter_rows():
        index[residence][role].append(Candidate(places[geonameid], text, kind, group, label))
    return index


def weight(candidate: Candidate) -> float:
    place = candidate.place
    return (place.population or DEFAULT_POPULATION.get(place.feature_code, 30)) * KIND_WEIGHT[candidate.kind]


def representative(candidates: list[Candidate]) -> Candidate:
    return min(candidates, key=lambda c: (LABEL_RANK[c.label], KIND_RANK[c.kind], c.text))


def ranked_places(weighted: list[tuple[Candidate, float]]) -> list[tuple[Candidate, float]]:
    by_place: dict[int, list[tuple[Candidate, float]]] = defaultdict(list)
    for candidate, value in weighted:
        by_place[candidate.place.geonameid].append((candidate, value))
    options = sorted(
        ((representative([c for c, _ in group]), max(v for _, v in group)) for group in by_place.values()),
        key=lambda option: (-option[1], option[0].place.geonameid),
    )
    merged: list[tuple[Candidate, float]] = []
    for candidate, value in options[:MAX_COMPARED]:
        if not any(distance_km(candidate.place, kept.place) < SAME_PLACE_KM for kept, _ in merged):
            merged.append((candidate, value))
    return merged


def is_former_name_of_town(top: Candidate, options: list[tuple[Candidate, float]]) -> bool:
    if top.kind == "name" or top.place.population >= ESCAPE_CITY:
        return False
    namesakes = [
        candidate.place for candidate, _ in options[1:]
        if candidate.kind == "name"
    ]
    return len(namesakes) >= GENERIC_NAME_COUNT and max(place.population for place in namesakes) < TOWN


def pick_in_tier(candidates: list[Candidate], tier: Tier) -> Pick | None:
    weighted = []
    for candidate in candidates:
        if not tier.accepts_match(candidate):
            continue
        value = weight(candidate) * (CORE_BONUS if tier.is_core(candidate.place) else 1.0)
        accepted = tier.accepts(candidate.place) or (tier.accepts_town(candidate.place) and value >= TOWN)
        if accepted and value >= tier.min_weight:
            weighted.append((candidate, value))
    options = ranked_places(weighted)
    if not options:
        return None
    (top, top_weight), rivals = options[0], [c for c, v in options[1:] if v * DOMINANCE > options[0][1]]
    if tier.country_wide and is_former_name_of_town(top, options):
        return Pick(None, tier.name, True, [c for c, _ in options[: GENERIC_NAME_COUNT + 1]], top_weight)
    if not rivals:
        return Pick(top, tier.name, False, [top], top_weight)
    if len(rivals) == 1:
        return Pick(top, tier.name, True, [top, *rivals], top_weight)
    return Pick(None, tier.name, True, [top, *rivals], top_weight)


def search(candidates: list[Candidate], groups: tuple[str, ...], tiers: list[Tier]) -> Pick | None:
    for group in groups:
        pool = [c for c in candidates if c.group == group]
        for tier in tiers if pool else []:
            pick = pick_in_tier(pool, tier)
            if pick:
                return pick
    return None


@dataclass
class Context:
    region: Area | None
    nation: Area | None
    hints: list[Area]

    def strict_tiers(self) -> list[Tier]:
        tiers = [Tier("zusatz", hint.contains) for hint in self.hints]
        region = self.region
        if region:
            tiers.append(Tier("region", region.contains, region.contains_town, region.is_core))
            if region.core:
                countries = set(region.countries)
                tiers.append(Tier("region_land", lambda place: place.country in countries, min_weight=TOWN, accepts_match=official_name_only))
        return tiers

    def nation_tier(self) -> Tier | None:
        nation = self.nation
        if not nation or not nation.scope:
            return None
        if self.region:
            return Tier("nationalitaet", nation.contains, nation.contains_town, min_weight=TOWN, accepts_match=official_name_only, country_wide=True)
        return Tier("nationalitaet", nation.contains, nation.contains_town, country_wide=True)

    def loose_tiers(self) -> list[Tier]:
        nation = self.nation if self.nation and self.nation.scope else None
        expected = lambda place: place.country in RECEIVING_COUNTRIES or bool(nation and nation.contains(place))
        tiers = [Tier("grossstadt", lambda place: place.population >= CITY, is_core=expected, accepts_match=safe_far_from_context, country_wide=True)]
        if not self.region:
            receiving = lambda place: place.country in RECEIVING_COUNTRIES and place.population >= RECEIVING_TOWN
            tiers.append(Tier("aufnahmeland", receiving, accepts_match=official_name_only))
        if self.region and self.region.is_country:
            tiers.append(Tier("ausserhalb", lambda place: place.population >= RECEIVING_TOWN, accepts_match=official_name_only, country_wide=True))
        if not self.region and not nation:
            tiers.append(Tier("ohne_kontext", lambda place: True, accepts_match=safe_far_from_context, country_wide=True))
        return tiers

    def fuzzy_tiers(self) -> list[tuple[Tier, tuple[str, ...]]]:
        tiers = [(Tier("zusatz", hint.contains), hint.search_countries) for hint in self.hints]
        if self.region:
            tiers.append((Tier("region", self.region.contains, is_core=self.region.is_core), self.region.search_countries))
        elif self.nation and self.nation.scope:
            tiers.append((Tier("nationalitaet", self.nation.contains), self.nation.search_countries))
        return tiers

    def allows_city_escape(self) -> bool:
        return self.region is None or self.region.is_country


def city_escape(candidates: list[Candidate], pick: Pick | None, context: Context) -> Pick | None:
    if pick is None or not context.allows_city_escape():
        return pick
    cities = [c for c in candidates if c.group in DIRECT_GROUPS and c.kind == "name" and c.place.population >= ESCAPE_CITY]
    if not cities:
        return pick
    city = min(cities, key=lambda c: (-weight(c), LABEL_RANK[c.label], KIND_RANK[c.kind], c.place.geonameid))
    if pick.candidate and pick.candidate.place.geonameid == city.place.geonameid:
        return pick
    if weight(city) >= ESCAPE_RATIO * pick.top_weight and pick.top_weight < ESCAPE_CITY:
        return Pick(city, "grossstadt", False, [city], weight(city))
    return pick


def find_place(candidates: list[Candidate], context: Context) -> Pick | None:
    pick = search(candidates, ALL_GROUPS, context.strict_tiers())
    nation_tier = context.nation_tier()
    if pick is None and nation_tier:
        pick = search(candidates, ALL_GROUPS, [nation_tier])
    if pick is None:
        pick = search(candidates, DIRECT_GROUPS, context.loose_tiers())
    return city_escape(candidates, pick, context)


def region_fits_better(named_region: Area, pick: Pick, context: Context) -> bool:
    expected = [area for area in (context.region, context.nation) if area and area.scope]
    if not expected:
        return False
    region_countries = set(named_region.countries)
    region_expected = any(region_countries & set(area.search_countries) for area in expected)
    place_expected = any(area.contains(pick.candidate.place) for area in expected)
    return region_expected and not place_expected


def confirmed_town(pick: Pick | None) -> bool:
    if pick is None or pick.candidate is None:
        return False
    population = pick.candidate.place.population
    return population >= REGION_NAME_CITY or (pick.tier in CONFIRMING_TIERS and population >= TOWN)


def find_near(candidates: list[Candidate], anchor: Place, radius_km: float) -> Pick | None:
    near = [(c, weight(c)) for c in candidates if distance_km(c.place, anchor) <= radius_km]
    if not near:
        return None
    best, value = min(ranked_places(near), key=lambda option: (distance_km(option[0].place, anchor), -option[1]))
    return Pick(best, "bezug", False, [best], value)


class FuzzyIndex:
    def __init__(self, names: pl.DataFrame, places: dict[int, Place]):
        frame = (
            names.filter(pl.col("kind") != "kurzform")
            .unique(["compact", "geonameid"], keep="first", maintain_order=True)
            .with_columns(pl.col("compact").str.slice(0, 1).alias("initial"))
        )
        self.buckets = {
            (country, initial): (group["compact"].to_list(), group["geonameid"].to_list(), group["text"].to_list())
            for (country, initial), group in frame.group_by(["country", "initial"])
        }
        self.places = places
        self.cache: dict[tuple[str, tuple[str, ...]], list[Candidate]] = {}

    def candidates(self, text: str, countries: tuple[str, ...]) -> list[Candidate]:
        query = compact(name_key(text))
        if len(query) < FUZZY_MIN_LENGTH or re.search(r"\d", query):
            return []
        if (query, countries) not in self.cache:
            self.cache[(query, countries)] = self.closest(query, countries)
        return self.cache[(query, countries)]

    def closest(self, query: str, countries: tuple[str, ...]) -> list[Candidate]:
        max_edits = 2 if len(query) >= FUZZY_TWO_EDITS_LENGTH else 1
        found = []
        for country in countries:
            keys, geonameids, texts = self.buckets.get((country, query[0]), ([], [], []))
            for _, edits, position in process.extract(query, keys, scorer=Levenshtein.distance, score_cutoff=max_edits, limit=None):
                found.append((edits, Candidate(self.places[geonameids[position]], texts[position], "name", "fuzzy", "fuzzy")))
        fewest = min((edits for edits, _ in found), default=None)
        return [candidate for edits, candidate in found if edits == fewest]


@dataclass
class LocalName:
    text: str
    preferred: bool


class LocalNames:
    def __init__(self, admin1: dict[str, tuple[str, int]]):
        self.admin1 = admin1
        self.local: dict[int, list[LocalName]] = {}
        self.english: dict[int, set[str]] = {}

    def load(self, places: list[Place]):
        ids_by_country = defaultdict(set)
        for place in places:
            ids_by_country[place.country].add(place.geonameid)
        for code, (_, geonameid) in self.admin1.items():
            ids_by_country[code.split(".")[0]].add(geonameid)
        for country, ids in sorted(ids_by_country.items()):
            if country in LOCAL_LANGUAGES:
                self.read_country(country, ids)

    def read_country(self, country: str, ids: set[int]):
        archive = download(f"{GEONAMES_URL}alternatenames/{country}.zip", ALTERNATE_NAMES_DIR / f"{country}.zip")
        languages = LOCAL_LANGUAGES[country]
        table = (
            read_zipped_tsv(archive, f"{country}.txt", ALTERNATE_NAME_COLUMNS)
            .with_columns(pl.col("geonameid").cast(pl.Int64))
            .filter(
                pl.col("geonameid").is_in(sorted(ids))
                & pl.col("language").is_in([*languages, "en"])
                & pl.col("is_colloquial").ne_missing("1")
                & pl.col("is_historic").ne_missing("1")
                & pl.col("alternate_name").str.contains(LATIN_TEXT)
            )
        )

        def rank(row):
            return (row["is_preferred"] != "1", row["is_short"] == "1", languages.index(row["language"]), row["alternate_name"])

        rows_by_place = defaultdict(list)
        for row in table.iter_rows(named=True):
            if row["language"] == "en":
                self.english.setdefault(row["geonameid"], set()).add(row["alternate_name"])
            else:
                rows_by_place[row["geonameid"]].append(row)
        for geonameid, rows in rows_by_place.items():
            self.local[geonameid] = [LocalName(row["alternate_name"], row["is_preferred"] == "1") for row in sorted(rows, key=rank)]

    def official_name(self, geonameid: int, geonames_name: str, country: str) -> str:
        options = self.local.get(geonameid, [])
        same_name = [option.text for option in options if name_key(option.text) == name_key(geonames_name)]
        if same_name:
            return max(same_name, key=lambda text: (not text.isascii(), -same_name.index(text)))
        preferred = [option.text for option in options if option.preferred]
        english_exonym = geonames_name in self.english.get(geonameid, set())
        if not options or not (preferred or english_exonym):
            return geonames_name
        if len(LOCAL_LANGUAGES[country]) > 1:
            return max((option.text for option in options), key=lambda text: fuzz.ratio(name_key(text), name_key(geonames_name)))
        return (preferred or [option.text for option in options])[0]

    def place_name(self, place: Place) -> str:
        return self.official_name(place.geonameid, place.name, place.country)

    def admin1_name(self, code: str | None) -> str | None:
        if code not in self.admin1:
            return None
        name, geonameid = self.admin1[code]
        return self.official_name(geonameid, name, code.split(".")[0])


@dataclass
class Override:
    region: str | None
    nationality: str | None
    any_region: bool
    place: Place | None
    herkunft_ort: str
    lat: float | None
    lon: float | None
    country: str | None
    precision: str
    confidence: float


def load_overrides(places: dict[int, Place]) -> dict[str, list[Override]]:
    overrides = defaultdict(list)
    for row in read_manual("herkunft_overrides.csv"):
        place = places.get(int(row["geonames_id"])) if row["geonames_id"] else None
        if row["geonames_id"] and place is None:
            raise ValueError(f"GeoNames-ID {row['geonames_id']} für {row['ort_roh']} nicht gefunden")
        overrides[name_key(row["ort_roh"])].append(Override(
            row["region"] or None, row["nationalitaet"] or None, row["kontext"] == "immer", place,
            row["herkunft_ort"], optional_float(row["lat"]), optional_float(row["lon"]), row["land"] or None,
            row["genauigkeit"], optional_float(row["konfidenz"]) or METHOD_CONFIDENCE["override"],
        ))
    for options in overrides.values():
        options.sort(key=lambda o: (o.region is None, o.nationality is None))
    return overrides


class Geocoder:
    def __init__(self, parsed, index, areas, overrides, fuzzy, country_points):
        self.parsed = parsed
        self.index = index
        self.areas = areas
        self.overrides = overrides
        self.fuzzy = fuzzy
        self.country_points = country_points

    def resolve(self, residence: str, region_label: str | None, nationality: str | None) -> Result:
        parsed = self.parsed[residence]
        region = self.areas.label(region_label)
        context = Context(region, self.areas.label(nationality), parsed.hints)
        override = self.matching_override(parsed, region, region_label, nationality)
        if override:
            return override
        if parsed.unreadable:
            return self.region_fallback(parsed.display, region)
        country = self.country_named(parsed)
        if country:
            return self.area_result(parsed.display, country, COUNTRY_NAME_CONFIDENCE)
        pick = self.locate(parsed, context)
        named_region = self.areas.term(parsed.display)
        if named_region and named_region.kind == "region" and named_region.lat is not None:
            if not confirmed_town(pick) or region_fits_better(named_region, pick, context):
                return self.area_result(parsed.display, named_region, REGION_CONFIDENCE)
        if pick and pick.candidate:
            return self.place_result(parsed, pick)
        if pick:
            return self.ambiguous_fallback(parsed.display, region, pick)
        return self.region_fallback(parsed.display, region)

    def locate(self, parsed: Parsed, context: Context) -> Pick | None:
        candidates = self.index.get(parsed.raw, {})
        places = candidates.get("ort", [])
        if parsed.reference:
            anchor = find_place(candidates.get("bezug", []), context)
            if anchor and anchor.candidate:
                near = find_near(places, anchor.candidate.place, REFERENCE_RADIUS_KM)
                near = near or find_near(self.fuzzy.candidates(parsed.main, (anchor.candidate.place.country,)), anchor.candidate.place, REFERENCE_RADIUS_KM)
                if near:
                    return near
        pick = find_place(places, context)
        if pick:
            return pick
        if parsed.district_of:
            anchor = find_place(candidates.get("bezug", []), context)
            if anchor and anchor.candidate:
                part = find_near(candidates.get("teil", []), anchor.candidate.place, DISTRICT_RADIUS_KM)
                if part:
                    return Pick(part.candidate, "stadtteil", False, [anchor.candidate, part.candidate], part.top_weight)
                return Pick(anchor.candidate, "stadt", anchor.ambiguous, [anchor.candidate], anchor.top_weight)
        if parsed.uncertain:
            return None
        return self.fuzzy_pick(parsed.main, context)

    def fuzzy_pick(self, text: str, context: Context) -> Pick | None:
        for tier, countries in context.fuzzy_tiers():
            pick = pick_in_tier(self.fuzzy.candidates(text, countries), tier)
            if pick:
                return pick if pick.candidate and not pick.ambiguous else None
        return None

    def override_options(self, parsed: Parsed) -> list[Override]:
        exact = self.overrides.get(name_key(parsed.raw), [])
        if exact or name_key(parsed.main) == name_key(parsed.raw):
            return exact
        core = self.overrides.get(name_key(parsed.main), [])
        return [o for o in core if o.place and all(hint.contains(o.place) for hint in parsed.hints)]

    def matching_override(self, parsed, region, region_label, nationality) -> Result | None:
        for override in self.override_options(parsed):
            if override.region and override.region != region_label:
                continue
            if override.nationality and override.nationality != nationality:
                continue
            if not (override.region or override.any_region) and override.place and region and not region.contains(override.place):
                continue
            if override.precision == "keine":
                return self.region_fallback(override.herkunft_ort, region)
            return self.override_result(override)
        return None

    @staticmethod
    def override_result(override: Override) -> Result:
        place = override.place
        if place:
            return Result(override.herkunft_ort, place, place.lat, place.lon, place.country, place.admin1, override.precision, "override", override.confidence)
        return Result(override.herkunft_ort, None, override.lat, override.lon, override.country, None, override.precision, "override", override.confidence)

    def country_named(self, parsed: Parsed) -> Area | None:
        area = self.areas.term(parsed.display) or self.areas.term(parsed.main)
        return area if area and area.is_country and area.lat is not None else None

    def place_result(self, parsed: Parsed, pick: Pick) -> Result:
        place = pick.candidate.place
        method = self.method(pick)
        confidence = METHOD_CONFIDENCE[method] * TIER_CONFIDENCE[pick.tier]
        if pick.ambiguous:
            confidence *= AMBIGUOUS_FACTOR
        if parsed.uncertain:
            confidence *= UNCERTAIN_FACTOR
        return Result(
            self.display_name(parsed, pick), place, place.lat, place.lon, place.country,
            place.admin1, "ort", method, round(confidence, 3), pick.ambiguous,
        )

    @staticmethod
    def method(pick: Pick) -> str:
        candidate = pick.candidate
        if pick.tier == "stadtteil":
            return "stadtteil"
        if candidate.label == "fuzzy":
            return "fuzzy"
        if candidate.label != "exakt":
            return "normalisiert"
        return {"name": "exakt", "alt": "alternativname", "kurzform": "kurzform"}[candidate.kind]

    def display_name(self, parsed: Parsed, pick: Pick) -> str:
        if pick.tier == "stadtteil":
            city, part = pick.rivals
            return f"{candidate_display(parsed.district_of, city)}-{candidate_display(parsed.district, part)}"
        if pick.tier == "stadt":
            return parsed.main
        return candidate_display(parsed.main, pick.candidate)

    @staticmethod
    def area_result(display: str, area: Area, confidence: float, ambiguous: bool = False) -> Result:
        admin1 = {code if code.count(".") == 1 else code.rsplit(".", 1)[0] for code in area.scope if "." in code}
        precision = "land" if area.is_country else "region"
        return Result(
            display, None, area.lat, area.lon, area.countries[0] if area.countries else None,
            admin1.pop() if len(admin1) == 1 and not area.is_country else None,
            precision, precision, confidence, ambiguous or area.ambiguous,
        )

    def region_fallback(self, display: str, region: Area | None, ambiguous: bool = False) -> Result:
        if region and region.lat is not None:
            return self.area_result(display, region, REGION_CONFIDENCE, ambiguous)
        return Result(display, ambiguous=ambiguous)

    def ambiguous_fallback(self, display: str, region: Area | None, pick: Pick) -> Result:
        if region and region.lat is not None:
            return self.region_fallback(display, region, ambiguous=True)
        countries = {candidate.place.country for candidate in pick.rivals}
        if len(countries) == 1 and next(iter(countries)) in self.country_points:
            country = countries.pop()
            lat, lon = self.country_points[country]
            return Result(display, None, lat, lon, country, None, "land", "land", AMBIGUOUS_COUNTRY_CONFIDENCE, True)
        return Result(display, ambiguous=True)


def candidate_display(source: str, candidate: Candidate) -> str:
    text = candidate.text
    if candidate.label == "zusatz":
        return text
    if candidate.kind == "kurzform" and candidate.place.country in GERMAN_SPEAKING and name_key(text).startswith(name_key(source) + " "):
        return text
    if candidate.label in ("variante", "fuzzy", "kompakt"):
        return text
    if source.islower() or source.isupper() and len(source) > 3:
        source = source.title()
    for option in (text, candidate.place.name):
        if source.isascii() and not option.isascii() and german_fold(option) == german_fold(source):
            return option
    return source


def results_frame(keys: pl.DataFrame, results: list[Result], local_names: LocalNames) -> pl.DataFrame:
    return keys.with_columns(
        pl.Series("herkunft_ort", [r.herkunft_ort for r in results], dtype=pl.String),
        pl.Series("herkunft_ort_heute", [local_names.place_name(r.place) if r.place else None for r in results], dtype=pl.String),
        pl.Series("herkunft_land_heute", [r.country if r.precision else None for r in results], dtype=pl.String),
        pl.Series("herkunft_admin1_heute", [local_names.admin1_name(r.admin1) for r in results], dtype=pl.String),
        pl.Series("herkunft_lat", [r.lat for r in results], dtype=pl.Float64),
        pl.Series("herkunft_lon", [r.lon for r in results], dtype=pl.Float64),
        pl.Series("geonames_id", [r.place.geonameid if r.place else None for r in results], dtype=pl.Int64),
        pl.Series("geo_precision", [r.precision for r in results], dtype=pl.String),
        pl.Series("geo_method", [r.method for r in results], dtype=pl.String),
        pl.Series("geo_confidence", [r.confidence for r in results], dtype=pl.Float64),
        pl.Series("geo_ambiguous", [r.ambiguous for r in results], dtype=pl.Boolean),
    )


def admin1_names_of(area: Area, local_names: LocalNames) -> str | None:
    if area.is_country:
        return None
    codes = {".".join(code.split(".")[:2]) for code in area.scope if "." in code}
    return ";".join(sorted(local_names.admin1_name(code) or code for code in codes)) or None


def region_table(counts: pl.DataFrame, areas: AreaIndex, local_names: LocalNames) -> pl.DataFrame:
    rows = []
    for label, n_records in counts.iter_rows():
        area = areas.label(label)
        located = area is not None and area.lat is not None
        rows.append({
            "state_or_province_cleaned": label,
            "n_records": n_records,
            "region_lat": area.lat if located else None,
            "region_lon": area.lon if located else None,
            "land_heute": area.countries[0] if located and area.countries else None,
            "laender_heute": ";".join(area.search_countries) if area else None,
            "admin_codes": ";".join(sorted(area.scope)) if area and not area.is_country else None,
            "admin1_heute": admin1_names_of(area, local_names) if area else None,
            "ebene": ("land" if area.is_country else "region") if area else None,
            "methode": area.point_method if located else "nicht_zugeordnet",
        })
    return pl.DataFrame(rows)


def main():
    keys = load_residence_keys()
    features = load_geonames_features()
    place_features = features.filter(pl.col("feature_class") == "P")
    places = place_lookup(place_features)
    names = geonames_name_table(place_features)
    countries, country_points = load_countries()
    areas = AreaIndex(load_regions(admin_points(features), country_points), countries)
    qualifiers = load_qualifiers()
    parsed = {residence: parse_residence(residence, areas, qualifiers) for residence in keys["previous_residence"].unique().sort()}
    index = candidate_index(parsed, names, places, qualifiers)
    geocoder = Geocoder(parsed, index, areas, load_overrides(places), FuzzyIndex(names, places), country_points)
    results = [geocoder.resolve(*row) for row in keys.select(KEY_COLUMNS).iter_rows()]
    local_names = LocalNames(admin1_names())
    local_names.load([r.place for r in results if r.place])
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results_frame(keys, results, local_names).write_parquet(OUTPUT_DIR / "herkunft_geo.parquet")
    region_table(load_region_counts(), areas, local_names).write_csv(OUTPUT_DIR / "region_geo.csv")


if __name__ == "__main__":
    main()
