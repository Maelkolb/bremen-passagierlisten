import { fmt } from "../format";
import { FIRST_YEAR, LAST_YEAR } from "./state";

const PAD_LEFT = 4;
const PAD_RIGHT = 4;
const HEIGHT = 76;
const AXIS = 14;
const PLAY_MS = 850;
const LABEL_YEARS = [1830, 1840, 1850, 1860, 1870, 1880, 1890, 1900, 1910, 1920, 1930, 1939];

type Drag = { kind: "start" | "end" | "move" | "new"; anchor: number; from: [number, number] };

export class Timeline {
  private svg: SVGSVGElement;
  private label: HTMLElement;
  private playButton: HTMLButtonElement;
  private counts = new Map<number, number>();
  private gaps: [number, number][] = [];
  private window: [number, number] = [FIRST_YEAR, LAST_YEAR];
  private width = 800;
  private drag: Drag | null = null;
  private timer: number | null = null;
  private playYears: number[] = [];

  constructor(root: HTMLElement, private onChange: (window: [number, number], playing: boolean) => void) {
    root.innerHTML = `
      <div class="timeline-controls">
        <button type="button" class="button secondary" id="timeline-play">Abspielen</button>
        <div class="timeline-window" id="timeline-label"></div>
      </div>
      <svg class="timeline-svg" id="timeline-svg" role="slider" aria-label="Zeitfenster der Abfahrtsjahre" tabindex="0"></svg>`;
    this.svg = root.querySelector("#timeline-svg")!;
    this.label = root.querySelector("#timeline-label")!;
    this.playButton = root.querySelector("#timeline-play")!;
    this.playButton.addEventListener("click", () => (this.playing ? this.stop() : this.play()));
    new ResizeObserver(() => {
      this.width = this.svg.clientWidth || 800;
      this.render();
    }).observe(this.svg);
    this.bindPointer();
    this.svg.addEventListener("keydown", (e) => this.keyboard(e));
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  setCounts(counts: Map<number, number>): void {
    this.counts = counts;
    this.render();
  }

  setGaps(gaps: [number, number][]): void {
    this.gaps = gaps;
    this.render();
  }

  setWindow(window: [number, number]): void {
    this.window = window;
    this.render();
  }

  play(years?: number[]): void {
    this.stop();
    const withData = [...this.counts.entries()].filter(([, n]) => n > 0).map(([y]) => y).sort((a, b) => a - b);
    this.playYears = years ?? withData.filter((y) => y >= this.window[0] && y <= this.window[1]);
    if (this.playYears.length < 2) this.playYears = withData;
    let index = 0;
    this.playButton.textContent = "Anhalten";
    const step = () => {
      if (index >= this.playYears.length) {
        this.stop();
        this.emit([this.playYears[0], this.playYears[this.playYears.length - 1]], false);
        return;
      }
      const year = this.playYears[index++];
      this.emit([year, year], true);
    };
    step();
    this.timer = window.setInterval(step, PLAY_MS);
  }

  stop(): void {
    const wasPlaying = this.timer !== null;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.playButton.textContent = "Abspielen";
    if (wasPlaying) this.onChange(this.window, false);
  }

  private emit(window: [number, number], playing: boolean): void {
    this.window = window;
    this.render();
    this.onChange(window, playing);
  }

  private x(year: number): number {
    const step = (this.width - PAD_LEFT - PAD_RIGHT) / (LAST_YEAR - FIRST_YEAR + 1);
    return PAD_LEFT + (year - FIRST_YEAR) * step;
  }

  private yearAt(clientX: number): number {
    const rect = this.svg.getBoundingClientRect();
    const step = (this.width - PAD_LEFT - PAD_RIGHT) / (LAST_YEAR - FIRST_YEAR + 1);
    const year = FIRST_YEAR + Math.floor((clientX - rect.left - PAD_LEFT) / step);
    return Math.max(FIRST_YEAR, Math.min(LAST_YEAR, year));
  }

  private render(): void {
    const w = this.width;
    const plot = HEIGHT - AXIS;
    const step = (w - PAD_LEFT - PAD_RIGHT) / (LAST_YEAR - FIRST_YEAR + 1);
    const max = Math.max(1, ...this.counts.values());
    const bars: string[] = [];
    for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
      const n = this.counts.get(year) ?? 0;
      if (!n) continue;
      const h = Math.max(1.5, Math.sqrt(n / max) * (plot - 6));
      const inside = year >= this.window[0] && year <= this.window[1];
      bars.push(`<rect class="bar${inside ? " in" : ""}" x="${this.x(year) + step * 0.12}" y="${plot - h}" width="${Math.max(1, step * 0.76)}" height="${h}" rx="1"><title>${year}: ${fmt(n)} Einträge</title></rect>`);
    }
    const gaps = this.gaps.map(([a, b]) => {
      const gx = this.x(a);
      const gw = this.x(b + 1) - gx;
      const text = gw > 90 ? `<text x="${gx + gw / 2}" y="${plot / 2 + 3}" text-anchor="middle">${a}–${b} keine Listen</text>` : "";
      return `<rect class="gap" x="${gx}" y="2" width="${gw}" height="${plot - 2}"/>${text}`;
    }).join("");
    const bx = this.x(this.window[0]);
    const bw = this.x(this.window[1] + 1) - bx;
    const labelYears = w < 520 ? [FIRST_YEAR, 1870, 1910, LAST_YEAR] : LABEL_YEARS;
    const labels = labelYears.map((year) => {
      const anchor = year === FIRST_YEAR ? "start" : year === LAST_YEAR ? "end" : "middle";
      const lx = year === LAST_YEAR ? this.x(year + 1) : this.x(year);
      return `<text x="${lx}" y="${HEIGHT - 2}" text-anchor="${anchor}">${year}</text>`;
    }).join("");
    this.svg.setAttribute("viewBox", `0 0 ${w} ${HEIGHT}`);
    this.svg.innerHTML = `
      <defs><pattern id="timeline-hatch" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="5" stroke="var(--rule)" stroke-width="1.5"/></pattern></defs>
      ${gaps}
      <line x1="${PAD_LEFT}" x2="${w - PAD_RIGHT}" y1="${plot}" y2="${plot}" stroke="var(--rule-strong)"/>
      ${bars.join("")}
      <rect class="brush" x="${bx}" y="0" width="${bw}" height="${plot}" rx="2" style="fill-opacity:${this.window[0] === FIRST_YEAR && this.window[1] === LAST_YEAR ? 0.03 : 0.12}"/>
      <rect class="handle" x="${bx - 3}" y="${plot / 2 - 11}" width="6" height="22" rx="2"/>
      <rect class="handle" x="${bx + bw - 3}" y="${plot / 2 - 11}" width="6" height="22" rx="2"/>
      ${labels}`;
    this.svg.setAttribute("aria-valuetext", this.windowText());
    const total = [...this.counts.entries()].filter(([y]) => y >= this.window[0] && y <= this.window[1]).reduce((s, [, n]) => s + n, 0);
    this.label.innerHTML = `<strong>${this.windowText()}</strong>${fmt(total)} Einträge`;
  }

  private windowText(): string {
    return this.window[0] === this.window[1] ? String(this.window[0]) : `${this.window[0]}–${this.window[1]}`;
  }

  private bindPointer(): void {
    this.svg.addEventListener("pointerdown", (e) => {
      this.stop();
      const year = this.yearAt(e.clientX);
      const rect = this.svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const startX = this.x(this.window[0]);
      const endX = this.x(this.window[1] + 1);
      let kind: Drag["kind"] = "new";
      if (Math.abs(px - startX) < 8) kind = "start";
      else if (Math.abs(px - endX) < 8) kind = "end";
      else if (px > startX && px < endX && this.window[0] !== this.window[1]) kind = "move";
      this.drag = { kind, anchor: year, from: [...this.window] as [number, number] };
      if (kind === "new") this.emit([year, year], false);
      this.svg.setPointerCapture(e.pointerId);
    });
    this.svg.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const year = this.yearAt(e.clientX);
      const [a, b] = this.drag.from;
      let next: [number, number] = [a, b];
      if (this.drag.kind === "start") next = [Math.min(year, b), b];
      if (this.drag.kind === "end") next = [a, Math.max(year, a)];
      if (this.drag.kind === "new") next = [Math.min(this.drag.anchor, year), Math.max(this.drag.anchor, year)];
      if (this.drag.kind === "move") {
        const shift = Math.max(FIRST_YEAR - a, Math.min(LAST_YEAR - b, year - this.drag.anchor));
        next = [a + shift, b + shift];
      }
      if (next[0] !== this.window[0] || next[1] !== this.window[1]) this.emit(next, false);
    });
    const end = () => (this.drag = null);
    this.svg.addEventListener("pointerup", end);
    this.svg.addEventListener("pointercancel", end);
    this.svg.addEventListener("dblclick", () => this.emit([FIRST_YEAR, LAST_YEAR], false));
  }

  private keyboard(e: KeyboardEvent): void {
    const [a, b] = this.window;
    const shift = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (shift && a + shift >= FIRST_YEAR && b + shift <= LAST_YEAR) {
      e.preventDefault();
      this.emit([a + shift, b + shift], false);
    }
    if (e.key === "Home") this.emit([FIRST_YEAR, LAST_YEAR], false);
  }
}
