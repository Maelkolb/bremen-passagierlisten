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

const DETAIL_FIELDS: [string, string][] = [
  ["nachname", "Nachname"], ["vorname", "Vorname"], ["geschlecht", "Geschlecht"], ["alter", "Alter"],
  ["familienstand", "Familienstand"], ["staatsangehoerigkeit", "Staatsangehörigkeit"], ["wohnort", "Wohnort (Liste)"],
  ["region", "Region"], ["herkunft_ort", "Herkunftsort (geokodiert)"], ["herkunft_land", "Land heute"],
  ["beruf", "Beruf (Liste)"], ["beruf_norm", "Beruf (normalisiert)"], ["hisco", "HISCO"], ["sektor_name", "KldB-Bereich"],
  ["niveau_name", "Anforderungsniveau"], ["ziel", "Reiseziel (Liste)"], ["ziel_ort", "Reiseziel (geokodiert)"], ["us_staat", "US-Bundesstaat"],
  ["datum", "Abfahrt"], ["schiff", "Schiff"], ["reederei", "Reederei"], ["ankunftshafen", "Ankunftshafen"], ["klasse", "Reiseklasse"],
  ["liste", "Archivliste"], ["nr", "Nr. auf der Liste"], ["reiseart", "Reiseart"], ["religion", "Religion"],
  ["angehoerige", "Angehörige"], ["kontaktperson", "Kontaktperson"], ["bemerkung", "Bemerkung"], ["id", "Datensatz-ID"],
];

const LEVELS: Record<string, string> = { "1": "Helfer", "2": "Fachkraft", "3": "Spezialist", "4": "Experte" };

export async function renderWerkbank(root: HTMLElement): Promise<void> {
  const [kennzahlen, berufe] = await Promise.all([load("kennzahlen"), load("berufe")]);
  const sectors = berufe.sektoren_kurz as Record<string, string>;
  root.innerHTML = `
    <p class="lede mb-6">Alle ${fmt(kennzahlen.datensaetze)} Einträge, durchsuchbar direkt im Browser. Platzhalter: <code>*</code> für beliebig viele, <code>?</code> für ein Zeichen. Umlaute werden gleich behandelt (Müller findet auch Mueller). Orte in Anführungszeichen ("Münster") werden genau gesucht.</p>
    <form id="wb-form" class="grid gap-4 md:grid-cols-4" autocomplete="off">
      <label class="field"><span>Nachname</span><input class="input" name="nachname" placeholder="z. B. Müller oder Schm*" /></label>
      <label class="field"><span>Vorname</span><input class="input" name="vorname" placeholder="z. B. Johann" /></label>
      <label class="field"><span>Herkunftsort oder Region</span><input class="input" name="herkunft" placeholder="z. B. Wien" /></label>
      <label class="field"><span>Reiseziel</span><input class="input" name="ziel" placeholder="z. B. Chicago" /></label>
      <label class="field"><span>Beruf</span><input class="input" name="beruf" placeholder="z. B. Bäcker" /></label>
      <label class="field"><span>Ankunftshafen</span><select class="select" name="hafen"><option value="">alle</option></select></label>
      <label class="field"><span>Schiff</span><input class="input" name="schiff" list="wb-ships" placeholder="z. B. Columbus" /><datalist id="wb-ships"></datalist></label>
      <label class="field"><span>KldB-Berufsbereich</span><select class="select" name="sektor"><option value="">alle</option>${Object.entries(sectors).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join("")}<option value="-1">ohne Angabe</option></select></label>
      <label class="field"><span>HISCO</span><select class="select" name="hisco"><option value="">alle</option></select></label>
      <div class="field"><span>Zeitraum</span><div class="flex items-center gap-2"><input class="input w-24" type="number" name="von" min="${FIRST_YEAR}" max="${LAST_YEAR}" value="${FIRST_YEAR}" aria-label="von Jahr" /><span class="muted">bis</span><input class="input w-24" type="number" name="bis" min="${FIRST_YEAR}" max="${LAST_YEAR}" value="${LAST_YEAR}" aria-label="bis Jahr" /></div></div>
      <label class="field"><span>Reiseart</span><select class="select" name="reiseart"><option value="">alle</option><option>Überfahrt</option><option>US-Staatsangehörige</option><option>Kreuzfahrt</option></select></label>
      <div class="field justify-end"><label class="check"><input type="checkbox" name="aehnlich" /> ähnliche Schreibweisen (Kölner Phonetik)</label></div>
      <div class="flex items-end gap-3"><button class="button" type="submit">Suchen</button><button class="button secondary" type="reset">Zurücksetzen</button></div>
    </form>
    <div id="wb-status" class="mt-6" aria-live="polite">
      <div class="progress"><div id="wb-progress"></div></div>
      <p class="muted text-sm mt-2 mb-0" id="wb-status-text">Die Datenbank (${fmt(kennzahlen.datensaetze)} Einträge) wird geladen, sobald Sie diesen Abschnitt erreichen.</p>
    </div>
    <div id="wb-results" hidden>
      <div class="flex flex-wrap items-baseline justify-between gap-4 mt-8 mb-4">
        <p class="m-0"><span class="figure-number text-3xl" id="wb-count">0</span> <span class="muted" id="wb-count-label">Einträge</span></p>
        <button class="button secondary" type="button" id="wb-export">Auswahl als CSV herunterladen</button>
      </div>
      <div class="grid gap-6 md:grid-cols-3">
        <figure class="m-0"><figcaption class="text-sm text-[var(--ink-2)] mb-1">Einträge je Jahr</figcaption><div class="h-44" id="wb-years"></div></figure>
        <figure class="m-0"><figcaption class="text-sm text-[var(--ink-2)] mb-1">Häufigste Ankunftshäfen</figcaption><div class="h-44" id="wb-ports"></div></figure>
        <figure class="m-0"><figcaption class="text-sm text-[var(--ink-2)] mb-1">Alter und Geschlecht</figcaption><div class="h-44" id="wb-ages"></div></figure>
      </div>
      <div class="overflow-x-auto mt-8"><table class="data-table" id="wb-table"></table></div>
      <div class="flex items-center gap-3 mt-4"><button class="button secondary" type="button" id="wb-prev">Zurück</button><span class="text-sm muted" id="wb-page"></span><button class="button secondary" type="button" id="wb-next">Weiter</button></div>
      <div id="wb-detail" class="mt-8"></div>
    </div>
  `;

  const form = root.querySelector<HTMLFormElement>("#wb-form")!;
  const progressBar = root.querySelector<HTMLElement>("#wb-progress")!;
  const statusText = root.querySelector<HTMLElement>("#wb-status-text")!;
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
      statusText.textContent = `Die Datenbank konnte nicht geladen werden: ${(error as Error).message}. Die Werkbank braucht einen lokalen Webserver (siehe README).`;
    }
  };

  const search = async () => {
    if (!database) return;
    const run = ++generation;
    const began = performance.now();
    where = whereClause(readCriteria(form), columns);
    page = 0;
    const [count] = await queryRows<{ n: number }>(database, `SELECT count(*)::INTEGER AS n FROM p WHERE ${where}`);
    if (run !== generation) return;
    total = count.n;
    const aggregates = await loadAggregates(database, where);
    if (run !== generation) return;
    lastAggregates = aggregates;
    root.querySelector("#wb-count")!.textContent = fmt(total);
    root.querySelector("#wb-count-label")!.textContent = `${total === 1 ? "Eintrag" : "Einträge"} in ${fmt(performance.now() - began)} ms`;
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

  const showDetail = async (id: number) => {
    if (!database) return;
    const [record] = await queryRows<any>(database, `SELECT *, strftime(abfahrt, '%d.%m.%Y') AS datum FROM p WHERE id = ${Number(id)}`);
    if (!record) return;
    record.sektor_name = record.sektor == null ? null : sectors[String(record.sektor)];
    record.niveau_name = record.niveau == null ? null : LEVELS[String(record.niveau)];
    const group = await queryRows<any>(database, `
      SELECT id, nachname, vorname, alter, geschlecht, nr, wohnort, beruf
      FROM p WHERE gruppe_id = ${Number(record.gruppe_id)} ORDER BY id`);
    renderDetail(root.querySelector("#wb-detail")!, record, group, showDetail);
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
  form.addEventListener("reset", () => window.setTimeout(search, 0));
  root.querySelector("#wb-prev")!.addEventListener("click", () => {
    page = Math.max(0, page - 1);
    showPage();
  });
  root.querySelector("#wb-next")!.addEventListener("click", () => {
    page += 1;
    showPage();
  });
  root.querySelector("#wb-table")!.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-id]");
    if (row) showDetail(Number(row.dataset.id));
  });
  root.querySelector("#wb-table")!.addEventListener("keydown", (e) => {
    const key = (e as KeyboardEvent).key;
    const row = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr[data-id]");
    if (row && (key === "Enter" || key === " ")) {
      e.preventDefault();
      showDetail(Number(row.dataset.id));
    }
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
    return Number.isFinite(value) && value >= FIRST_YEAR && value <= LAST_YEAR ? value : fallback;
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
}

function placeCondition(value: string, fields: string[], exactFields: string[]): string {
  const quoted = value.match(/^"(.+)"$/);
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
  const ports = await queryRows<any>(database, `SELECT coalesce(ankunftshafen, 'ohne Angabe') AS hafen, count(*)::INTEGER AS n FROM p WHERE ${where} GROUP BY 1 ORDER BY n DESC LIMIT 8`);
  const ages = await queryRows<any>(database, `SELECT (least(alter, 80) // 10 * 10)::INTEGER AS klasse, geschlecht, count(*)::INTEGER AS n FROM p WHERE ${where} AND alter IS NOT NULL AND geschlecht IS NOT NULL GROUP BY 1, 2`);
  return { years, ports, ages };
}

function drawCharts(charts: Record<"years" | "ports" | "ages", echarts.ECharts>, a: Aggregates): void {
  const t = tokens();
  const ax = axisStyle(t);
  const compact = { left: 44, right: 12, top: 8, bottom: 24 };
  const allYears = Array.from({ length: 1939 - 1830 + 1 }, (_, i) => 1830 + i);
  const byYear = new Map(a.years.map((y) => [y.jahr, y.n]));
  charts.years.setOption({
    ...baseOption(t),
    animationDuration: 300,
    grid: compact,
    tooltip: { trigger: "axis", valueFormatter: (v: any) => fmt(v) },
    xAxis: { type: "category", data: allYears.map(String), ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, interval: 19 } },
    yAxis: { type: "value", ...ax, axisLine: { show: false }, splitNumber: 3, axisLabel: { ...ax.axisLabel, formatter: (v: number) => fmt(v) } },
    series: [{ type: "bar", name: "Einträge", data: allYears.map((y) => byYear.get(y) ?? 0), itemStyle: { color: t.series[0] }, barCategoryGap: "10%" }],
  }, { notMerge: true });
  charts.ports.setOption({
    ...baseOption(t),
    animationDuration: 300,
    grid: { left: 110, right: 40, top: 4, bottom: 4 },
    tooltip: { trigger: "item", formatter: (p: any) => `${escapeHtml(p.name)}: ${fmt(p.value)}` },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", inverse: true, data: a.ports.map((p) => p.hafen), ...ax, axisLine: { show: false }, splitLine: { show: false } },
    series: [{ type: "bar", data: a.ports.map((p) => p.n), itemStyle: { color: t.series[2], borderRadius: [0, 2, 2, 0] }, barWidth: "60%", label: { show: true, position: "right", color: t.ink2, fontSize: 11, formatter: (p: any) => fmt(p.value) } }],
  }, { notMerge: true });
  const classes = [0, 10, 20, 30, 40, 50, 60, 70, 80];
  const value = (k: number, g: string) => a.ages.find((r) => r.klasse === k && r.geschlecht === g)?.n ?? 0;
  charts.ages.setOption({
    ...baseOption(t),
    animationDuration: 300,
    grid: { left: 44, right: 12, top: 20, bottom: 24 },
    legend: { show: false },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps: any) => `${ps[0].name}<br>${ps.map((p: any) => `${p.seriesName}: ${fmt(Math.abs(p.value))}`).join("<br>")}` },
    xAxis: { type: "value", ...ax, splitNumber: 2, axisLabel: { ...ax.axisLabel, formatter: (v: number) => fmt(Math.abs(v)) } },
    yAxis: { type: "category", data: classes.map((k) => (k === 80 ? "80+" : `${k}–${k + 9}`)), ...ax, splitLine: { show: false } },
    series: [
      { type: "bar", name: "Männer", stack: "a", data: classes.map((k) => -value(k, "m")), itemStyle: { color: t.series[0] }, barWidth: "70%" },
      { type: "bar", name: "Frauen", stack: "a", data: classes.map((k) => value(k, "w")), itemStyle: { color: t.series[1] }, barWidth: "70%" },
    ],
    graphic: [
      { type: "text", left: 48, top: 0, style: { text: "Männer", fill: t.ink2, font: `11px ${t.sans}` } },
      { type: "text", right: 14, top: 0, style: { text: "Frauen", fill: t.ink2, font: `11px ${t.sans}` } },
    ],
  }, { notMerge: true });
}

function renderTable(table: HTMLElement, list: any[]): void {
  const cell = (v: unknown) => escapeHtml(v == null ? "" : String(v));
  table.innerHTML = `
    <thead><tr><th>Abfahrt</th><th>Schiff</th><th>Name</th><th class="num">Alter</th><th>G.</th><th>Wohnort</th><th>Beruf</th><th>Reiseziel</th><th>Hafen</th><th class="num">Gruppe</th></tr></thead>
    <tbody>${list.map((r) => `
      <tr data-id="${r.id}" tabindex="0">
        <td>${cell(r.datum)}</td><td>${cell(r.schiff)}</td><td><strong>${cell(r.nachname)}</strong>${r.vorname ? `, ${cell(r.vorname)}` : ""}</td>
        <td class="num">${cell(r.alter)}</td><td>${cell(r.geschlecht)}</td><td>${cell(r.wohnort)}</td><td>${cell(r.beruf)}</td>
        <td>${cell(r.ziel)}</td><td>${cell(r.ankunftshafen)}</td><td class="num">${r.gruppe_groesse > 1 ? fmt(r.gruppe_groesse) : ""}</td>
      </tr>`).join("") || `<tr><td colspan="10" class="muted">Keine Einträge für diese Auswahl.</td></tr>`}</tbody>`;
}

function renderDetail(target: HTMLElement, record: any, group: any[], open: (id: number) => void): void {
  const fields = DETAIL_FIELDS.filter(([key]) => record[key] != null && record[key] !== "");
  target.innerHTML = `
    <div class="panel p-5">
      <h3 class="mt-0 mb-4 text-2xl">${escapeHtml(record.vorname ?? "")} ${escapeHtml(record.nachname ?? "")}</h3>
      <dl class="grid gap-x-8 gap-y-2 md:grid-cols-2 text-sm m-0">
        ${fields.map(([key, label]) => `<div class="grid grid-cols-[180px_1fr] gap-3 border-b border-[var(--rule)] pb-1"><dt class="muted">${label}</dt><dd class="m-0">${escapeHtml(String(record[key]))}</dd></div>`).join("")}
      </dl>
      ${group.length > 1 ? `
        <h4 class="serif text-lg mt-6 mb-2">Reisegruppe auf derselben Liste</h4>
        <table class="data-table"><thead><tr><th class="num">Nr.</th><th>Name</th><th class="num">Alter</th><th>G.</th><th>Wohnort</th><th>Beruf</th></tr></thead>
        <tbody>${group.map((g) => `<tr data-group-id="${g.id}" tabindex="0"><td class="num">${escapeHtml(String(g.nr ?? ""))}</td><td>${escapeHtml(g.nachname ?? "")}, ${escapeHtml(g.vorname ?? "")}</td><td class="num">${escapeHtml(String(g.alter ?? ""))}</td><td>${escapeHtml(g.geschlecht ?? "")}</td><td>${escapeHtml(g.wohnort ?? "")}</td><td>${escapeHtml(g.beruf ?? "")}</td></tr>`).join("")}</tbody></table>
        <p class="muted text-sm mt-2 mb-0">Rekonstruiert aus gleichem Nachnamen und aufeinanderfolgender Nummer auf derselben Liste. Verwandtschaft ist damit wahrscheinlich, nicht belegt.</p>` : ""}
    </div>`;
  target.querySelectorAll<HTMLTableRowElement>("tr[data-group-id]").forEach((row) => row.addEventListener("click", () => open(Number(row.dataset.groupId))));
  target.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
