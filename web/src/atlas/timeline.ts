import { fmt } from "../format";
import { FIRST_YEAR, FULL_WINDOW, isFullWindow, LAST_YEAR } from "./state";

const SEGMENT_SPLIT = 20;
const MINOR_WEIGHT = 0.2;
const MINOR_SHARE = 0.05;
const BREAK_PX = 16;
const LABEL_SPACING = 34;
const EDGE = 14;
const MIN_MISSING_RUN = 3;
const PLAY_MS = 900;

const PLAY_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>`;
const PAUSE_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.8" width="3" height="10.4" rx="0.8" fill="currentColor"/><rect x="9.5" y="2.8" width="3" height="10.4" rx="0.8" fill="currentColor"/></svg>`;

interface Segment {
  from: number;
  to: number;
  weight: number;
  left: number;
}

export class YearAxis {
  segments: Segment[] = [];
  private unit = 1;

  constructor(private years: Map<number, number>, readonly width: number) {
    const present = [...years.keys()].sort((a, b) => a - b);
    const total = [...years.values()].reduce((s, n) => s + n, 0);
    const ranges: [number, number][] = [];
    for (const year of present) {
      const last = ranges[ranges.length - 1];
      if (last && year - last[1] <= SEGMENT_SPLIT) last[1] = year;
      else ranges.push([year, year]);
    }
    const share = (from: number, to: number) => present.filter((y) => y >= from && y <= to).reduce((s, y) => s + years.get(y)!, 0) / total;
    this.segments = ranges.map(([from, to]) => ({ from, to, weight: share(from, to) < MINOR_SHARE ? MINOR_WEIGHT : 1, left: 0 }));
    const units = this.segments.reduce((s, g) => s + (g.to - g.from + 1) * g.weight, 0);
    this.unit = (width - BREAK_PX * (this.segments.length - 1)) / units;
    let left = 0;
    for (const segment of this.segments) {
      segment.left = left;
      left = this.right(segment) + BREAK_PX;
    }
  }

  get first(): number {
    return this.segments[0].from;
  }

  get last(): number {
    return this.segments[this.segments.length - 1].to;
  }

  slot(year: number): number {
    return this.segmentOf(year).weight * this.unit;
  }

  x(year: number): number {
    const segment = this.segmentOf(year);
    const clamped = Math.max(segment.from, Math.min(segment.to + 1, year));
    return segment.left + (clamped - segment.from) * segment.weight * this.unit;
  }

  end(year: number): number {
    return this.x(year) + (this.inside(year) ? this.slot(year) : 0);
  }

  yearAt(px: number): number {
    let previous: Segment | null = null;
    for (const segment of this.segments) {
      if (px < segment.left) {
        if (!previous) return segment.from;
        return px - this.right(previous) < segment.left - px ? previous.to : segment.from;
      }
      if (px < this.right(segment)) return segment.from + Math.floor((px - segment.left) / (segment.weight * this.unit));
      previous = segment;
    }
    return this.last;
  }

  inside(year: number): boolean {
    return this.segments.some((s) => year >= s.from && year <= s.to);
  }

  breaks(): number[] {
    return this.segments.slice(1).map((s) => s.left - BREAK_PX / 2);
  }

  missingRuns(): [number, number][] {
    const runs: [number, number][] = [];
    for (const segment of this.segments) {
      let start: number | null = null;
      for (let year = segment.from; year <= segment.to + 1; year++) {
        const missing = year <= segment.to && !this.years.has(year);
        if (missing) start ??= year;
        else if (start !== null) {
          if (year - start >= MIN_MISSING_RUN) runs.push([start, year - 1]);
          start = null;
        }
      }
    }
    return runs;
  }

  labels(): number[] {
    const major = this.segments.filter((s) => s.weight === 1);
    const candidates = [
      ...this.segments.map((s) => s.from),
      ...major.map((s) => s.to),
      ...major.flatMap((s) => range(s.from, s.to).filter((y) => y % 10 === 0)),
      ...major.flatMap((s) => range(s.from, s.to).filter((y) => y % 5 === 0)),
    ];
    const accepted: number[] = [];
    for (const year of candidates) {
      if (accepted.includes(year)) continue;
      const center = this.x(year) + this.slot(year) / 2;
      if (accepted.every((other) => Math.abs(this.x(other) + this.slot(other) / 2 - center) >= LABEL_SPACING)) accepted.push(year);
    }
    return accepted.sort((a, b) => a - b);
  }

  private right(segment: Segment): number {
    return segment.left + (segment.to - segment.from + 1) * segment.weight * this.unit;
  }

  private segmentOf(year: number): Segment {
    for (let i = this.segments.length - 1; i >= 0; i--) if (year >= this.segments[i].from) return this.segments[i];
    return this.segments[0];
  }
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export function yearBars(axis: YearAxis, counts: Map<number, number>, window: [number, number], height: number, labelHeight = 14): string {
  const plot = height - labelHeight;
  const max = Math.max(1, ...counts.values());
  const bars: string[] = [];
  for (const [year, n] of counts) {
    if (!n || !axis.inside(year)) continue;
    const h = Math.max(1.5, Math.sqrt(n / max) * (plot - 4));
    const slot = axis.slot(year);
    const inWindow = year >= window[0] && year <= window[1];
    bars.push(`<rect class="bar${inWindow ? " in" : ""}" x="${(axis.x(year) + slot * 0.14).toFixed(1)}" y="${(plot - h).toFixed(1)}" width="${Math.max(1, slot * 0.72).toFixed(1)}" height="${h.toFixed(1)}"><title>${year}: ${fmt(n)} Einträge</title></rect>`);
  }
  const missing = axis.missingRuns().map(([a, b]) => `<rect class="missing" x="${axis.x(a).toFixed(1)}" y="0" width="${(axis.end(b) - axis.x(a)).toFixed(1)}" height="${plot}"><title>${a}–${b}: keine Listen überliefert</title></rect>`);
  const breaks = axis.breaks().map((x) => `<path class="break" d="M${x - 4} ${plot + 3} l4 -7 M${x} ${plot + 3} l4 -7"/>`);
  const baselines = axis.segments.map((s) => `<line class="baseline" x1="${s.left}" x2="${axis.end(s.to)}" y1="${plot}" y2="${plot}"/>`);
  const labels = axis.labels().map((year) => {
    const center = axis.x(year) + axis.slot(year) / 2;
    const [x, anchor] = center < EDGE ? [axis.x(year), "start"] : center > axis.width - EDGE ? [axis.end(year), "end"] : [center, "middle"];
    return `<text x="${x.toFixed(1)}" y="${height - 2}" text-anchor="${anchor}">${year}</text>`;
  });
  return `<defs><pattern id="hatch" width="4" height="4" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="4" class="hatch"/></pattern></defs>${missing.join("")}${baselines.join("")}${breaks.join("")}${bars.join("")}${labels.join("")}`;
}

type Drag = { kind: "start" | "end" | "move" | "new"; anchor: number; from: [number, number] };

export class Timeline {
  private svg: SVGSVGElement;
  private range: HTMLElement;
  private count: HTMLElement;
  private reset: HTMLButtonElement;
  private playButton: HTMLButtonElement;
  private counts = new Map<number, number>();
  private axis: YearAxis;
  private window: [number, number] = FULL_WINDOW;
  private drag: Drag | null = null;
  private timer: number | null = null;
  private height = 58;

  constructor(root: HTMLElement, private baseYears: Map<number, number>, private onChange: (window: [number, number], playing: boolean) => void) {
    root.innerHTML = `
      <button type="button" class="play" id="timeline-play" aria-label="Jahre abspielen">${PLAY_ICON}</button>
      <div class="timeline-text">
        <div class="timeline-range" id="timeline-range"></div>
        <div class="timeline-count"><span id="timeline-count"></span><button type="button" class="link-button" id="timeline-reset" hidden>alle Jahre</button></div>
      </div>
      <svg class="timeline-svg" id="timeline-svg" role="slider" aria-label="Zeitraum der Abfahrtsjahre" tabindex="0"></svg>`;
    this.svg = root.querySelector("#timeline-svg")!;
    this.range = root.querySelector("#timeline-range")!;
    this.count = root.querySelector("#timeline-count")!;
    this.reset = root.querySelector("#timeline-reset")!;
    this.playButton = root.querySelector("#timeline-play")!;
    this.axis = new YearAxis(baseYears, 800);
    this.playButton.addEventListener("click", () => (this.playing ? this.stop() : this.play()));
    this.reset.addEventListener("click", () => this.emit(FULL_WINDOW, false));
    new ResizeObserver(() => this.render()).observe(this.svg);
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

  setWindow(window: [number, number]): void {
    this.window = window;
    this.render();
  }

  play(): void {
    this.stop();
    const withData = [...this.baseYears.keys()].sort((a, b) => a - b);
    const inWindow = withData.filter((y) => y >= this.window[0] && y <= this.window[1]);
    const years = inWindow.length > 1 ? inWindow : withData;
    const restore: [number, number] = inWindow.length > 1 ? this.window : FULL_WINDOW;
    let index = 0;
    this.playButton.innerHTML = PAUSE_ICON;
    this.playButton.setAttribute("aria-label", "Anhalten");
    const step = () => {
      if (index >= years.length) {
        this.stop();
        this.emit(restore, false);
        return;
      }
      const year = years[index++];
      this.emit([year, year], true);
    };
    step();
    this.timer = window.setInterval(step, PLAY_MS);
  }

  stop(): void {
    const wasPlaying = this.timer !== null;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.playButton.innerHTML = PLAY_ICON;
    this.playButton.setAttribute("aria-label", "Jahre abspielen");
    if (wasPlaying) this.onChange(this.window, false);
  }

  private emit(window: [number, number], playing: boolean): void {
    this.window = window;
    this.render();
    this.onChange(window, playing);
  }

  private render(): void {
    const width = this.svg.clientWidth || 800;
    if (width !== this.axis.width) this.axis = new YearAxis(this.baseYears, width);
    const plot = this.height - 14;
    const a = this.axis;
    const left = a.x(Math.max(this.window[0], a.first));
    const right = a.end(Math.min(this.window[1], a.last));
    const full = isFullWindow(this.window);
    this.svg.setAttribute("viewBox", `0 0 ${width} ${this.height}`);
    this.svg.innerHTML = `
      ${yearBars(a, this.counts, this.window, this.height)}
      ${full ? "" : `<rect class="brush" x="${left}" y="0" width="${Math.max(2, right - left)}" height="${plot}" rx="3"/>
      <rect class="handle" x="${left - 3}" y="${plot / 2 - 10}" width="6" height="20" rx="3"/>
      <rect class="handle" x="${right - 3}" y="${plot / 2 - 10}" width="6" height="20" rx="3"/>`}`;
    this.svg.setAttribute("aria-valuetext", this.windowText());
    const total = [...this.counts.entries()].filter(([y]) => y >= this.window[0] && y <= this.window[1]).reduce((s, [, n]) => s + n, 0);
    this.range.textContent = full ? `${a.first}–${a.last}` : this.windowText();
    this.count.textContent = `${fmt(total)} Einträge`;
    this.reset.hidden = full || this.playing;
  }

  private windowText(): string {
    return this.window[0] === this.window[1] ? String(this.window[0]) : `${this.window[0]}–${this.window[1]}`;
  }

  private pointerYear(clientX: number): number {
    const rect = this.svg.getBoundingClientRect();
    return this.axis.yearAt(clientX - rect.left);
  }

  private bindPointer(): void {
    this.svg.addEventListener("pointerdown", (e) => {
      this.stop();
      const year = this.pointerYear(e.clientX);
      const px = e.clientX - this.svg.getBoundingClientRect().left;
      const full = isFullWindow(this.window);
      const startX = this.axis.x(Math.max(this.window[0], this.axis.first));
      const endX = this.axis.end(Math.min(this.window[1], this.axis.last));
      let kind: Drag["kind"] = "new";
      if (!full && Math.abs(px - startX) < 8) kind = "start";
      else if (!full && Math.abs(px - endX) < 8) kind = "end";
      else if (!full && px > startX && px < endX && this.window[0] !== this.window[1]) kind = "move";
      this.drag = { kind, anchor: year, from: [...this.window] as [number, number] };
      if (kind === "new") this.emit([year, year], false);
      this.svg.setPointerCapture(e.pointerId);
    });
    this.svg.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const year = this.pointerYear(e.clientX);
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
    this.svg.addEventListener("dblclick", () => this.emit(FULL_WINDOW, false));
  }

  private keyboard(e: KeyboardEvent): void {
    const [a, b] = this.window;
    const shift = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (shift && a + shift >= FIRST_YEAR && b + shift <= LAST_YEAR) {
      e.preventDefault();
      this.emit([a + shift, b + shift], false);
    }
    if (e.key === "Home" || e.key === "Escape") this.emit(FULL_WINDOW, false);
  }
}
