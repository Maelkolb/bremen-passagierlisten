import { escapeHtml } from "../format";
import { CHAPTERS } from "./chapters";
import type { MapView } from "./mapview";
import type { AtlasData } from "./source";
import { DEFAULT_FILTERS, FIRST_YEAR, LAST_YEAR, store } from "./state";
import type { Timeline } from "./timeline";

export class Tour {
  private card: HTMLElement;
  private index = -1;

  constructor(private data: AtlasData, private map: MapView, private timeline: Timeline) {
    this.card = document.getElementById("tour")!;
    document.getElementById("tour-start")!.addEventListener("click", () => this.start(0));
  }

  get active(): boolean {
    return this.index >= 0;
  }

  start(index: number): void {
    this.go(Math.max(0, Math.min(CHAPTERS.length - 1, index)));
  }

  end(): void {
    this.index = -1;
    this.card.hidden = true;
    this.timeline.stop();
  }

  private go(index: number): void {
    this.index = index;
    const chapter = CHAPTERS[index];
    this.timeline.stop();
    const selection = chapter.title.startsWith("1938") ? this.shanghai() : null;
    store.set({
      filters: DEFAULT_FILTERS,
      window: [FIRST_YEAR, LAST_YEAR],
      selection,
      corridor: null,
      category: "",
      ...chapter.state,
    });
    this.timeline.setWindow(store.state.window);
    this.map.fly(chapter.view, 1800, true);
    if (chapter.play) window.setTimeout(() => this.index === index && this.timeline.play(), 1900);
    const last = index === CHAPTERS.length - 1;
    this.card.hidden = false;
    this.card.innerHTML = `
      <div class="tour-step">Rundgang ${index + 1} von ${CHAPTERS.length}</div>
      <h2>${escapeHtml(chapter.title)}</h2>
      <p>${escapeHtml(chapter.text(this.data.kapitel))}</p>
      <div class="tour-nav">
        <button type="button" class="button secondary" id="tour-prev"${index === 0 ? " disabled" : ""}>Zurück</button>
        <button type="button" class="button" id="tour-next">${last ? "Atlas erkunden" : "Weiter"}</button>
        <button type="button" class="back-link" id="tour-end">Beenden</button>
      </div>`;
    this.card.querySelector("#tour-prev")!.addEventListener("click", () => this.go(index - 1));
    this.card.querySelector("#tour-next")!.addEventListener("click", () => (last ? this.end() : this.go(index + 1)));
    this.card.querySelector("#tour-end")!.addEventListener("click", () => this.end());
    (this.card.querySelector("#tour-next") as HTMLElement).focus({ preventScroll: true });
  }

  private shanghai() {
    const corridor = this.data.korridore.find((c) => c.ziel === "Shanghai");
    return corridor ? { kind: "ziel" as const, name: "Shanghai", lat: corridor.ziel_lat, lon: corridor.ziel_lon } : null;
  }
}
