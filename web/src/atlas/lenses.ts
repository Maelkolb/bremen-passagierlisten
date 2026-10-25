import { BREMEN, cellKey, cellPolygon, centroid, deviationEllipse, distanceKm, inEurope, weightedMedian, type Centroid, type Weighted } from "./geo";
import { totals, type Corridor, type Flow, type Profile, type Series } from "./source";
import { PERIODS, type OriginMode, type Selection, type State } from "./state";

export interface PlacePoint {
  name: string;
  extra: string | null;
  lat: number;
  lon: number;
  n: number;
  base?: number;
  lq?: number;
}

export interface SelectionView {
  selection: Selection;
  profile: Profile | null;
}

export interface HerkunftView {
  kind: "herkunft";
  mode: OriginMode;
  points: PlacePoint[];
  total: number;
  medianKm: number | null;
  europeShare: number | null;
  distanceBins: { label: string; n: number }[];
  lqActive: boolean;
  selected: SelectionView | null;
}

export interface ZieleView {
  kind: "ziele";
  ports: PlacePoint[];
  destinations: PlacePoint[];
  total: number;
  regions: { name: string; n: number }[];
  selected: SelectionView | null;
}

export interface WegeView {
  kind: "wege";
  flows: Flow[];
  loading: boolean;
}

export interface CorridorView extends Corridor {
  inWindow: number;
}

export interface KettenView {
  kind: "ketten";
  corridors: CorridorView[];
  categories: { name: string; corridors: number; persons: number }[];
  selected: CorridorView | null;
  members: any[] | null;
}

export interface Cell {
  key: string;
  polygon: [number, number][];
  a: number;
  b: number;
  diff: number;
}

export interface PeriodShape {
  period: string;
  centroid: Centroid;
  ring: [number, number][];
}

export interface WandelView {
  kind: "wandel";
  periods: [string, string];
  cells: Cell[];
  yearly: (Centroid & { year: number })[];
  shapes: PeriodShape[];
  shiftKm: number | null;
  gainers: { name: string; a: number; b: number; diff: number }[];
  losers: { name: string; a: number; b: number; diff: number }[];
  totals: [number, number];
}

export type LensView = HerkunftView | ZieleView | WegeView | KettenView | WandelView;

const DISTANCE_BINS: [number, number, string][] = [
  [0, 100, "unter 100 km"],
  [100, 300, "100–300 km"],
  [300, 600, "300–600 km"],
  [600, 1000, "600–1.000 km"],
  [1000, 2000, "1.000–2.000 km"],
  [2000, Infinity, "über 2.000 km"],
];
const MIN_LQ_BASE = 20;
const MIN_CELL = 12;
const MIN_YEAR_POINTS = 300;
const MIN_PLACE_FOR_CHANGE = 60;

export function points(series: Series | null, window: [number, number]): PlacePoint[] {
  if (!series) return [];
  const sums = totals(series, window);
  const out: PlacePoint[] = [];
  sums.forEach((n, i) => {
    if (n > 0) out.push({ name: series.names[i], extra: series.extra[i], lat: series.lat[i], lon: series.lon[i], n });
  });
  return out.sort((a, b) => b.n - a.n);
}

export function herkunftView(series: Series | null, base: Series | null, state: State, selected: SelectionView | null, lqActive: boolean): HerkunftView {
  const list = points(series, state.window);
  if (state.mode === "anteil" && base) {
    const baseList = points(base, state.window);
    const byKey = new Map(baseList.map((p) => [`${p.lat}|${p.lon}`, p.n]));
    const total = list.reduce((s, p) => s + p.n, 0);
    const baseTotal = baseList.reduce((s, p) => s + p.n, 0);
    for (const p of list) {
      p.base = byKey.get(`${p.lat}|${p.lon}`) ?? p.n;
      p.lq = p.base >= MIN_LQ_BASE && total > 0 ? (p.n / p.base) / (total / baseTotal) : undefined;
    }
  }
  const distances = list.map((p) => distanceKm(p.lat, p.lon, BREMEN[1], BREMEN[0]));
  const weights = list.map((p) => p.n);
  const total = weights.reduce((s, w) => s + w, 0);
  const europe = list.filter((p) => inEurope(p.lat, p.lon)).reduce((s, p) => s + p.n, 0);
  return {
    kind: "herkunft",
    mode: state.mode,
    points: list,
    total,
    medianKm: weightedMedian(distances, weights),
    europeShare: total ? europe / total : null,
    distanceBins: DISTANCE_BINS.map(([low, high, label]) => ({ label, n: list.reduce((s, p, i) => s + (distances[i] >= low && distances[i] < high ? p.n : 0), 0) })),
    lqActive,
    selected,
  };
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

export function zieleView(ports: Series | null, destinations: Series | null, state: State, selected: SelectionView | null): ZieleView {
  const portList = points(ports, state.window);
  const destinationList = points(destinations, state.window);
  const regions = new Map<string, number>();
  for (const p of destinationList) {
    const region = REGIONS.find(([, test]) => test(p.lat, p.lon))?.[0] ?? "übrige";
    regions.set(region, (regions.get(region) ?? 0) + p.n);
  }
  return {
    kind: "ziele",
    ports: portList,
    destinations: destinationList,
    total: destinationList.reduce((s, p) => s + p.n, 0),
    regions: [...regions.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    selected,
  };
}

export function kettenView(corridors: Corridor[], categories: string[], state: State, members: any[] | null): KettenView {
  const [from, to] = state.window;
  const withWindow: CorridorView[] = corridors.map((c) => ({ ...c, inWindow: c.jahre.reduce((s, [y, n]) => s + (y >= from && y <= to ? n : 0), 0) })).filter((c) => c.inWindow > 0);
  const visible = state.category ? withWindow.filter((c) => c.kategorie === state.category) : withWindow;
  return {
    kind: "ketten",
    corridors: visible.sort((a, b) => b.z - a.z),
    categories: categories.map((name) => {
      const list = withWindow.filter((c) => c.kategorie === name);
      return { name, corridors: list.length, persons: list.reduce((s, c) => s + c.personen, 0) };
    }),
    selected: state.corridor === null ? null : withWindow.find((c) => c.id === state.corridor) ?? corridors.map((c) => ({ ...c, inWindow: 0 })).find((c) => c.id === state.corridor) ?? null,
    members,
  };
}

function periodRange(id: string): [number, number] {
  const period = PERIODS.find((p) => p.id === id)!;
  return [period.from, period.to];
}

function europeanWeighted(list: PlacePoint[]): Weighted[] {
  return list.filter((p) => inEurope(p.lat, p.lon)).map((p) => ({ lat: p.lat, lon: p.lon, w: p.n }));
}

export function wandelView(series: Series | null, state: State): WandelView {
  const [a, b] = state.compare;
  const listA = points(series, periodRange(a));
  const listB = points(series, periodRange(b));
  const totalA = listA.reduce((s, p) => s + p.n, 0);
  const totalB = listB.reduce((s, p) => s + p.n, 0);
  const cells = new Map<string, { a: number; b: number }>();
  for (const p of listA) {
    const key = cellKey(p.lat, p.lon);
    cells.set(key, { a: (cells.get(key)?.a ?? 0) + p.n, b: cells.get(key)?.b ?? 0 });
  }
  for (const p of listB) {
    const key = cellKey(p.lat, p.lon);
    cells.set(key, { a: cells.get(key)?.a ?? 0, b: (cells.get(key)?.b ?? 0) + p.n });
  }
  const cellList: Cell[] = [];
  cells.forEach((value, key) => {
    if (value.a + value.b < MIN_CELL || !totalA || !totalB) return;
    cellList.push({ key, polygon: cellPolygon(key), a: value.a, b: value.b, diff: value.b / totalB - value.a / totalA });
  });
  const yearly: (Centroid & { year: number })[] = [];
  if (series) {
    const years = [...new Set(series.year)].sort((x, y) => x - y);
    for (const year of years) {
      const c = centroid(europeanWeighted(points(series, [year, year])));
      if (c && c.n >= MIN_YEAR_POINTS) yearly.push({ ...c, year });
    }
  }
  const shapes: PeriodShape[] = [];
  for (const [period, list] of [[a, listA], [b, listB]] as [string, PlacePoint[]][]) {
    const weighted = europeanWeighted(list);
    const c = centroid(weighted);
    if (c) shapes.push({ period, centroid: c, ring: deviationEllipse(weighted, c) });
  }
  const shiftKm = shapes.length === 2 ? distanceKm(shapes[0].centroid.lat, shapes[0].centroid.lon, shapes[1].centroid.lat, shapes[1].centroid.lon) : null;
  const byPlace = new Map<string, { name: string; a: number; b: number }>();
  for (const p of listA) byPlace.set(`${p.lat}|${p.lon}`, { name: p.name, a: p.n, b: 0 });
  for (const p of listB) {
    const key = `${p.lat}|${p.lon}`;
    const entry = byPlace.get(key) ?? { name: p.name, a: 0, b: 0 };
    entry.b = p.n;
    byPlace.set(key, entry);
  }
  const changes = [...byPlace.values()]
    .filter((p) => p.a + p.b >= MIN_PLACE_FOR_CHANGE && totalA && totalB)
    .map((p) => ({ name: p.name, a: p.a / totalA, b: p.b / totalB, diff: p.b / totalB - p.a / totalA }));
  return {
    kind: "wandel",
    periods: [a, b],
    cells: cellList,
    yearly,
    shapes,
    shiftKm,
    gainers: [...changes].sort((x, y) => y.diff - x.diff).slice(0, 8),
    losers: [...changes].sort((x, y) => x.diff - y.diff).slice(0, 8),
    totals: [totalA, totalB],
  };
}

export function wegeViewOf(flows: Flow[], loading: boolean): WegeView {
  return { kind: "wege", flows, loading };
}
