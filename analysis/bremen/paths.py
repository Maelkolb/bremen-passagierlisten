from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW_CSV = ROOT / "data" / "raw" / "CHUP_Passengerlists.csv"
ENRICHMENT = ROOT / "data" / "enrichment"
WORK = ROOT / "data" / "work"
GEONAMES_CITIES = ROOT / "data" / "external" / "geonames" / "cities500.txt"
TABLES = ROOT / "analysis" / "output"
WEB_DATA = ROOT / "web" / "public" / "data"
REPORT = ROOT / "FORSCHUNGSBERICHT_MAUS.md"

ZENODO_URL = "https://zenodo.org/api/records/17977460/files/CHUP_Passengerlists.csv/content"
ZENODO_MD5 = "41f6368bf50131b577f73943f8fee629"
