import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ArcLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import type { PickingInfo } from "@deck.gl/core";
import { assetUrl } from "../data";
import { escapeHtml, fmt, pct } from "../format";
import { tokens, type Tokens } from "../theme";
import { BREMEN } from "./geo";
import type { CorridorView, HerkunftView, KettenView, LensView, PlacePoint, SelectionView, WandelView, WegeView, ZieleView } from "./lenses";
import type { Flow } from "./source";

export type RGBA = [number, number, number, number];

export const VIEWS = {
  europa: [[-11, 36], [44, 61]] as [[number, number], [number, number]],
  mitteleuropa: [[2, 45.5], [26, 56.5]] as [[number, number], [number, number]],
  osteuropa: [[12, 43], [50, 58]] as [[number, number], [number, number]],
  atlantik: [[-118, -42], [42, 64]] as [[number, number], [number, number]],
  nordatlantik: [[-100, 25], [30, 60]] as [[number, number], [number, number]],
  welt: [[-125, -45], [150, 66]] as [[number, number], [number, number]],
};

export const CATEGORY_SLOTS: Record<string, number> = {
  Orden: 4,
  Landwirtschaft: 5,
  "Handwerk und Industrie": 2,
  "Handel und Büro": 3,
  "Haushalt und Pflege": 0,
};

export function rgb(hex: string, alpha = 255): RGBA {
  const value = hex.trim().replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16), alpha];
}

function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return [0, 1, 2, 3].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGBA;
}

export function diverging(t: Tokens, value: number, alpha = 220): RGBA {
  const clamped = Math.max(-1, Math.min(1, value));
  const mid = rgb(t.ruleStrong, alpha);
  return clamped < 0 ? mix(mid, rgb(t.series[0], alpha), -clamped) : mix(mid, rgb(t.series[7], alpha), clamped);
}

export function categoryColor(t: Tokens, category: string, alpha = 220): RGBA {
  const slot = CATEGORY_SLOTS[category];
  return slot === undefined ? rgb(t.ink3, alpha) : rgb(t.series[slot], alpha);
}

function graticule() {
  const features = [];
  for (let lon = -180; lon <= 180; lon += 10) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 33 }, (_, i) => [lon, -80 + i * 5]) } });
  for (let lat = -80; lat <= 80; lat += 10) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]) } });
  return { type: "FeatureCollection", features };
}

export interface MapHandlers {
  selectPlace: (kind: "herkunft" | "ziel", point: PlacePoint) => void;
  selectCorridor: (id: number) => void;
  clear: () => void;
}

type Box = [number, number, number, number];

export class MapView {
  map: maplibregl.Map;
  private placed: Box[] = [];
  private last: LensView | null = null;
  private overlay: MapboxOverlay;
  private tooltip: HTMLElement;
  private ready: Promise<void>;

  constructor(container: HTMLElement, tooltip: HTMLElement, private handlers: MapHandlers) {
    const t = tokens();
    this.tooltip = tooltip;
    this.map = new maplibregl.Map({
      container,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      renderWorldCopies: false,
      minZoom: 1,
      maxZoom: 10,
      bounds: VIEWS.europa,
      fitBoundsOptions: { padding: 24 },
      style: {
        version: 8,
        sources: {
          land: { type: "geojson", data: assetUrl("geo/land.json") },
          seen: { type: "geojson", data: assetUrl("geo/seen.json") },
          fluesse: { type: "geojson", data: assetUrl("geo/fluesse.json") },
          netz: { type: "geojson", data: graticule() as any },
        },
        layers: [
          { id: "sea", type: "background", paint: { "background-color": t.sea } },
          { id: "netz", type: "line", source: "netz", paint: { "line-color": t.rule, "line-width": 0.6 } },
          { id: "land", type: "fill", source: "land", paint: { "fill-color": t.land } },
          { id: "seen", type: "fill", source: "seen", paint: { "fill-color": t.sea } },
          { id: "fluesse", type: "line", source: "fluesse", filter: ["<=", ["get", "scalerank"], 8], paint: { "line-color": t.river, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.3, 6, 1.1] } },
          { id: "coast", type: "line", source: "land", paint: { "line-color": t.landLine, "line-width": 0.6 } },
        ],
      },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    this.map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    this.map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Natural Earth, GeoNames" }), "bottom-right");
    this.overlay = new MapboxOverlay({ interleaved: false, layers: [], onClick: (info: PickingInfo) => { if (!info.object) this.handlers.clear(); } });
    this.map.addControl(this.overlay as unknown as maplibregl.IControl);
    this.ready = new Promise((resolve) => this.map.on("load", () => resolve()));
    this.map.on("moveend", () => this.last && this.render(this.last));
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  fly(view: keyof typeof VIEWS | [[number, number], [number, number]], duration = 1600, besideCard = false): void {
    const bounds = typeof view === "string" ? VIEWS[view] : view;
    const width = this.map.getContainer().clientWidth;
    const narrow = width < 700;
    const right = besideCard && !narrow ? Math.min(420, width * 0.4) : 20;
    this.map.fitBounds(bounds, { padding: { top: 30, bottom: narrow ? 220 : 30, left: 20, right }, duration, essential: true });
  }

  restyle(): void {
    const t = tokens();
    this.map.setPaintProperty("sea", "background-color", t.sea);
    this.map.setPaintProperty("netz", "line-color", t.rule);
    this.map.setPaintProperty("land", "fill-color", t.land);
    this.map.setPaintProperty("seen", "fill-color", t.sea);
    this.map.setPaintProperty("fluesse", "line-color", t.river);
    this.map.setPaintProperty("coast", "line-color", t.landLine);
  }

  render(view: LensView): void {
    const t = tokens();
    this.last = view;
    const bremen = this.map.project(BREMEN as [number, number]);
    this.placed = [[bremen.x - 8, bremen.y - 10, bremen.x + 70, bremen.y + 10]];
    const layers = [
      ...(view.kind === "herkunft" ? this.herkunft(view, t) : []),
      ...(view.kind === "ziele" ? this.ziele(view, t) : []),
      ...(view.kind === "wege" ? this.wege(view, t) : []),
      ...(view.kind === "ketten" ? this.ketten(view, t) : []),
      ...(view.kind === "wandel" ? this.wandel(view, t) : []),
      ...this.bremen(t),
    ];
    this.overlay.setProps({ layers });
  }

  private hover = (info: PickingInfo): boolean => {
    const object = info.object as any;
    const html = object ? (object.tip ?? (object.name ? `${escapeHtml(object.name)}<br><strong>${fmt(object.n)}</strong> Einträge` : null)) : null;
    if (!html) {
      this.tooltip.hidden = true;
      this.map.getCanvas().style.cursor = "";
      return true;
    }
    this.tooltip.hidden = false;
    this.tooltip.innerHTML = html;
    const width = this.tooltip.offsetWidth;
    const flip = info.x + 16 + width > this.map.getContainer().clientWidth;
    this.tooltip.style.left = `${flip ? info.x - width - 12 : info.x + 14}px`;
    this.tooltip.style.top = `${info.y + 14}px`;
    this.map.getCanvas().style.cursor = "pointer";
    return true;
  };

  private declutter(list: PlacePoint[], count: number, size: number): PlacePoint[] {
    const canvas = this.map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const accepted: PlacePoint[] = [];
    for (const p of list) {
      if (accepted.length >= count) break;
      if (p.name === "Bremen") continue;
      const { x, y } = this.map.project([p.lon, p.lat]);
      const half = (p.name.length * size * 0.56 + 8) / 2;
      const box: Box = [x - half, y - 14 - size, x + half, y - 8];
      if (box[0] < 0 || box[2] > width || box[1] < 0 || y > height) continue;
      if (this.placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      this.placed.push(box);
      accepted.push(p);
    }
    return accepted;
  }

  private labels(id: string, list: PlacePoint[], t: Tokens, count: number, size = 12) {
    return new TextLayer<PlacePoint>({
      id,
      data: this.declutter(list, count, size),
      getPosition: (d: PlacePoint) => [d.lon, d.lat],
      getText: (d: PlacePoint) => d.name,
      getSize: size,
      getColor: rgb(t.ink, 235),
      getPixelOffset: [0, -12],
      fontFamily: "Inter Variable, Inter, sans-serif",
      fontWeight: 500,
      characterSet: "auto",
      fontSettings: { sdf: true },
      outlineWidth: 4,
      outlineColor: rgb(t.paper, 230),
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
    });
  }

  private bremen(t: Tokens) {
    const data = [{ position: BREMEN, name: "Bremen" }];
    return [
      new ScatterplotLayer({ id: "bremen", data, getPosition: (d: any) => d.position, getRadius: 6, radiusUnits: "pixels", getFillColor: rgb(t.ink), getLineColor: rgb(t.paper), stroked: true, lineWidthUnits: "pixels", getLineWidth: 2 }),
      new TextLayer({ id: "bremen-label", data, getPosition: (d: any) => d.position, getText: (d: any) => d.name, getSize: 13, getColor: rgb(t.ink), getPixelOffset: [10, 0], getTextAnchor: "start", getAlignmentBaseline: "center", fontFamily: "Newsreader Variable, Georgia, serif", fontWeight: 600, characterSet: "auto", fontSettings: { sdf: true }, outlineWidth: 4, outlineColor: rgb(t.paper, 230) }),
    ];
  }

  private selection(selected: SelectionView | null, t: Tokens) {
    if (!selected) return [];
    const { selection, profile } = selected;
    const others = (profile?.counterparts ?? []).filter((c) => c.lat != null && c.lon != null);
    const max = Math.max(1, ...others.map((c) => c.n));
    const fromHere = selection.kind === "herkunft";
    return [
      new ArcLayer<any>({
        id: "auswahl-boegen",
        data: others.map((c) => ({ ...c, tip: `${escapeHtml(fromHere ? selection.name : c.name)} → ${escapeHtml(fromHere ? c.name : selection.name)}<br><strong>${fmt(c.n)}</strong> Einträge` })),
        getSourcePosition: (d: any) => (fromHere ? [selection.lon, selection.lat] : [d.lon, d.lat]),
        getTargetPosition: (d: any) => (fromHere ? [d.lon, d.lat] : [selection.lon, selection.lat]),
        getWidth: (d: any) => 1 + 6 * Math.sqrt(d.n / max),
        getSourceColor: rgb(t.brass, 230),
        getTargetColor: rgb(t.series[4], 230),
        getHeight: 0.45,
        pickable: true,
        onHover: this.hover,
      }),
      new ScatterplotLayer({
        id: "auswahl-ring",
        data: [selection],
        getPosition: (d: any) => [d.lon, d.lat],
        getRadius: 14,
        radiusUnits: "pixels",
        filled: false,
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: 2.5,
        getLineColor: rgb(t.ink),
      }),
      this.labels("auswahl-ziele-labels", others.map((c) => ({ name: c.name, extra: c.land, lat: c.lat, lon: c.lon, n: c.n })), t, 6, 11),
    ];
  }

  private herkunft(view: HerkunftView, t: Tokens) {
    const max = Math.max(1, ...view.points.map((p) => p.n));
    const layers: any[] = [];
    const pick = (info: PickingInfo) => {
      if (info.object) this.handlers.selectPlace("herkunft", info.object as PlacePoint);
      return true;
    };
    if (view.mode === "dichte") {
      layers.push(new HexagonLayer<PlacePoint>({
        id: "dichte",
        data: view.points,
        getPosition: (d) => [d.lon, d.lat],
        getColorWeight: (d) => d.n,
        colorAggregation: "SUM",
        colorScaleType: "quantile",
        colorRange: t.sequential.slice(1).map((c) => rgb(c).slice(0, 3)) as any,
        radius: 28000,
        coverage: 0.94,
        opacity: 0.9,
        extruded: false,
        pickable: true,
        onHover: (info: PickingInfo) => this.hover({ ...info, object: info.object ? { tip: `<strong>${fmt((info.object as any).colorValue)}</strong> Einträge im Umkreis von etwa 28 km` } : null } as PickingInfo),
      }));
    } else if (view.mode === "anteil") {
      const shown = view.points.filter((p) => p.lq !== undefined);
      const nMax = Math.max(1, ...shown.map((p) => p.n));
      layers.push(new ScatterplotLayer<PlacePoint>({
        id: "anteil",
        data: shown.map((p) => ({ ...p, tip: `${escapeHtml(p.name)}<br><strong>${fmt(p.n)}</strong> von ${fmt(p.base)} Einträgen<br>${p.lq! >= 1 ? fmt2(p.lq!) + "-fach überrepräsentiert" : "unterrepräsentiert (" + fmt2(p.lq!) + ")"}` })),
        getPosition: (d) => [d.lon, d.lat],
        getRadius: (d) => 2.5 + 14 * Math.sqrt(d.n / nMax),
        radiusUnits: "pixels",
        getFillColor: (d) => diverging(t, Math.log2(d.lq!) / 2),
        getLineColor: rgb(t.paper, 200),
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: 0.5,
        pickable: true,
        onHover: this.hover,
        onClick: pick,
        updateTriggers: { getFillColor: [t.series[0], t.series[7]], getRadius: [nMax] },
      }));
    } else {
      layers.push(new ScatterplotLayer<PlacePoint>({
        id: "orte",
        data: view.points,
        getPosition: (d) => [d.lon, d.lat],
        getRadius: (d) => 1.4 + 20 * Math.sqrt(d.n / max),
        radiusUnits: "pixels",
        getFillColor: rgb(t.brass, 150),
        getLineColor: rgb(t.paper, 210),
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: 0.6,
        pickable: true,
        onHover: this.hover,
        onClick: pick,
        updateTriggers: { getRadius: [max], getFillColor: [t.brass] },
        transitions: { getRadius: 400 },
      }));
    }
    if (view.mode !== "dichte") layers.push(this.labels("orte-labels", view.points, t, 10));
    return [...layers, ...this.selection(view.selected, t)];
  }

  private ziele(view: ZieleView, t: Tokens) {
    const portMax = Math.max(1, ...view.ports.map((p) => p.n));
    const destMax = Math.max(1, ...view.destinations.map((p) => p.n));
    const pick = (info: PickingInfo) => {
      if (info.object) this.handlers.selectPlace("ziel", info.object as PlacePoint);
      return true;
    };
    return [
      new ArcLayer<PlacePoint>({
        id: "routen",
        data: view.ports,
        getSourcePosition: () => BREMEN,
        getTargetPosition: (d) => [d.lon, d.lat],
        getWidth: (d) => 0.6 + 9 * Math.sqrt(d.n / portMax),
        getSourceColor: (d) => rgb(t.series[0], 50 + Math.round(170 * Math.sqrt(d.n / portMax))),
        getTargetColor: (d) => rgb(t.series[2], 70 + Math.round(170 * Math.sqrt(d.n / portMax))),
        getHeight: 0.55,
        pickable: true,
        onHover: (info: PickingInfo) => this.hover({ ...info, object: info.object ? { tip: `Bremen → ${escapeHtml((info.object as PlacePoint).name)}<br><strong>${fmt((info.object as PlacePoint).n)}</strong> Einträge` } : null } as PickingInfo),
        updateTriggers: { getWidth: [portMax], getSourceColor: [portMax, t.series[0]], getTargetColor: [portMax, t.series[2]] },
      }),
      new ScatterplotLayer<PlacePoint>({
        id: "ziele",
        data: view.destinations,
        getPosition: (d) => [d.lon, d.lat],
        getRadius: (d) => 1.6 + 16 * Math.sqrt(d.n / destMax),
        radiusUnits: "pixels",
        getFillColor: rgb(t.series[4], 165),
        getLineColor: rgb(t.paper, 210),
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: 0.6,
        pickable: true,
        onHover: this.hover,
        onClick: pick,
        updateTriggers: { getRadius: [destMax] },
      }),
      new ScatterplotLayer<PlacePoint>({
        id: "haefen",
        data: view.ports,
        getPosition: (d) => [d.lon, d.lat],
        getRadius: (d) => 3 + 6 * Math.sqrt(d.n / portMax),
        radiusUnits: "pixels",
        getFillColor: rgb(t.series[2], 240),
        getLineColor: rgb(t.paper, 255),
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: 1.5,
        pickable: true,
        onHover: (info: PickingInfo) => this.hover({ ...info, object: info.object ? { tip: `Ankunftshafen ${escapeHtml((info.object as PlacePoint).name)}<br><strong>${fmt((info.object as PlacePoint).n)}</strong> Einträge` } : null } as PickingInfo),
      }),
      this.labels("ziele-labels", view.destinations, t, 8),
      ...this.selection(view.selected, t),
    ];
  }

  private wege(view: WegeView, t: Tokens) {
    const max = Math.max(1, ...view.flows.map((f) => f.n));
    const data = view.flows.map((f) => ({ ...f, tip: `${escapeHtml(f.herkunft)} → ${escapeHtml(f.ziel)}<br><strong>${fmt(f.n)}</strong> Einträge` }));
    const ends = (key: "h" | "z") => {
      const map = new Map<string, PlacePoint>();
      for (const f of view.flows) {
        const name = key === "h" ? f.herkunft : f.ziel;
        const lat = key === "h" ? f.hlat : f.zlat;
        const lon = key === "h" ? f.hlon : f.zlon;
        const entry = map.get(name) ?? { name, extra: null, lat, lon, n: 0 };
        entry.n += f.n;
        map.set(name, entry);
      }
      return [...map.values()].sort((a, b) => b.n - a.n);
    };
    const origins = ends("h");
    const targets = ends("z");
    return [
      new ArcLayer<Flow & { tip: string }>({
        id: "wege",
        data,
        getSourcePosition: (d) => [d.hlon, d.hlat],
        getTargetPosition: (d) => [d.zlon, d.zlat],
        getWidth: (d) => 0.5 + 7 * Math.sqrt(d.n / max),
        getSourceColor: (d) => rgb(t.brass, 60 + Math.round(180 * Math.sqrt(d.n / max))),
        getTargetColor: (d) => rgb(t.series[4], 60 + Math.round(180 * Math.sqrt(d.n / max))),
        getHeight: 0.4,
        pickable: true,
        onHover: this.hover,
        updateTriggers: { getWidth: [max], getSourceColor: [max], getTargetColor: [max] },
      }),
      new ScatterplotLayer<PlacePoint>({ id: "wege-herkunft", data: origins, getPosition: (d) => [d.lon, d.lat], getRadius: 2.5, radiusUnits: "pixels", getFillColor: rgb(t.brass, 230), pickable: true, onHover: this.hover }),
      new ScatterplotLayer<PlacePoint>({ id: "wege-ziel", data: targets, getPosition: (d) => [d.lon, d.lat], getRadius: 3, radiusUnits: "pixels", getFillColor: rgb(t.series[4], 230), pickable: true, onHover: this.hover }),
      this.labels("wege-labels-h", origins, t, 6, 11),
      this.labels("wege-labels-z", targets, t, 6, 11),
    ];
  }

  private ketten(view: KettenView, t: Tokens) {
    const max = Math.max(1, ...view.corridors.map((c) => c.inWindow));
    const selected = view.selected;
    const tip = (c: CorridorView) => `${escapeHtml(c.herkunft)} → ${escapeHtml(c.ziel)}<br><strong>${fmt(c.gruppen)}</strong> Reisegruppen, ${fmt(c.personen)} Personen<br>${c.von}–${c.bis}, ${c.kategorie}${c.beruf ? `<br>häufigster Beruf: ${escapeHtml(c.beruf)}` : ""}`;
    const data = view.corridors.map((c) => ({ ...c, tip: tip(c) }));
    const fade = (c: CorridorView) => (selected && selected.id !== c.id ? 45 : 225);
    const layers: any[] = [
      new ArcLayer<CorridorView>({
        id: "ketten",
        data,
        getSourcePosition: (d) => [d.herkunft_lon, d.herkunft_lat],
        getTargetPosition: (d) => [d.ziel_lon, d.ziel_lat],
        getWidth: (d) => 0.8 + 6 * Math.sqrt(d.inWindow / max),
        getSourceColor: (d) => categoryColor(t, d.kategorie, fade(d)),
        getTargetColor: (d) => categoryColor(t, d.kategorie, fade(d)),
        getHeight: 0.35,
        pickable: true,
        onHover: this.hover,
        onClick: (info: PickingInfo) => {
          if (info.object) this.handlers.selectCorridor((info.object as CorridorView).id);
          return true;
        },
        updateTriggers: { getWidth: [max], getSourceColor: [selected?.id], getTargetColor: [selected?.id] },
      }),
    ];
    if (selected) {
      const ends = [
        { name: selected.herkunft, extra: null, lat: selected.herkunft_lat, lon: selected.herkunft_lon, n: selected.personen },
        { name: selected.ziel, extra: null, lat: selected.ziel_lat, lon: selected.ziel_lon, n: selected.personen },
      ];
      layers.push(
        new ScatterplotLayer<PlacePoint>({ id: "ketten-enden", data: ends, getPosition: (d) => [d.lon, d.lat], getRadius: 6, radiusUnits: "pixels", getFillColor: categoryColor(t, selected.kategorie, 255), getLineColor: rgb(t.paper), stroked: true, lineWidthUnits: "pixels", getLineWidth: 2 }),
        this.labels("ketten-labels", ends, t, 2, 13),
      );
    }
    return layers;
  }

  private wandel(view: WandelView, t: Tokens) {
    const maxDiff = Math.max(1e-6, ...view.cells.map((c) => Math.abs(c.diff)));
    const [a, b] = view.periods;
    const colorA = rgb(t.series[0]);
    const colorB = rgb(t.series[7]);
    const years = view.yearly;
    const first = years[0]?.year ?? 0;
    const last = years[years.length - 1]?.year ?? 1;
    const yearColor = (year: number) => mix(rgb(t.sequential[2]), rgb(t.sequential[5]), (year - first) / Math.max(1, last - first));
    return [
      new PolygonLayer<any>({
        id: "wandel-zellen",
        data: view.cells.map((c) => ({ ...c, tip: `Anteil ${a}: <strong>${pct(c.a / view.totals[0], 2)}</strong><br>Anteil ${b}: <strong>${pct(c.b / view.totals[1], 2)}</strong>` })),
        getPolygon: (d: any) => d.polygon,
        getFillColor: (d: any) => diverging(t, Math.sign(d.diff) * Math.sqrt(Math.abs(d.diff) / maxDiff), 200),
        stroked: false,
        pickable: true,
        onHover: this.hover,
        updateTriggers: { getFillColor: [maxDiff, t.series[0], t.series[7]] },
      }),
      new PolygonLayer<any>({
        id: "wandel-ellipsen",
        data: view.shapes,
        getPolygon: (d: any) => d.ring,
        filled: false,
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: 2,
        getLineColor: (d: any) => (d.period === a ? colorA : colorB),
      }),
      new PathLayer<any>({
        id: "wandel-pfad",
        data: [{ path: years.map((y) => [y.lon, y.lat]) }],
        getPath: (d: any) => d.path,
        getColor: rgb(t.ink, 160),
        getWidth: 1.5,
        widthUnits: "pixels",
      }),
      new ScatterplotLayer<any>({
        id: "wandel-schwerpunkte",
        data: years.map((y) => ({ ...y, tip: `Schwerpunkt ${y.year}<br>${fmt(y.n)} Einträge, Standarddistanz ${fmt(y.spreadKm)} km` })),
        getPosition: (d: any) => [d.lon, d.lat],
        getRadius: 5,
        radiusUnits: "pixels",
        getFillColor: (d: any) => yearColor(d.year),
        getLineColor: rgb(t.paper),
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: 1.5,
        pickable: true,
        onHover: this.hover,
      }),
      new TextLayer<any>({
        id: "wandel-jahre",
        data: years.filter((y) => y.year === first || y.year === last),
        getPosition: (d: any) => [d.lon, d.lat],
        getText: (d: any) => String(d.year),
        getSize: 13,
        getColor: rgb(t.ink),
        getPixelOffset: [0, -14],
        fontFamily: "Inter Variable, Inter, sans-serif",
        fontWeight: 600,
        fontSettings: { sdf: true },
        outlineWidth: 4,
        outlineColor: rgb(t.paper, 230),
      }),
    ];
  }
}

function fmt2(value: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value);
}
