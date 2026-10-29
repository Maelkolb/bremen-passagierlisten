import * as echarts from "echarts";
import { load, PERIOD_LABELS } from "../data";
import { fmt, pct } from "../format";
import { baseOption, onThemeChange, sectorColor, tokens, type Tokens } from "../theme";

interface Flow {
  zeitraum: string;
  sektor: string;
  niveau: string;
  hafen: string;
  n: number;
}

const FOLDED_SECTORS = ["Verkehr", "Naturwissenschaft", "Militär"];
const OTHER_SECTORS = "übrige Bereiche";
const SANKEY_LEFT = 0;
const SANKEY_RIGHT = 132;
const NODE_WIDTH = 10;
const LEVEL_ORDER = ["Helfer", "Fachkraft", "Spezialist", "Experte", "ohne Angabe"];

export async function renderSankey(root: HTMLElement): Promise<void> {
  const data = await load("sankey");
  const flows: Flow[] = data.fluesse.n.map((n: number, i: number) => ({
    zeitraum: data.fluesse.zeitraum[i],
    sektor: FOLDED_SECTORS.includes(data.fluesse.sektor[i]) ? OTHER_SECTORS : data.fluesse.sektor[i],
    niveau: data.fluesse.niveau[i],
    hafen: data.fluesse.hafen[i],
    n,
  })).filter((f: Flow) => f.zeitraum !== "1830–1869");
  const sectorTotals = new Map<string, number>();
  flows.forEach((f) => sectorTotals.set(f.sektor, (sectorTotals.get(f.sektor) ?? 0) + f.n));
  const sectorOrder = [...sectorTotals.entries()].filter(([s]) => s !== OTHER_SECTORS).sort((a, b) => b[1] - a[1]).map(([s]) => s).concat([OTHER_SECTORS]);

  root.innerHTML = `
    <div class="sankey-scroll"><div class="sankey-chart" id="sankey-chart" role="img" aria-label="Flussdiagramm vom Zeitraum über Berufsbereich und Anforderungsniveau zum Ankunftshafen"></div></div>
    <p class="caption">${fmt(flows.reduce((s, f) => s + f.n, 0))} Reisende 1907–1939 mit Berufsangabe, ohne US-Staatsangehörige. Berufsbereiche nach der Klassifikation der Berufe 2010. Ein Knoten unter dem Zeiger hebt seine Verbindungen hervor.</p>
  `;
  const element = root.querySelector<HTMLElement>("#sankey-chart")!;
  const chart = echarts.init(element);
  const draw = () => {
    const t = tokens();
    chart.setOption({ ...baseOption(t), ...option(flows, sectorOrder, t, element.clientWidth) }, { notMerge: true });
  };
  draw();
  new ResizeObserver(() => {
    chart.resize();
    draw();
  }).observe(element);
  onThemeChange(draw);
}

function option(flows: Flow[], sectorOrder: string[], t: Tokens, width: number) {
  const colorOf = new Map(sectorOrder.map((s) => [s, sectorColor(s, t)]));
  const links = new Map<string, { source: string; target: string; value: number }>();
  const add = (source: string, target: string, value: number) => {
    const key = `${source}→${target}`;
    const link = links.get(key) ?? { source, target, value: 0 };
    link.value += value;
    links.set(key, link);
  };
  const periodNode = (p: string) => `${PERIOD_LABELS[p] ?? p} ${p}`;
  for (const f of flows) {
    add(periodNode(f.zeitraum), f.sektor, f.n);
    add(f.sektor, f.niveau, f.n);
    add(f.niveau, f.hafen, f.n);
  }
  const total = flows.reduce((s, f) => s + f.n, 0);
  const periods = [...new Set(flows.map((f) => f.zeitraum))].sort();
  const sectors = sectorOrder.filter((s) => flows.some((f) => f.sektor === s));
  const levels = LEVEL_ORDER.filter((l) => flows.some((f) => f.niveau === l));
  const portTotals = new Map<string, number>();
  flows.forEach((f) => portTotals.set(f.hafen, (portTotals.get(f.hafen) ?? 0) + f.n));
  const ports = [...portTotals.entries()].sort((a, b) => (a[0] === "Sonstige Häfen" ? 1 : b[0] === "Sonstige Häfen" ? -1 : b[1] - a[1])).map(([p]) => p);
  const nodes = [
    ...periods.map((p) => ({ name: periodNode(p), itemStyle: { color: t.ink } })),
    ...sectors.map((s) => ({ name: s, itemStyle: { color: colorOf.get(s) } })),
    ...levels.map((l) => ({ name: l, itemStyle: { color: t.ink2 } })),
    ...ports.map((p) => ({ name: p, itemStyle: { color: t.ink3 } })),
  ];
  const linkList = [...links.values()].map((l) => ({
    ...l,
    lineStyle: { color: colorOf.get(l.target) ?? colorOf.get(l.source) ?? t.ruleStrong, opacity: 0.28 },
  }));
  return {
    tooltip: {
      trigger: "item",
      formatter: (p: any) => p.dataType === "edge"
        ? `${p.data.source} → ${p.data.target}<br><strong>${fmt(p.data.value)}</strong> Personen (${pct(p.data.value / total, 1)})`
        : `${p.name}<br><strong>${fmt(p.value)}</strong> Personen (${pct(p.value / total, 1)})`,
    },
    series: [{
      type: "sankey",
      left: SANKEY_LEFT,
      right: SANKEY_RIGHT,
      top: 30,
      bottom: 8,
      nodeWidth: NODE_WIDTH,
      nodeGap: 10,
      layoutIterations: 0,
      draggable: false,
      emphasis: { focus: "adjacency", lineStyle: { opacity: 0.62 } },
      label: { color: t.ink, fontSize: 12.5, fontFamily: t.sans },
      levels: [0, 1, 2, 3].map((depth) => ({ depth, label: { position: depth === 3 ? "right" : "right" } })),
      data: nodes,
      links: linkList,
    }],
    graphic: ["Zeitraum", "Berufsbereich", "Anforderungsniveau", "Ankunftshafen"].map((text, i) => ({
      type: "text",
      left: SANKEY_LEFT + (i * (width - SANKEY_LEFT - SANKEY_RIGHT - NODE_WIDTH)) / 3,
      top: 0,
      style: { text, fill: t.ink2, font: `500 12.5px ${t.sans}` },
    })),
  };
}
