import "../styles.css";
import "./atlas.css";
import { onThemeChange } from "../theme";
import { herkunftView, kettenView, wandelView, wegeViewOf, zieleView, type LensView, type SelectionView } from "./lenses";
import { MapView, type VIEWS } from "./mapview";
import { Panel } from "./panel";
import { AtlasData, type Profile } from "./source";
import { filtersAreDefault, FIRST_YEAR, initialChapter, LAST_YEAR, LENSES, store, type Lens, type State } from "./state";
import { Timeline } from "./timeline";
import { Tour } from "./tour";

const LENS_VIEWS: Record<Lens, keyof typeof VIEWS> = {
  herkunft: "europa",
  ziele: "atlantik",
  wege: "atlantik",
  ketten: "nordatlantik",
  wandel: "europa",
};

const data = new AtlasData();
await data.loadStatic();

const panel = new Panel(data);
const yearOverlay = document.getElementById("year-overlay")!;
const map = new MapView(document.getElementById("map")!, document.getElementById("tooltip")!, {
  selectPlace: (kind, point) => store.set({ selection: { kind, name: point.name, lat: point.lat, lon: point.lon } }),
  selectCorridor: (id) => store.set({ corridor: id }),
  clear: () => {
    if (store.state.selection || store.state.corridor !== null) store.set({ selection: null, corridor: null });
  },
});
const timeline = new Timeline(document.getElementById("timeline")!, (window, playing) => {
  yearOverlay.textContent = playing ? String(window[0]) : "";
  yearOverlay.classList.toggle("visible", playing);
  store.set({ window });
});
timeline.setGaps(gapsFrom(data.basis.jahre.jahr));
timeline.setWindow(store.state.window);
const tour = new Tour(data, map, timeline);

const profiles = new Map<string, Promise<Profile>>();
const members = new Map<number, Promise<any[]>>();

function gapsFrom(years: number[]): [number, number][] {
  const present = new Set(years);
  const gaps: [number, number][] = [];
  let start: number | null = null;
  for (let year = FIRST_YEAR; year <= LAST_YEAR + 1; year++) {
    if (!present.has(year) && year <= LAST_YEAR) start ??= year;
    else if (start !== null) {
      if (year - start >= 3) gaps.push([start, year - 1]);
      start = null;
    }
  }
  return gaps;
}

function renderLensTabs(): void {
  const nav = document.getElementById("lenses")!;
  nav.innerHTML = LENSES.map((l) => `<button type="button" data-lens="${l.id}" aria-pressed="${store.state.lens === l.id}">${l.label}</button>`).join("");
  nav.querySelectorAll<HTMLButtonElement>("button").forEach((button) =>
    button.addEventListener("click", () => {
      const lens = button.dataset.lens as Lens;
      if (lens === store.state.lens) return;
      store.set({ lens, selection: null, corridor: null });
      map.fly(LENS_VIEWS[lens]);
    }),
  );
}

async function selectionView(state: State): Promise<SelectionView | null> {
  const sel = state.selection;
  if (!sel || !data.ready) return sel ? { selection: sel, profile: null } : null;
  const key = JSON.stringify([sel, state.filters, state.window]);
  if (!profiles.has(key)) profiles.set(key, data.profile(sel, state.filters, state.window));
  return { selection: sel, profile: await profiles.get(key)! };
}

async function compute(state: State): Promise<LensView> {
  switch (state.lens) {
    case "herkunft": {
      const lqActive = !filtersAreDefault({ ...state.filters, reiseart: "Überfahrt" });
      const [series, base, selected] = await Promise.all([
        data.origins(state.filters),
        state.mode === "anteil" && lqActive ? data.baseOrigins(state.filters) : Promise.resolve(null),
        selectionView(state),
      ]);
      return herkunftView(series, base, state, selected, lqActive);
    }
    case "ziele": {
      const [ports, destinations, selected] = await Promise.all([data.ports(state.filters), data.destinations(state.filters), selectionView(state)]);
      return zieleView(ports, destinations, state, selected);
    }
    case "wege": {
      if (!data.ready) return wegeViewOf([], true);
      return wegeViewOf(await data.flows(state.filters, state.window, state.flowLimit, state.overseasOnly), false);
    }
    case "ketten": {
      let list: any[] | null = null;
      if (state.corridor !== null && data.ready) {
        const corridor = data.korridore.find((c) => c.id === state.corridor);
        if (corridor) {
          if (!members.has(corridor.id)) members.set(corridor.id, data.corridorMembers(corridor));
          list = await members.get(corridor.id)!;
        }
      }
      return kettenView(data.korridore, data.kategorien, state, list);
    }
    case "wandel":
      return wandelView(await data.origins(state.filters), state);
  }
}

let generation = 0;
let pending = false;

function schedule(): void {
  if (pending) return;
  pending = true;
  requestAnimationFrame(async () => {
    pending = false;
    const run = ++generation;
    const state = store.state;
    const view = await compute(state);
    if (run !== generation) return;
    map.render(view);
    panel.render(view);
  });
}

function refreshTimeline(): void {
  data.years(store.state.filters).then((counts) => timeline.setCounts(counts));
}

store.subscribe((state, previous) => {
  if (state.lens !== previous.lens) {
    document.querySelectorAll<HTMLButtonElement>("#lenses button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lens === state.lens)));
  }
  if (state.filters !== previous.filters) {
    panel.syncFilters(state.filters);
    refreshTimeline();
  }
  if (state.window !== previous.window) timeline.setWindow(state.window);
  schedule();
});

document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
  if (e.key === "Escape") {
    if (tour.active) tour.end();
    else store.set({ selection: null, corridor: null });
  }
  if (e.key === " ") {
    e.preventDefault();
    if (timeline.playing) timeline.stop();
    else timeline.play();
  }
});

onThemeChange(() => {
  map.restyle();
  schedule();
});

renderLensTabs();
refreshTimeline();
await map.whenReady();
if (store.state.lens !== "herkunft") map.fly(LENS_VIEWS[store.state.lens], 0);
schedule();
if (initialChapter !== undefined && Number.isFinite(initialChapter)) tour.start(initialChapter - 1);

data
  .openDatabase((stage, loaded, total) => panel.status(stage, loaded, total))
  .then(() => {
    panel.ready();
    profiles.clear();
    refreshTimeline();
    schedule();
  })
  .catch((error) => panel.failed(String(error?.message ?? error)));
