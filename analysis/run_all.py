import argparse
import sys
import time

from bremen import m1_quellen, m2_berufe, m3_geografie, m4_demografie, m5_schifffahrt, report, web_exports
from bremen.load import prepared

MODULES = [
    ("quellen", m1_quellen),
    ("berufe", m2_berufe),
    ("geografie", m3_geografie),
    ("demografie", m4_demografie),
    ("schifffahrt", m5_schifffahrt),
    ("web", web_exports),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rebuild", action="store_true")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    started = time.time()
    df = prepared(rebuild=args.rebuild)
    print(f"{len(df):,} Datensätze geladen ({time.time() - started:.1f} s)")

    results = {}
    for name, module in MODULES:
        step = time.time()
        results[name] = module.run(df)
        print(f"{name}: {time.time() - step:.1f} s")

    report.write(df, results)
    print(f"Fertig in {time.time() - started:.1f} s")


if __name__ == "__main__":
    main()
