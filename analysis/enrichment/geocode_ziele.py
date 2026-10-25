import math
import re
import sys
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import NamedTuple

import polars as pl
from rapidfuzz import fuzz, process
from rapidfuzz.distance import Levenshtein
from unidecode import unidecode

ROOT = Path(__file__).resolve().parents[2]
RAW_CSV = ROOT / "data/raw/CHUP_Passengerlists.csv"
GEONAMES = ROOT / "data/external/geonames"
MANUAL = Path(__file__).resolve().parent / "manual"
OUT = ROOT / "data/enrichment"

COUNTRY_DUMPS = ("US", "CA", "BR", "AR", "CL", "PY", "UY", "DE", "AT", "CH")
ADMIN1_NAME_COUNTRIES = ("US", "CA", "BR", "AR", "CL", "PY", "UY", "GB")
DEST_KEY = ["emigration_destination", "US_state_cleaned", "port_of_arrival_country"]
STAY_KEY = ["place_of_stay", "US_state_cleaned", "port_of_arrival_country"]
PORT_KEY = ["port_of_arrival_cleaned", "port_of_arrival_country"]

NYC_COUNTIES = {"005", "047", "061", "081", "085"}
NEW_YORK_METRO = {("NY", c) for c in NYC_COUNTIES | {"059", "087", "103", "119"}} | {
    ("NJ", c) for c in ("003", "013", "017", "023", "025", "027", "031", "035", "039")
}
METRO_STATES = {"NY", "NJ", "CT"}

UMLAUTS = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue"})
TOKEN_EXPANSIONS = {
    "st": "saint", "ste": "sainte", "sankt": "saint", "sta": "santa", "sto": "santo",
    "ft": "fort", "mt": "mount", "hts": "heights", "spgs": "springs", "jct": "junction", "junct": "junction",
}
FIRST_TOKEN_VARIANTS = {
    "n": ["north"], "no": ["north"], "nord": ["north"], "s": ["south", "sao", "san", "santa", "santo", "saint"],
    "so": ["south"], "sud": ["south"], "e": ["east"], "ost": ["east"], "w": ["west"], "neu": ["new"],
    "new": ["neu"], "mr": ["mount"], "pt": ["port", "point"], "gr": ["grand", "great"], "ny": ["new york"],
    "coll": ["college"], "ind": ["indiana"], "pto": ["puerto", "porto"], "pta": ["punta", "ponta"],
    "sa": ["santa", "sao", "san"],
}
ADDRESS_WORDS = re.compile(
    r"\b(str|street|ave|avenue|av|road|rd|place|pl|blvd|boulevard|lane|ln|drive|dr|box|strasse|weg|platz|allee|apt|route|rfd|r f d)\b"
)
NOISE = re.compile(
    r"^(see col|siehe|unbekannt|unknown|transit|gestrichen|kein|ohne|keine|nicht|none|dito|do|wie oben|\W*)$"
    r"|^(see col|rundreise|transit|reise bis)\b|reise$|fahrt$|\brundreise\b|\bund zuruck\b"
)
PERSON_MARKERS = re.compile(r"^(c/o|bei |b/|per adr|adr\.|mrs?\.? |herrn? |frau |familie |fam\. )", re.I)
NEAR_MARKERS = re.compile(r"\s+(?:bei|b\.|near|nahe|nr\.|kr\.|kreis|bez\.|amt|post)\s+", re.I)
LATIN_LABEL = r"^[\p{Latin}\p{N}\p{Zs}\p{P}\p{M}'’`]+$"

SCORE_COUNTRY = 8.0
SCORE_ADMIN1 = 6.5
SCORE_REGION = 6.0
PORT_BONUS = 1.5
PORT_BONUS_US_WITHOUT_STATE = 0.75
HOME_BONUS = {"DE": 0.5}
VOTE_SHARE = 0.8
VOTE_MIN_ROWS = 5
PRIMARY_BONUS = 1.5
FCODE_BONUS = {"PPLC": 0.2, "PPLA": 0.1, "PPLX": -0.2, "PPLH": -0.5}
DISTINCT_KM = 25.0
CLEAR_MARGIN = 1.0
ACCEPT_MARGIN = 0.5


class Place(NamedTuple):
    gid: int
    name: str
    cc: str
    a1: str | None
    a2: str | None
    pop: int
    lat: float
    lon: float
    fcode: str


class Area(NamedTuple):
    key: str
    kind: str
    cc: str
    a1: str | None
    name: str
    lat: float | None
    lon: float | None
    gid: int | None
    precision: str | None


class Scope(NamedTuple):
    cc: str
    a1: str | None = None
    counties: frozenset | None = None


@dataclass(frozen=True)
class Qualifier:
    scopes: tuple
    strong: bool
    is_name: bool
    display: str | None
    point: str | None
    precision: str | None


@dataclass
class Candidate:
    score: float
    primary: bool
    place: Place | None = None
    area: Area | None = None


@dataclass
class Result:
    typ: str = "unklar"
    method: str = "kein_treffer"
    ort: str | None = None
    land: str | None = None
    us_state: str | None = None
    lat: float | None = None
    lon: float | None = None
    gid: int | None = None
    precision: str | None = None
    confidence: float | None = None
    ambiguous: bool = False
    place: Place | None = None


def normalize(text):
    text = unidecode(text).lower().replace("&", " and ")
    tokens = re.sub(r"[^a-z0-9]+", " ", text).split()
    return " ".join(TOKEN_EXPANSIONS.get(token, token) for token in tokens)


def compact_key(text):
    return re.sub(r"[^a-z]", "", unidecode(text.translate(UMLAUTS)).lower())


def query_variants(text):
    base = normalize(text)
    variants = [base, normalize(text.translate(UMLAUTS))]
    tokens = base.split()
    if len(tokens) > 1:
        for replacement in FIRST_TOKEN_VARIANTS.get(tokens[0], []):
            variants.append(" ".join([replacement, *tokens[1:]]))
    glued = re.sub(r"\b(neu|new)(york|jersey|orleans|haven|britain|brunswick|rochelle|ulm|braunfels)\b", r"new \2", base)
    variants.append(glued)
    if len(tokens) > 1 and tokens[-1] in ("city", "town", "village"):
        variants.append(" ".join(tokens[:-1]))
    pieces = [normalize(piece) for piece in re.split(r"\s*-\s*", text) if piece.strip()]
    if len(pieces) > 1:
        variants.extend([pieces[0], pieces[-1]])
    return list(dict.fromkeys(v for v in variants if v))


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def read_records():
    columns = [
        "emigration_destination", "US_state_cleaned", "port_of_arrival_cleaned", "port_of_arrival_country",
        "port_of_arrival_LAT", "port_of_arrival_LON", "place_of_stay",
    ]
    frame = pl.read_csv(RAW_CSV, separator="@", infer_schema=False, quote_char=None, columns=columns)
    return frame.with_columns(pl.col(c).str.strip_chars().replace("", None) for c in columns)


GEONAMES_COLUMNS = [
    "geonameid", "name", "asciiname", "alternatenames", "lat", "lon", "fclass", "fcode", "cc", "cc2",
    "a1", "a2", "a3", "a4", "pop", "elevation", "dem", "timezone", "modified",
]


def read_geonames(source):
    frame = pl.read_csv(
        source, separator="\t", has_header=False, new_columns=GEONAMES_COLUMNS, quote_char=None, infer_schema=False
    )
    return frame.select(
        pl.col("geonameid").cast(pl.Int64), "name", "asciiname", "alternatenames",
        pl.col("lat").cast(pl.Float64), pl.col("lon").cast(pl.Float64), "fclass", "fcode", "cc", "a1", "a2",
        pl.col("pop").cast(pl.Int64, strict=False).fill_null(0),
    )


def read_country_dump(cc):
    folder = GEONAMES / "countries"
    if (folder / f"{cc}.txt").exists():
        return read_geonames(folder / f"{cc}.txt")
    with zipfile.ZipFile(folder / f"{cc}.zip") as archive:
        return read_geonames(archive.read(f"{cc}.txt"))


def load_features():
    dumps = pl.concat([read_country_dump(cc) for cc in COUNTRY_DUMPS])
    dumps = dumps.filter(pl.col("fclass").is_in(["P", "A", "T", "L"]))
    cities = read_geonames(GEONAMES / "cities500.txt").filter(~pl.col("cc").is_in(COUNTRY_DUMPS))
    return pl.concat([cities, dumps])


def settlement_places(features):
    return features.filter((pl.col("fclass") == "P") & ~pl.col("fcode").is_in(["PPLQ", "PPLW", "PPLCH"]))


def place_records(places):
    rows = places.select("geonameid", "name", "cc", "a1", "a2", "pop", "lat", "lon", "fcode").iter_rows()
    return {row[0]: Place(*row) for row in rows}


def label_table(places):
    primary = pl.concat([
        places.select("geonameid", pl.col("name").alias("label")),
        places.select("geonameid", pl.col("asciiname").alias("label")),
    ]).with_columns(pl.lit(True).alias("primary"))
    alternates = (
        places.select("geonameid", pl.col("alternatenames").str.split(",").alias("label"))
        .explode("label")
        .filter(pl.col("label").str.len_chars() >= 4)
        .with_columns(pl.lit(False).alias("primary"))
    )
    labels = pl.concat([primary, alternates]).drop_nulls("label")
    return labels.filter(pl.col("label").str.contains(LATIN_LABEL))


def normalized_labels(labels):
    unique = labels.select("label").unique()
    keyed = unique.with_columns(
        pl.col("label").map_elements(normalize, return_dtype=pl.String).alias("plain"),
        pl.col("label").map_elements(lambda s: normalize(s.translate(UMLAUTS)), return_dtype=pl.String).alias("umlaut"),
    )
    keyed = pl.concat([
        keyed.select("label", pl.col("plain").alias("key")),
        keyed.select("label", pl.col("umlaut").alias("key")),
    ]).unique()
    return labels.join(keyed, on="label").filter(pl.col("key") != "")


SHORT_FORM_JOINERS = (" (", " am ", " an der ", " an ", " im ", " in ", " ob der ", " bei ", " a. ")


def short_form_flags(keyed, places):
    names = places.select("geonameid", pl.col("name").alias("full"))
    keyed = keyed.join(names, on="geonameid", how="left")
    short_form = pl.any_horizontal(pl.col("full").str.starts_with(pl.col("label") + joiner) for joiner in SHORT_FORM_JOINERS)
    return keyed.with_columns((pl.col("primary") | short_form.fill_null(False)).alias("primary")).drop("full")


def build_name_index(places):
    keyed = short_form_flags(normalized_labels(label_table(places)), places)
    grouped = keyed.group_by("key", "geonameid").agg(pl.col("primary").any().alias("primary")).sort("key", "geonameid")
    index = defaultdict(dict)
    for key, gid, primary in grouped.iter_rows():
        index[key][gid] = primary
    return index


def load_admin1(features):
    names = pl.read_csv(
        GEONAMES / "admin1CodesASCII.txt", separator="\t", has_header=False, quote_char=None,
        new_columns=["code", "name", "asciiname", "geonameid"], infer_schema=False,
    ).with_columns(pl.col("geonameid").cast(pl.Int64))
    points = features.filter(pl.col("fcode") == "ADM1").select("geonameid", "lat", "lon")
    joined = names.join(points, on="geonameid", how="left").sort("code")
    admin1 = {}
    for code, name, _, gid, lat, lon in joined.iter_rows():
        cc, a1 = code.split(".", 1)
        has_point = lat is not None
        admin1[code] = Area(code, "bundesstaat", cc, a1, name, lat, lon, gid if has_point else None,
                            "bundesstaat" if has_point else None)
    return admin1


def read_country_info():
    lines = (GEONAMES / "countryInfo.txt").read_text(encoding="utf-8").splitlines()
    rows = [line.split("\t") for line in lines if line and not line.startswith("#")]
    return {row[0]: (row[4], row[8]) for row in rows if row[0] not in ("CS", "AN")}


def country_points(places):
    medians = places.group_by("cc").agg(pl.col("lat").median().alias("mlat"), pl.col("lon").median().alias("mlon"))
    distance = (pl.col("lat") - pl.col("mlat")) ** 2 + (pl.col("lon") - pl.col("mlon")) ** 2
    nearest = places.join(medians, on="cc").group_by("cc").agg(
        pl.col("lat").sort_by(distance).first().alias("lat"),
        pl.col("lon").sort_by(distance).first().alias("lon"),
    )
    return {cc: (lat, lon) for cc, lat, lon in nearest.iter_rows()}


def load_countries(places):
    info = read_country_info()
    points = country_points(places.filter(pl.col("pop") >= 500))
    countries = {}
    for cc, (name, _) in info.items():
        lat, lon = points.get(cc, (None, None))
        countries[cc] = Area(cc, "land", cc, None, name, lat, lon, None, "land" if lat is not None else None)
    return countries, {cc: continent for cc, (_, continent) in info.items()}


class Gazetteer:
    def __init__(self):
        self.features = load_features()
        places = settlement_places(self.features)
        self.places = place_records(places)
        self.index = build_name_index(places)
        self.admin1 = load_admin1(self.features)
        self.countries, self.continents = load_countries(places)
        self.by_admin1 = defaultdict(list)
        for place in self.places.values():
            self.by_admin1[(place.cc, place.a1)].append(place)
            self.by_admin1[(place.cc, None)].append(place)
        self.scope_names = {}
        self.feature_cache = {}

    def lookup(self, key):
        return [(self.places[gid], primary) for gid, primary in self.index.get(key, {}).items()]

    def feature(self, gid):
        if gid not in self.feature_cache:
            row = self.features.filter(pl.col("geonameid") == gid).row(0, named=True)
            self.feature_cache[gid] = row
        return self.feature_cache[gid]

    def area_for(self, code):
        return self.admin1.get(code) if "." in code else self.countries.get(code)

    def names_in_scope(self, scope):
        if scope not in self.scope_names:
            members = [p for p in self.by_admin1[(scope.cc, scope.a1)] if in_scope(p, scope)]
            self.scope_names[scope] = ([normalize(p.name) for p in members], members)
        return self.scope_names[scope]


def in_scope(place, scope):
    if place.cc != scope.cc:
        return False
    if scope.a1 is not None and place.a1 != scope.a1:
        return False
    return scope.counties is None or place.a2 in scope.counties


def area_in_scope(area, scope):
    if area.cc != scope.cc:
        return False
    if area.kind == "land":
        return scope.a1 is None
    if area.kind == "region":
        return scope.a1 is None or area.a1 == scope.a1
    return scope.a1 is None or (area.a1 == scope.a1 and scope.counties is None)


def parse_scope(text):
    match = re.fullmatch(r"([A-Z]{2})(?:\.([A-Z0-9]+))?(?:\[([0-9|]+)\])?", text.strip())
    cc, a1, counties = match.groups()
    return Scope(cc, a1, frozenset(counties.split("|")) if counties else None)


def auto_qualifiers(gazetteer):
    entries = {}
    for area in gazetteer.admin1.values():
        if area.cc in ADMIN1_NAME_COUNTRIES:
            key = compact_key(area.name)
            state = Qualifier((Scope(area.cc, area.a1),), True, True, None, None, None)
            entries[key] = merge_qualifiers(entries.get(key), state)
        if area.cc == "US":
            entries[area.a1.lower()] = Qualifier((Scope("US", area.a1),), True, False, None, None, None)
    for cc, area in gazetteer.countries.items():
        entries[compact_key(area.name)] = Qualifier((Scope(cc),), False, True, None, None, None)
    return entries


def curated_qualifiers():
    table = pl.read_csv(MANUAL / "ziel_qualifier.csv", infer_schema=False)
    merged = {}
    for row in table.iter_rows(named=True):
        key = compact_key(row["kuerzel"])
        scopes = tuple(parse_scope(s) for s in (row["bereiche"] or "").split(";") if s)
        strong = row["stark"] == "1" and all(s.a1 for s in scopes)
        new = Qualifier(scopes, strong, row["art"] == "name", row["anzeige"], row["punkt"], row["genauigkeit"])
        merged[key] = merge_qualifiers(merged.get(key), new)
    return merged


def merge_qualifiers(old, new):
    if old is None:
        return new
    scopes = tuple(dict.fromkeys(old.scopes + new.scopes))
    return Qualifier(scopes, old.strong and new.strong, old.is_name or new.is_name,
                     old.display or new.display, old.point or new.point, old.precision or new.precision)


def load_qualifiers(gazetteer):
    return auto_qualifiers(gazetteer) | curated_qualifiers()


def name_areas(qualifiers):
    by_name = {}
    for key, qualifier in qualifiers.items():
        if qualifier.is_name:
            by_name[key] = qualifier
    return by_name


@dataclass(frozen=True)
class Override:
    target: str
    typ: str
    display: str | None
    confidence: float | None
    precision: str | None


def load_overrides():
    table = pl.read_csv(MANUAL / "ziel_overrides.csv", infer_schema=False)
    overrides = {}
    for row in table.iter_rows(named=True):
        confidence = float(row["konfidenz"]) if row["konfidenz"] else None
        override = Override(row["ziel"], row["ziel_typ"], row["ziel_ort"], confidence, row["genauigkeit"])
        for text in {normalize(row["ziel_text"]), normalize(row["ziel_text"].translate(UMLAUTS))}:
            overrides[(text, row["us_state"] or "*", row["hafen_land"] or "*")] = override
    return overrides


def find_override(overrides, text, us_state, port_country):
    key = normalize(text)
    for state in (us_state or "<leer>", "*"):
        for port in (port_country or "<leer>", "*"):
            if (key, state, port) in overrides:
                return overrides[(key, state, port)]
    return None


@dataclass
class Parsed:
    names: list
    qualifiers: list
    has_address: bool


def split_parts(text):
    text = re.sub(r"[(\[]([^)\]]*)[)\]]", r", \1", text)
    parts = re.split(r"\s*[,;/]\s*|\s+-\s+|\s*:\s+", text)
    return [p.strip(" .-'\"?!") for p in parts if p.strip(" .-'\"?!")]


def is_address(part):
    lowered = unidecode(part).lower()
    return bool(re.search(r"\d", lowered)) or bool(ADDRESS_WORDS.search(lowered))


def trailing_qualifier(part, qualifiers):
    tokens = part.split()
    for size in (2, 1):
        if len(tokens) > size:
            key = compact_key(" ".join(tokens[-size:]))
            if key in qualifiers and qualifiers[key].scopes and not qualifiers[key].is_name:
                return " ".join(tokens[:-size]), key
    return None


def leading_qualifier(part, qualifiers):
    tokens = part.split()
    if len(tokens) > 1:
        key = compact_key(tokens[0])
        qualifier = qualifiers.get(key)
        if qualifier and qualifier.scopes and not qualifier.is_name and all(s.cc == "US" for s in qualifier.scopes):
            return " ".join(tokens[1:]), key
    return None


def compatible(qualifier, us_state):
    state_scope = state_scope_for(us_state)
    return state_scope is None or any(s.cc == state_scope.cc for s in qualifier.scopes)


def parse_destination(text, qualifiers):
    names, found, has_address = [], [], False
    for position, part in enumerate(split_parts(text)):
        key = compact_key(part)
        if key in qualifiers and qualifiers[key].scopes == () or PERSON_MARKERS.search(part):
            continue
        if position > 0 and key in qualifiers:
            found.append(key)
        elif is_address(part):
            has_address = True
        else:
            names.extend(NEAR_MARKERS.split(part))
    return Parsed(names, found, has_address)


class Resolver:
    def __init__(self, gazetteer, qualifiers, overrides, state_votes):
        self.gazetteer = gazetteer
        self.qualifiers = qualifiers
        self.areas_by_name = name_areas(qualifiers)
        self.overrides = overrides
        self.state_votes = state_votes

    def resolve(self, text, us_state, port_country, state_is_strong=True):
        result = self.resolve_once(text, us_state, port_country, state_is_strong)
        state = dominant_state(self.state_votes.get(normalize(text)))
        if state is None or not self.needs_vote(result, us_state, port_country, state):
            return result
        voted = self.resolve_once(text, state, port_country, state_is_strong)
        if voted.precision != "ort" or voted.method.startswith(("fallback", "mehrdeutig", "staat_")):
            return result
        voted.method, voted.ambiguous = "staat_aus_korpus", True
        voted.confidence = min(voted.confidence or 0.7, 0.75)
        return voted

    def needs_vote(self, result, us_state, port_country, state):
        if result.method == "override" or result.us_state == state:
            return False
        if us_state == "uneindeutig":
            return True
        if us_state is None:
            if "US" not in self.port_countries(port_country, None, True):
                return False
            return result.precision is None or (result.land == "US" and (result.precision != "ort" or result.ambiguous))
        return result.method in ("staat_widerspruch", "fallback_bundesstaat")

    def resolve_once(self, text, us_state, port_country, state_is_strong):
        override = find_override(self.overrides, text, us_state, port_country)
        if override:
            return self.from_override(override)
        if NOISE.search(normalize(text)):
            return Result(method="kein_ort")
        whole = self.whole_string_area(text, us_state)
        if whole is not None:
            return whole
        parsed = parse_destination(text, self.qualifiers)
        scopes = self.scope_chain(parsed.qualifiers, us_state, state_is_strong)
        port_ccs = self.port_countries(port_country, us_state, state_is_strong)
        for position, name in enumerate(parsed.names):
            name, part_scopes = self.split_trailing_qualifier(name, parsed, us_state, state_is_strong, scopes)
            result = self.resolve_name(name, us_state, port_country, part_scopes, port_ccs)
            if result is not None:
                return self.finish(result, parsed, position)
        if not parsed.names and parsed.qualifiers:
            return self.qualifier_area(parsed.qualifiers[0])
        return self.fallback(scopes, parsed)

    def whole_string_area(self, text, us_state):
        key = compact_key(text)
        qualifier = self.qualifiers.get(key)
        if qualifier is None or not qualifier.scopes or not compatible(qualifier, us_state):
            return None
        if qualifier.is_name:
            if len(split_parts(text)) == 1 or self.gazetteer.lookup(normalize(text)):
                return None
            return self.qualifier_area(key)
        scope = qualifier.scopes[0]
        if len(qualifier.scopes) == 1 and scope.a1 and (scope.counties is None or qualifier.display):
            return self.qualifier_area(key)
        return None

    def split_trailing_qualifier(self, name, parsed, us_state, state_is_strong, scopes):
        if self.candidates(name)[0]:
            return name, scopes
        split = trailing_qualifier(name, self.qualifiers) or leading_qualifier(name, self.qualifiers)
        if split is None or not compatible(self.qualifiers[split[1]], us_state) or not self.candidates(split[0])[0]:
            return name, scopes
        stripped, key = split
        return stripped, self.scope_chain([*parsed.qualifiers, key], us_state, state_is_strong)

    def finish(self, result, parsed, position):
        if position > 0 and result.precision == "ort":
            result = self.coarsen(result)
        if parsed.has_address and result.typ == "ort":
            result.typ = "adresse"
        return result

    def coarsen(self, result):
        place = result.place
        state = self.gazetteer.admin1.get(f"{place.cc}.{place.a1}")
        area = state if state is not None and state.lat is not None else self.gazetteer.countries.get(place.cc)
        coarse = self.area_result(area, "ort", "folgeteil", 0.6)
        coarse.ort = None
        return coarse

    def port_countries(self, port_country, us_state, state_is_strong):
        if port_country is None:
            return {} if state_is_strong else {"US": PORT_BONUS}
        ccs = set()
        for label in re.split(r"\s*,\s*", port_country.strip('"')):
            qualifier = self.qualifiers.get(compact_key(label))
            if qualifier is not None and qualifier.is_name:
                ccs |= {scope.cc for scope in qualifier.scopes}
        weights = {cc: PORT_BONUS for cc in ccs}
        if not state_is_strong:
            weights["US"] = PORT_BONUS
        elif us_state is None and "US" in weights:
            weights["US"] = PORT_BONUS_US_WITHOUT_STATE
        return weights

    def scope_chain(self, qualifier_keys, us_state, state_is_strong):
        state_scope = state_scope_for(us_state)
        chain = []
        for key in qualifier_keys:
            qualifier = self.qualifiers[key]
            origin = "qualifier" if qualifier.strong else "qualifier_schwach"
            if state_scope is not None:
                narrowed = tuple(n for n in (narrow(s, state_scope) for s in qualifier.scopes) if n is not None)
                if narrowed:
                    chain.append((narrowed, qualifier.strong, origin))
            chain.append((qualifier.scopes, qualifier.strong, origin))
        if state_scope is not None:
            chain.append(((state_scope,), state_is_strong, "staat"))
        return chain

    def resolve_name(self, name, us_state, port_country, scopes, port_ccs):
        override = find_override(self.overrides, name, us_state, port_country)
        if override:
            return self.from_override(override)
        candidates, method = self.candidates(name)
        for scope_set, strong, origin in scopes:
            result = self.resolve_in_scope(name, candidates, method, scope_set, strong, origin, us_state)
            if result is not None:
                return result
        return self.resolve_globally(name, candidates, method, port_ccs)

    def resolve_in_scope(self, name, candidates, method, scope_set, strong, origin, us_state):
        inside = [c for c in candidates if candidate_in(c, scope_set)]
        if origin == "qualifier_schwach":
            inside = [c for c in inside if c.primary]
        corrected = self.metro_correction(candidates, inside, us_state, origin)
        if corrected is not None:
            return corrected
        trusted = inside if origin != "staat" else [c for c in inside if trustworthy(c, name)]
        if trusted:
            return self.choose(trusted, method, origin, scope_set)
        found = self.fuzzy_or_prefix(name, scope_set)
        if found is None and strong:
            found = self.dominant_elsewhere(candidates, scope_set, method)
        if found is None and inside:
            found = self.historic_name(inside, method, origin, scope_set)
        if found is None and strong:
            found = self.state_conflict(candidates, origin) or self.scope_fallback(scope_set)
        return found

    def historic_name(self, inside, method, origin, scope_set):
        result = self.choose(inside, method, origin, scope_set)
        if result.precision == "ort":
            result.method, result.ambiguous = "historischer_name", True
            result.confidence = min(result.confidence or 0.6, 0.6)
        return result

    def resolve_globally(self, name, candidates, method, port_ccs):
        if candidates and not self.only_remote_hamlets(candidates, port_ccs):
            return self.choose(candidates, method, "global", None, port_ccs)
        found = self.fuzzy_in_ports(name, port_ccs) if port_ccs else None
        if found is None and candidates:
            return self.choose(candidates, method, "global", None, port_ccs)
        return found

    def only_remote_hamlets(self, candidates, port_ccs):
        if not port_ccs:
            return False
        nearby = set(port_ccs) | set(HOME_BONUS)
        return all(c.place is not None and c.place.cc not in nearby and c.place.pop < 1000 for c in candidates)

    def candidates(self, name):
        for position, key in enumerate(query_variants(name)):
            places = self.gazetteer.lookup(key)
            areas = self.name_area_candidates(compact_key(name) if position == 0 else compact_key(key))
            if places or areas:
                method = self.match_method(name, places, position)
                return [self.place_candidate(p, primary) for p, primary in places] + areas, method
        return [], None

    def match_method(self, name, places, position):
        if any(p.name == name.strip() for p, _ in places):
            return "exakt"
        return "normalisiert" if position <= 1 else "variante"

    def place_candidate(self, place, primary):
        score = math.log10(max(place.pop, 100)) + FCODE_BONUS.get(place.fcode, 0.0)
        if primary:
            score += PRIMARY_BONUS
        return Candidate(score, primary, place=place)

    def name_area_candidates(self, key):
        qualifier = self.areas_by_name.get(key)
        if qualifier is None or not qualifier.scopes:
            return []
        area = self.qualifier_point(qualifier)
        return [Candidate(area_score(area), True, area=area)] if area is not None else []

    def qualifier_point(self, qualifier):
        scope = qualifier.scopes[0]
        composite = len(qualifier.scopes) > 1 and qualifier.display
        if composite and qualifier.point is None:
            return Area("region:" + qualifier.display, "region", "", None, qualifier.display, None, None, None, None)
        base = self.gazetteer.area_for(scope_code(scope))
        if base is None:
            return None
        lat, lon, gid, precision = self.point_of(qualifier, scope, base)
        if qualifier.precision == "land":
            kind = "land"
        elif qualifier.display or scope.counties:
            kind = "region"
        else:
            kind = base.kind
        return Area(base.key, kind, scope.cc, scope.a1, qualifier.display or base.name, lat, lon, gid, precision)

    def point_of(self, qualifier, scope, base):
        if qualifier.point:
            if "." in qualifier.point:
                area = self.gazetteer.admin1[qualifier.point]
                return area.lat, area.lon, area.gid, qualifier.precision or "bundesstaat"
            feature = self.gazetteer.feature(int(qualifier.point))
            return feature["lat"], feature["lon"], feature["geonameid"], qualifier.precision or "bundesstaat"
        if base.lat is not None:
            return base.lat, base.lon, base.gid, base.precision
        country = self.gazetteer.countries[scope.cc]
        return country.lat, country.lon, None, "land"

    def choose(self, candidates, method, origin, scope_set, port_ccs=None):
        scored = sorted(candidates, key=lambda c: (-(c.score + port_bonus(c, port_ccs)), *tie_breaker(c)))
        best = prefer_eponymous_seat(scored)
        top = best.score + port_bonus(best, port_ccs)
        rivals = [c for c in scored if c is not best and not same_referent(c, best) and not paired(c, best)]
        margin = top - (rivals[0].score + port_bonus(rivals[0], port_ccs)) if rivals else 99.0
        if margin >= ACCEPT_MARGIN:
            return self.candidate_result(best, method, origin, margin)
        close = [best] + [c for c in rivals if top - (c.score + port_bonus(c, port_ccs)) < ACCEPT_MARGIN]
        return self.ambiguous_fallback(close, scope_set)

    def candidate_result(self, candidate, method, origin, margin):
        ambiguous = margin < CLEAR_MARGIN
        confidence = match_confidence(method, origin, ambiguous, candidate.primary)
        if candidate.area is not None:
            result = self.area_result(candidate.area, area_typ(candidate.area), method, confidence)
        else:
            result = self.place_result(candidate.place, method, confidence)
        result.method = method if candidate.primary or candidate.area else "alternativname"
        result.ambiguous = ambiguous
        return result

    def place_result(self, place, method, confidence):
        return Result(
            typ="ort", method=method, ort=place.name, land=place.cc,
            us_state=place.a1 if place.cc == "US" else None, lat=place.lat, lon=place.lon, gid=place.gid,
            precision="ort", confidence=confidence, place=place,
        )

    def area_result(self, area, typ, method, confidence):
        if area.precision is None or area.lat is None:
            return Result(typ=typ, method=method, ort=area.name or None, land=area.cc if area.kind != "region" or area.a1 else None,
                          confidence=confidence)
        return Result(
            typ=typ, method=method, ort=area.name, land=area.cc,
            us_state=area.a1 if area.cc == "US" and area.a1 and area.precision != "land" else None,
            lat=area.lat, lon=area.lon, gid=area.gid, precision=area.precision, confidence=confidence,
        )

    def ambiguous_fallback(self, close, scope_set):
        areas = {common_area(c) for c in close}
        if len(areas) == 1:
            code = areas.pop()
            area = self.gazetteer.area_for(code)
            if area is not None and area.lat is not None:
                result = self.area_result(area, "ort", "mehrdeutig_" + area.kind, 0.7)
                result.ort, result.ambiguous = None, True
                return result
        countries = {c.place.cc if c.place else c.area.cc for c in close}
        if len(countries) == 1:
            result = self.area_result(self.gazetteer.countries[countries.pop()], "ort", "mehrdeutig_land", 0.7)
            result.ort, result.ambiguous = None, True
            return result
        return Result(typ="ort", method="mehrdeutig", ambiguous=True)

    def state_conflict(self, candidates, origin):
        if origin != "staat":
            return None
        elsewhere = [c for c in candidates if c.place is not None and c.primary and c.place.cc == "US" and c.place.pop >= 1000]
        if not elsewhere:
            return None
        return Result(typ="ort", method="staat_widerspruch", ambiguous=True)

    def metro_correction(self, candidates, inside, us_state, origin):
        if origin != "staat" or us_state not in METRO_STATES:
            return None
        metro = [c for c in candidates if c.place is not None and c.primary and c.place.cc == "US"
                 and (c.place.a1, c.place.a2) in NEW_YORK_METRO and c.place.a1 != us_state]
        if not metro:
            return None
        best = max(metro, key=lambda c: c.place.pop)
        largest_inside = max((c.place.pop for c in inside if c.place is not None and c.primary), default=0)
        if inside and any(c.area is not None for c in inside):
            return None
        if best.place.pop < 10 * max(largest_inside, 500):
            return None
        result = self.place_result(best.place, "staat_korrigiert", 0.65)
        result.ambiguous = True
        return result

    def dominant_elsewhere(self, candidates, scope_set, method):
        countries = {s.cc for s in scope_set}
        pool = [c for c in candidates if c.place is not None and c.place.cc in countries and c.primary]
        if not pool:
            return None
        pool.sort(key=lambda c: (-c.score, *tie_breaker(c)))
        best = pool[0]
        rivals = [c for c in pool[1:] if not same_referent(c, best)]
        margin = best.score - rivals[0].score if rivals else 99.0
        if best.place.pop >= 100_000 and margin >= 1.5:
            result = self.place_result(best.place, method, 0.6)
            result.method = "name_gegen_staat"
            return result
        return None

    def scope_fallback(self, scope_set):
        if len(scope_set) != 1:
            ccs = {s.cc for s in scope_set}
            if len(ccs) != 1:
                return None
            scope_set = (Scope(ccs.pop()),)
        scope = scope_set[0]
        area = self.gazetteer.area_for(scope_code(scope))
        if area is None:
            return None
        if area.lat is None:
            area = self.gazetteer.countries[scope.cc]
        result = self.area_result(area, "ort", "fallback_" + area.kind, 0.75)
        result.ort = None
        return result

    def fuzzy_or_prefix(self, name, scope_set):
        if len(scope_set) != 1:
            return None
        if scope_set[0].a1 is None:
            return self.fuzzy_in_ports(name, {scope_set[0].cc: PORT_BONUS})
        query = normalize(name)
        if len(query) < 5:
            return None
        names, members = self.gazetteer.names_in_scope(scope_set[0])
        match = fuzzy_pick(query, names, members) or prefix_pick(query, names, members)
        if match is None:
            return None
        place, method = match
        return self.place_result(place, method, 0.7 if method == "fuzzy" else 0.65)

    def fuzzy_in_ports(self, name, port_ccs):
        query = normalize(name)
        port_ccs = [cc for cc, weight in port_ccs.items() if weight >= PORT_BONUS]
        if len(query) < 6 or len(port_ccs) != 1:
            return None
        names, members = self.gazetteer.names_in_scope(Scope(next(iter(port_ccs))))
        pairs = [(n, m) for n, m in zip(names, members) if m.pop >= 5000]
        match = fuzzy_pick(query, [n for n, _ in pairs], [m for _, m in pairs], strict=True)
        if match is None:
            return None
        return self.place_result(match[0], "fuzzy", 0.6)

    def qualifier_area(self, key):
        qualifier = self.qualifiers[key]
        if len(qualifier.scopes) != 1 and not qualifier.is_name:
            return Result(typ="unklar", method="nur_kuerzel")
        area = self.qualifier_point(qualifier)
        if area is None:
            return Result(typ="region", method="nur_kuerzel")
        return self.area_result(area, area_typ(area), "nur_kuerzel", 0.7)

    def fallback(self, scopes, parsed):
        typ = "adresse" if parsed.has_address else ("unklar" if not parsed.names else "ort")
        for scope_set, strong, origin in scopes:
            result = self.scope_fallback(scope_set)
            if result is not None:
                result.typ = typ
                return result
        return Result(typ="unklar" if not parsed.names else typ, method="kein_treffer")

    def from_override(self, override):
        kind, _, value = override.target.partition(":")
        confidence = override.confidence or 0.95
        if kind == "keine":
            return Result(typ=override.typ, method="override")
        if kind == "gn":
            result = self.override_feature(int(value), override, confidence)
        else:
            area = self.gazetteer.area_for(value)
            result = self.area_result(area, override.typ, "override", confidence)
        result.typ = override.typ
        if override.display:
            result.ort = override.display
        result.method = "override"
        return result

    def override_feature(self, gid, override, confidence):
        place = self.gazetteer.places.get(gid)
        if place is not None and override.precision in (None, "ort"):
            return self.place_result(place, "override", confidence)
        feature = self.gazetteer.feature(gid)
        return Result(
            ort=feature["name"], land=feature["cc"], us_state=feature["a1"] if feature["cc"] == "US" else None,
            lat=feature["lat"], lon=feature["lon"], gid=gid, precision=override.precision or "bundesstaat",
            confidence=confidence,
        )


def state_votes(records):
    valid = records.filter(pl.col("US_state_cleaned").str.contains(r"^[A-Z]{2}$") & (pl.col("US_state_cleaned") != "SK"))
    counts = valid.group_by("emigration_destination", "US_state_cleaned").agg(pl.len().alias("n"))
    votes = defaultdict(dict)
    for text, state, n in counts.drop_nulls().iter_rows():
        key = normalize(text)
        votes[key][state] = votes[key].get(state, 0) + n
    return votes


def dominant_state(votes):
    if not votes:
        return None
    total = sum(votes.values())
    state, count = max(votes.items(), key=lambda item: item[1])
    return state if total >= VOTE_MIN_ROWS and count / total >= VOTE_SHARE else None


def narrow(scope, state_scope):
    if scope.cc != state_scope.cc:
        return None
    if state_scope.a1 is None:
        return scope
    if scope.a1 not in (None, state_scope.a1):
        return None
    return Scope(scope.cc, state_scope.a1, scope.counties)


def state_scope_for(us_state):
    if us_state is None:
        return None
    if us_state == "uneindeutig":
        return Scope("US")
    if us_state == "SK":
        return Scope("CA", "11")
    return Scope("US", us_state)


def scope_code(scope):
    return f"{scope.cc}.{scope.a1}" if scope.a1 else scope.cc


def candidate_in(candidate, scope_set):
    if candidate.place is not None:
        return any(in_scope(candidate.place, s) for s in scope_set)
    return any(area_in_scope(candidate.area, s) for s in scope_set)


def area_score(area):
    return {"land": SCORE_COUNTRY, "bundesstaat": SCORE_ADMIN1}.get(area.kind, SCORE_REGION)


def area_typ(area):
    return {"land": "land", "bundesstaat": "bundesstaat"}.get(area.kind, "region")


def port_bonus(candidate, port_weights):
    if port_weights is None:
        return 0.0
    cc = candidate.place.cc if candidate.place is not None else candidate.area.cc
    return port_weights.get(cc, 0.0) + HOME_BONUS.get(cc, 0.0)


def tie_breaker(candidate):
    if candidate.place is not None:
        return -candidate.place.pop, candidate.place.gid
    return 0, 0


def same_referent(a, b):
    if a.place is not None and b.place is not None:
        if a.place.a2 is not None and (a.place.cc, a.place.a1, a.place.a2) == (b.place.cc, b.place.a1, b.place.a2):
            return normalize(a.place.name) == normalize(b.place.name)
        return haversine_km(a.place.lat, a.place.lon, b.place.lat, b.place.lon) < DISTINCT_KM
    if a.area is not None and b.area is not None:
        return a.area.key == b.area.key
    place, area = (a.place, b.area) if a.place is not None else (b.place, a.area)
    return place.cc == area.cc and (area.kind == "land" or place.a1 == area.a1)


def prefer_eponymous_seat(scored):
    best = scored[0]
    if best.area is None:
        return best
    for candidate in scored[1:]:
        if candidate.place is not None and eponymous(candidate, best):
            return candidate
    return best


def eponymous(place_candidate, area_candidate):
    place, area = place_candidate.place, area_candidate.area
    if not place_candidate.primary or place.cc != area.cc:
        return False
    if area.kind == "land":
        return place.fcode == "PPLC"
    return place.fcode in ("PPLA", "PPLC") and place.a1 == area.a1 or place.pop >= 100_000


def trustworthy(candidate, name):
    return candidate.primary or candidate.area is not None or resembles(name, candidate.place.name)


def resembles(query, name):
    query, name = normalize(query), normalize(name)
    compact = fuzz.ratio(query.replace(" ", ""), name.replace(" ", ""))
    return max(fuzz.token_set_ratio(query, name), compact) >= 80


def paired(a, b):
    if a.place is not None and b.area is not None:
        return eponymous(a, b)
    if b.place is not None and a.area is not None:
        return eponymous(b, a)
    return False


def common_area(candidate):
    if candidate.place is not None:
        return f"{candidate.place.cc}.{candidate.place.a1}"
    return candidate.area.key


def match_confidence(method, origin, ambiguous, primary):
    base = {"exakt": 0.95, "normalisiert": 0.92, "variante": 0.85}.get(method, 0.8)
    if not primary:
        base -= 0.07
    if origin == "global":
        base -= 0.07
    if ambiguous:
        base -= 0.2
    return round(base, 2)


def fuzzy_pick(query, names, members, strict=False):
    hits = process.extract(query, names, scorer=fuzz.ratio, limit=12, score_cutoff=84)
    hits = [(names[i], score, members[i]) for _, score, i in hits]
    hits = [h for h in hits if h[0][:1] == query[:1] and Levenshtein.distance(query, h[0]) <= allowed_edits(query, strict)]
    if not hits:
        return None
    best_name, best_score = hits[0][0], hits[0][1]
    namesakes = [h[2] for h in hits if h[0] == best_name]
    rivals = [h for h in hits if h[0] != best_name]
    if rivals and best_score - rivals[0][1] < 4:
        return None
    best = max(namesakes, key=lambda m: m.pop)
    if best.pop == 0 or any(rivals_in_size(m, best) for m in namesakes if m is not best):
        return None
    return best, "fuzzy"


def rivals_in_size(other, best):
    return other.pop * 10 > best.pop and haversine_km(other.lat, other.lon, best.lat, best.lon) > DISTINCT_KM


def allowed_edits(query, strict):
    if len(query) <= 6:
        return 1
    if strict:
        return 2 if len(query) >= 10 else 1
    return 2 if len(query) <= 11 else 3


def prefix_pick(query, names, members):
    if len(query) < 6:
        return None
    hits = [m for n, m in zip(names, members) if n.startswith(query + " ") and m.pop >= 1000]
    distinct = []
    for hit in hits:
        if all(haversine_km(hit.lat, hit.lon, d.lat, d.lon) > DISTINCT_KM for d in distinct):
            distinct.append(hit)
    return (distinct[0], "praefix") if len(distinct) == 1 else None


def place_group(result):
    place = result.place
    if place is not None and place.cc == "US" and place.a1 == "NY" and (place.gid == 5128581 or place.a2 in NYC_COUNTIES):
        return "New York City"
    return result.ort if result.precision == "ort" else None


def place_metro(result, group):
    place = result.place
    if group == "New York City" or (place is not None and place.cc == "US" and (place.a1, place.a2) in NEW_YORK_METRO):
        return "New York Metro"
    return group


def result_row(result, prefix):
    group = place_group(result)
    return {
        f"{prefix}_ort": result.ort,
        f"{prefix}_ort_gruppe": group if group is not None else result.ort,
        f"{prefix}_metro": place_metro(result, group) if group is not None else result.ort,
        f"{prefix}_land": result.land,
        f"{prefix}_us_state": result.us_state,
        f"{prefix}_lat": result.lat,
        f"{prefix}_lon": result.lon,
        "geonames_id": result.gid,
        "geo_precision": result.precision,
        "geo_method": result.method,
        "geo_confidence": result.confidence if result.precision else None,
        "geo_ambiguous": result.ambiguous,
        f"{prefix}_typ": result.typ,
    }


GEO_SCHEMA = {
    "_ort": pl.String, "_ort_gruppe": pl.String, "_metro": pl.String, "_land": pl.String, "_us_state": pl.String,
    "_lat": pl.Float64, "_lon": pl.Float64, "geonames_id": pl.Int64, "geo_precision": pl.String,
    "geo_method": pl.String, "geo_confidence": pl.Float64, "geo_ambiguous": pl.Boolean, "_typ": pl.String,
}


def geo_schema(prefix):
    return {(prefix + k if k.startswith("_") else k): v for k, v in GEO_SCHEMA.items()}


def geocode_keys(records, key_columns, resolver, prefix, state_is_strong):
    keys = (
        records.filter(pl.col(key_columns[0]).is_not_null())
        .group_by(key_columns)
        .agg(pl.len().cast(pl.Int64).alias("n_records"))
        .sort(["n_records", *key_columns], descending=[True, False, False, False], nulls_last=True)
    )
    rows = [
        result_row(resolver.resolve(text, state, port, state_is_strong), prefix)
        for text, state, port in keys.select(key_columns).iter_rows()
    ]
    return pl.concat([keys, pl.DataFrame(rows, schema=geo_schema(prefix))], how="horizontal")


def build_destinations(records, resolver):
    return geocode_keys(records, DEST_KEY, resolver, "ziel", True)


def build_stays(records, resolver):
    return geocode_keys(records, STAY_KEY, resolver, "aufenthalt", False)


REGION_BY_CONTINENT = {"EU": "Europa", "AF": "Afrika", "AS": "Asien", "OC": "Australien/Ozeanien", "SA": "Südamerika"}
NORTH_AMERICA = {"US", "CA", "GL", "PM", "BM"}


def world_region(cc, continents):
    if cc is None or cc not in continents:
        return None
    continent = continents[cc]
    if continent == "NA":
        return "Nordamerika" if cc in NORTH_AMERICA else "Mittelamerika/Karibik"
    return REGION_BY_CONTINENT.get(continent)


def nearest_country(lat, lon, towns):
    scale = math.cos(math.radians(lat))
    distance = (pl.col("lat") - lat) ** 2 + ((pl.col("lon") - lon) * scale) ** 2
    return towns.select(pl.col("cc").sort_by(distance).first()).item()


def load_port_manual():
    table = pl.read_csv(MANUAL / "ankunftshafen_manual.csv", infer_schema=False)
    table = table.with_columns(pl.col(c).replace("", None) for c in table.columns)
    return {(row["port_of_arrival_cleaned"], row["port_of_arrival_country"]): row for row in table.iter_rows(named=True)}


def port_rows(records):
    return (
        records.group_by(PORT_KEY)
        .agg(
            pl.len().alias("n_records"),
            pl.col("port_of_arrival_LAT").cast(pl.Float64).drop_nulls().first().alias("lat"),
            pl.col("port_of_arrival_LON").cast(pl.Float64).drop_nulls().first().alias("lon"),
        )
        .sort(["n_records", *PORT_KEY], descending=[True, False, False], nulls_last=True)
    )


def manual_point(entry, gazetteer):
    reference = entry.get("geonames_id")
    if reference is None:
        return None, None, None
    if reference.startswith("land:"):
        country = gazetteer.countries[reference.removeprefix("land:")]
        return country.lat, country.lon, reference
    feature = gazetteer.feature(int(reference))
    return feature["lat"], feature["lon"], f"geonames:{reference}"


def manual_or(entry, column, default):
    value = entry.get(column)
    if value is None:
        return default
    return None if value == "-" else value


def coordinate_note(row, typ, nearest_land, resolver):
    if typ != "hafen" or row["lat"] is None or row["port_of_arrival_cleaned"] is None:
        return None
    match = resolver.resolve(row["port_of_arrival_cleaned"], None, row["port_of_arrival_country"])
    trusted = match.method in ("exakt", "normalisiert", "alternativname", "override")
    if match.precision != "ort" or not trusted or match.land != nearest_land:
        return None
    distance = haversine_km(row["lat"], row["lon"], match.lat, match.lon)
    return f"{distance:.0f} km von GeoNames {match.ort} ({match.gid})" if distance > 50 else None


def describe_port(row, manual, gazetteer, towns, resolver):
    entry = manual.get((row["port_of_arrival_cleaned"], row["port_of_arrival_country"]), {})
    lat, lon, source = row["lat"], row["lon"], "datensatz"
    if lat is None:
        lat, lon, source = manual_point(entry, gazetteer)
    land = manual_or(entry, "hafen_land", nearest_country(lat, lon, towns) if lat is not None else None)
    typ = manual_or(entry, "hafen_typ", "hafen" if lat is not None else "unbekannt")
    return {
        "port_of_arrival_cleaned": row["port_of_arrival_cleaned"],
        "port_of_arrival_country": row["port_of_arrival_country"],
        "hafen_name": manual_or(entry, "hafen_name", row["port_of_arrival_cleaned"]),
        "hafen_land": land,
        "hafen_lat": lat,
        "hafen_lon": lon,
        "hafen_typ": typ,
        "hafen_region": manual_or(entry, "hafen_region", world_region(land, gazetteer.continents)),
        "reise_typ": manual_or(entry, "reise_typ", "kreuzfahrt" if typ == "kreuzfahrt" else "ueberfahrt"),
        "n_records": row["n_records"],
        "koordinaten_quelle": source,
        "koordinaten_hinweis": coordinate_note(row, typ, land, resolver),
    }


PORT_SCHEMA = {
    "port_of_arrival_cleaned": pl.String, "port_of_arrival_country": pl.String, "hafen_name": pl.String,
    "hafen_land": pl.String, "hafen_lat": pl.Float64, "hafen_lon": pl.Float64, "hafen_typ": pl.String,
    "hafen_region": pl.String, "reise_typ": pl.String, "n_records": pl.Int64, "koordinaten_quelle": pl.String,
    "koordinaten_hinweis": pl.String,
}


def build_ports(records, gazetteer, resolver):
    manual = load_port_manual()
    towns = gazetteer.features.filter((pl.col("fclass") == "P") & (pl.col("pop") >= 1000)).select("cc", "lat", "lon")
    rows = [describe_port(row, manual, gazetteer, towns, resolver) for row in port_rows(records).iter_rows(named=True)]
    return pl.DataFrame(rows, schema=PORT_SCHEMA)


def coverage(frame, prefix):
    pl.Config.set_tbl_rows(-1)
    total_rows, total_keys = frame["n_records"].sum(), frame.height
    for column in ("geo_precision", "geo_method", f"{prefix}_typ"):
        summary = (
            frame.group_by(column)
            .agg(pl.col("n_records").sum().alias("rows"), pl.len().alias("keys"))
            .with_columns(
                (pl.col("rows") / total_rows * 100).round(1).alias("rows_pct"),
                (pl.col("keys") / total_keys * 100).round(1).alias("keys_pct"),
            )
            .sort("rows", descending=True)
        )
        print(summary)
    ambiguous = frame.filter(pl.col("geo_ambiguous"))
    print("mehrdeutig:", round(ambiguous["n_records"].sum() / total_rows * 100, 1), "% Zeilen,",
          round(ambiguous.height / total_keys * 100, 1), "% Schlüssel")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    records = read_records()
    gazetteer = Gazetteer()
    resolver = Resolver(gazetteer, load_qualifiers(gazetteer), load_overrides(), state_votes(records))
    destinations = build_destinations(records, resolver)
    destinations.write_parquet(OUT / "ziel_geo.parquet")
    build_ports(records, gazetteer, resolver).write_csv(OUT / "ankunftshafen.csv")
    build_stays(records, resolver).write_csv(OUT / "aufenthaltsort_geo.csv")
    coverage(destinations, "ziel")


if __name__ == "__main__":
    main()
