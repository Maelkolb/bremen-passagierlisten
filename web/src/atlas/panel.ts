import { escapeHtml, fmt, pct } from "../format";
import { tokens, type Tokens } from "../theme";
import { categoryColor, css, placeRadius, rgb, viewColor } from "./mapview";
import type { AtlasData, Corridor, Member } from "./source";
import { FULL_WINDOW, isFullWindow, store, type Selection, type State, type View } from "./state";
import { YearAxis, yearBars } from "./timeline";
import { countryName, type AtlasView, type HerkunftView, type KettenView, type PlacePoint, type SelectionView, type Share, type ZieleView } from "./views";

interface Row {
  label: string;
  sub?: string;
  n: number;
  value?: string;
  key?: string;
  color?: string;
}

const SEARCH_DELAY = 450;
const BACK_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SEARCH_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m10.5 10.5 3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const CLEAR_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

function rows(items: Row[], color: string, max?: number): string {
  const top = max ?? Math.max(Number.EPSILON, ...items.map((r) => r.n));
  return `<ol class="rows">${items.map((r) => {
    const tag = r.key === undefined ? "div" : "button";
    const attributes = r.key === undefined ? "" : ` type="button" data-key="${escapeHtml(r.key)}"`;
    return `<li><${tag} class="row"${attributes}>
      <span class="row-label">${escapeHtml(r.label)}${r.sub ? `<span class="row-sub">${escapeHtml(r.sub)}</span>` : ""}</span>
      <span class="row-value">${r.value ?? fmt(r.n)}</span>
      <span class="row-bar"><i style="width:${Math.max(1.5, (r.n / top) * 100).toFixed(1)}%;background:${r.color ?? color}"></i></span>
    </${tag}></li>`;
  }).join("")}</ol>`;
}

function shareRows(items: Share[], total: number, color: string): string {
  return rows(items.map((s) => ({ label: s.label, n: s.n, value: pct(s.n / Math.max(1, total)) })), color);
}

function stats(items: [string, string][]): string {
  return `<dl class="stats">${items.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

function block(title: string, content: string): string {
  return `<section class="block"><h3>${title}</h3>${content}</section>`;
}

function windowText(window: [number, number]): string {
  return window[0] === window[1] ? String(window[0]) : `${window[0]}–${window[1]}`;
}

function niceFloor(value: number): number {
  const power = 10 ** Math.floor(Math.log10(value));
  return [5, 2, 1].map((m) => m * power).find((v) => v <= value) ?? power;
}

export class Panel {
  private root: HTMLElement;
  private body: HTMLElement;
  private handle: HTMLElement;
  private legend: HTMLElement;
  private input: HTMLInputElement;
  private clear: HTMLButtonElement;
  private similar: HTMLInputElement;
  private similarRow: HTMLElement;
  private progress: HTMLElement;
  private loadShare = 0;

  constructor(private data: AtlasData, private baseYears: Map<number, number>) {
    this.root = document.getElementById("panel")!;
    this.body = document.getElementById("panel-body")!;
    this.handle = document.getElementById("panel-handle")!;
    this.legend = document.getElementById("legend")!;
    const search = document.getElementById("search")!;
    search.innerHTML = `
      <label class="search-field">${SEARCH_ICON}
        <span class="sr-only">Nachname</span>
        <input id="search-input" type="search" autocomplete="off" spellcheck="false" placeholder="Nachname suchen" disabled />
        <button type="button" class="search-clear" id="search-clear" aria-label="Suche löschen" hidden>${CLEAR_ICON}</button>
      </label>
      <div class="search-progress" id="search-progress"><i></i></div>
      <label class="search-similar" id="search-similar-row" hidden><input type="checkbox" id="search-similar" /> ähnliche Schreibweisen einbeziehen</label>`;
    this.input = search.querySelector("#search-input")!;
    this.clear = search.querySelector("#search-clear")!;
    this.similar = search.querySelector("#search-similar")!;
    this.similarRow = search.querySelector("#search-similar-row")!;
    this.progress = search.querySelector("#search-progress")!;
    this.bindSearch();
    this.handle.addEventListener("click", () => this.toggleSheet());
    this.sync(store.state);
  }

  private bindSearch(): void {
    let timer: number | undefined;
    const apply = () => {
      window.clearTimeout(timer);
      const name = this.input.value.trim();
      if (name !== store.state.name) store.set({ name, selection: null, corridor: null });
    };
    this.input.addEventListener("input", () => {
      this.clear.hidden = !this.input.value;
      window.clearTimeout(timer);
      timer = window.setTimeout(apply, SEARCH_DELAY);
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") apply();
      if (e.key === "Escape") this.setName("");
    });
    this.clear.addEventListener("click", () => {
      this.setName("");
      this.input.focus();
    });
    this.similar.addEventListener("change", () => store.set({ similar: this.similar.checked, selection: null, corridor: null }));
  }

  setName(name: string): void {
    this.input.value = name;
    store.set({ name, selection: null, corridor: null });
  }

  focusSearch(): void {
    if (!this.input.disabled) this.input.focus();
  }

  sync(state: State): void {
    if (document.activeElement !== this.input) this.input.value = state.name;
    this.clear.hidden = !this.input.value;
    this.similar.checked = state.similar;
    this.similarRow.hidden = !state.name;
  }

  loading(share: number): void {
    this.loadShare = share;
    this.progress.querySelector("i")!.style.width = `${Math.round(share * 100)}%`;
    this.input.placeholder = `Namenssuche wird geladen … ${Math.round(share * 100)} %`;
  }

  ready(): void {
    this.progress.classList.add("done");
    this.input.disabled = false;
    this.input.placeholder = "Nachname suchen";
  }

  failed(): void {
    this.progress.classList.add("done");
    this.input.placeholder = "Namenssuche nicht verfügbar";
  }

  render(view: AtlasView, state: State): void {
    const t = tokens();
    if (view.kind === "loading") this.loadingView(state);
    if (view.kind === "herkunft") this.herkunft(view, state, t);
    if (view.kind === "ziele") this.ziele(view, state, t);
    if (view.kind === "ketten") this.ketten(view, state, t);
    this.renderLegend(view, t);
  }

  private subject(state: State): string {
    if (!state.name) return "Einträge";
    return `Einträge namens ${escapeHtml(state.name)}${state.similar ? " und ähnlich" : ""}`;
  }

  private headline(number: string, text: string, state: State): string {
    const period = isFullWindow(state.window) ? "" : `, ${windowText(state.window)}`;
    this.handle.innerHTML = `<span><strong>${number}</strong> ${text}${period}</span>`;
    return `<div class="headline"><div class="headline-number">${number}</div><p class="headline-text">${text}${period}</p></div>`;
  }

  private empty(state: State): string {
    this.handle.innerHTML = `<span>Keine Einträge</span>`;
    const period = isFullWindow(state.window) ? "" : ` in den Jahren ${windowText(state.window)}`;
    return `<div class="empty">
      <p>Keine Einträge für „${escapeHtml(state.name)}“${period}.</p>
      ${!state.similar ? `<button type="button" class="button secondary" data-similar>Ähnliche Schreibweisen einbeziehen</button>` : ""}
      ${!isFullWindow(state.window) ? `<button type="button" class="button secondary" data-all-years>Alle Jahre</button>` : ""}
    </div>`;
  }

  private show(html: string): void {
    this.body.innerHTML = html;
    this.body.scrollTop = 0;
    this.body.querySelector("[data-similar]")?.addEventListener("click", () => store.set({ similar: true }));
    this.body.querySelector("[data-all-years]")?.addEventListener("click", () => store.set({ window: FULL_WINDOW }));
  }

  private onRows(selector: string, handler: (key: string) => void): void {
    this.body.querySelectorAll<HTMLElement>(`${selector} [data-key]`).forEach((row) => row.addEventListener("click", () => handler(row.dataset.key!)));
  }

  private loadingView(state: State): void {
    this.handle.innerHTML = `<span>Suche nach ${escapeHtml(state.name)} …</span>`;
    this.show(`<div class="headline"><p class="headline-text">Die Namenssuche wird vorbereitet, ${Math.round(this.loadShare * 100)} % geladen. Danach erscheinen hier alle Einträge namens ${escapeHtml(state.name)}.</p></div>`);
  }

  private placeRows(list: PlacePoint[], color: string): string {
    return rows(list.map((p, i) => ({ label: p.name, sub: countryName(p.land), n: p.n, key: String(i) })), color);
  }

  private herkunft(view: HerkunftView, state: State, t: Tokens): void {
    if (view.selected) return this.profile(view.selected, state, t);
    if (!view.total) return this.show(this.empty(state));
    const color = viewColor(t, "herkunft");
    const top = view.points.slice(0, 10);
    this.show(`
      ${this.headline(fmt(view.total), `${this.subject(state)} mit Herkunftsort, aus ${fmt(view.points.length)} Orten`, state)}
      ${block("Heutige Staaten", shareRows(view.countries, view.total, color))}
      <section class="block" id="top-places"><h3>Häufigste Herkunftsorte</h3>${this.placeRows(top, color)}</section>`);
    this.onRows("#top-places", (i) => this.select("herkunft", top[Number(i)]));
  }

  private ziele(view: ZieleView, state: State, t: Tokens): void {
    if (view.selected) return this.profile(view.selected, state, t);
    if (!view.total) return this.show(this.empty(state));
    const color = viewColor(t, "ziele");
    const top = view.points.slice(0, 10);
    const portTotal = view.ports.reduce((s, p) => s + p.n, 0);
    this.show(`
      ${this.headline(fmt(view.total), `${this.subject(state)} mit Reiseziel, in ${fmt(view.points.length)} Orten`, state)}
      ${block("Weltregionen", shareRows(view.regions, view.total, color))}
      ${block("Ankunftshäfen", rows(view.ports.slice(0, 5).map((p) => ({ label: p.name, n: p.n, value: pct(p.n / Math.max(1, portTotal)) })), t.series[0]))}
      <section class="block" id="top-places"><h3>Häufigste Reiseziele</h3>${this.placeRows(top, color)}</section>`);
    this.onRows("#top-places", (i) => this.select("ziel", top[Number(i)]));
  }

  private select(kind: "herkunft" | "ziel", p: PlacePoint): void {
    store.set({ selection: { kind, name: p.name, land: p.land, lat: p.lat, lon: p.lon } });
  }

  private werkbankLink(params: Record<string, string | number>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) search.set(key, String(value));
    const state = store.state;
    if (state.name) search.set("nachname", state.name);
    if (state.name && state.similar) search.set("aehnlich", "1");
    search.set("reiseart", "Überfahrt");
    if (!isFullWindow(state.window)) {
      search.set("von", String(state.window[0]));
      search.set("bis", String(state.window[1]));
    }
    return `index.html?${search.toString()}#werkbank`;
  }

  private profile(selected: SelectionView, state: State, t: Tokens): void {
    const { selection, profile } = selected;
    const outward = selection.kind === "herkunft";
    const ownColor = viewColor(t, outward ? "herkunft" : "ziele");
    const otherColor = viewColor(t, outward ? "ziele" : "herkunft");
    this.handle.innerHTML = `<span><strong>${escapeHtml(selection.name)}</strong> ${profile ? `${fmt(profile.inWindow)} Einträge` : ""}</span>`;
    const head = `
      <button type="button" class="back" id="back">${BACK_ICON}Übersicht</button>
      <h2 class="title">${escapeHtml(selection.name)}</h2>
      <p class="subtitle"><i class="dot" style="background:${ownColor}"></i>${outward ? "Herkunftsort" : "Reiseziel"}${selection.land ? `, ${escapeHtml(countryName(selection.land))}` : ""}${isFullWindow(state.window) ? "" : `, ${windowText(state.window)}`}</p>`;
    if (!profile) {
      const waiting = this.data.ready ? "Profil wird berechnet …" : `Das Profil erscheint, sobald die Datenbank geladen ist (${Math.round(this.loadShare * 100)} %).`;
      this.show(`${head}<p class="note">${waiting}</p>`);
      this.bindBack(() => store.set({ selection: null }));
      return;
    }
    const counterparts = profile.counterparts.slice(0, 6);
    const link = this.werkbankLink({ [outward ? "herkunft" : "ziel"]: `"${selection.name}"` });
    this.show(`${head}
      ${stats([
        ["Einträge", fmt(profile.inWindow)],
        ["Frauen", profile.women == null ? "–" : pct(profile.women)],
        ["Medianalter", profile.medianAge == null ? "–" : fmt(profile.medianAge)],
      ])}
      ${block("Einträge je Jahr", `<svg class="mini-years" id="profile-years"></svg>`)}
      <section class="block" id="counterparts"><h3>${outward ? "Wohin sie wollten" : "Woher sie kamen"}</h3>${rows(counterparts.map((c, i) => ({ label: c.name, sub: countryName(c.land), n: c.n, key: String(i) })), otherColor)}</section>
      <section class="block" id="surnames"><h3>Häufigste Nachnamen</h3>${rows(profile.surnames.map((s) => ({ label: s.name, n: s.n, key: s.name })), t.ink3)}</section>
      ${block("Häufigste Berufe", rows(profile.occupations.map((o) => ({ label: o.name, n: o.n })), t.ink3))}
      <a class="button wide" href="${link}">Einträge in der Werkbank ansehen</a>`);
    this.bindBack(() => store.set({ selection: null }));
    this.miniYears("#profile-years", profile.years, state.window);
    this.onRows("#counterparts", (i) => {
      const c = counterparts[Number(i)];
      const view: View = outward ? "ziele" : "herkunft";
      const next: Selection = { kind: outward ? "ziel" : "herkunft", name: c.name, land: c.land, lat: c.lat, lon: c.lon };
      store.set({ view, selection: next });
    });
    this.onRows("#surnames", (name) => this.setName(name));
  }

  private bindBack(handler: () => void): void {
    this.body.querySelector("#back")?.addEventListener("click", handler);
  }

  private miniYears(selector: string, counts: Map<number, number>, window: [number, number]): void {
    const svg = this.body.querySelector<SVGSVGElement>(selector);
    if (!svg) return;
    const width = svg.clientWidth || 320;
    const height = 64;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = yearBars(new YearAxis(this.baseYears, width), counts, window, height);
  }

  private ketten(view: KettenView, state: State, t: Tokens): void {
    if (view.selected) return this.corridor(view.selected, view.members, state, t);
    if (!view.corridors.length && !view.categories.length) return this.show(this.empty(state));
    const top = view.corridors.slice(0, 12);
    const groups = view.corridors.reduce((s, c) => s + c.inWindow, 0);
    const text = state.name
      ? `Korridore mit Einträgen namens ${escapeHtml(state.name)}${state.similar ? " und ähnlich" : ""}`
      : `Korridore der Kettenmigration mit ${fmt(groups)} Reisegruppen`;
    const categoryRows = view.categories.map((c) => ({
      label: c.name,
      n: c.corridors,
      key: c.name,
      color: css(categoryColor(t, c.name, state.category && state.category !== c.name ? 70 : 255)),
    }));
    this.show(`
      ${this.headline(fmt(view.corridors.length), text, state)}
      <p class="note">Ein Korridor verbindet einen Herkunftsort mit einem Ziel in Übersee, zu dem über mehrere Jahre immer wieder Reisegruppen fuhren, weit häufiger als zufällig zu erwarten.</p>
      <section class="block" id="categories"><h3>Kategorien${state.category ? `<button type="button" class="link-button" id="category-reset">alle zeigen</button>` : ""}</h3>${rows(categoryRows, t.ink3)}</section>
      <section class="block" id="top-corridors"><h3>Stärkste Korridore</h3>${rows(top.map((c) => ({
        label: `${c.herkunft} → ${c.ziel}`,
        sub: c.hits ? `${fmt(c.hits)} Einträge namens ${state.name}` : `${c.beruf ?? c.kategorie}, ${c.von}–${c.bis}`,
        n: c.inWindow,
        key: String(c.id),
        color: css(categoryColor(t, c.kategorie)),
      })), t.ink3)}</section>`);
    this.body.querySelectorAll<HTMLElement>("#categories .row").forEach((row) => row.classList.toggle("muted-row", Boolean(state.category) && row.dataset.key !== state.category));
    this.onRows("#categories", (name) => store.set({ category: state.category === name ? "" : name, corridor: null }));
    this.body.querySelector("#category-reset")?.addEventListener("click", () => store.set({ category: "" }));
    this.onRows("#top-corridors", (id) => store.set({ corridor: Number(id) }));
  }

  private corridor(c: Corridor & { inWindow: number; hits: number | null }, members: Member[] | null, state: State, t: Tokens): void {
    const color = css(categoryColor(t, c.kategorie));
    const link = this.werkbankLink({ herkunft: `"${c.herkunft}"`, ziel: `"${c.ziel}"` });
    this.handle.innerHTML = `<span><strong>${escapeHtml(c.herkunft)} → ${escapeHtml(c.ziel)}</strong></span>`;
    const people = members
      ? `<ol class="people">${members.map((m) => `<li><span class="person">${escapeHtml([m.vorname, m.nachname].filter(Boolean).join(" "))}<span class="row-sub">${escapeHtml([m.beruf, m.alter != null ? `${m.alter} Jahre` : null].filter(Boolean).join(", "))}</span></span><span class="row-value">${m.jahr}</span></li>`).join("")}</ol>`
      : `<p class="note">${this.data.ready ? "Einträge werden geladen …" : `Die Einträge erscheinen, sobald die Datenbank geladen ist (${Math.round(this.loadShare * 100)} %).`}</p>`;
    this.show(`
      <button type="button" class="back" id="back">${BACK_ICON}Alle Korridore</button>
      <h2 class="title">${escapeHtml(c.herkunft)} → ${escapeHtml(c.ziel)}</h2>
      <p class="subtitle"><i class="dot" style="background:${color}"></i>${escapeHtml(c.kategorie)}${c.beruf ? `, häufigster Beruf ${escapeHtml(c.beruf)}` : ""}</p>
      ${stats([
        ["Reisegruppen", fmt(c.gruppen)],
        ["Personen", fmt(c.personen)],
        ["Frauen", pct(c.frauenanteil)],
      ])}
      ${block("Reisegruppen je Jahr", `<svg class="mini-years" id="corridor-years"></svg>`)}
      ${block(state.name ? `Reisende namens ${escapeHtml(state.name)}` : "Reisende", people)}
      <a class="button wide" href="${link}">Einträge in der Werkbank ansehen</a>`);
    this.bindBack(() => store.set({ corridor: null }));
    this.miniYears("#corridor-years", new Map(c.jahre), state.window);
  }

  private renderLegend(view: AtlasView, t: Tokens): void {
    const dot = (color: string, label: string) => `<div class="legend-row"><i class="dot" style="background:${color}"></i>${label}</div>`;
    const line = (color: string, label: string) => `<div class="legend-row"><i class="line" style="background:${color}"></i>${label}</div>`;
    if ((view.kind === "herkunft" || view.kind === "ziele") && view.selected) {
      const outward = view.selected.selection.kind === "herkunft";
      this.legend.innerHTML = `${dot(viewColor(t, "herkunft"), outward ? escapeHtml(view.selected.selection.name) : "Herkunftsorte")}${dot(viewColor(t, "ziele"), outward ? "Reiseziele" : escapeHtml(view.selected.selection.name))}`;
    } else if (view.kind === "herkunft" && view.points.length) {
      this.legend.innerHTML = this.sizeLegend(view.points[0].n, viewColor(t, "herkunft"), "Einträge je Herkunftsort");
    } else if (view.kind === "ziele" && view.points.length) {
      this.legend.innerHTML = `${this.sizeLegend(view.points[0].n, viewColor(t, "ziele"), "Einträge je Reiseziel")}${line(t.series[0], "Seeweg zum Ankunftshafen")}`;
    } else {
      this.legend.innerHTML = "";
    }
  }

  private sizeLegend(max: number, color: string, title: string): string {
    const first = niceFloor(max);
    const values = [first / 100, first / 10, first].filter((v) => v >= 1);
    const radius = values.map((v) => placeRadius(v, max));
    const height = radius[radius.length - 1] * 2 + 18;
    const column = 50;
    const circles = values.map((v, i) => {
      const cx = column * i + column / 2;
      const r = radius[i];
      return `<circle cx="${cx}" cy="${height - 16 - r}" r="${r}" fill="${css(rgb(color, 115))}" stroke="${color}" stroke-width="0.8"/>
        <text x="${cx}" y="${height - 2}" text-anchor="middle">${fmt(v)}</text>`;
    }).join("");
    return `<div class="legend-title">${title}</div><svg class="size-legend" width="${column * values.length}" height="${height}">${circles}</svg>`;
  }

  private toggleSheet(): void {
    const open = this.root.classList.toggle("open");
    this.handle.setAttribute("aria-expanded", String(open));
  }
}
