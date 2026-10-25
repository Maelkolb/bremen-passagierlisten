import { inEurope } from "./geo";
import { totals, type Corridor, type Member, type Profile, type Series } from "./source";
import type { Selection, State } from "./state";

export interface PlacePoint {
  name: string;
  land: string | null;
  lat: number;
  lon: number;
  n: number;
}

export interface Share {
  label: string;
  n: number;
}

export interface SelectionView {
  selection: Selection;
  profile: Profile | null;
}

export interface HerkunftView {
  kind: "herkunft";
  points: PlacePoint[];
  total: number;
  countries: Share[];
  selected: SelectionView | null;
}

export interface ZieleView {
  kind: "ziele";
  points: PlacePoint[];
  ports: PlacePoint[];
  total: number;
  regions: Share[];
  selected: SelectionView | null;
}

export interface CorridorView extends Corridor {
  inWindow: number;
  hits: number | null;
}

export interface KettenView {
  kind: "ketten";
  corridors: CorridorView[];
  categories: { name: string; corridors: number; groups: number }[];
  selected: CorridorView | null;
  members: Member[] | null;
}

export interface LoadingView {
  kind: "loading";
}

export type AtlasView = HerkunftView | ZieleView | KettenView | LoadingView;

const COUNTRY_ROWS = 6;
const MIN_SHARE = 0.005;
const regionNames = new Intl.DisplayNames(["de"], { type: "region" });

export function countryName(code: string | null): string {
  if (!code) return "";
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

const REGIONS: [string, (lat: number, lon: number) => boolean][] = [
  ["Nordamerika", (lat, lon) => lat > 24 && lon < -50],
  ["Mittelamerika und Karibik", (lat, lon) => lat <= 24 && lat > 7 && lon < -55],
  ["Südamerika", (lat, lon) => lat <= 7 && lon < -30],
  ["Europa", (lat, lon) => inEurope(lat, lon)],
  ["Afrika", (lat, lon) => lat < 34 && lon >= -20 && lon < 52],
  ["Asien", (lat, lon) => lon >= 52 || (lat > 34 && lon > 45)],
  ["Australien und Ozeanien", (lat, lon) => lat < -10 && lon > 110],
];

export function points(series: Series, window: [number, number]): PlacePoint[] {
  const sums = totals(series, window);
  const out: PlacePoint[] = [];
  sums.forEach((n, i) => {
    if (n > 0) out.push({ name: series.names[i], land: series.lands[i], lat: series.lat[i], lon: series.lon[i], n });
  });
  return out.sort((a, b) => b.n - a.n);
}

function shares(groups: Map<string, number>, rows: number): Share[] {
  const total = [...groups.values()].reduce((s, n) => s + n, 0);
  const sorted = [...groups.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
  const shown = sorted.filter((g, i) => i < rows - 1 && g.n / total >= MIN_SHARE && g.label !== "übrige");
  const rest = total - shown.reduce((s, g) => s + g.n, 0);
  return rest > 0 ? [...shown, { label: "übrige", n: rest }] : shown;
}

export function herkunftView(series: Series, state: State, selected: SelectionView | null): HerkunftView {
  const list = points(series, state.window);
  const countries = new Map<string, number>();
  for (const p of list) {
    const name = countryName(p.land) || "ohne Angabe";
    countries.set(name, (countries.get(name) ?? 0) + p.n);
  }
  return {
    kind: "herkunft",
    points: list,
    total: list.reduce((s, p) => s + p.n, 0),
    countries: shares(countries, COUNTRY_ROWS),
    selected,
  };
}

export function zieleView(destinations: Series, ports: Series, state: State, selected: SelectionView | null): ZieleView {
  const list = points(destinations, state.window);
  const regions = new Map<string, number>();
  for (const p of list) {
    const region = REGIONS.find(([, test]) => test(p.lat, p.lon))?.[0] ?? "übrige";
    regions.set(region, (regions.get(region) ?? 0) + p.n);
  }
  return {
    kind: "ziele",
    points: list,
    ports: points(ports, state.window),
    total: list.reduce((s, p) => s + p.n, 0),
    regions: shares(regions, COUNTRY_ROWS),
    selected,
  };
}

export function kettenView(corridors: Corridor[], categories: string[], state: State, hits: Map<number, number> | null, members: Member[] | null): KettenView {
  const [from, to] = state.window;
  const inWindow = (c: Corridor) => c.jahre.reduce((s, [y, n]) => s + (y >= from && y <= to ? n : 0), 0);
  const all = corridors
    .map((c) => ({ ...c, inWindow: inWindow(c), hits: hits ? hits.get(c.id) ?? 0 : null }))
    .filter((c) => c.inWindow > 0 && (c.hits === null || c.hits > 0))
    .sort((a, b) => b.inWindow - a.inWindow || b.personen - a.personen);
  const selected = state.corridor === null ? null : corridors.find((c) => c.id === state.corridor) ?? null;
  return {
    kind: "ketten",
    corridors: state.category ? all.filter((c) => c.kategorie === state.category) : all,
    categories: categories
      .map((name) => {
        const list = all.filter((c) => c.kategorie === name);
        return { name, corridors: list.length, groups: list.reduce((s, c) => s + c.inWindow, 0) };
      })
      .filter((c) => c.corridors > 0),
    selected: selected ? { ...selected, inWindow: inWindow(selected), hits: hits?.get(selected.id) ?? null } : null,
    members,
  };
}
