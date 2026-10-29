import * as echarts from "echarts";
import { exportCsv, literal, openDatabase, queryRows, type Database } from "../db";
import { load } from "../data";
import { escapeHtml, fmt } from "../format";
import { contains, hasWildcard, occupationCondition, surnameCondition, toLike } from "../search";
import { axisStyle, baseOption, onThemeChange, tokens } from "../theme";

interface Criteria {
  nachname: string;
  aehnlich: boolean;
  vorname: string;
  herkunft: string;
  ziel: string;
  hafen: string;
  beruf: string;
  hisco: string;
  sektor: string;
  schiff: string;
  von: number;
  bis: number;
  reiseart: string;
}

const PAGE_SIZE = 50;
const FIRST_YEAR = 1830;
const LAST_YEAR = 1945;
const INTERNAL_COLUMNS = ["nachname_norm", "phonetik", "herkunft_lat", "herkunft_lon", "herkunft_genauigkeit", "herkunft_sicher", "ziel_lat", "ziel_lon", "ziel_genauigkeit", "ziel_sicher"];
const URL_FIELDS = ["nachname", "vorname", "herkunft", "ziel", "beruf", "schiff", "hafen", "sektor", "hisco", "von", "bis", "reiseart"];
const MORE_FIELDS = ["beruf", "schiff", "hafen", "sektor", "hisco", "reiseart"];
const CLOSE_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

const DETAIL_FIELDS: [string, string][] = [
  ["geschlecht", "Geschlecht"], ["alter", "Alter"], ["familienstand", "Familienstand"], ["staatsangehoerigkeit", "Staatsangehörigkeit"],
  ["religion", "Religion"], ["wohnort", "Wohnort (Liste)"], ["region", "Region"], ["herkunft_ort", "Herkunftsort (geokodiert)"],
  ["herkunft_land", "Land heute"], ["beruf", "Beruf (Liste)"], ["beruf_norm", "Beruf (vereinheitlicht)"], ["hisco", "HISCO"],
  ["sektor_name", "KldB-Bereich"], ["niveau_name", "Anforderungsniveau"], ["ziel", "Reiseziel (Liste)"], ["ziel_ort", "Reiseziel (geokodiert)"],
  ["us_staat", "US-Bundesstaat"], ["datum", "Abfahrt"], ["schiff", "Schiff"], ["reederei", "Reederei"], ["ankunftshafen", "Ankunftshafen"],
  ["klasse", "Reiseklasse"], ["reiseart", "Reiseart"], ["angehoerige", "Angehörige"], ["kontaktperson", "Kontaktperson"],
  ["bemerkung", "Bemerkung"], ["liste", "Archivliste"], ["nr", "Nr. auf der Liste"], ["id", "Datensatz"],
];

const LEVELS: Record<string, string> = { "1": "Helfer", "2": "Fachkraft", "3": "Spezialist", "4": "Experte" };
const SEX: Record<string, string> = { m: "männlich", w: "weiblich" };

export async function renderWerkbank(root: HTMLElement): Promise<void> {
  const [kennzahlen, berufe] = await Promise.all([load("kennzahlen"), load("berufe")]);
  const sectors = berufe.sektoren_kurz as Record<string, string>;
  root.innerHTML = `
    <p class="section-lede">Alle ${fmt(kennzahlen.datensaetze)} Einträge, durchsucht direkt im Browser.</p>
    <form id="wb-form" class="search-form" autocomplete="off">
      <div class="search-main">
        <div class="field field-name">
          <label for="wb-nachname">Nachname</label>
          <input class="input" id="wb-nachname" name="nachname" placeholder="Müller oder Schm*" spellcheck="false" />
          <label class="check"><input type="checkbox" name="aehnlich" /> ähnliche Schreibweisen</label>
        </div>
        <label class="field"><span>Vorname</span><input class="input" name="vorname" placeholder="Johann" spellcheck="false" /></label>
        <label class="field"><span>Herkunft</span><input class="input" name="herkunft" placeholder="Ort oder Region" spellcheck="false" /></label>
        <label class="field"><span>Reiseziel</span><input class="input" name="ziel" placeholder="Chicago" spellcheck="false" /></label>
        <div class="field field-years"><span id="wb-years-label">Jahre</span><div class="year-range" role="group" aria-labelledby="wb-years-label"><input class="input" type="number" inputmode="numeric" name="von" min="${FIRST_YEAR}" max="${LAST_YEAR}" placeholder="${FIRST_YEAR}" aria-label="von" /><span aria-hidden="true">–</span><input class="input" type="number" inputmode="numeric" name="bis" min="${FIRST_YEAR}" max="${LAST_YEAR}" placeholder="${LAST_YEAR}" aria-label="bis" /></div></div>
        <div class="search-submit"><button class="button" type="submit">Suchen</button></div>
      </div>
      <details class="more-fields" id="wb-more">
        <summary>Weitere Felder</summary>
        <div class="more-grid">
          <label class="field"><span>Beruf</span><input class="input" name="beruf" placeholder="Bäcker" /></label>
          <label class="field"><span>Schiff</span><input class="input" name="schiff" list="wb-ships" placeholder="Columbus" /><datalist id="wb-ships"></datalist></label>
          <label class="field"><span>Ankunftshafen</span><select class="select" name="hafen"><option value="">alle</option></select></label>
          <label class="field"><span>Berufsbereich (KldB 2010)</span><select class="select" name="sektor"><option value="">alle</option>${Object.entries(sectors).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join("")}<option value="-1">ohne Angabe</option></select></label>
          <label class="field"><span>Beruf nach HISCO</span><select class="select" name="hisco"><option value="">alle</option></select></label>
          <label class="field"><span>Reiseart</span><select class="select" name="reiseart"><option value="">alle</option><option>Überfahrt</option><option>US-Staatsangehörige</option><option>Kreuzfahrt</option></select></label>
        </div>
      </details>
      <p class="search-hint">Platzhalter <kbd>*</kbd> und <kbd>?</kbd>. Ein Ort in Anführungszeichen, etwa „Münster“, wird genau gesucht. Müller findet auch Mueller.</p>
    </form>
    <div id="wb-status" class="search-status" aria-live="polite">
      <div class="progress"><div id="wb-progress"></div></div>
      <p id="wb-status-text">Die Datenbank wird geladen, sobald Sie diesen Abschnitt erreichen.</p>
    </div>
    <div id="wb-results" hidden>
      <div class="results-head">
        <p class="results-count" aria-live="polite"><span id="wb-count">0</span> <span id="wb-count-label">Einträge</span></p>
        <div class="results-tools"><button class="text-button" type="button" id="wb-reset">Alle Felder leeren</button><button class="text-button" type="button" id="wb-export">Auswahl als CSV herunterladen</button></div>
      </div>
      <div class="results-charts">
        <figure><figcaption class="chart-title">Einträge je Jahr</figcaption><div class="mini-chart" id="wb-years"></div></figure>
        <figure><figcaption class="chart-title">Häufigste Ankunftshäfen</figcaption><div class="mini-chart" id="wb-ports"></div></figure>
        <figure><figcaption class="chart-title">Alter und Geschlecht</figcaption><div class="mini-chart" id="wb-ages"></div></figure>
      </div>
      <div class="table-scroll"><table class="ledger results-table" id="wb-table"></table></div>
      <div class="pager"><button class="button secondary" type="button" id="wb-prev">Zurück</button><span id="wb-page"></span><button class="button secondary" type="button" id="wb-next">Weiter</button></div>
    </div>
    <dialog class="record" id="wb-record" aria-labelledby="record-name">
      <button type="button" class="icon-button record-close" id="wb-record-close" aria-label="Schließen">${CLOSE_ICON}</button>
      <div id="wb-record-body"></div>
    </dialog>
  `;

  const form = root.querySelector<HTMLFormElement>("#wb-form")!;
  const progressBar = root.querySelector<HTMLElement>("#wb-progress")!;
  const statusText = root.querySelector<HTMLElement>("#wb-status-text")!;
  const dialog = root.querySelector<HTMLDialogElement>("#wb-record")!;
  let database: Database | null = null;
  let columns = new Set<string>();
  let page = 0;
  let total = 0;
  let where = "TRUE";
  let generation = 0;
  const charts = {
    years: echarts.init(root.querySelector<HTMLElement>("#wb-years")!),
    ports: echarts.init(root.querySelector<HTMLElement>("#wb-ports")!),
    ages: echarts.init(root.querySelector<HTMLElement>("#wb-ages")!),
  };
  Object.values(charts).forEach((chart) => new ResizeObserver(() => chart.resize()).observe(chart.getDom()));
  let lastAggregates: Aggregates | null = null;
  onThemeChange(() => lastAggregates && drawCharts(charts, lastAggregates));

  const start = async () => {
    try {
      database = await openDatabase((stage, loaded, all) => {
        progressBar.style.width = `${all ? Math.round((loaded / all) * 100) : 0}%`;
        statusText.textContent = all > 1 ? `${stage}: ${fmt(loaded / 1e6)} von ${fmt(all / 1e6)} MB` : `${stage} …`;
      });
      columns = new Set((await queryRows<any>(database, "DESCRIBE p")).map((r) => r.column_name));
      await fillOptions(database, form);
      prefillFromUrl(form);
      root.querySelector("#wb-status")!.setAttribute("hidden", "");
      root.querySelector("#wb-results")!.removeAttribute("hidden");
      await search();
    } catch (error) {
      statusText.textContent = `Die Datenbank konnte nicht geladen werden: ${(error as Error).message}. Die Suche braucht einen Webserver, siehe README.`;
    }
  };

  const search = async () => {
    if (!database) return;
    const run = ++generation;
    where = whereClause(readCriteria(form), columns);
    page = 0;
    const [count] = await queryRows<{ n: number }>(database, `SELECT count(*)::INTEGER AS n FROM p WHERE ${where}`);
    if (run !== generation) return;
    total = count.n;
    const aggregates = await loadAggregates(database, where);
    if (run !== generation) return;
    lastAggregates = aggregates;
    root.querySelector("#wb-count")!.textContent = fmt(total);
    root.querySelector("#wb-count-label")!.textContent = total === 1 ? "Eintrag" : "Einträge";
    root.querySelector<HTMLButtonElement>("#wb-export")!.disabled = total === 0;
    drawCharts(charts, aggregates);
    await showPage();
  };

  const showPage = async () => {
    if (!database) return;
    const list = await queryRows<any>(database, `
      SELECT id, strftime(abfahrt, '%d.%m.%Y') AS datum, schiff, nachname, vorname, alter, geschlecht, wohnort, beruf, ziel, ankunftshafen, gruppe_groesse
      FROM p WHERE ${where}
      ORDER BY abfahrt NULLS LAST, liste, id
      LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}`);
    renderTable(root.querySelector("#wb-table")!, list);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    root.querySelector("#wb-page")!.textContent = `Seite ${fmt(page + 1)} von ${fmt(pages)}`;
    root.querySelector<HTMLButtonElement>("#wb-prev")!.disabled = page === 0;
    root.querySelector<HTMLButtonElement>("#wb-next")!.disabled = page + 1 >= pages;
  };

  const showRecord = async (id: number) => {
    if (!database) return;
    const [record] = await queryRows<any>(database, `SELECT *, strftime(abfahrt, '%d.%m.%Y') AS datum FROM p WHERE id = ${Number(id)}`);
    if (!record) return;
    record.sektor_name = record.sektor == null ? null : sectors[String(record.sektor)];
    record.niveau_name = record.niveau == null ? null : LEVELS[String(record.niveau)];
    record.geschlecht = SEX[record.geschlecht] ?? record.geschlecht;
    if (record.hisco != null && record.hisco < 0) record.hisco = null;
    const group = record.gruppe_groesse > 1
      ? await queryRows<any>(database, `SELECT id, nr, nachname, vorname, alter, geschlecht, wohnort, beruf FROM p WHERE gruppe_id = ${Number(record.gruppe_id)} ORDER BY id`)
      : [];
    const body = root.querySelector<HTMLElement>("#wb-record-body")!;
    body.innerHTML = recordHtml(record, group);
    body.querySelectorAll<HTMLTableRowElement>("tr[data-id]").forEach((row) => {
      row.addEventListener("click", () => showRecord(Number(row.dataset.id)));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          showRecord(Number(row.dataset.id));
        }
      });
    });
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0;
  };

  let debounce: number | undefined;
  form.addEventListener("input", () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(search, 450);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    window.clearTimeout(debounce);
    search();
  });
  root.querySelector("#wb-reset")!.addEventListener("click", () => {
    form.reset();
    search();
  });
  root.querySelector("#wb-prev")!.addEventListener("click", () => {
    page = Math.max(0, page - 1);
    showPage();
  });
  root.querySelector("#wb-next")!.addEventListener("click", () => {
    page += 1;
    showPage();
  });
  const table = root.querySelector("#wb-table")!;
  table.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-id]");
    if (row) showRecord(Number(row.dataset.id));
  });
  table.addEventListener("keydown", (e) => {
    const key = (e as KeyboardEvent).key;
    const row = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-id]");
    if (row && (key === "Enter" || key === " ")) {
      e.preventDefault();
      showRecord(Number(row.dataset.id));
    }
  });
  root.querySelector("#wb-record-close")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  root.querySelector("#wb-export")!.addEventListener("click", async () => {
    if (!database) return;
    const button = root.querySelector<HTMLButtonElement>("#wb-export")!;
    button.disabled = true;
    button.textContent = "CSV wird erstellt …";
    const exclude = INTERNAL_COLUMNS.filter((c) => columns.has(c));
    const blob = await exportCsv(database, `SELECT * ${exclude.length ? `EXCLUDE (${exclude.join(", ")})` : ""} FROM p WHERE ${where} ORDER BY abfahrt NULLS LAST, liste, id`);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `bremer_passagierlisten_auswahl_${total}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    button.disabled = false;
    button.textContent = "Auswahl als CSV herunterladen";
  });

  const deepLink = location.hash === "#werkbank" || location.search.length > 1;
  if (deepLink) {
    start().then(() => document.getElementById("werkbank")?.scrollIntoView());
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      observer.disconnect();
      start();
    }
  }, { rootMargin: "800px 0px" });
  observer.observe(root);
}

function readCriteria(form: HTMLFormElement): Criteria {
  const data = new FormData(form);
  const text = (name: string) => String(data.get(name) ?? "").trim();
  const year = (name: string, fallback: number) => {
    const value = Number(text(name));
    return text(name) && Number.isFinite(value) && value >= FIRST_YEAR && value <= LAST_YEAR ? value : fallback;
  };
  return {
    nachname: text("nachname"),
    aehnlich: data.get("aehnlich") === "on",
    vorname: text("vorname"),
    herkunft: text("herkunft"),
    ziel: text("ziel"),
    hafen: text("hafen"),
    beruf: text("beruf"),
    hisco: text("hisco"),
    sektor: text("sektor"),
    schiff: text("schiff"),
    von: year("von", FIRST_YEAR),
    bis: year("bis", LAST_YEAR),
    reiseart: text("reiseart"),
  };
}

function prefillFromUrl(form: HTMLFormElement): void {
  const params = new URLSearchParams(location.search);
  for (const name of URL_FIELDS) {
    const value = params.get(name);
    const field = form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name=${name}]`);
    if (value !== null && field) field.value = value;
  }
  if (params.get("aehnlich") === "1") form.querySelector<HTMLInputElement>("[name=aehnlich]")!.checked = true;
  if (MORE_FIELDS.some((name) => params.get(name))) form.querySelector<HTMLDetailsElement>("#wb-more")!.open = true;
}

function placeCondition(value: string, fields: string[], exactFields: string[]): string {
  const quoted = value.match(/^["„“](.+)["“”]$/);
  if (quoted) return `(${exactFields.map((f) => `${f} = ${literal(quoted[1])}`).join(" OR ")})`;
  return `(${fields.map((f) => `${f} ILIKE ${contains(value)}`).join(" OR ")})`;
}

function whereClause(c: Criteria, columns: Set<string>): string {
  const parts: string[] = [];
  if (c.nachname) parts.push(surnameCondition(c.nachname, c.aehnlich));
  if (c.vorname) parts.push(`vorname ILIKE ${literal(hasWildcard(c.vorname) ? toLike(c.vorname) : `${toLike(c.vorname)}%`)}`);
  if (c.herkunft) {
    const fields = ["wohnort", "region", "herkunft_ort"].filter((f) => columns.has(f));
    parts.push(placeCondition(c.herkunft, fields, ["wohnort", "herkunft_ort"].filter((f) => columns.has(f))));
  }
  if (c.ziel) {
    const fields = ["ziel", "ziel_ort", "ziel_ort_gruppe"].filter((f) => columns.has(f));
    parts.push(placeCondition(c.ziel, fields, fields));
  }
  if (c.beruf) parts.push(occupationCondition(c.beruf));
  if (c.hafen) parts.push(`ankunftshafen = ${literal(c.hafen)}`);
  if (c.schiff) parts.push(`schiff ILIKE ${contains(c.schiff)}`);
  if (c.hisco) parts.push(`hisco = ${Number(c.hisco)}`);
  if (c.sektor) parts.push(c.sektor === "-1" ? "sektor IS NULL" : `sektor = ${Number(c.sektor)}`);
  if (c.reiseart) parts.push(`reiseart = ${literal(c.reiseart)}`);
  if (c.von > FIRST_YEAR || c.bis < LAST_YEAR) parts.push(`jahr BETWEEN ${Math.min(c.von, c.bis)} AND ${Math.max(c.von, c.bis)}`);
  return parts.length ? parts.join(" AND ") : "TRUE";
}

async function fillOptions(database: Database, form: HTMLFormElement): Promise<void> {
  const ports = await queryRows<any>(database, "SELECT ankunftshafen AS v, count(*)::INTEGER AS n FROM p WHERE ankunftshafen IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 80");
  const hisco = await queryRows<any>(database, "SELECT hisco AS v, mode(beruf_norm) AS label, count(*)::INTEGER AS n FROM p WHERE hisco >= 0 GROUP BY 1 ORDER BY n DESC");
  const ships = await queryRows<any>(database, "SELECT schiff AS v FROM p WHERE schiff IS NOT NULL GROUP BY 1 ORDER BY 1");
  form.querySelector<HTMLSelectElement>("[name=hafen]")!.insertAdjacentHTML("beforeend", ports.map((p) => `<option value="${escapeHtml(p.v)}">${escapeHtml(p.v)} (${fmt(p.n)})</option>`).join(""));
  form.querySelector<HTMLSelectElement>("[name=hisco]")!.insertAdjacentHTML("beforeend", hisco.map((h) => `<option value="${h.v}">${String(h.v).padStart(5, "0")} ${escapeHtml(h.label ?? "")} (${fmt(h.n)})</option>`).join(""));
  form.querySelector<HTMLElement>("#wb-ships")!.innerHTML = ships.map((s) => `<option value="${escapeHtml(s.v)}"></option>`).join("");
}

interface Aggregates {
  years: { jahr: number; n: number }[];
  ports: { hafen: string; n: number }[];
  ages: { klasse: number; geschlecht: string; n: number }[];
}

async function loadAggregates(database: Database, where: string): Promise<Aggregates> {
  const years = await queryRows<any>(database, `SELECT jahr::INTEGER AS jahr, count(*)::INTEGER AS n FROM p WHERE ${where} AND jahr IS NOT NULL GROUP BY 1 ORDER BY 1`);
  const ports = await queryRows<any>(database, `SELECT coalesce(ankunftshafen, 'ohne Angabe') AS hafen, count(*)::INTEGER AS n FROM p WHERE ${where} GROUP BY 1 ORDER BY n DESC, 1 LIMIT 6`);
  const ages = await queryRows<any>(database, `SELECT (least(alter, 80) // 10 * 10)::INTEGER AS klasse, geschlecht, count(*)::INTEGER AS n FROM p WHERE ${where} AND alter IS NOT NULL AND geschlecht IS NOT NULL GROUP BY 1, 2`);
  return { years, ports, ages };
}

function drawCharts(charts: Record<"years" | "ports" | "ages", echarts.ECharts>, a: Aggregates): void {
  const t = tokens();
  const ax = axisStyle(t);
  const allYears = Array.from({ length: 1939 - 1830 + 1 }, (_, i) => 1830 + i);
  const byYear = new Map(a.years.map((y) => [y.jahr, y.n]));
  charts.years.setOption({
    ...baseOption(t),
    animationDuration: 300,
    grid: { left: 44, right: 8, top: 8, bottom: 24 },
    tooltip: { trigger: "axis", valueFormatter: (v: any) => fmt(v) },
    xAxis: { type: "category", data: allYears.map(String), ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, interval: 19 } },
    yAxis: { type: "value", ...ax, axisLine: { show: false }, splitNumber: 3, axisLabel: { ...ax.axisLabel, formatter: (v: number) => fmt(v) } },
    series: [{ type: "bar", name: "Einträge", data: allYears.map((y) => byYear.get(y) ?? 0), itemStyle: { color: t.ink }, barCategoryGap: "12%" }],
  }, { notMerge: true });
  charts.ports.setOption({
    ...baseOption(t),
    animationDuration: 300,
    grid: { left: 104, right: 56, top: 4, bottom: 4 },
    tooltip: { trigger: "item", formatter: (p: any) => `${escapeHtml(p.name)}: ${fmt(p.value)}` },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", inverse: true, data: a.ports.map((p) => p.hafen), ...ax, axisLine: { show: false }, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, color: t.ink2, width: 96, overflow: "truncate" } },
    series: [{ type: "bar", data: a.ports.map((p) => p.n), itemStyle: { color: t.destination }, barWidth: "56%", label: { show: true, position: "right", color: t.ink2, fontSize: 11, formatter: (p: any) => fmt(p.value) } }],
  }, { notMerge: true });
  const classes = [0, 10, 20, 30, 40, 50, 60, 70, 80];
  const value = (k: number, g: string) => a.ages.find((r) => r.klasse === k && r.geschlecht === g)?.n ?? 0;
  charts.ages.setOption({
    ...baseOption(t),
    animationDuration: 300,
    grid: { left: 44, right: 12, top: 20, bottom: 24 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: t.rule, opacity: 0.4 } }, formatter: (ps: any) => `${ps[0].name}<br>${ps.map((p: any) => `${p.seriesName}: ${fmt(Math.abs(p.value))}`).join("<br>")}` },
    xAxis: { type: "value", ...ax, splitNumber: 2, axisLabel: { ...ax.axisLabel, formatter: (v: number) => fmt(Math.abs(v)) } },
    yAxis: { type: "category", data: classes.map((k) => (k === 80 ? "80+" : `${k}–${k + 9}`)), ...ax, splitLine: { show: false } },
    series: [
      { type: "bar", name: "Männer", stack: "a", data: classes.map((k) => -value(k, "m")), itemStyle: { color: t.series[0] }, barWidth: "68%" },
      { type: "bar", name: "Frauen", stack: "a", data: classes.map((k) => value(k, "w")), itemStyle: { color: t.series[1] }, barWidth: "68%" },
    ],
    graphic: [
      { type: "text", left: 48, top: 0, style: { text: "Männer", fill: t.ink2, font: `11.5px ${t.sans}` } },
      { type: "text", right: 14, top: 0, style: { text: "Frauen", fill: t.ink2, font: `11.5px ${t.sans}` } },
    ],
  }, { notMerge: true });
}

function cell(value: unknown): string {
  return escapeHtml(value == null ? "" : String(value));
}

function renderTable(table: HTMLElement, list: any[]): void {
  table.innerHTML = `
    <thead><tr><th>Abfahrt</th><th>Name</th><th class="num">Alter</th><th>Wohnort</th><th class="col-wide">Beruf</th><th>Reiseziel</th><th class="col-wide">Schiff</th><th class="col-wide">Hafen</th></tr></thead>
    <tbody>${list.map((r) => `
      <tr data-id="${r.id}" tabindex="0">
        <td>${cell(r.datum)}</td>
        <td class="name">${cell(r.nachname)}${r.vorname ? `, ${cell(r.vorname)}` : ""}${r.gruppe_groesse > 1 ? `<span class="group-size" title="Reisegruppe mit ${r.gruppe_groesse} Personen">${r.gruppe_groesse}</span>` : ""}</td>
        <td class="num">${cell(r.alter)}</td><td>${cell(r.wohnort)}</td><td class="col-wide">${cell(r.beruf)}</td>
        <td>${cell(r.ziel)}</td><td class="col-wide">${cell(r.schiff)}</td><td class="col-wide">${cell(r.ankunftshafen)}</td>
      </tr>`).join("") || `<tr class="empty-row"><td colspan="8">Keine Einträge für diese Auswahl.</td></tr>`}</tbody>`;
}

function recordHtml(record: any, group: any[]): string {
  const name = [record.vorname, record.nachname].filter(Boolean).join(" ") || "ohne Namen";
  const identity = [record.alter != null ? `${record.alter} Jahre` : null, record.beruf_norm ?? record.beruf].filter(Boolean).join(", ");
  const origin = record.herkunft_ort ?? record.wohnort ?? record.region;
  const destination = record.ziel_ort_gruppe ?? record.ziel_ort ?? record.ziel ?? record.us_staat;
  const stops: [string, string][] = [];
  if (origin) stops.push([origin, "Wohnort"]);
  stops.push(["Bremen", [record.datum, record.schiff].filter(Boolean).join(", ")]);
  if (record.ankunftshafen && record.ankunftshafen !== destination) stops.push([record.ankunftshafen, "Ankunftshafen"]);
  if (destination) stops.push([destination, record.ankunftshafen === destination ? "Ankunftshafen und Ziel" : "Reiseziel"]);
  const fields = DETAIL_FIELDS.filter(([key]) => record[key] != null && record[key] !== "");
  const numbered = group.some((g) => g.nr != null);
  return `
    <h3 class="record-name" id="record-name">${escapeHtml(name)}</h3>
    ${identity ? `<p class="record-identity">${escapeHtml(identity)}</p>` : ""}
    <ol class="record-route">${stops.map(([place, detail]) => `<li><span class="record-place">${escapeHtml(place)}</span><span class="record-detail">${escapeHtml(detail)}</span></li>`).join("")}</ol>
    <dl class="record-fields">${fields.map(([key, label]) => `<div><dt>${label}</dt><dd>${escapeHtml(String(record[key]))}</dd></div>`).join("")}</dl>
    ${group.length > 1 ? `
      <h4 class="record-subhead">Reisegruppe auf derselben Liste</h4>
      <table class="ledger"><thead><tr>${numbered ? `<th class="num">Nr.</th>` : ""}<th>Name</th><th class="num">Alter</th><th>Wohnort</th><th class="col-wide">Beruf</th></tr></thead>
      <tbody>${group.map((g) => `<tr data-id="${g.id}" tabindex="0"${g.id === record.id ? ` aria-current="true"` : ""}>${numbered ? `<td class="num">${cell(g.nr)}</td>` : ""}<td class="name">${cell(g.nachname)}${g.vorname ? `, ${cell(g.vorname)}` : ""}</td><td class="num">${cell(g.alter)}</td><td>${cell(g.wohnort)}</td><td class="col-wide">${cell(g.beruf)}</td></tr>`).join("")}</tbody></table>
      <p class="caption">Erschlossen aus gleichem Nachnamen und aufeinanderfolgender Nummer auf derselben Liste. Verwandtschaft ist damit wahrscheinlich, nicht belegt.</p>` : ""}
    <div class="record-actions"><a class="button secondary" href="atlas.html#eintrag=${record.id}">Reise im Atlas zeigen</a></div>`;
}
