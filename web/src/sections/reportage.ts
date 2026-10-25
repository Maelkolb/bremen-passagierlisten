import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { assetUrl, load, PERIOD_LABELS, rows } from "../data";
import { fmt, fmt1, pct } from "../format";
import { axisStyle, baseOption, onThemeChange, sectorColor, tokens, type Tokens } from "../theme";

interface Data {
  quellen: any;
  berufe: any;
  demografie: any;
  schifffahrt: any;
  geografie: any | null;
}

interface Step {
  era: string;
  title: string;
  text: (d: Data) => string;
  chart: (d: Data, t: Tokens) => EChartsOption;
}

const MIN_YEAR_SIZE = 1000;
const STEPS: Step[] = [
  {
    era: "1830–1939",
    title: "Was überliefert ist",
    text: (d) => {
      const years = rows<any>(d.quellen.jahre).filter((y) => y.datensaetze > 0);
      const total = years.reduce((s, y) => s + y.datensaetze, 0);
      const gap = (d.quellen.luecken as number[][]).reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
      return `${fmt(total)} datierte Einträge aus ${years.length} Jahrgängen. Für ${gap[0]} bis ${gap[1]} ist keine Liste erhalten: Die Bremer Listen jener Jahrzehnte wurden nach damaliger Aufbewahrungspraxis vernichtet.`;
    },
    chart: (d, t) => yearlyBars(d, t, [1830, 1939]),
  },
  {
    era: "Segelschiffzeit 1830–1869",
    title: "Einzelne Listen",
    text: (d) => {
      const early = rows<any>(d.quellen.jahre).filter((y) => y.jahr < 1870 && y.datensaetze > 0);
      const total = early.reduce((s, y) => s + y.datensaetze, 0);
      return `Aus der Zeit der Segelschiffe sind ${fmt(total)} Einträge aus ${early.length} Jahrgängen erhalten, Splitter aus Sammlungen statt geschlossener Serien.`;
    },
    chart: (d, t) => yearlyBars(d, t, [1830, 1869]),
  },
  {
    era: "Vorkriegsjahre 1907–1914",
    title: "Landarbeit über den Atlantik",
    text: (d) => {
      const share = sectorShare(d, "1907–1914", 1);
      const later = sectorShare(d, "1930–1939", 1);
      return `Vor dem Ersten Weltkrieg gaben ${pct(share)} der Auswanderer mit Berufsangabe die Landwirtschaft an, die meisten als Tagelöhner. In den Dreißigerjahren waren es ${pct(later)}.`;
    },
    chart: (d, t) => sectorBars(d, t),
  },
  {
    era: "1907–1939",
    title: "Erst die Männer, dann die Frauen",
    text: (d) => {
      const years = rows<any>(d.demografie.jahre).filter((y) => y.n >= MIN_YEAR_SIZE);
      const first = years[0];
      const last = years[years.length - 1];
      return `${first.jahr} kamen auf 100 Frauen ${fmt(first.maenner_je_100_frauen)} Männer, ${last.jahr} noch ${fmt(last.maenner_je_100_frauen)}.`;
    },
    chart: (d, t) => sexRatio(d, t),
  },
  {
    era: "Zwanziger Jahre 1919–1929",
    title: "New York und Buenos Aires",
    text: (d) => {
      const ports = rows<any>(d.schifffahrt.haefen_jahr).filter((r) => r.jahr >= 1919);
      const total = ports.reduce((s, r) => s + r.n, 0);
      const byPort = sumBy(ports, "hafen");
      const twenties = sumBy(ports.filter((r) => r.jahr <= 1929 && r.hafen !== "New York" && r.hafen !== "Sonstige"), "hafen");
      const second = [...twenties.entries()].sort((a, b) => b[1] - a[1])[0];
      return `${pct((byPort.get("New York") ?? 0) / total)} aller Einträge 1919–1939 führen nach New York. Zweites großes Ziel der Zwanziger war ${second[0]}.`;
    },
    chart: (d, t) => portArea(d, t),
  },
  {
    era: "Jahreslauf",
    title: "Rückreise im Spätsommer",
    text: (d) => {
      const us = d.quellen.saison_nach_reiseart["US-Staatsangehörige"].monate;
      const peak = us.reduce((a: any, b: any) => (b.index > a.index ? b : a));
      return `US-Bürger fuhren nach dem Sommer in Europa zurück: Im ${MONTHS[peak.monat - 1]} lag ihr Aufkommen beim ${fmt1(peak.index)}-Fachen des Monatsmittels. Bei allen anderen schwankt der Jahreslauf weit weniger.`;
    },
    chart: (d, t) => seasonLines(d, t),
  },
  {
    era: "Dreißiger Jahre 1930–1939",
    title: "Älter, und seltener mit Kindern",
    text: (d) => {
      const years = rows<any>(d.demografie.jahre).filter((y) => y.n >= MIN_YEAR_SIZE && y.jahr >= 1920 && y.median_alter != null);
      const start = years.find((y) => y.jahr === 1925) ?? years[0];
      const end = years[years.length - 1];
      return `Das mittlere Alter der Auswanderer stieg von ${fmt(start.median_alter)} Jahren (${start.jahr}) auf ${fmt(end.median_alter)} (${end.jahr}). Kinder unter 15 machten ${start.jahr} ${pct(start.anteil_kinder)} aus, ${end.jahr} ${pct(end.anteil_kinder)}.`;
    },
    chart: (d, t) => medianAge(d, t),
  },
  {
    era: "Reisegruppen",
    title: "Familien an Bord",
    text: (d) => {
      const g = rows<any>(d.demografie.gruppen_zeitraum).filter((r) => r.gruppe_typ === "Familie/Gruppe 3+");
      const at = (p: string) => g.find((r) => r.zeitraum === p)?.anteil;
      return `Reisende in Gruppen ab drei Personen mit gleichem Namen, direkt hintereinander auf der Liste: ${pct(at("1907–1914"))} vor dem Krieg, ${pct(at("1930–1939"))} in den Dreißigern.`;
    },
    chart: (d, t) => groupBars(d, t),
  },
  {
    era: "Herkunft",
    title: "Der Schwerpunkt wandert",
    text: (d) => {
      const c = rows<any>(d.geografie?.schwerpunkte_jahr);
      if (c.length < 2) return "Die Herkunftsorte werden geokodiert.";
      const first = c[0];
      const last = c[c.length - 1];
      const km = distanceKm(first.lat, first.lon, last.lat, last.lon);
      const direction = last.lon < first.lon ? "Westen" : "Osten";
      return `Der Mittelpunkt aller Herkunftsorte in Europa verschob sich zwischen ${first.jahr} und ${last.jahr} um ${fmt(km)} km nach ${direction}.`;
    },
    chart: (d, t) => centroidMap(d, t),
  },
];

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MONTHS_SHORT = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export async function renderReportage(root: HTMLElement): Promise<void> {
  const [quellen, berufe, demografie, schifffahrt, geografie, land] = await Promise.all([
    load("quellen"),
    load("berufe"),
    load("demografie"),
    load("schifffahrt"),
    load("geografie").catch(() => null),
    fetch(assetUrl("geo/land.json")).then((r) => r.json()),
  ]);
  echarts.registerMap("land", land);
  const data: Data = { quellen, berufe, demografie, schifffahrt, geografie };
  const steps = STEPS.filter((s) => s.era !== "Herkunft" || geografie);

  root.innerHTML = `
    <div class="scrolly">
      <div class="scrolly-stage"><p class="stage-title" id="stage-title"></p><div class="stage-chart" id="stage" role="img"></div></div>
      <div class="scrolly-steps">
        ${steps.map((s, i) => `
          <div class="step" data-step="${i}">
            <div class="step-card">
              <div class="step-era">${s.era}</div>
              <h3>${s.title}</h3>
              <p>${s.text(data)}</p>
            </div>
          </div>`).join("")}
      </div>
    </div>`;

  const stage = root.querySelector<HTMLElement>("#stage")!;
  const chart = echarts.init(stage, undefined, { renderer: "canvas" });
  let current = 0;
  const caption = root.querySelector<HTMLElement>("#stage-title")!;
  const show = (index: number) => {
    current = index;
    const t = tokens();
    const { title: heading, ...option } = steps[index].chart(data, t) as EChartsOption & { title?: { text?: string } };
    caption.textContent = heading?.text ?? "";
    chart.setOption({ ...baseOption(t), ...option }, { notMerge: true });
    stage.setAttribute("aria-label", `${steps[index].title}: ${caption.textContent}`);
    root.querySelectorAll(".step").forEach((el, i) => el.classList.toggle("is-active", i === index));
  };
  show(0);
  new ResizeObserver(() => chart.resize()).observe(stage);
  onThemeChange(() => show(current));

  const narrow = window.matchMedia("(max-width: 959px)").matches;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) show(Number((entry.target as HTMLElement).dataset.step));
      }
    },
    { rootMargin: narrow ? "-68% 0px -12% 0px" : "-45% 0px -45% 0px" },
  );
  root.querySelectorAll(".step").forEach((el) => observer.observe(el));
}

function sumBy(list: any[], key: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of list) map.set(r[key], (map.get(r[key]) ?? 0) + r.n);
  return map;
}

function sectorShare(d: Data, period: string, sector: number): number {
  return rows<any>(d.berufe.sektor_zeitraum).find((r) => r.zeitraum === period && r.sektor === sector)?.anteil ?? 0;
}

function grid() {
  return { left: 56, right: 24, top: 24, bottom: 40, containLabel: false };
}

function title(text: string, t: Tokens) {
  return { text, left: 0, top: 0, textStyle: { fontFamily: t.sans, fontSize: 13, fontWeight: 500 as const, color: t.ink2 } };
}

function yearlyBars(d: Data, t: Tokens, range: [number, number]): EChartsOption {
  const years = rows<any>(d.quellen.jahre).filter((y) => y.jahr >= range[0] && y.jahr <= range[1]);
  const gaps = (d.quellen.luecken as number[][]).filter((g) => g[1] >= range[0] && g[0] <= range[1]);
  const ax = axisStyle(t);
  return {
    title: title("Einträge je Jahr", t),
    grid: grid(),
    tooltip: { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: t.rule, opacity: 0.4 } }, valueFormatter: (v) => fmt(v as number) },
    xAxis: { type: "category", data: years.map((y) => String(y.jahr)), ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, interval: range[1] - range[0] > 60 ? 9 : 4 } },
    yAxis: { type: "value", ...ax, axisLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: (v: number) => fmt(v) } },
    series: [{
      type: "bar",
      name: "Einträge",
      data: years.map((y) => y.datensaetze),
      barCategoryGap: "20%",
      itemStyle: { color: t.series[0], borderRadius: [2, 2, 0, 0] },
      markArea: {
        silent: true,
        itemStyle: { color: t.rule, opacity: 0.45 },
        label: { color: t.ink3, fontSize: 11, position: "insideTop" },
        data: gaps.map((g) => [{ xAxis: String(Math.max(g[0], range[0])), name: g[1] - g[0] > 10 ? `${g[0]}–${g[1]}: keine Listen` : "" }, { xAxis: String(Math.min(g[1], range[1])) }]),
      },
    }],
  };
}

function sectorBars(d: Data, t: Tokens): EChartsOption {
  const shares = rows<any>(d.berufe.sektor_zeitraum).filter((r) => r.zeitraum !== "1830–1869");
  const periods = ["1907–1914", "1919–1929", "1930–1939"];
  const names = d.berufe.sektoren_kurz as Record<string, string>;
  const order = [1, 8, 2, 6, 9, 7, 3, 5, 4, 0];
  const highlight: Record<number, string> = Object.fromEntries([1, 8, 2, 6].map((s) => [s, sectorColor(names[s], t)]));
  return {
    title: title("Berufsbereiche der Auswanderer (KldB 2010), Anteil an allen Berufsangaben", t),
    grid: { left: 120, right: 24, top: 24, bottom: 64 },
    legend: { bottom: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: t.ink2, fontSize: 12 }, data: [1, 8, 2, 6].map((s) => names[s]).concat(["übrige Bereiche"]) },
    tooltip: { trigger: "item", formatter: (p: any) => `${p.seriesName}<br>${p.name}: ${pct(p.value, 1)}` },
    xAxis: { type: "value", max: 1, ...axisStyle(t), axisLabel: { ...axisStyle(t).axisLabel, formatter: (v: number) => pct(v) } },
    yAxis: { type: "category", data: periods.map((p) => `${PERIOD_LABELS[p]}\n${p}`), inverse: true, ...axisStyle(t), splitLine: { show: false } },
    series: order.map((sector) => ({
      type: "bar",
      stack: "s",
      name: highlight[sector] ? names[sector] : "übrige Bereiche",
      data: periods.map((p) => shares.find((r) => r.zeitraum === p && r.sektor === sector)?.anteil ?? 0),
      barWidth: "56%",
      itemStyle: { color: highlight[sector] ?? t.ruleStrong, borderColor: t.paper, borderWidth: 1 },
      emphasis: { focus: "series" },
    })),
  };
}

function sexRatio(d: Data, t: Tokens): EChartsOption {
  const years = rows<any>(d.demografie.jahre).filter((y) => y.n >= MIN_YEAR_SIZE);
  const ax = axisStyle(t);
  return {
    title: title("Männer je 100 Frauen (Jahre mit mindestens 1.000 Einträgen)", t),
    grid: grid(),
    tooltip: { trigger: "axis", valueFormatter: (v) => fmt(v as number) },
    xAxis: { type: "value", min: 1905, max: 1940, ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: (v: number) => String(v) } },
    yAxis: { type: "value", min: 0, ...ax, axisLine: { show: false } },
    series: [{
      type: "line",
      name: "Männer je 100 Frauen",
      data: years.map((y) => [y.jahr, y.maenner_je_100_frauen]),
      lineStyle: { width: 2, color: t.series[0] },
      itemStyle: { color: t.series[0] },
      symbolSize: 7,
      connectNulls: false,
      markLine: { silent: true, symbol: "none", lineStyle: { color: t.ink3, width: 1, type: "solid" }, label: { formatter: "ausgeglichen", color: t.ink3 }, data: [{ yAxis: 100 }] },
    }],
  };
}

function portArea(d: Data, t: Tokens): EChartsOption {
  const list = rows<any>(d.schifffahrt.haefen_jahr).filter((r) => r.jahr >= 1919);
  const years = [...new Set(list.map((r) => r.jahr))].sort();
  const totals = sumBy(list, "hafen");
  const ports = [...totals.entries()].filter(([p]) => p !== "Sonstige").sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p]) => p);
  const seriesNames = [...ports, "Sonstige"];
  const ax = axisStyle(t);
  return {
    title: title("Einträge je Jahr nach Ankunftshafen", t),
    grid: { ...grid(), bottom: 64 },
    legend: { bottom: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: t.ink2, fontSize: 12 } },
    tooltip: { trigger: "axis", valueFormatter: (v) => fmt(v as number) },
    xAxis: { type: "category", data: years.map(String), ...ax, splitLine: { show: false } },
    yAxis: { type: "value", ...ax, axisLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: (v: number) => fmt(v) } },
    series: seriesNames.map((port, i) => ({
      type: "bar",
      stack: "p",
      name: port,
      data: years.map((y) => (port === "Sonstige"
        ? list.filter((r) => r.jahr === y && !ports.includes(r.hafen)).reduce((s, r) => s + r.n, 0)
        : list.find((r) => r.jahr === y && r.hafen === port)?.n ?? 0)),
      itemStyle: { color: port === "Sonstige" ? t.ruleStrong : t.series[i], borderColor: t.paper, borderWidth: 1 },
      barCategoryGap: "18%",
      emphasis: { focus: "series" },
    })),
  };
}

function seasonLines(d: Data, t: Tokens): EChartsOption {
  const kinds = [["Überfahrt", "Auswanderer und übrige Reisende"], ["US-Staatsangehörige", "US-Staatsangehörige"]];
  const ax = axisStyle(t);
  return {
    title: title(`Monatsindex (1 = Monatsmittel), Jahre ${d.quellen.saison.jahre[0]}–${d.quellen.saison.jahre.at(-1)} mit mindestens zehn belegten Monaten`, t),
    grid: { ...grid(), bottom: 64 },
    legend: { bottom: 0, left: 0, itemWidth: 14, itemHeight: 2, textStyle: { color: t.ink2, fontSize: 12 } },
    tooltip: { trigger: "axis", valueFormatter: (v) => fmt2(v as number) },
    xAxis: { type: "category", data: MONTHS_SHORT, ...ax, splitLine: { show: false } },
    yAxis: { type: "value", min: 0, ...ax, axisLine: { show: false } },
    series: kinds.map(([key, label], i) => ({
      type: "line",
      name: label,
      data: d.quellen.saison_nach_reiseart[key].monate.map((m: any) => m.index),
      lineStyle: { width: 2, color: t.series[i] },
      itemStyle: { color: t.series[i] },
      symbolSize: 7,
      smooth: false,
      markLine: i === 0 ? { silent: true, symbol: "none", lineStyle: { color: t.ink3, width: 1, type: "solid" }, label: { show: false }, data: [{ yAxis: 1 }] } : undefined,
    })),
  };
}

function fmt2(v: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(v);
}

function medianAge(d: Data, t: Tokens): EChartsOption {
  const years = rows<any>(d.demografie.jahre).filter((y) => y.n >= MIN_YEAR_SIZE && y.median_alter != null);
  const ax = axisStyle(t);
  return {
    title: title("Mittleres Alter (Median) der Auswanderer, Jahre mit mindestens 1.000 Einträgen", t),
    grid: grid(),
    tooltip: { trigger: "axis", valueFormatter: (v) => `${fmt(v as number)} Jahre` },
    xAxis: { type: "value", min: 1905, max: 1940, ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: (v: number) => String(v) } },
    yAxis: { type: "value", min: 15, max: 45, ...ax, axisLine: { show: false } },
    series: [{
      type: "line",
      name: "Median",
      data: years.map((y) => [y.jahr, y.median_alter]),
      lineStyle: { width: 2, color: t.series[1] },
      itemStyle: { color: t.series[1] },
      symbolSize: 7,
      step: "middle",
    }],
  };
}

function groupBars(d: Data, t: Tokens): EChartsOption {
  const list = rows<any>(d.demografie.gruppen_zeitraum).filter((r) => r.zeitraum !== "1830–1869");
  const periods = ["1907–1914", "1919–1929", "1930–1939"];
  const types: [string, string][] = [["allein", "allein"], ["zu zweit", "zu zweit"], ["Familie/Gruppe 3+", "Gruppe ab drei"]];
  return {
    title: title("Anteil der Auswanderer nach rekonstruierter Reisegruppe", t),
    grid: { left: 120, right: 24, top: 24, bottom: 56 },
    legend: { bottom: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: t.ink2, fontSize: 12 } },
    tooltip: { trigger: "item", formatter: (p: any) => `${p.seriesName}<br>${p.name.replace("\n", " ")}: ${pct(p.value, 1)}` },
    xAxis: { type: "value", max: 1, ...axisStyle(t), axisLabel: { ...axisStyle(t).axisLabel, formatter: (v: number) => pct(v) } },
    yAxis: { type: "category", data: periods.map((p) => `${PERIOD_LABELS[p]}\n${p}`), inverse: true, ...axisStyle(t), splitLine: { show: false } },
    series: types.map(([key, label], i) => ({
      type: "bar",
      stack: "g",
      name: label,
      data: periods.map((p) => list.find((r) => r.zeitraum === p && r.gruppe_typ === key)?.anteil ?? 0),
      barWidth: "56%",
      itemStyle: { color: [t.ruleStrong, t.series[2], t.series[1]][i], borderColor: t.paper, borderWidth: 1 },
      label: { show: true, color: i === 0 ? t.ink : "#fff", formatter: (p: any) => (p.value > 0.08 ? pct(p.value) : ""), fontSize: 12 },
    })),
  };
}

function centroidMap(d: Data, t: Tokens): EChartsOption {
  const c = rows<any>(d.geografie?.schwerpunkte_jahr);
  return {
    title: title("Mittelpunkt der Herkunftsorte in Europa je Jahr", t),
    geo: {
      map: "land",
      roam: false,
      center: [15, 50],
      zoom: 15,
      silent: true,
      itemStyle: { areaColor: t.land, borderColor: t.landLine, borderWidth: 0.6 },
    },
    visualMap: {
      type: "continuous",
      min: c.length ? c[0].jahr : 1907,
      max: c.length ? c[c.length - 1].jahr : 1939,
      dimension: 2,
      inRange: { color: [t.sequential[2], t.sequential[5]] },
      text: ["später", "früher"],
      textStyle: { color: t.ink2 },
      right: 0,
      bottom: 0,
      itemHeight: 90,
      calculable: false,
    },
    tooltip: { trigger: "item", formatter: (p: any) => `${p.value[2]}<br>${fmt(p.value[3])} geokodierte Einträge` },
    series: [
      {
        type: "scatter",
        coordinateSystem: "geo",
        data: c.map((r) => [r.lon, r.lat, r.jahr, r.n]),
        symbolSize: 9,
        itemStyle: { borderColor: t.paper, borderWidth: 2 },
        label: { show: true, formatter: (p: any) => ([c[0]?.jahr, c[c.length - 1]?.jahr].includes(p.value[2]) ? String(p.value[2]) : ""), position: "right", color: t.ink, fontSize: 12 },
      },
    ],
  };
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
