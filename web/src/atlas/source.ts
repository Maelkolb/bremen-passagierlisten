import { literal, openDatabase, queryRows, type Database, type Progress } from "../db";
import { load } from "../data";
import { surnameCondition } from "../search";
import { FIRST_YEAR, LAST_YEAR, type Selection } from "./state";

export interface Series {
  names: string[];
  lands: (string | null)[];
  lat: Float64Array;
  lon: Float64Array;
  place: Int32Array;
  year: Int32Array;
  n: Float64Array;
}

export interface Search {
  name: string;
  similar: boolean;
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
  von: number;
  bis: number;
  beruf: string | null;
  kategorie: string;
  frauenanteil: number;
  jahre: [number, number][];
}

export interface Ranked {
  name: string;
  n: number;
}

export interface Counterpart extends Ranked {
  land: string | null;
  lat: number;
  lon: number;
}

export interface Profile {
  total: number;
  inWindow: number;
  women: number | null;
  medianAge: number | null;
  years: Map<number, number>;
  counterparts: Counterpart[];
  surnames: Ranked[];
  occupations: Ranked[];
}

export interface Entry {
  id: number;
  nachname: string | null;
  vorname: string | null;
  alter: number | null;
  beruf: string | null;
  herkunft: string | null;
  ziel: string | null;
  jahr: number | null;
  gruppe: number;
  gruppe_groesse: number;
}

export interface EntryList {
  total: number;
  items: Entry[];
}

export interface Scope {
  search: Search;
  window: [number, number];
  selection: Selection | null;
  corridor: Corridor | null;
}

export interface PersonRecord {
  record: Record<string, any>;
  group: EntryList | null;
  relatives: EntryList | null;
  port: [number, number] | null;
}

interface Columns {
  name: ArrayLike<string>;
  land: ArrayLike<string | null>;
  lat: ArrayLike<number>;
  lon: ArrayLike<number>;
}

interface Counts {
  i: ArrayLike<number>;
  jahr: ArrayLike<number>;
  n: ArrayLike<number>;
}

const searchKey = (search: Search) => `${search.name}|${search.name ? search.similar : false}`;

function where(search: Search): string {
  const parts = ["reiseart = 'Überfahrt'", `jahr BETWEEN ${FIRST_YEAR} AND ${LAST_YEAR}`];
  if (search.name) parts.push(surnameCondition(search.name, search.similar));
  return parts.join(" AND ");
}

function windowClause(window: [number, number]): string {
  return `jahr BETWEEN ${Math.round(window[0])} AND ${Math.round(window[1])}`;
}

function placeClause(sel: Selection): string {
  if (sel.kind === "herkunft") {
    return `herkunft_genauigkeit = 'ort' AND abs(herkunft_lat - ${sel.lat}) < 0.0006 AND abs(herkunft_lon - ${sel.lon}) < 0.0006`;
  }
  const land = sel.land ? `ziel_land = ${literal(sel.land)}` : "ziel_land IS NULL";
  return `ziel_genauigkeit = 'ort' AND ziel_ort_gruppe = ${literal(sel.name)} AND ${land} AND abs(ziel_lat - ${sel.lat}) < 1 AND abs(ziel_lon - ${sel.lon}) < 1`;
}

function corridorClause(c: Corridor): string {
  return `herkunft_sicher AND ziel_sicher
    AND herkunft_ort = ${literal(c.herkunft)} AND herkunft_land = ${literal(c.herkunft_land)}
    AND ziel_ort_gruppe = ${literal(c.ziel)} AND ziel_land = ${literal(c.ziel_land)}`;
}

function scopeClause(scope: Scope): string {
  const parts = [where(scope.search), windowClause(scope.window)];
  if (scope.selection) parts.push(placeClause(scope.selection));
  if (scope.corridor) parts.push(corridorClause(scope.corridor));
  return parts.join(" AND ");
}

export function scopeKey(scope: Scope): string {
  return JSON.stringify([searchKey(scope.search), scope.window, scope.selection, scope.corridor?.id ?? null]);
}

function seriesFrom(places: Columns, counts: Counts): Series {
  return {
    names: Array.from(places.name),
    lands: Array.from(places.land),
    lat: Float64Array.from(places.lat),
    lon: Float64Array.from(places.lon),
    place: Int32Array.from(counts.i),
    year: Int32Array.from(counts.jahr),
    n: Float64Array.from(counts.n),
  };
}

function seriesFromRows(c: Record<string, any>, key: (i: number) => string): Series {
  const index = new Map<string, number>();
  const places: { name: string[]; land: (string | null)[]; lat: number[]; lon: number[] } = { name: [], land: [], lat: [], lon: [] };
  const place: number[] = [];
  for (let i = 0; i < c.n.length; i++) {
    const k = key(i);
    let id = index.get(k);
    if (id === undefined) {
      id = places.name.length;
      index.set(k, id);
      places.name.push(c.name[i]);
      places.land.push(c.land?.[i] ?? null);
      places.lat.push(c.lat[i]);
      places.lon.push(c.lon[i]);
    }
    place.push(id);
  }
  return seriesFrom(places, { i: place, jahr: c.jahr, n: c.n });
}

export function totals(series: Series, window: [number, number]): Float64Array {
  const sums = new Float64Array(series.names.length);
  for (let i = 0; i < series.n.length; i++) {
    const year = series.year[i];
    if (year >= window[0] && year <= window[1]) sums[series.place[i]] += series.n[i];
  }
  return sums;
}

export class AtlasData {
  db: Database | null = null;
  korridore: Corridor[] = [];
  kategorien: string[] = [];
  kapitel: any;
  private baseOrigins!: Series;
  private baseDestinations!: Series;
  private basePorts!: Series;
  private baseYears = new Map<number, number>();
  private portCoordinates = new Map<string, [number, number]>();
  private cache = new Map<string, Promise<any>>();

  async loadStatic(): Promise<void> {
    const [basis, haefen, korridore, kapitel] = await Promise.all([load("atlas/basis"), load("atlas/haefen"), load("atlas/korridore"), load("atlas/kapitel")]);
    this.baseOrigins = seriesFrom(basis.orte, basis.zaehlung);
    this.baseDestinations = seriesFrom(basis.ziele.orte, basis.ziele.zaehlung);
    this.basePorts = seriesFrom({ ...haefen.haefen, land: haefen.haefen.name.map(() => null) }, haefen.zaehlung);
    haefen.haefen.name.forEach((name: string, i: number) => this.portCoordinates.set(name, [haefen.haefen.lat[i], haefen.haefen.lon[i]]));
    basis.jahre.jahr.forEach((year: number, i: number) => this.baseYears.set(year, basis.jahre.n[i]));
    this.korridore = korridore.korridore;
    this.kategorien = korridore.kategorien;
    this.kapitel = kapitel;
  }

  get dataYears(): number[] {
    return [...this.baseYears.keys()].sort((a, b) => a - b);
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

  origins(search: Search): Promise<Series> {
    if (!search.name) return Promise.resolve(this.baseOrigins);
    return this.cached(`origins|${searchKey(search)}`, async () => {
      const c = await this.columns(`
        SELECT any_value(herkunft_ort) AS name, any_value(herkunft_land) AS land, round(herkunft_lat::DOUBLE, 3) AS lat, round(herkunft_lon::DOUBLE, 3) AS lon,
               jahr::INTEGER AS jahr, count(*)::INTEGER AS n
        FROM p WHERE ${where(search)} AND herkunft_genauigkeit = 'ort'
        GROUP BY 3, 4, 5`);
      return seriesFromRows(c, (i) => `${c.lat[i]}|${c.lon[i]}`);
    });
  }

  destinations(search: Search): Promise<Series> {
    if (!search.name) return Promise.resolve(this.baseDestinations);
    return this.cached(`destinations|${searchKey(search)}`, async () => {
      const c = await this.columns(`
        WITH g AS (
          SELECT ziel_ort_gruppe AS name, ziel_land AS land, round(ziel_lat) AS cell_lat, round(ziel_lon) AS cell_lon, jahr::INTEGER AS jahr,
                 count(*) AS n, sum(ziel_lat::DOUBLE) AS sum_lat, sum(ziel_lon::DOUBLE) AS sum_lon
          FROM p WHERE ${where(search)} AND ziel_genauigkeit = 'ort' AND ziel_ort_gruppe IS NOT NULL
          GROUP BY ALL)
        SELECT name, land, round(sum(sum_lat) OVER w / sum(n) OVER w, 3) AS lat, round(sum(sum_lon) OVER w / sum(n) OVER w, 3) AS lon, jahr, n::INTEGER AS n
        FROM g WINDOW w AS (PARTITION BY name, land, cell_lat, cell_lon)`);
      return seriesFromRows(c, (i) => `${c.name[i]}|${c.land[i]}|${c.lat[i]}|${c.lon[i]}`);
    });
  }

  ports(search: Search): Promise<Series> {
    if (!search.name) return Promise.resolve(this.basePorts);
    return this.cached(`ports|${searchKey(search)}`, async () => {
      const c = await this.columns(`
        SELECT ankunftshafen AS name, jahr::INTEGER AS jahr, count(*)::INTEGER AS n
        FROM p WHERE ${where(search)} AND ankunftshafen IS NOT NULL GROUP BY ALL`);
      const rows = { name: [] as string[], lat: [] as number[], lon: [] as number[], jahr: [] as number[], n: [] as number[] };
      Array.from(c.name as string[]).forEach((name, i) => {
        const point = this.portCoordinates.get(name);
        if (!point) return;
        rows.name.push(name);
        rows.lat.push(point[0]);
        rows.lon.push(point[1]);
        rows.jahr.push(c.jahr[i]);
        rows.n.push(c.n[i]);
      });
      return seriesFromRows(rows, (i) => rows.name[i]);
    });
  }

  years(search: Search): Promise<Map<number, number>> {
    if (!search.name) return Promise.resolve(this.baseYears);
    return this.cached(`years|${searchKey(search)}`, async () => {
      const c = await this.columns(`SELECT jahr::INTEGER AS jahr, count(*)::INTEGER AS n FROM p WHERE ${where(search)} GROUP BY 1`);
      const map = new Map<number, number>();
      c.jahr.forEach((year: number, i: number) => map.set(year, c.n[i]));
      return map;
    });
  }

  corridorHits(search: Search): Promise<Map<number, number> | null> {
    if (!search.name) return Promise.resolve(null);
    return this.cached(`hits|${searchKey(search)}`, async () => {
      const rows = await queryRows<{ h: string; hl: string; z: string; zl: string; n: number }>(this.db!, `
        SELECT herkunft_ort AS h, herkunft_land AS hl, ziel_ort_gruppe AS z, ziel_land AS zl, count(*)::INTEGER AS n
        FROM p WHERE ${where(search)} AND herkunft_sicher AND ziel_sicher GROUP BY ALL`);
      const byPair = new Map(rows.map((r) => [`${r.h}|${r.hl}|${r.z}|${r.zl}`, r.n]));
      const hits = new Map<number, number>();
      for (const c of this.korridore) {
        const n = byPair.get(`${c.herkunft}|${c.herkunft_land}|${c.ziel}|${c.ziel_land}`);
        if (n) hits.set(c.id, n);
      }
      return hits;
    });
  }

  profile(sel: Selection, search: Search, window: [number, number]): Promise<Profile> {
    return this.cached(`profile|${JSON.stringify(sel)}|${searchKey(search)}|${window}`, async () => {
      const other = sel.kind === "herkunft" ? "ziel" : "herkunft";
      const otherName = other === "ziel" ? "ziel_ort_gruppe" : "herkunft_ort";
      const base = `${where(search)} AND ${placeClause(sel)}`;
      const inWindow = `${base} AND ${windowClause(window)}`;
      const top = (column: string, n: number) => queryRows<Ranked>(this.db!, `
        SELECT ${column} AS name, count(*)::INTEGER AS n FROM p WHERE ${inWindow} AND ${column} IS NOT NULL GROUP BY 1 ORDER BY n DESC, name LIMIT ${n}`);
      const [[summary], years, counterparts, surnames, occupations] = await Promise.all([
        queryRows<{ n: number; women: number | null; age: number | null }>(this.db!, `
          SELECT count(*)::INTEGER AS n,
                 avg(CASE WHEN geschlecht = 'w' THEN 1.0 WHEN geschlecht = 'm' THEN 0.0 END)::DOUBLE AS women,
                 median(alter)::DOUBLE AS age
          FROM p WHERE ${inWindow}`),
        queryRows<{ jahr: number; n: number }>(this.db!, `SELECT jahr::INTEGER AS jahr, count(*)::INTEGER AS n FROM p WHERE ${base} GROUP BY 1`),
        queryRows<Counterpart>(this.db!, `
          SELECT ${otherName} AS name, ${other}_land AS land, avg(${other}_lat)::DOUBLE AS lat, avg(${other}_lon)::DOUBLE AS lon, count(*)::INTEGER AS n
          FROM p WHERE ${inWindow} AND ${other}_genauigkeit = 'ort' AND ${otherName} IS NOT NULL
          GROUP BY ${otherName}, ${other}_land, round(${other}_lat), round(${other}_lon) ORDER BY n DESC, name LIMIT 10`),
        top("nachname", 8),
        top("beruf_norm", 6),
      ]);
      return {
        total: years.reduce((s, y) => s + y.n, 0),
        inWindow: summary.n,
        women: summary.women,
        medianAge: summary.age,
        years: new Map(years.map((y) => [y.jahr, y.n])),
        counterparts,
        surnames,
        occupations,
      };
    });
  }

  portPosition(name: string | null): [number, number] | null {
    const point = name ? this.portCoordinates.get(name) : undefined;
    return point ? [point[1], point[0]] : null;
  }

  private list(condition: string, limit: number): Promise<EntryList> {
    return this.cached(`list|${condition}|${limit}`, async () => {
      const items = await queryRows<Entry & { total: number }>(this.db!, `
        SELECT id, nachname, vorname, alter, coalesce(beruf_norm, beruf) AS beruf,
               coalesce(herkunft_ort, wohnort) AS herkunft, coalesce(ziel_ort_gruppe, ziel_ort, ziel) AS ziel,
               jahr::INTEGER AS jahr, gruppe_id AS gruppe, gruppe_groesse::INTEGER AS gruppe_groesse,
               count(*) OVER ()::INTEGER AS total
        FROM p WHERE ${condition}
        ORDER BY abfahrt NULLS LAST, liste, id LIMIT ${limit}`);
      return { total: items[0]?.total ?? 0, items };
    });
  }

  entries(scope: Scope, limit: number): Promise<EntryList> {
    return this.list(scopeClause(scope), limit);
  }

  record(id: number): Promise<PersonRecord | null> {
    return this.cached(`record|${id}`, async () => {
      const [record] = await queryRows<Record<string, any>>(this.db!, `
        SELECT * EXCLUDE (abfahrt), strftime(abfahrt, '%d.%m.%Y') AS datum FROM p WHERE id = ${Math.round(id)}`);
      if (!record) return null;
      const placed = record.herkunft_genauigkeit === "ort" && record.nachname_norm;
      const [group, relatives] = await Promise.all([
        record.gruppe_groesse > 1 ? this.list(`gruppe_id = ${record.gruppe_id}`, 40) : null,
        placed
          ? this.list(`${where({ name: "", similar: false })} AND nachname_norm = ${literal(record.nachname_norm)} AND herkunft_genauigkeit = 'ort'
              AND abs(herkunft_lat - ${record.herkunft_lat}) < 0.0006 AND abs(herkunft_lon - ${record.herkunft_lon}) < 0.0006
              AND gruppe_id <> ${record.gruppe_id}`, 12)
          : null,
      ]);
      return { record, group, relatives: relatives?.total ? relatives : null, port: this.portPosition(record.ankunftshafen) };
    });
  }
}
