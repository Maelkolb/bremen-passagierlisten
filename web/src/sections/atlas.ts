import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ArcLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import { assetUrl, load, rows } from "../data";
import { escapeHtml, fmt } from "../format";
import { onThemeChange, tokens } from "../theme";

interface Places {
  name: string[];
  lat: number[];
  lon: number[];
}

interface Counts {
  i: number[];
  jahr: number[];
  sektor: number[];
  n: number[];
}

interface Point {
  name: string;
  position: [number, number];
  n: number;
}

interface Filter {
  year: number | null;
  sector: number | null;
  layers: Set<string>;
}

const PLAY_INTERVAL_MS = 900;

function rgb(hex: string, alpha = 255): [number, number, number, number] {
  const value = hex.replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16), alpha];
}

function aggregate(places: Places | undefined, counts: Counts | undefined, filter: Filter): Point[] {
  if (!places || !counts) return [];
  const sums = new Float64Array(places.name.length);
  for (let k = 0; k < counts.n.length; k++) {
    if (filter.year !== null && counts.jahr[k] !== filter.year) continue;
    if (filter.sector !== null && counts.sektor[k] !== filter.sector) continue;
    sums[counts.i[k]] += counts.n[k];
  }
  const points: Point[] = [];
  sums.forEach((n, i) => {
    if (n > 0) points.push({ name: places.name[i], position: [places.lon[i], places.lat[i]], n });
  });
  return points.sort((a, b) => b.n - a.n);
}

export async function renderAtlas(root: HTMLElement): Promise<void> {
  const [atlas, geografie] = await Promise.all([load("atlas"), load("geografie").catch(() => null)]);
  const sectors = atlas.sektoren as Record<string, string>;
  const years = [...new Set<number>(atlas.hafen_zaehlung.jahr)].sort((a, b) => a - b);
  const corridors = rows<any>(geografie?.korridore);
  const hasOrigins = Boolean(atlas.herkunft);
  const hasTargets = Boolean(atlas.ziele);

  root.innerHTML = `
    <div class="control-row mb-4">
      <div class="field" style="flex:1 1 280px">
        <span>Abfahrtsjahr <strong id="atlas-year-label" class="text-[var(--ink)]">alle Jahre</strong></span>
        <div class="flex items-center gap-3">
          <button class="button secondary" id="atlas-play" type="button" aria-label="Jahre abspielen">Abspielen</button>
          <input type="range" id="atlas-year" min="0" max="${years.length}" value="${years.length}" step="1" aria-label="Abfahrtsjahr" />
        </div>
      </div>
      <label class="field" style="flex:0 1 260px">
        <span>Berufsbereich (KldB 2010)</span>
        <select class="select" id="atlas-sector">
          <option value="">alle</option>
          ${Object.entries(sectors).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join("")}
          <option value="-1">ohne Angabe</option>
        </select>
      </label>
      <fieldset class="flex flex-wrap gap-4 border-0 p-0 m-0">
        <legend class="sr-only">Ebenen</legend>
        ${hasOrigins ? `<label class="check"><input type="checkbox" value="herkunft" checked /> Herkunftsorte</label>` : ""}
        <label class="check"><input type="checkbox" value="haefen" checked /> Ankunftshäfen</label>
        ${hasTargets ? `<label class="check"><input type="checkbox" value="ziele" /> Reiseziele</label>` : ""}
        ${corridors.length ? `<label class="check"><input type="checkbox" value="korridore" /> Kettenmigration</label>` : ""}
      </fieldset>
    </div>
    <div class="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div class="map" id="atlas-map"><div class="map-tooltip" id="atlas-tip" hidden></div></div>
      <aside class="text-sm" id="atlas-side" aria-live="polite"></aside>
    </div>
    <p class="muted text-sm mt-3 mb-0" id="atlas-note"></p>
  `;

  const filter: Filter = { year: null, sector: null, layers: new Set(["herkunft", "haefen"]) };
  const tip = root.querySelector<HTMLElement>("#atlas-tip")!;
  const container = root.querySelector<HTMLElement>("#atlas-map")!;
  const t0 = tokens();
  const map = new maplibregl.Map({
    container,
    attributionControl: false,
    dragRotate: false,
    renderWorldCopies: false,
    style: {
      version: 8,
      sources: { land: { type: "geojson", data: assetUrl("geo/land.json") } },
      layers: [
        { id: "sea", type: "background", paint: { "background-color": t0.sea } },
        { id: "land", type: "fill", source: "land", paint: { "fill-color": t0.land } },
        { id: "coast", type: "line", source: "land", paint: { "line-color": t0.landLine, "line-width": 0.6 } },
      ],
    },
    bounds: [[-100, -38], [48, 62]],
    fitBoundsOptions: { padding: 20 },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.scrollZoom.disable();
  container.addEventListener("click", () => map.scrollZoom.enable(), { once: true });
  const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
  map.addControl(overlay as unknown as maplibregl.IControl);

  const hover = (info: PickingInfo) => {
    const object = info.object as (Point & { label?: string }) | undefined;
    if (!object) {
      tip.hidden = true;
      return;
    }
    tip.hidden = false;
    tip.style.left = `${info.x + 12}px`;
    tip.style.top = `${info.y + 12}px`;
    tip.innerHTML = object.label ?? `${escapeHtml(object.name)}<br><strong>${fmt(object.n)}</strong> Einträge`;
  };

  const render = () => {
    const t = tokens();
    const origins = aggregate(atlas.herkunft, atlas.herkunft_zaehlung, filter);
    const ports = aggregate(atlas.haefen, atlas.hafen_zaehlung, filter);
    const targets = aggregate(atlas.ziele, atlas.ziel_zaehlung, filter);
    const bremen: [number, number] = [atlas.bremen.lon, atlas.bremen.lat];
    const maxOf = (list: Point[]) => Math.max(1, ...list.map((p) => p.n));
    const originMax = maxOf(origins);
    const portMax = maxOf(ports);
    const targetMax = maxOf(targets);
    const layers: any[] = [];
    if (filter.layers.has("herkunft")) {
      layers.push(new ScatterplotLayer<Point>({
        id: "herkunft",
        data: origins,
        getPosition: (d) => d.position,
        getRadius: (d) => 1.5 + 18 * Math.sqrt(d.n / originMax),
        radiusUnits: "pixels",
        getFillColor: rgb(t.brass, 150),
        getLineColor: rgb(t.paper, 200),
        lineWidthUnits: "pixels",
        getLineWidth: 0.5,
        stroked: true,
        pickable: true,
        onHover: hover,
        updateTriggers: { getRadius: [originMax], getFillColor: [t.brass] },
      }));
    }
    if (filter.layers.has("haefen")) {
      layers.push(new ArcLayer<Point>({
        id: "routen",
        data: ports,
        getSourcePosition: () => bremen,
        getTargetPosition: (d) => d.position,
        getWidth: (d) => 0.8 + 9 * Math.sqrt(d.n / portMax),
        getSourceColor: (d) => rgb(t.series[0], 60 + Math.round(170 * Math.sqrt(d.n / portMax))),
        getTargetColor: (d) => rgb(t.series[2], 80 + Math.round(170 * Math.sqrt(d.n / portMax))),
        getHeight: 0.6,
        greatCircle: false,
        pickable: true,
        onHover: hover,
        updateTriggers: { getWidth: [portMax], getSourceColor: [t.series[0], portMax], getTargetColor: [t.series[2], portMax] },
      }));
      layers.push(new ScatterplotLayer<Point>({
        id: "haefen",
        data: ports,
        getPosition: (d) => d.position,
        getRadius: (d) => 3 + 7 * Math.sqrt(d.n / portMax),
        radiusUnits: "pixels",
        getFillColor: rgb(t.series[2], 230),
        getLineColor: rgb(t.paper, 255),
        lineWidthUnits: "pixels",
        getLineWidth: 1.5,
        stroked: true,
        pickable: true,
        onHover: hover,
        updateTriggers: { getRadius: [portMax] },
      }));
    }
    if (filter.layers.has("ziele")) {
      layers.push(new ScatterplotLayer<Point>({
        id: "ziele",
        data: targets,
        getPosition: (d) => d.position,
        getRadius: (d) => 1.5 + 14 * Math.sqrt(d.n / targetMax),
        radiusUnits: "pixels",
        getFillColor: rgb(t.series[4], 150),
        getLineColor: rgb(t.paper, 200),
        lineWidthUnits: "pixels",
        getLineWidth: 0.5,
        stroked: true,
        pickable: true,
        onHover: hover,
        updateTriggers: { getRadius: [targetMax] },
      }));
    }
    if (filter.layers.has("korridore")) {
      const zMax = Math.max(1, ...corridors.map((c) => c.y));
      layers.push(new ArcLayer<any>({
        id: "korridore",
        data: corridors.map((c) => ({
          ...c,
          label: `${escapeHtml(c.herkunft_ort)} → ${escapeHtml(c.ziel_ort_gruppe)}<br><strong>${fmt(c.y)}</strong> Reisegruppen, ${fmt(c.personen)} Personen<br>${c.erstes_jahr}–${c.letztes_jahr}, ${c.jahre} Jahrgänge${c.haeufigster_beruf ? `<br>häufigster Beruf: ${escapeHtml(c.haeufigster_beruf)}` : ""}`,
        })),
        getSourcePosition: (d: any) => [d.herkunft_lon, d.herkunft_lat],
        getTargetPosition: (d: any) => [d.ziel_lon, d.ziel_lat],
        getWidth: (d: any) => 1 + 5 * Math.sqrt(d.y / zMax),
        getSourceColor: rgb(t.brass, 230),
        getTargetColor: rgb(t.series[4], 230),
        getHeight: 0.35,
        pickable: true,
        onHover: hover,
      }));
    }
    overlay.setProps({ layers });
    renderSide(root.querySelector("#atlas-side")!, origins, ports, targets, filter);
  };

  const yearInput = root.querySelector<HTMLInputElement>("#atlas-year")!;
  const yearLabel = root.querySelector<HTMLElement>("#atlas-year-label")!;
  const setYear = (index: number) => {
    filter.year = index >= years.length ? null : years[index];
    yearLabel.textContent = filter.year === null ? "alle Jahre" : String(filter.year);
    yearInput.value = String(index);
    render();
  };
  yearInput.addEventListener("input", () => setYear(Number(yearInput.value)));
  root.querySelector<HTMLSelectElement>("#atlas-sector")!.addEventListener("change", (e) => {
    const value = (e.target as HTMLSelectElement).value;
    filter.sector = value === "" ? null : Number(value);
    render();
  });
  root.querySelectorAll<HTMLInputElement>("fieldset input").forEach((box) => {
    if (box.checked) filter.layers.add(box.value);
    else filter.layers.delete(box.value);
    box.addEventListener("change", () => {
      if (box.checked) filter.layers.add(box.value);
      else filter.layers.delete(box.value);
      render();
    });
  });

  let timer: number | null = null;
  const play = root.querySelector<HTMLButtonElement>("#atlas-play")!;
  play.addEventListener("click", () => {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
      play.textContent = "Abspielen";
      return;
    }
    play.textContent = "Anhalten";
    let index = filter.year === null ? 0 : years.indexOf(filter.year);
    setYear(index);
    timer = window.setInterval(() => {
      index += 1;
      if (index >= years.length) {
        window.clearInterval(timer!);
        timer = null;
        play.textContent = "Abspielen";
        setYear(years.length);
        return;
      }
      setYear(index);
    }, PLAY_INTERVAL_MS);
  });

  map.on("load", render);
  onThemeChange(() => {
    const t = tokens();
    map.setPaintProperty("sea", "background-color", t.sea);
    map.setPaintProperty("land", "fill-color", t.land);
    map.setPaintProperty("coast", "line-color", t.landLine);
    render();
  });

  const note = root.querySelector<HTMLElement>("#atlas-note")!;
  note.textContent = hasOrigins
    ? "Auswanderer und übrige Reisende ohne US-Staatsangehörigkeit und ohne Kreuzfahrten. Herkunftsorte geokodiert gegen GeoNames, nur Einträge mit Ortsgenauigkeit. Kettenmigration: Herkunft-Ziel-Paare, die in mindestens drei Jahrgängen wiederkehren und signifikant überdurchschnittlich häufig sind."
    : "Auswanderer und übrige Reisende ohne US-Staatsangehörigkeit und ohne Kreuzfahrten.";
}

function renderSide(side: HTMLElement, origins: Point[], ports: Point[], targets: Point[], filter: Filter): void {
  const list = (title: string, points: Point[], limit: number) => {
    if (!points.length) return "";
    const total = points.reduce((s, p) => s + p.n, 0);
    return `
      <h3 class="text-base mt-0 mb-2">${title}</h3>
      <table class="data-table mb-6"><tbody>
        ${points.slice(0, limit).map((p) => `<tr style="cursor:default"><td>${escapeHtml(p.name)}</td><td class="num">${fmt(p.n)}</td></tr>`).join("")}
        <tr style="cursor:default"><td class="muted">insgesamt</td><td class="num muted">${fmt(total)}</td></tr>
      </tbody></table>`;
  };
  side.innerHTML =
    (filter.layers.has("herkunft") ? list("Herkunftsorte", origins, 8) : "") +
    list("Ankunftshäfen", ports, 6) +
    (filter.layers.has("ziele") ? list("Reiseziele", targets, 6) : "");
}
