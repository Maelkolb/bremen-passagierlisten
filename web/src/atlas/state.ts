export type Lens = "herkunft" | "ziele" | "wege" | "ketten" | "wandel";
export type OriginMode = "orte" | "dichte" | "anteil";

export interface Filters {
  reiseart: string;
  sektor: string;
  geschlecht: string;
  alter: string;
  staat: string;
  nachname: string;
  aehnlich: boolean;
  beruf: string;
}

export interface Selection {
  kind: "herkunft" | "ziel";
  name: string;
  lat: number;
  lon: number;
}

export interface State {
  lens: Lens;
  mode: OriginMode;
  filters: Filters;
  window: [number, number];
  selection: Selection | null;
  category: string;
  corridor: number | null;
  compare: [string, string];
  flowLimit: number;
  overseasOnly: boolean;
}

export const FIRST_YEAR = 1830;
export const LAST_YEAR = 1939;

export const LENSES: { id: Lens; label: string }[] = [
  { id: "herkunft", label: "Herkunft" },
  { id: "ziele", label: "Ziele" },
  { id: "wege", label: "Wege" },
  { id: "ketten", label: "Ketten" },
  { id: "wandel", label: "Wandel" },
];

export const PERIODS: { id: string; label: string; from: number; to: number }[] = [
  { id: "1830–1869", label: "Segelschiffzeit", from: 1830, to: 1869 },
  { id: "1907–1914", label: "Vorkriegsjahre", from: 1907, to: 1914 },
  { id: "1919–1929", label: "Zwanziger Jahre", from: 1919, to: 1929 },
  { id: "1930–1939", label: "Dreißiger Jahre", from: 1930, to: 1939 },
];

export const AGE_GROUPS: Record<string, [number, number]> = {
  "0-14": [0, 14],
  "15-29": [15, 29],
  "30-44": [30, 44],
  "45-59": [45, 59],
  "60+": [60, 120],
};

export const DEFAULT_FILTERS: Filters = {
  reiseart: "Überfahrt",
  sektor: "",
  geschlecht: "",
  alter: "",
  staat: "",
  nachname: "",
  aehnlich: false,
  beruf: "",
};

const DEFAULT_STATE: State = {
  lens: "herkunft",
  mode: "orte",
  filters: DEFAULT_FILTERS,
  window: [FIRST_YEAR, LAST_YEAR],
  selection: null,
  category: "",
  corridor: null,
  compare: ["1907–1914", "1930–1939"],
  flowLimit: 300,
  overseasOnly: true,
};

export function filtersAreDefault(filters: Filters): boolean {
  return (Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]).every((key) => filters[key] === DEFAULT_FILTERS[key]);
}

export function activeFilterCount(filters: Filters): number {
  return (Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]).filter((key) => key !== "aehnlich" && filters[key] !== DEFAULT_FILTERS[key]).length;
}

type Listener = (state: State, previous: State) => void;

class Store {
  state: State;
  private listeners = new Set<Listener>();

  constructor(initial: State) {
    this.state = initial;
  }

  set(patch: Partial<State>): void {
    const previous = this.state;
    this.state = { ...previous, ...patch };
    this.listeners.forEach((listener) => listener(this.state, previous));
    writeHash(this.state);
  }

  setFilters(patch: Partial<Filters>): void {
    this.set({ filters: { ...this.state.filters, ...patch }, selection: null });
  }

  subscribe(listener: Listener): void {
    this.listeners.add(listener);
  }
}

function readHash(): Partial<State> & { kapitel?: number } {
  const params = new URLSearchParams(location.hash.slice(1));
  const result: Partial<State> & { kapitel?: number } = {};
  const lens = params.get("ansicht") as Lens | null;
  if (lens && LENSES.some((l) => l.id === lens)) result.lens = lens;
  const from = Number(params.get("von"));
  const to = Number(params.get("bis"));
  if (from >= FIRST_YEAR && to <= LAST_YEAR && from <= to) result.window = [from, to];
  const filters = { ...DEFAULT_FILTERS };
  for (const key of Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]) {
    const value = params.get(key);
    if (value === null) continue;
    if (key === "aehnlich") filters.aehnlich = value === "1";
    else filters[key] = value;
  }
  result.filters = filters;
  if (params.has("kapitel")) result.kapitel = Number(params.get("kapitel"));
  return result;
}

let hashTimer: number | undefined;

function writeHash(state: State): void {
  window.clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    const params = new URLSearchParams();
    params.set("ansicht", state.lens);
    if (state.window[0] !== FIRST_YEAR || state.window[1] !== LAST_YEAR) {
      params.set("von", String(state.window[0]));
      params.set("bis", String(state.window[1]));
    }
    for (const key of Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]) {
      const value = state.filters[key];
      if (value === DEFAULT_FILTERS[key]) continue;
      params.set(key, typeof value === "boolean" ? (value ? "1" : "0") : value);
    }
    history.replaceState(null, "", `#${params.toString()}`);
  }, 250);
}

const fromHash = readHash();
export const initialChapter = fromHash.kapitel;
delete fromHash.kapitel;
export const store = new Store({ ...DEFAULT_STATE, ...fromHash });
