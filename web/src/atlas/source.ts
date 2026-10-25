import { literal, openDatabase, queryRows, type Database, type Progress } from "../db";
import { load } from "../data";
import { occupationCondition, surnameCondition } from "../search";
import { AGE_GROUPS, filtersAreDefault, FIRST_YEAR, LAST_YEAR, type Filters, type Selection } from "./state";

export interface Series {
  names: string[];
  extra: (string | null)[];
  lat: Float64Array;
  lon: Float64Array;
  place: Int32Array;
  year: Int32Array;
  n: Float64Array;
}

export interface Corridor {
  id: number;
  herkunft: string;
  herkunft_land: string;
  herkunft_lat: number;
  herkunft_lon: number;
  ziel: string;
  ziel_land: string;
  ziel_lat: number;
  ziel_lon: number;
  gruppen: number;
  personen: number;
  jahrgaenge: number;
  von: number;
  bis: number;
  z: number;
  pmi: number;
  beruf: string | null;
  kategorie: string;
  frauenanteil: number;
  familienanteil: number;
  jahre: [number, number][];
}

export interface Flow {
  herkunft: string;
  hlat: number;
  hlon: number;
  ziel: string;
  zlat: number;
  zlon: number;
  n: number;
}

export interface Profile {
  total: number;
  inWindow: number;
  women: number | null;
  medianAge: number | null;
  families: number | null;
  years: { jahr: number; n: number }[];
  counterparts: { name: string; land: string | null; lat: number; lon: number; n: number }[];
  occupations: { name: string; n: number }[];
  surnames: { name: string; n: number }[];
  ports: { name: string; n: number }[];
}

const YEARS = `jahr BETWEEN ${FIRST_YEAR} AND ${LAST_YEAR}`;

export function whereFor(f: Filters): string {
  const parts = [YEARS];
  if (f.reiseart !== "alle") parts.push(`reiseart = ${literal(f.reiseart)}`);
  if (f.sektor === "-1") parts.push("sektor IS NULL");
  else if (f.sektor) parts.push(`sektor = ${Number(f.sektor)}`);
  if (f.geschlecht) parts.push(`geschlecht = ${literal(f.geschlecht)}`);
  if (f.alter && AGE_GROUPS[f.alter]) parts.push(`alter BETWEEN ${AGE_GROUPS[f.alter][0]} AND ${AGE_GROUPS[f.alter][1]}`);
  if (f.staat) parts.push(`staatsangehoerigkeit = ${literal(f.staat)}`);
  if (f.nachname.trim()) parts.push(surnameCondition(f.nachname.trim(), f.aehnlich));
  if (f.beruf.trim()) parts.push(occupationCondition(f.beruf.trim()));
  return parts.join(" AND ");
}

function windowClause(window: [number, number]): string {
  return `jahr BETWEEN ${Math.round(window[0])} AND ${Math.round(window[1])}`;
}

function nearPlace(prefix: "herkunft" | "ziel", sel: Selection): string {
  const name = prefix === "herkunft" ? "herkunft_ort" : "ziel_ort_gruppe";
  return `${name} = ${literal(sel.name)} AND abs(${prefix}_lat - ${sel.lat}) < 0.01 AND abs(${prefix}_lon - ${sel.lon}) < 0.01`;
}

function seriesFromColumns(names: string[], extra: (string | null)[], lats: ArrayLike<number>, lons: ArrayLike<number>, years: ArrayLike<number>, counts: ArrayLike<number>): Series {
  const index = new Map<string, number>();
  const placeNames: string[] = [];
  const placeExtra: (string | null)[] = [];
  const placeLat: number[] = [];
  const placeLon: number[] = [];
  const place = new Int32Array(counts.length);
  for (let i = 0; i < counts.length; i++) {
    const key = `${lats[i]}|${lons[i]}`;
    let id = index.get(key);
    if (id === undefined) {
      id = placeNames.length;
      index.set(key, id);
      placeNames.push(names[i]);
      placeExtra.push(extra[i] ?? null);
      placeLat.push(lats[i]);
      placeLon.push(lons[i]);
    }
    place[i] = id;
  }
  return {
    names: placeNames,
    extra: placeExtra,
    lat: Float64Array.from(placeLat),
    lon: Float64Array.from(placeLon),
    place,
    year: Int32Array.from(years),
    n: Float64Array.from(counts),
  };
}

export function totals(series: Series, window: [number, number]): Float64Array {
  const sums = new Float64Array(series.names.length);
  for (let i = 0; i < series.n.length; i++) {
    const year = series.year[i];
    if (year >= window[0] && year <= window[1]) sums[series.place[i]] += series.n[i];
  }
  return sums;
}

export function yearTotals(series: Series): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < series.n.length; i++) map.set(series.year[i], (map.get(series.year[i]) ?? 0) + series.n[i]);
  return map;
}

export class AtlasData {
  db: Database | null = null;
  basis: any;
  haefen: any;
  korridore: Corridor[] = [];
  kategorien: string[] = [];
  kapitel: any;
  sektoren: Record<string, string> = {};
  private cache = new Map<string, Promise<any>>();
  private baseline: Series | null = null;

  async loadStatic(): Promise<void> {
    const [basis, haefen, korridore, kapitel, sektoren] = await Promise.all([
      load("atlas/basis"),
      load("atlas/haefen"),
      load("atlas/korridore"),
      load("atlas/kapitel"),
      load("atlas/sektoren"),
    ]);
    this.basis = basis;
    this.haefen = haefen;
    this.korridore = korridore.korridore;
    this.kategorien = korridore.kategorien;
    this.kapitel = kapitel;
    this.sektoren = sektoren;
    this.baseline = {
      names: basis.orte.name,
      extra: basis.orte.name.map(() => null),
      lat: Float64Array.from(basis.orte.lat),
      lon: Float64Array.from(basis.orte.lon),
      place: Int32Array.from(basis.zaehlung.i),
      year: Int32Array.from(basis.zaehlung.jahr),
      n: Float64Array.from(basis.zaehlung.n),
    };
  }

  async openDatabase(progress: Progress): Promise<void> {
    this.db = await openDatabase(progress);
  }

  get ready(): boolean {
    return this.db !== null;
  }

  private cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, compute());
    return this.cache.get(key)!;
  }

  private async columns(sql: string): Promise<Record<string, any>> {
    const table = await this.db!.conn.query(sql);
    const out: Record<string, any> = {};
    for (const field of table.schema.fields) out[field.name] = table.getChild(field.name)!.toArray();
    return out;
  }

  private async placeSeries(sql: string): Promise<Series> {
    const c = await this.columns(sql);
    return seriesFromColumns(Array.from(c.name), Array.from(c.land ?? []), c.lat, c.lon, c.jahr, c.n);
  }

  origins(filters: Filters): Promise<Series | null> {
    if (!this.db) return Promise.resolve(filtersAreDefault(filters) ? this.baseline : null);
    return this.cached(`origins|${JSON.stringify(filters)}`, () =>
      this.placeSeries(`
        SELECT herkunft_ort AS name, herkunft_land AS land, round(herkunft_lat::DOUBLE, 3) AS lat, round(herkunft_lon::DOUBLE, 3) AS lon,
               jahr::INTEGER AS jahr, count(*)::INTEGER AS n
        FROM p WHERE ${whereFor(filters)} AND herkunft_genauigkeit = 'ort'
        GROUP BY ALL`),
    );
  }

  baseOrigins(filters: Filters): Promise<Series | null> {
    return this.origins({ ...filters, sektor: "", geschlecht: "", alter: "", staat: "", nachname: "", aehnlich: false, beruf: "" });
  }

  destinations(filters: Filters): Promise<Series | null> {
    if (!this.db) return Promise.resolve(null);
    return this.cached(`destinations|${JSON.stringify(filters)}`, () =>
      this.placeSeries(`
        WITH g AS (
          SELECT ziel_ort_gruppe AS name, ziel_land AS land, round(ziel_lat) AS cell_lat, round(ziel_lon) AS cell_lon, jahr::INTEGER AS jahr,
                 count(*) AS n, sum(ziel_lat::DOUBLE) AS sum_lat, sum(ziel_lon::DOUBLE) AS sum_lon
          FROM p WHERE ${whereFor(filters)} AND ziel_genauigkeit = 'ort'
          GROUP BY ALL)
        SELECT name, land, round(sum(sum_lat) OVER w / sum(n) OVER w, 3) AS lat, round(sum(sum_lon) OVER w / sum(n) OVER w, 3) AS lon, jahr, n::INTEGER AS n
        FROM g WINDOW w AS (PARTITION BY name, land, cell_lat, cell_lon)`),
    );
  }

  ports(filters: Filters): Promise<Series | null> {
    if (!this.db) return Promise.resolve(null);
    return this.cached(`ports|${JSON.stringify(filters)}`, async () => {
      const c = await this.columns(`
        SELECT ankunftshafen AS name, jahr::INTEGER AS jahr, count(*)::INTEGER AS n
        FROM p WHERE ${whereFor(filters)} AND ankunftshafen IS NOT NULL GROUP BY ALL`);
      const coords = new Map<string, [number, number]>();
      this.haefen.haefen.name.forEach((name: string, i: number) => coords.set(name, [this.haefen.haefen.lat[i], this.haefen.haefen.lon[i]]));
      const names: string[] = [];
      const lats: number[] = [];
      const lons: number[] = [];
      const years: number[] = [];
      const counts: number[] = [];
      Array.from(c.name as string[]).forEach((name, i) => {
        const point = coords.get(name);
        if (!point) return;
        names.push(name);
        lats.push(point[0]);
        lons.push(point[1]);
        years.push(c.jahr[i]);
        counts.push(c.n[i]);
      });
      return seriesFromColumns(names, [], lats, lons, years, counts);
    });
  }

  years(filters: Filters): Promise<Map<number, number>> {
    if (!this.db) {
      const map = new Map<number, number>();
      if (filtersAreDefault(filters)) this.basis.jahre.jahr.forEach((y: number, i: number) => map.set(y, this.basis.jahre.n[i]));
      return Promise.resolve(map);
    }
    return this.cached(`years|${JSON.stringify(filters)}`, async () => {
      const c = await this.columns(`SELECT jahr::INTEGER AS jahr, count(*)::INTEGER AS n FROM p WHERE ${whereFor(filters)} GROUP BY 1`);
      const map = new Map<number, number>();
      c.jahr.forEach((y: number, i: number) => map.set(y, c.n[i]));
      return map;
    });
  }

  flows(filters: Filters, window: [number, number], limit: number, overseasOnly: boolean): Promise<Flow[]> {
    if (!this.db) return Promise.resolve([]);
    const overseas = overseasOnly ? "AND herkunft_lat BETWEEN 34 AND 72 AND herkunft_lon BETWEEN -25 AND 45 AND NOT (ziel_lat BETWEEN 34 AND 72 AND ziel_lon BETWEEN -25 AND 45)" : "";
    return this.cached(`flows|${JSON.stringify(filters)}|${window}|${limit}|${overseasOnly}`, () =>
      queryRows<Flow>(this.db!, `
        SELECT herkunft_ort AS herkunft, round(avg(herkunft_lat)::DOUBLE, 3) AS hlat, round(avg(herkunft_lon)::DOUBLE, 3) AS hlon,
               ziel_ort_gruppe AS ziel, round(avg(ziel_lat)::DOUBLE, 3) AS zlat, round(avg(ziel_lon)::DOUBLE, 3) AS zlon, count(*)::INTEGER AS n
        FROM p WHERE ${whereFor(filters)} AND ${windowClause(window)} AND herkunft_sicher AND ziel_sicher
          AND herkunft_ort <> ziel_ort_gruppe ${overseas}
        GROUP BY herkunft_ort, round(herkunft_lat, 1), round(herkunft_lon, 1), ziel_ort_gruppe
        ORDER BY n DESC LIMIT ${Number(limit)}`),
    );
  }

  async profile(sel: Selection, filters: Filters, window: [number, number]): Promise<Profile> {
    const here = sel.kind === "herkunft" ? "herkunft" : "ziel";
    const other = sel.kind === "herkunft" ? "ziel" : "herkunft";
    const otherName = other === "ziel" ? "ziel_ort_gruppe" : "herkunft_ort";
    const otherCountry = other === "ziel" ? "ziel_land" : "herkunft_land";
    const base = `${whereFor(filters)} AND ${nearPlace(here, sel)}`;
    const inWindow = `${base} AND ${windowClause(window)}`;
    const [summary] = await queryRows<any>(this.db!, `
      SELECT count(*)::INTEGER AS n,
             avg(CASE WHEN geschlecht = 'w' THEN 1.0 WHEN geschlecht = 'm' THEN 0.0 END)::DOUBLE AS women,
             median(alter)::DOUBLE AS age,
             avg(CASE WHEN gruppe_groesse >= 3 THEN 1.0 ELSE 0.0 END)::DOUBLE AS families
      FROM p WHERE ${inWindow}`);
    const years = await queryRows<any>(this.db!, `SELECT jahr::INTEGER AS jahr, count(*)::INTEGER AS n FROM p WHERE ${base} GROUP BY 1 ORDER BY 1`);
    const counterparts = await queryRows<any>(this.db!, `
      SELECT ${otherName} AS name, ${otherCountry} AS land, avg(${other}_lat)::DOUBLE AS lat, avg(${other}_lon)::DOUBLE AS lon, count(*)::INTEGER AS n
      FROM p WHERE ${inWindow} AND ${other}_genauigkeit = 'ort' AND ${otherName} IS NOT NULL
      GROUP BY ${otherName}, ${otherCountry}, round(${other}_lat), round(${other}_lon) ORDER BY n DESC LIMIT 12`);
    const top = (column: string) => queryRows<any>(this.db!, `
      SELECT ${column} AS name, count(*)::INTEGER AS n FROM p WHERE ${inWindow} AND ${column} IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 6`);
    const [occupations, surnames, ports] = await Promise.all([top("beruf_norm"), top("nachname"), top("ankunftshafen")]);
    return {
      total: years.reduce((s, y) => s + y.n, 0),
      inWindow: summary.n,
      women: summary.women,
      medianAge: summary.age,
      families: summary.families,
      years,
      counterparts,
      occupations,
      surnames,
      ports,
    };
  }

  corridorMembers(c: Corridor): Promise<any[]> {
    return queryRows<any>(this.db!, `
      SELECT vorname, nachname, alter, jahr::INTEGER AS jahr, schiff, beruf_norm AS beruf, gruppe_groesse
      FROM p WHERE reiseart = 'Überfahrt' AND herkunft_ort = ${literal(c.herkunft)} AND ziel_ort_gruppe = ${literal(c.ziel)}
        AND herkunft_sicher AND ziel_sicher
      ORDER BY abfahrt, liste, id LIMIT 60`);
  }

  nationalities(): Promise<{ name: string; n: number }[]> {
    return this.cached("nationalities", () => queryRows<any>(this.db!, `
      SELECT staatsangehoerigkeit AS name, count(*)::INTEGER AS n FROM p
      WHERE staatsangehoerigkeit IS NOT NULL AND staatsangehoerigkeit NOT IN ('keine', 'Ohne') GROUP BY 1 ORDER BY n DESC LIMIT 30`));
  }
}
