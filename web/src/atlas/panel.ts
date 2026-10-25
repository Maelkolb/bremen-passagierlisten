import * as echarts from "echarts";
import { escapeHtml, fmt, pct } from "../format";
import { axisStyle, baseOption, tokens } from "../theme";
import type { CorridorView, HerkunftView, KettenView, LensView, SelectionView, WandelView, WegeView, ZieleView } from "./lenses";
import { categoryColor, diverging, rgb } from "./mapview";
import type { AtlasData } from "./source";
import { activeFilterCount, AGE_GROUPS, DEFAULT_FILTERS, PERIODS, store, type Filters, type OriginMode } from "./state";

const css = (c: [number, number, number, number]) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(2)})`;
const fmt1 = (v: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(v);
const MODES: { id: OriginMode; label: string }[] = [
  { id: "orte", label: "Orte" },
  { id: "dichte", label: "Dichte" },
  { id: "anteil", label: "Überrepräsentation" },
];

export class Panel {
  private filterRoot: HTMLElement;
  private lensRoot: HTMLElement;
  private statusRoot: HTMLElement;
  private charts: echarts.ECharts[] = [];

  constructor(private data: AtlasData) {
    this.filterRoot = document.getElementById("panel-filters")!;
    this.lensRoot = document.getElementById("panel-lens")!;
    this.statusRoot = document.getElementById("panel-status")!;
    this.renderFilters();
    const panel = document.getElementById("panel")!;
    const toggle = document.getElementById("panel-toggle")!;
    toggle.addEventListener("click", () => {
      const open = panel.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  status(stage: string, loaded: number, total: number): void {
    const share = total > 1 ? Math.round((loaded / total) * 100) : 0;
    this.statusRoot.innerHTML = `
      <div class="db-status">${escapeHtml(stage)}${total > 1 ? ` ${fmt(loaded / 1e6)} von ${fmt(total / 1e6)} MB` : " …"}
        <div class="progress"><div style="width:${share}%"></div></div>
      </div>
      <p class="panel-note">Bis die Datenbank bereitsteht, zeigt die Karte die Herkunftsorte aller Überfahrten ohne Filter.</p>`;
  }

  ready(): void {
    this.statusRoot.hidden = true;
    this.filterRoot.classList.remove("disabled-block");
    this.data.nationalities().then((list) => {
      const select = this.filterRoot.querySelector<HTMLSelectElement>("[name=staat]")!;
      select.insertAdjacentHTML("beforeend", list.map((n) => `<option value="${escapeHtml(n.name)}">${escapeHtml(n.name)} (${fmt(n.n)})</option>`).join(""));
      select.value = store.state.filters.staat;
    });
  }

  failed(message: string): void {
    this.statusRoot.innerHTML = `<p class="db-status">Die Datenbank konnte nicht geladen werden (${escapeHtml(message)}). Der Atlas braucht einen lokalen Webserver; die Grundansicht bleibt nutzbar.</p>`;
  }

  syncFilters(filters: Filters): void {
    for (const [key, value] of Object.entries(filters)) {
      const field = this.filterRoot.querySelector<HTMLInputElement | HTMLSelectElement>(`[name=${key}]`);
      if (!field) continue;
      if (field instanceof HTMLInputElement && field.type === "checkbox") field.checked = Boolean(value);
      else field.value = String(value);
    }
    const count = activeFilterCount(filters);
    this.filterRoot.querySelector("#filter-count")!.textContent = count ? `${count} aktiv` : "alle Überfahrten";
    if (count) (this.filterRoot.querySelector("#filter-details") as HTMLDetailsElement).open = true;
  }

  private renderFilters(): void {
    const sectors = this.data.sektoren;
    this.filterRoot.classList.add("disabled-block");
    this.filterRoot.innerHTML = `
      <details id="filter-details">
      <summary class="filter-summary"><h2>Auswahl</h2><span class="text-sm muted" id="filter-count"></span></summary>
      <form class="panel-grid" id="filter-form" autocomplete="off">
        <label class="field wide"><span>Reisende</span>
          <select class="select" name="reiseart">
            <option value="Überfahrt">Auswanderer und übrige Überfahrten</option>
            <option value="US-Staatsangehörige">US-Staatsangehörige</option>
            <option value="alle">alle Einträge</option>
          </select></label>
        <label class="field"><span>Berufsbereich</span>
          <select class="select" name="sektor"><option value="">alle</option>${Object.entries(sectors).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join("")}<option value="-1">ohne Angabe</option></select></label>
        <label class="field"><span>Geschlecht</span>
          <select class="select" name="geschlecht"><option value="">alle</option><option value="m">Männer</option><option value="w">Frauen</option></select></label>
        <label class="field"><span>Alter</span>
          <select class="select" name="alter"><option value="">alle</option>${Object.keys(AGE_GROUPS).map((k) => `<option value="${k}">${k.replace("-", "–")} Jahre</option>`).join("")}</select></label>
        <label class="field"><span>Staatsangehörigkeit</span>
          <select class="select" name="staat"><option value="">alle</option></select></label>
        <label class="field wide"><span>Nachname</span><input class="input" name="nachname" placeholder="z. B. Schmidt oder Hoff*" /></label>
        <label class="check wide" style="grid-column:1/-1"><input type="checkbox" name="aehnlich" /> ähnliche Schreibweisen (Kölner Phonetik)</label>
        <label class="field wide"><span>Beruf</span><input class="input" name="beruf" placeholder="z. B. Bäcker" /></label>
        <div class="wide" style="grid-column:1/-1"><button type="button" class="back-link" id="filter-reset">Auswahl zurücksetzen</button></div>
      </form>
      </details>`;
    const form = this.filterRoot.querySelector<HTMLFormElement>("#filter-form")!;
    let timer: number | undefined;
    const apply = () => {
      const data = new FormData(form);
      const next: Filters = {
        reiseart: String(data.get("reiseart") ?? "Überfahrt"),
        sektor: String(data.get("sektor") ?? ""),
        geschlecht: String(data.get("geschlecht") ?? ""),
        alter: String(data.get("alter") ?? ""),
        staat: String(data.get("staat") ?? ""),
        nachname: String(data.get("nachname") ?? "").trim(),
        aehnlich: data.get("aehnlich") === "on",
        beruf: String(data.get("beruf") ?? "").trim(),
      };
      store.setFilters(next);
    };
    form.addEventListener("change", apply);
    form.addEventListener("input", (e) => {
      if ((e.target as HTMLElement).tagName !== "INPUT" || (e.target as HTMLInputElement).type === "checkbox") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(apply, 500);
    });
    form.addEventListener("submit", (e) => e.preventDefault());
    this.filterRoot.querySelector("#filter-reset")!.addEventListener("click", () => {
      store.setFilters(DEFAULT_FILTERS);
      this.syncFilters(DEFAULT_FILTERS);
    });
    this.syncFilters(store.state.filters);
  }

  render(view: LensView): void {
    this.filterRoot.classList.toggle("filters-inactive", view.kind === "ketten");
    this.charts.forEach((c) => c.dispose());
    this.charts = [];
    if (view.kind === "herkunft") this.herkunft(view);
    if (view.kind === "ziele") this.ziele(view);
    if (view.kind === "wege") this.wege(view);
    if (view.kind === "ketten") this.ketten(view);
    if (view.kind === "wandel") this.wandel(view);
    this.legend(view);
  }

  private figures(items: [string, string][]): string {
    return `<dl class="figures">${items.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
  }

  private rank(rows: { label: string; sub?: string; n: number; data?: string; value?: string; color?: string }[], max?: number): string {
    const top = max ?? Math.max(Number.EPSILON, ...rows.map((r) => r.n));
    return `<table class="rank"><tbody>${rows.map((r) => `
      <tr${r.data ? ` class="clickable" data-pick="${escapeHtml(r.data)}" tabindex="0"` : ""}>
        <td>${escapeHtml(r.label)}${r.sub ? `<span class="sub">${escapeHtml(r.sub)}</span>` : ""}</td>
        <td class="bar"><i style="width:${Math.max(2, (r.n / top) * 100)}%${r.color ? `;background:${r.color}` : ""}"></i></td>
        <td class="num">${r.value ?? fmt(r.n)}</td>
      </tr>`).join("")}</tbody></table>`;
  }

  private onPick(handler: (value: string) => void): void {
    this.lensRoot.querySelectorAll<HTMLElement>("[data-pick]").forEach((row) => {
      const go = () => handler(row.dataset.pick!);
      row.addEventListener("click", go);
      row.addEventListener("keydown", (e) => (e.key === "Enter" ? go() : null));
    });
  }

  private yearChart(target: HTMLElement, years: { jahr: number; n: number }[], window: [number, number]): void {
    const t = tokens();
    const ax = axisStyle(t);
    const all = Array.from({ length: 1939 - 1830 + 1 }, (_, i) => 1830 + i);
    const byYear = new Map(years.map((y) => [y.jahr, y.n]));
    const chart = echarts.init(target);
    chart.setOption({
      ...baseOption(t),
      animation: false,
      grid: { left: 34, right: 4, top: 6, bottom: 20 },
      tooltip: { trigger: "axis", valueFormatter: (v: any) => fmt(v) },
      xAxis: { type: "category", data: all.map(String), ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, fontSize: 10, interval: 19 } },
      yAxis: { type: "value", ...ax, splitNumber: 2, axisLine: { show: false }, axisLabel: { ...ax.axisLabel, fontSize: 10, formatter: (v: number) => fmt(v) } },
      series: [{ type: "bar", data: all.map((y) => ({ value: byYear.get(y) ?? 0, itemStyle: { color: y >= window[0] && y <= window[1] ? t.ink : t.ruleStrong } })), barCategoryGap: "8%" }],
    });
    this.charts.push(chart);
  }

  private werkbankLink(params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
    const f = store.state.filters;
    if (f.nachname) search.set("nachname", f.nachname);
    if (f.aehnlich) search.set("aehnlich", "1");
    if (f.beruf) search.set("beruf", f.beruf);
    if (f.reiseart !== "alle") search.set("reiseart", f.reiseart);
    if (f.sektor) search.set("sektor", f.sektor);
    return `index.html?${search.toString()}#werkbank`;
  }

  private profile(selected: SelectionView, title: string): string {
    const { selection, profile } = selected;
    const [from, to] = store.state.window;
    const head = `<button type="button" class="back-link" id="profile-close">Zurück zur Übersicht</button><h2 style="margin-top:10px">${escapeHtml(selection.name)}</h2>`;
    if (!profile) return `${head}<p class="panel-note">Profil wird berechnet …</p>`;
    const fromHere = selection.kind === "herkunft";
    const link = this.werkbankLink({ [fromHere ? "herkunft" : "ziel"]: `"${selection.name}"`, von: from, bis: to });
    return `${head}
      ${this.figures([
        [`Einträge ${from === to ? from : `${from}–${to}`}`, fmt(profile.inWindow)],
        ["Einträge insgesamt", fmt(profile.total)],
        ["Frauenanteil", profile.women == null ? "–" : pct(profile.women)],
        ["Medianalter", profile.medianAge == null ? "–" : `${fmt(profile.medianAge)} Jahre`],
      ])}
      <h3>Einträge je Jahr</h3><div class="mini-chart" id="profile-years"></div>
      <h3>${fromHere ? "Wohin sie wollten" : "Woher sie kamen"}</h3>
      ${this.rank(profile.counterparts.slice(0, 8).map((c) => ({ label: c.name, sub: c.land ?? undefined, n: c.n })))}
      <h3>Häufigste Berufe</h3>${this.rank(profile.occupations.map((o) => ({ label: o.name, n: o.n })))}
      <h3>Häufigste Nachnamen</h3>${this.rank(profile.surnames.map((o) => ({ label: o.name, n: o.n })))}
      <h3>Ankunftshäfen</h3>${this.rank(profile.ports.map((o) => ({ label: o.name, n: o.n })))}
      <p class="panel-note">${profile.families == null ? "" : `${pct(profile.families)} reisten in Gruppen ab drei Personen gleichen Namens. `}<a href="${link}">Alle Einträge in der Werkbank</a></p>
      <p class="panel-note">${title}</p>`;
  }

  private bindProfile(selected: SelectionView): void {
    this.lensRoot.querySelector("#profile-close")?.addEventListener("click", () => store.set({ selection: null }));
    const target = this.lensRoot.querySelector<HTMLElement>("#profile-years");
    if (target && selected.profile) this.yearChart(target, selected.profile.years, store.state.window);
  }

  private herkunft(view: HerkunftView): void {
    if (view.selected) {
      this.lensRoot.innerHTML = this.profile(view.selected, "Bögen zeigen die häufigsten Reiseziele aus diesem Ort im gewählten Zeitraum.");
      this.bindProfile(view.selected);
      return;
    }
    const top = view.points.slice(0, 12);
    const distanceMax = Math.max(1, ...view.distanceBins.map((b) => b.n));
    const modeNote = view.mode === "anteil"
      ? (view.lqActive
        ? "Farbe: Anteil der Auswahl an allen Reisenden eines Ortes, geteilt durch ihren Anteil insgesamt (Lagequotient). Nur Orte mit mindestens 20 Einträgen im Zeitraum."
        : "Für die Überrepräsentation zuerst oben eine Auswahl treffen, etwa Frauen, einen Berufsbereich oder einen Nachnamen.")
      : view.mode === "dichte"
        ? "Sechsecke von etwa 28 km Radius, Farbe nach Zahl der Einträge (Quantile)."
        : "Kreisfläche nach Zahl der Einträge. Ein Klick auf einen Ort öffnet sein Profil.";
    this.lensRoot.innerHTML = `
      <h2>Herkunft</h2>
      <div class="segmented" role="group" aria-label="Darstellung">${MODES.map((m) => `<button type="button" data-mode="${m.id}" aria-pressed="${view.mode === m.id}">${m.label}</button>`).join("")}</div>
      <p class="panel-note">${modeNote}</p>
      ${this.figures([
        ["Einträge mit Herkunftsort", fmt(view.total)],
        ["Orte", fmt(view.points.length)],
        ["Medianentfernung von Bremen", view.medianKm == null ? "–" : `${fmt(view.medianKm)} km`],
        ["aus Europa", view.europeShare == null ? "–" : pct(view.europeShare)],
      ])}
      <h3>Entfernung von Bremen</h3>
      ${this.rank(view.distanceBins.map((b) => ({ label: b.label, n: b.n })), distanceMax)}
      <h3>Häufigste Herkunftsorte</h3>
      ${this.rank(top.map((p, i) => ({ label: p.name, n: p.n, data: String(i) })))}
      <p class="panel-note">Nur Einträge, deren Wohnort sich auf einen Ort genau bestimmen ließ (GeoNames).</p>`;
    this.lensRoot.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => store.set({ mode: b.dataset.mode as OriginMode })));
    this.onPick((i) => {
      const p = top[Number(i)];
      store.set({ selection: { kind: "herkunft", name: p.name, lat: p.lat, lon: p.lon } });
    });
  }

  private ziele(view: ZieleView): void {
    if (view.selected) {
      this.lensRoot.innerHTML = this.profile(view.selected, "Bögen zeigen die häufigsten Herkunftsorte der Reisenden zu diesem Ziel.");
      this.bindProfile(view.selected);
      return;
    }
    const destinations = view.destinations.slice(0, 12);
    this.lensRoot.innerHTML = `
      <h2>Ziele</h2>
      ${this.figures([
        ["Einträge mit Reiseziel", fmt(view.total)],
        ["Reiseziele", fmt(view.destinations.length)],
      ])}
      <h3>Weltregionen der Reiseziele</h3>
      ${this.rank(view.regions.map((r) => ({ label: r.name, n: r.n })))}
      <h3>Ankunftshäfen</h3>
      ${this.rank(view.ports.slice(0, 8).map((p) => ({ label: p.name, n: p.n })))}
      <h3>Häufigste Reiseziele</h3>
      ${this.rank(destinations.map((p, i) => ({ label: p.name, sub: p.extra ?? undefined, n: p.n, data: String(i) })))}
      <p class="panel-note">Reiseziel ist der in der Liste genannte Bestimmungsort, geokodiert gegen GeoNames; New York City fasst die fünf Stadtbezirke zusammen.</p>`;
    this.onPick((i) => {
      const p = destinations[Number(i)];
      store.set({ selection: { kind: "ziel", name: p.name, lat: p.lat, lon: p.lon } });
    });
  }

  private wege(view: WegeView): void {
    const total = view.flows.reduce((s, f) => s + f.n, 0);
    this.lensRoot.innerHTML = `
      <h2>Wege</h2>
      <div class="panel-grid">
        <label class="field"><span>Verbindungen</span>
          <select class="select" id="flow-limit">${[100, 300, 1000].map((n) => `<option value="${n}"${store.state.flowLimit === n ? " selected" : ""}>${fmt(n)} stärkste</option>`).join("")}</select></label>
        <label class="check" style="align-self:end"><input type="checkbox" id="flow-overseas"${store.state.overseasOnly ? " checked" : ""} /> nur Europa → Übersee</label>
      </div>
      ${view.loading ? `<p class="panel-note">Verbindungen werden berechnet …</p>` : this.figures([["Einträge in diesen Verbindungen", fmt(total)], ["Verbindungen", fmt(view.flows.length)]])}
      <h3>Stärkste Verbindungen</h3>
      ${this.rank(view.flows.slice(0, 15).map((f) => ({ label: `${f.herkunft} → ${f.ziel}`, n: f.n })))}
      <p class="panel-note">Herkunftsort und Reiseziel derselben Person, beide sicher geokodiert. „Europa → Übersee“ blendet Rück- und Geschäftsreisen mit Herkunft außerhalb Europas oder Ziel in Europa aus.</p>`;
    this.lensRoot.querySelector<HTMLSelectElement>("#flow-limit")!.addEventListener("change", (e) => store.set({ flowLimit: Number((e.target as HTMLSelectElement).value) }));
    this.lensRoot.querySelector<HTMLInputElement>("#flow-overseas")!.addEventListener("change", (e) => store.set({ overseasOnly: (e.target as HTMLInputElement).checked }));
  }

  private ketten(view: KettenView): void {
    const t = tokens();
    if (view.selected) {
      this.corridorDetail(view.selected, view.members);
      return;
    }
    const top = view.corridors.slice(0, 20);
    this.lensRoot.innerHTML = `
      <h2>Kettenmigration</h2>
      <div class="chips" role="group" aria-label="Kategorie">
        <button type="button" class="chip" data-cat="" aria-pressed="${store.state.category === ""}">alle</button>
        ${view.categories.filter((c) => c.corridors > 0).map((c) => `<button type="button" class="chip" data-cat="${escapeHtml(c.name)}" aria-pressed="${store.state.category === c.name}"><i style="background:${css(categoryColor(t, c.name, 255))}"></i>${escapeHtml(c.name)} <span class="count">${fmt(c.corridors)}</span></button>`).join("")}
      </div>
      ${this.figures([
        ["Korridore", fmt(view.corridors.length)],
        ["Personen darin", fmt(view.corridors.reduce((s, c) => s + c.personen, 0))],
      ])}
      <h3>Stärkste Korridore</h3>
      ${this.rank(top.map((c) => ({ label: `${c.herkunft} → ${c.ziel}`, sub: `${c.beruf ?? c.kategorie}, ${c.von}–${c.bis}`, n: c.personen, data: String(c.id) })))}
      <p class="panel-note">Ein Korridor ist ein Paar aus Herkunftsort in Europa und Ziel in Übersee mit mindestens fünf Reisegruppen in mindestens drei Jahrgängen, deutlich häufiger als bei Unabhängigkeit erwartet (log-odds, z ≥ 3). Grundlage sind alle Überfahrten; die Auswahl oben gilt hier nicht, das Zeitfenster schon.</p>`;
    this.lensRoot.querySelectorAll<HTMLButtonElement>("[data-cat]").forEach((b) => b.addEventListener("click", () => store.set({ category: b.dataset.cat ?? "", corridor: null })));
    this.onPick((id) => store.set({ corridor: Number(id) }));
  }

  private corridorDetail(c: CorridorView, members: any[] | null): void {
    const link = this.werkbankLink({ herkunft: `"${c.herkunft}"`, ziel: `"${c.ziel}"`, reiseart: "Überfahrt" });
    this.lensRoot.innerHTML = `
      <button type="button" class="back-link" id="corridor-close">Alle Korridore</button>
      <h2 style="margin-top:10px">${escapeHtml(c.herkunft)} → ${escapeHtml(c.ziel)}</h2>
      <p class="panel-note" style="margin-top:0">${escapeHtml(c.kategorie)}${c.beruf ? `, häufigster Beruf ${escapeHtml(c.beruf)}` : ""}</p>
      ${this.figures([
        ["Reisegruppen", fmt(c.gruppen)],
        ["Personen", fmt(c.personen)],
        ["Frauenanteil", pct(c.frauenanteil)],
        ["Gruppen ab drei", pct(c.familienanteil)],
        ["Jahre", `${c.von}–${c.bis}`],
        ["z-Wert", fmt1(c.z)],
      ])}
      <h3>Reisegruppen je Jahr</h3><div class="mini-chart" id="corridor-years"></div>
      <h3>Reisende (erste 60 Einträge)</h3>
      ${members ? `<table class="rank"><tbody>${members.map((m) => `<tr><td>${escapeHtml(m.vorname ?? "")} ${escapeHtml(m.nachname ?? "")}<span class="sub">${escapeHtml(m.beruf ?? "")}${m.schiff ? `, ${escapeHtml(m.schiff)}` : ""}</span></td><td class="num">${m.alter ?? ""}</td><td class="num">${m.jahr}</td></tr>`).join("")}</tbody></table>` : `<p class="panel-note">Einträge werden geladen …</p>`}
      <p class="panel-note"><a href="${link}">Alle Einträge in der Werkbank</a></p>`;
    this.lensRoot.querySelector("#corridor-close")!.addEventListener("click", () => store.set({ corridor: null }));
    this.yearChart(this.lensRoot.querySelector<HTMLElement>("#corridor-years")!, c.jahre.map(([jahr, n]) => ({ jahr, n })), store.state.window);
  }

  private wandel(view: WandelView): void {
    const [a, b] = view.periods;
    const option = (selected: string) => PERIODS.map((p) => `<option value="${p.id}"${p.id === selected ? " selected" : ""} title="${p.label}">${p.id}</option>`).join("");
    const shapeA = view.shapes.find((s) => s.period === a);
    const shapeB = view.shapes.find((s) => s.period === b);
    const t = tokens();
    const changeRows = (list: WandelView["gainers"]) => list.map((p) => ({ label: p.name, sub: `${pct(p.a, 2)} → ${pct(p.b, 2)}`, n: Math.abs(p.diff), value: `${p.diff > 0 ? "+" : "−"}${fmt1(Math.abs(p.diff) * 100)}`, color: p.diff > 0 ? t.series[7] : t.series[0] }));
    const changeMax = Math.max(Number.EPSILON, ...[...view.gainers, ...view.losers].map((p) => Math.abs(p.diff)));
    this.lensRoot.innerHTML = `
      <h2>Wandel</h2>
      <div class="panel-grid">
        <label class="field"><span>Zeitraum A</span><select class="select" id="compare-a">${option(a)}</select></label>
        <label class="field"><span>Zeitraum B</span><select class="select" id="compare-b">${option(b)}</select></label>
      </div>
      ${this.figures([
        ["Einträge A", fmt(view.totals[0])],
        ["Einträge B", fmt(view.totals[1])],
        ["Abstand der Schwerpunkte A und B", view.shiftKm == null ? "–" : `${fmt(view.shiftKm)} km`],
        ["Standarddistanz A / B", shapeA && shapeB ? `${fmt(shapeA.centroid.spreadKm)} / ${fmt(shapeB.centroid.spreadKm)} km` : "–"],
      ])}
      <h3>Stärker vertreten in B (Prozentpunkte)</h3>
      ${this.rank(changeRows(view.gainers), changeMax)}
      <h3>Stärker vertreten in A (Prozentpunkte)</h3>
      ${this.rank(changeRows(view.losers), changeMax)}
      <p class="panel-note">Rasterzellen von 0,5° × 0,75°: Anteil an allen Herkunftsorten des Zeitraums, B minus A. Ellipsen umfassen eine Standardabweichung um den Schwerpunkt (europäische Herkunftsorte); die Punkte zeigen den Schwerpunkt jedes Jahres mit mindestens 300 Einträgen. Die Auswahl oben gilt auch hier.</p>`;
    this.lensRoot.querySelector<HTMLSelectElement>("#compare-a")!.addEventListener("change", (e) => store.set({ compare: [(e.target as HTMLSelectElement).value, store.state.compare[1]] }));
    this.lensRoot.querySelector<HTMLSelectElement>("#compare-b")!.addEventListener("change", (e) => store.set({ compare: [store.state.compare[0], (e.target as HTMLSelectElement).value] }));
  }

  private legend(view: LensView): void {
    const t = tokens();
    const root = document.getElementById("legend")!;
    const swatch = (color: string, label: string, round = true) => `<div class="legend-row"><span class="legend-swatch" style="background:${color};border-radius:${round ? "50%" : "2px"}"></span>${label}</div>`;
    const ramp = (colors: string[]) => `<div class="legend-ramp" style="background:linear-gradient(90deg, ${colors.join(", ")})"></div>`;
    const divergingRamp = [-1, -0.5, 0, 0.5, 1].map((v) => css(diverging(t, v, 255)));
    if (view.kind === "herkunft") {
      if (view.selected) {
        root.innerHTML = `<div class="legend-title">${escapeHtml(view.selected.selection.name)}</div>${swatch(css(rgb(t.brass, 255)), "Herkunft")}${swatch(css(rgb(t.series[4], 255)), "Reiseziele aus diesem Ort")}`;
      } else if (view.mode === "dichte") {
        root.innerHTML = `<div class="legend-title">Herkunftsorte, Dichte</div>${ramp(t.sequential.slice(1))}<div class="legend-scale"><span>wenige</span><span>viele Einträge</span></div>`;
      } else if (view.mode === "anteil") {
        root.innerHTML = `<div class="legend-title">Anteil der Auswahl je Ort</div>${ramp(divergingRamp)}<div class="legend-scale"><span>¼</span><span>gleich</span><span>4-fach</span></div>`;
      } else {
        root.innerHTML = `<div class="legend-title">Herkunftsorte</div>${swatch(css(rgb(t.brass, 200)), "Kreisfläche nach Zahl der Einträge")}`;
      }
    }
    if (view.kind === "ziele") root.innerHTML = `<div class="legend-title">Ziele</div>${swatch(css(rgb(t.series[2], 255)), "Ankunftshafen")}${swatch(css(rgb(t.series[4], 200)), "genanntes Reiseziel")}`;
    if (view.kind === "wege") root.innerHTML = `<div class="legend-title">Wege</div>${ramp([css(rgb(t.brass, 255)), css(rgb(t.series[4], 255))])}<div class="legend-scale"><span>Herkunft</span><span>Ziel</span></div>`;
    if (view.kind === "ketten") root.innerHTML = `<div class="legend-title">Korridore nach Kategorie</div>${view.categories.filter((c) => c.corridors).map((c) => swatch(css(categoryColor(t, c.name, 255)), c.name, false)).join("")}`;
    if (view.kind === "wandel") {
      const [a, b] = view.periods;
      root.innerHTML = `<div class="legend-title">Anteil B minus A</div>${ramp(divergingRamp)}<div class="legend-scale"><span>häufiger ${a}</span><span>häufiger ${b}</span></div>
        <div class="legend-row" style="margin-top:8px"><span class="legend-swatch" style="border:2px solid ${t.series[0]};background:transparent"></span>Ellipse ${a}</div>
        <div class="legend-row"><span class="legend-swatch" style="border:2px solid ${t.series[7]};background:transparent"></span>Ellipse ${b}</div>
        <div class="legend-row"><span class="legend-swatch" style="background:${t.sequential[4]}"></span>Schwerpunkt je Jahr</div>`;
    }
  }
}

