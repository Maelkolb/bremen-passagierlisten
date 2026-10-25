import * as echarts from "echarts";
import { load, rows } from "../data";
import { fmt, pct } from "../format";
import { axisStyle, baseOption, onThemeChange, tokens } from "../theme";

export async function renderQuellen(root: HTMLElement): Promise<void> {
  const quellen = await load("quellen");
  const fields: string[] = quellen.fehlwerte.spalten;
  const years = rows<any>(quellen.fehlwerte.jahre).filter((y) => y.n >= 100 && y.jahr <= 1939);
  const series = rows<any>(quellen.archivserien);
  const conflicts = quellen.datumskonflikte;
  const duplicates = quellen.dubletten;

  root.innerHTML = `
    <div class="grid gap-10 lg:grid-cols-[1fr_320px]">
      <figure class="m-0">
        <figcaption class="text-sm text-[var(--ink-2)] mb-2">Füllgrad der Felder je Jahrgang (Jahrgänge mit mindestens 100 Einträgen)</figcaption>
        <div class="h-[620px]" id="quellen-heatmap" role="img" aria-label="Füllgrad der Felder je Jahrgang"></div>
      </figure>
      <div class="text-[15px] flow">
        <p>Die Listen wurden zu verschiedenen Zeiten nach verschiedenen Formularen geführt. Was fehlt, fehlt meist für ganze Jahrgänge: Berufe werden nach 1914 seltener notiert, Lese- und Schreibfähigkeit, Bargeld und Angehörige nur auf den Formularen der US-Einwanderungsbehörde der Jahre 1935 bis 1937.</p>
        <p>${conflicts ? `Bei ${fmt(conflicts.zeilen)} Einträgen widerspricht das Abfahrtsdatum dem Datum im Archivkürzel; ${fmt(conflicts.korrigiert)} davon, eine Liste der <em>Merkur</em> vom Februar 1945, lassen sich sicher korrigieren.` : ""}
        ${duplicates ? ` ${fmt(duplicates.zeilen)} Einträge in ${fmt(duplicates.gruppen)} Gruppen stimmen in Name, Alter, Schiff und Datum überein, oft weil dieselbe Reise auf den Listen mehrerer Agenturen steht.` : ""}</p>
        <p><a href="bericht.html">Forschungsbericht</a> mit allen Methoden, Tests und Tabellen.</p>
      </div>
    </div>
    <figure class="m-0 mt-12">
      <figcaption class="text-sm text-[var(--ink-2)] mb-2">Einträge je Jahr nach Archivserie</figcaption>
      <div class="h-[320px]" id="quellen-series" role="img" aria-label="Einträge je Jahr nach Archivserie"></div>
    </figure>
  `;

  const heatmap = echarts.init(root.querySelector<HTMLElement>("#quellen-heatmap")!);
  const seriesChart = echarts.init(root.querySelector<HTMLElement>("#quellen-series")!);
  const draw = () => {
    const t = tokens();
    const ax = axisStyle(t);
    const cells: [number, number, number][] = [];
    years.forEach((y, xi) => fields.forEach((f, yi) => cells.push([xi, yi, y[f]])));
    heatmap.setOption({
      ...baseOption(t),
      grid: { left: 150, right: 16, top: 8, bottom: 72 },
      tooltip: { trigger: "item", formatter: (p: any) => `${years[p.value[0]].jahr}, ${fields[p.value[1]]}<br><strong>${pct(p.value[2])}</strong> gefüllt (${fmt(years[p.value[0]].n)} Einträge)` },
      xAxis: { type: "category", data: years.map((y) => String(y.jahr)), ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, rotate: 90, fontSize: 10 } },
      yAxis: { type: "category", data: fields, inverse: true, ...ax, splitLine: { show: false } },
      visualMap: { min: 0, max: 1, orient: "horizontal", left: 150, bottom: 0, itemWidth: 10, itemHeight: 160, inRange: { color: t.sequential }, text: ["100 %", "0 %"], textStyle: { color: t.ink2, fontSize: 11 }, calculable: false },
      series: [{ type: "heatmap", data: cells, itemStyle: { borderColor: t.paper, borderWidth: 1 }, emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } } }],
    }, { notMerge: true });

    const names = [...new Set(series.map((s) => s.serie))];
    const totals = new Map(names.map((n) => [n, series.filter((s) => s.serie === n).reduce((a, s) => a + s.n, 0)]));
    const ordered = names.sort((a, b) => totals.get(b)! - totals.get(a)!);
    const main = ordered.slice(0, 4);
    const allYears = Array.from({ length: 1939 - 1830 + 1 }, (_, i) => 1830 + i);
    const stacks = [...main, "übrige"];
    seriesChart.setOption({
      ...baseOption(t),
      grid: { left: 56, right: 16, top: 16, bottom: 56 },
      legend: { bottom: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: t.ink2, fontSize: 12 } },
      tooltip: { trigger: "axis", valueFormatter: (v: any) => fmt(v) },
      xAxis: { type: "category", data: allYears.map(String), ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, interval: 9 } },
      yAxis: { type: "value", ...ax, axisLine: { show: false }, axisLabel: { ...ax.axisLabel, formatter: (v: number) => fmt(v) } },
      series: stacks.map((name, i) => ({
        type: "bar",
        stack: "s",
        name,
        data: allYears.map((y) => series.filter((s) => s.jahr === y && (name === "übrige" ? !main.includes(s.serie) : s.serie === name)).reduce((a, s) => a + s.n, 0)),
        itemStyle: { color: name === "übrige" ? t.ruleStrong : t.series[i] },
        barCategoryGap: "15%",
      })),
    }, { notMerge: true });
  };
  draw();
  new ResizeObserver(() => {
    heatmap.resize();
    seriesChart.resize();
  }).observe(root);
  onThemeChange(draw);
}
