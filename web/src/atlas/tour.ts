import { escapeHtml } from "../format";
import { CHAPTERS } from "./chapters";
import type { MapView } from "./mapview";
import type { AtlasData } from "./source";
import { FULL_WINDOW, store, type State } from "./state";
import type { Timeline } from "./timeline";

const CLOSE_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const RESET: Partial<State> = { name: "", similar: false, window: FULL_WINDOW, selection: null, corridor: null, category: "" };

export class Tour {
  private card: HTMLElement;
  private index = -1;

  constructor(private data: AtlasData, private map: MapView, private timeline: Timeline, private onFinish: () => void) {
    this.card = document.getElementById("tour")!;
  }

  get active(): boolean {
    return this.index >= 0;
  }

  start(index = 0): void {
    this.go(Math.max(0, Math.min(CHAPTERS.length - 1, index)));
  }

  end(): void {
    this.index = -1;
    this.card.hidden = true;
    this.timeline.stop();
    document.body.classList.remove("touring");
  }

  private go(index: number): void {
    this.index = index;
    const chapter = CHAPTERS[index];
    this.timeline.stop();
    store.set({ ...RESET, selection: chapter.state.view === "ziele" ? this.shanghai() : null, ...chapter.state });
    this.map.fly(chapter.frame, 1800, true);
    if (chapter.play) window.setTimeout(() => this.index === index && this.timeline.play(), 1900);
    const last = index === CHAPTERS.length - 1;
    document.body.classList.add("touring");
    this.card.hidden = false;
    this.card.innerHTML = `
      <div class="tour-progress" aria-hidden="true">${CHAPTERS.map((_, i) => `<i class="${i <= index ? "done" : ""}"></i>`).join("")}</div>
      <button type="button" class="tour-close" id="tour-end" aria-label="Rundgang beenden">${CLOSE_ICON}</button>
      <h2>${escapeHtml(chapter.title)}</h2>
      <p>${escapeHtml(chapter.text(this.data.kapitel))}</p>
      <div class="tour-nav">
        <button type="button" class="button secondary" id="tour-prev"${index === 0 ? " disabled" : ""}>Zurück</button>
        <span class="tour-count">${index + 1} von ${CHAPTERS.length}</span>
        <button type="button" class="button" id="tour-next">${last ? "Selbst erkunden" : "Weiter"}</button>
      </div>`;
    this.card.querySelector("#tour-prev")!.addEventListener("click", () => this.go(index - 1));
    this.card.querySelector("#tour-next")!.addEventListener("click", () => (last ? this.finish() : this.go(index + 1)));
    this.card.querySelector("#tour-end")!.addEventListener("click", () => this.end());
    (this.card.querySelector("#tour-next") as HTMLElement).focus({ preventScroll: true });
  }

  private finish(): void {
    this.end();
    store.set({ ...RESET, view: "herkunft" });
    this.map.fly("europa", 1400);
    this.onFinish();
  }

  private shanghai() {
    const corridor = this.data.korridore.find((c) => c.ziel === "Shanghai");
    return corridor ? { kind: "ziel" as const, name: "Shanghai", land: corridor.ziel_land, lat: corridor.ziel_lat, lon: corridor.ziel_lon } : null;
  }
}
