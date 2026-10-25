export type View = "herkunft" | "ziele" | "ketten";

export interface Selection {
  kind: "herkunft" | "ziel";
  name: string;
  land: string | null;
  lat: number;
  lon: number;
}

export interface State {
  view: View;
  name: string;
  similar: boolean;
  window: [number, number];
  selection: Selection | null;
  category: string;
  corridor: number | null;
  person: number | null;
}

export const FIRST_YEAR = 1830;
export const LAST_YEAR = 1939;

export const VIEWS: { id: View; label: string }[] = [
  { id: "herkunft", label: "Herkunft" },
  { id: "ziele", label: "Ziele" },
  { id: "ketten", label: "Ketten" },
];

export const FULL_WINDOW: [number, number] = [FIRST_YEAR, LAST_YEAR];

const DEFAULT_STATE: State = {
  view: "herkunft",
  name: "",
  similar: false,
  window: FULL_WINDOW,
  selection: null,
  category: "",
  corridor: null,
  person: null,
};

export function isFullWindow(window: [number, number]): boolean {
  return window[0] === FIRST_YEAR && window[1] === LAST_YEAR;
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

  subscribe(listener: Listener): void {
    this.listeners.add(listener);
  }
}

function readHash(): Partial<State> & { kapitel?: number } {
  const params = new URLSearchParams(location.hash.slice(1));
  const result: Partial<State> & { kapitel?: number } = {};
  const view = params.get("ansicht") as View | null;
  if (view && VIEWS.some((v) => v.id === view)) result.view = view;
  const from = Number(params.get("von"));
  const to = Number(params.get("bis"));
  if (from >= FIRST_YEAR && to <= LAST_YEAR && from <= to) result.window = [from, to];
  if (params.get("nachname")) result.name = params.get("nachname")!.trim();
  if (params.get("aehnlich") === "1") result.similar = true;
  const person = Number(params.get("eintrag"));
  if (Number.isInteger(person) && person > 0) result.person = person;
  if (params.has("kapitel")) result.kapitel = Number(params.get("kapitel"));
  return result;
}

let hashTimer: number | undefined;

function writeHash(state: State): void {
  window.clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    const params = new URLSearchParams();
    params.set("ansicht", state.view);
    if (!isFullWindow(state.window)) {
      params.set("von", String(state.window[0]));
      params.set("bis", String(state.window[1]));
    }
    if (state.name) params.set("nachname", state.name);
    if (state.name && state.similar) params.set("aehnlich", "1");
    if (state.person !== null) params.set("eintrag", String(state.person));
    history.replaceState(null, "", `#${params.toString()}`);
  }, 250);
}

const fromHash = readHash();
export const initialChapter = fromHash.kapitel;
delete fromHash.kapitel;
export const store = new Store({ ...DEFAULT_STATE, ...fromHash });
