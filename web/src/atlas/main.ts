import "../styles.css";
import "./atlas.css";
import type maplibregl from "maplibre-gl";
import { onThemeChange } from "../theme";
import { MapView, type FRAMES } from "./mapview";
import { Panel } from "./panel";
import { AtlasData, scopeKey, type EntryList, type Scope, type Search } from "./source";
import { initialChapter, store, VIEWS, type State, type View } from "./state";
import { Timeline } from "./timeline";
import { Tour } from "./tour";
import { herkunftView, journey, kettenView, zieleView, type AtlasView, type EntryBlock, type SelectionView } from "./views";

const FIRST_PAGE = 25;
const NEXT_PAGE = 50;

const FRAME_OF: Record<View, keyof typeof FRAMES> = {
  herkunft: "europa",
  ziele: "atlantik",
  ketten: "atlantik",
};

const data = new AtlasData();
await data.loadStatic();
const baseYears = await data.years({ name: "", similar: false });

const limits = new Map<string, number>();
const panel = new Panel(data, baseYears, (key) => {
  limits.set(key, (limits.get(key) ?? FIRST_PAGE) + NEXT_PAGE);
  schedule();
});
const yearOverlay = document.getElementById("year-overlay")!;
const map = new MapView(document.getElementById("map")!, document.getElementById("tooltip")!, {
  selectPlace: (kind, p) => store.set({ selection: { kind, name: p.name, land: p.land, lat: p.lat, lon: p.lon } }),
  selectCorridor: (id) => store.set({ corridor: id }),
  clear: () => {
    if (store.state.person !== null) store.set({ person: null });
    else if (store.state.selection || store.state.corridor !== null) store.set({ selection: null, corridor: null });
  },
});
const timeline = new Timeline(document.getElementById("timeline")!, baseYears, (window, playing) => {
  yearOverlay.textContent = playing ? String(window[0]) : "";
  yearOverlay.classList.toggle("visible", playing);
  store.set({ window });
});
timeline.setCounts(baseYears);
timeline.setWindow(store.state.window);
const tour = new Tour(data, map, timeline, () => panel.focusSearch());
document.getElementById("tour-start")!.addEventListener("click", () => tour.start());

const search = (state: State): Search => ({ name: state.name, similar: state.similar });
const resolved = new Map<string, unknown>();
const requested = new Set<string>();

function lazy<T>(key: string, compute: () => Promise<T>): T | null {
  if (resolved.has(key)) return resolved.get(key) as T;
  if (!requested.has(key)) {
    requested.add(key);
    compute().then((value) => {
      resolved.set(key, value);
      schedule();
    });
  }
  return null;
}

function selectionView(state: State): SelectionView | null {
  const selection = state.selection;
  if (!selection) return null;
  const key = JSON.stringify(["profile", selection, search(state), state.window]);
  return { selection, profile: data.ready ? lazy(key, () => data.profile(selection, search(state), state.window)) : null };
}

const shownLists = new Map<string, EntryList>();

function entryBlock(scope: Scope): EntryBlock {
  const key = scopeKey(scope);
  const limit = limits.get(key) ?? FIRST_PAGE;
  const fresh = data.ready ? lazy(JSON.stringify(["entries", key, limit]), () => data.entries(scope, limit)) : null;
  if (fresh) shownLists.set(key, fresh);
  return { key, list: fresh ?? shownLists.get(key) ?? null, limit };
}

function placeEntries(state: State): EntryBlock | null {
  if (!state.name && !state.selection) return null;
  return entryBlock({ search: search(state), window: state.window, selection: state.selection, corridor: null });
}

async function compute(state: State): Promise<AtlasView> {
  const s = search(state);
  if (state.person !== null) {
    if (!data.ready) return { kind: "loading" };
    const person = await data.record(state.person);
    if (person) return { kind: "person", person };
    queueMicrotask(() => store.set({ person: null }));
  }
  if (s.name && !data.ready) return { kind: "loading" };
  const years = await data.years(s);
  const count = [...years].reduce((sum, [year, n]) => sum + (year >= state.window[0] && year <= state.window[1] ? n : 0), 0);
  switch (state.view) {
    case "herkunft":
      return herkunftView(await data.origins(s), count, state, selectionView(state), placeEntries(state));
    case "ziele": {
      const [destinations, ports] = await Promise.all([data.destinations(s), data.ports(s)]);
      return zieleView(destinations, ports, count, state, selectionView(state), placeEntries(state));
    }
    case "ketten": {
      const corridor = data.korridore.find((c) => c.id === state.corridor) ?? null;
      const entries = corridor ? entryBlock({ search: s, window: state.window, selection: null, corridor }) : null;
      return kettenView(data.korridore, data.kategorien, state, await data.corridorHits(s), entries);
    }
  }
}

let generation = 0;
let pending = false;
let revealed = "";
let revealedPerson: number | null = null;
let cameraBeforePerson: { center: maplibregl.LngLat; zoom: number } | null = null;

function reveal(view: AtlasView): void {
  if (tour.active) return;
  if (view.kind === "person") {
    if (revealedPerson === view.person.record.id) return;
    revealedPerson = view.person.record.id;
    map.reveal(journey(view.person).flatMap((s) => (s.position ? [s.position] : [])), true);
    return;
  }
  revealedPerson = null;
  if ((view.kind === "herkunft" || view.kind === "ziele") && view.selected?.profile) {
    const { selection, profile } = view.selected;
    const key = JSON.stringify(selection);
    if (key === revealed) return;
    revealed = key;
    map.reveal([[selection.lon, selection.lat], ...profile.counterparts.slice(0, 6).map((c): [number, number] => [c.lon, c.lat])]);
  } else if (view.kind === "ketten" && view.selected) {
    const c = view.selected;
    if (`k${c.id}` === revealed) return;
    revealed = `k${c.id}`;
    map.reveal([[c.herkunft_lon, c.herkunft_lat], [c.ziel_lon, c.ziel_lat]]);
  } else if (!(view.kind === "herkunft" || view.kind === "ziele") || !view.selected) {
    revealed = "";
  }
}

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
    panel.render(view, state);
    reveal(view);
  });
}

function refreshTimeline(): void {
  const s = search(store.state);
  if (s.name && !data.ready) return;
  data.years(s).then((counts) => timeline.setCounts(counts));
}

function renderViewSwitch(): void {
  const nav = document.getElementById("views")!;
  nav.innerHTML = VIEWS.map((v) => `<button type="button" role="tab" data-view="${v.id}" aria-selected="${store.state.view === v.id}">${v.label}</button>`).join("");
  nav.querySelectorAll<HTMLButtonElement>("button").forEach((button) =>
    button.addEventListener("click", () => {
      const view = button.dataset.view as View;
      if (view !== store.state.view) store.set({ view, selection: null, corridor: null, person: null });
    }),
  );
}

store.subscribe((state, previous) => {
  if (previous.person === null && state.person !== null) cameraBeforePerson = { center: map.map.getCenter(), zoom: map.map.getZoom() };
  if (state.person === null && previous.person !== null) {
    if (state.view === previous.view && !tour.active) {
      if (cameraBeforePerson) map.map.easeTo({ ...cameraBeforePerson, duration: 1000, essential: true });
      else map.fly(FRAME_OF[state.view]);
    }
    cameraBeforePerson = null;
  }
  if (state.view !== previous.view) {
    document.querySelectorAll<HTMLButtonElement>("#views button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
    map.fly(FRAME_OF[state.view]);
  }
  if (state.name !== previous.name || state.similar !== previous.similar) {
    panel.sync(state);
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
    else if (store.state.person !== null) store.set({ person: null });
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

renderViewSwitch();
await map.whenReady();
if (store.state.view !== "herkunft") map.fly(FRAME_OF[store.state.view], 0);
schedule();
if (initialChapter !== undefined && Number.isFinite(initialChapter)) tour.start(initialChapter - 1);

data
  .openDatabase((stage, loaded, total) => panel.loading(stage.startsWith("Daten") && total > 0 ? (loaded / total) * 0.95 : stage.startsWith("Tabelle") ? 0.97 : 0.02))
  .then(() => {
    panel.ready();
    refreshTimeline();
    schedule();
  })
  .catch(() => panel.failed());
