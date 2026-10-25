import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ArcLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import { assetUrl } from "../data";
import { escapeHtml, fmt } from "../format";
import { tokens, type Tokens } from "../theme";
import { BREMEN } from "./geo";
import type { AtlasView, CorridorView, HerkunftView, KettenView, PlacePoint, SelectionView, ZieleView } from "./views";

export type RGBA = [number, number, number, number];
type Bounds = [[number, number], [number, number]];
type Box = [number, number, number, number];

export const FRAMES = {
  europa: [[-11, 36], [44, 61]] as Bounds,
  mitteleuropa: [[2, 45.5], [26, 56.5]] as Bounds,
  osteuropa: [[12, 43], [50, 58]] as Bounds,
  atlantik: [[-118, -42], [42, 64]] as Bounds,
  nordatlantik: [[-100, 25], [30, 60]] as Bounds,
  welt: [[-125, -45], [150, 66]] as Bounds,
};

const CATEGORY_SLOTS: Record<string, number> = {
  Orden: 4,
  Landwirtschaft: 5,
  "Handwerk und Industrie": 2,
  "Handel und Büro": 3,
  "Haushalt und Pflege": 0,
};

const MAX_RADIUS = 22;
const MIN_RADIUS = 1.2;
const FIT_MAX_ZOOM = 5.5;
const ROUTES = 16;
const LABELS = 9;

export function rgb(hex: string, alpha = 255): RGBA {
  const value = hex.trim().replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16), alpha];
}

export function css(color: RGBA): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${(color[3] / 255).toFixed(2)})`;
}

export function categoryColor(t: Tokens, category: string, alpha = 255): RGBA {
  const slot = CATEGORY_SLOTS[category];
  return slot === undefined ? rgb(t.ink3, alpha) : rgb(t.series[slot], alpha);
}

export function placeRadius(n: number, max: number): number {
  return MIN_RADIUS + MAX_RADIUS * Math.sqrt(n / Math.max(1, max));
}

export function viewColor(t: Tokens, kind: "herkunft" | "ziele"): string {
  return kind === "herkunft" ? t.brass : t.series[4];
}

export interface MapHandlers {
  selectPlace: (kind: "herkunft" | "ziel", point: PlacePoint) => void;
  selectCorridor: (id: number) => void;
  clear: () => void;
}

export class MapView {
  map: maplibregl.Map;
  private placed: Box[] = [];
  private last: AtlasView | null = null;
  private overlay: MapboxOverlay;
  private ready: Promise<void>;

  constructor(container: HTMLElement, private tooltip: HTMLElement, private handlers: MapHandlers) {
    const t = tokens();
    this.map = new maplibregl.Map({
      container,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      renderWorldCopies: false,
      minZoom: 1,
      maxZoom: 10,
      bounds: FRAMES.europa,
      fitBoundsOptions: { padding: 24 },
      style: {
        version: 8,
        sources: {
          land: { type: "geojson", data: assetUrl("geo/land.json") },
          seen: { type: "geojson", data: assetUrl("geo/seen.json") },
          fluesse: { type: "geojson", data: assetUrl("geo/fluesse.json") },
        },
        layers: [
          { id: "sea", type: "background", paint: { "background-color": t.sea } },
          { id: "land", type: "fill", source: "land", paint: { "fill-color": t.land } },
          { id: "seen", type: "fill", source: "seen", paint: { "fill-color": t.sea } },
          { id: "fluesse", type: "line", source: "fluesse", filter: ["<=", ["get", "scalerank"], 7], paint: { "line-color": t.river, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.3, 6, 1] } },
          { id: "coast", type: "line", source: "land", paint: { "line-color": t.landLine, "line-width": 0.6 } },
        ],
      },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    this.map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Natural Earth, GeoNames" }), "bottom-right");
    this.overlay = new MapboxOverlay({ interleaved: false, layers: [], onClick: (info: PickingInfo) => { if (!info.object) this.handlers.clear(); } });
    this.map.addControl(this.overlay as unknown as maplibregl.IControl);
    this.ready = new Promise((resolve) => this.map.on("load", () => resolve()));
    this.map.once("load", () => container.querySelector(".maplibregl-compact-show")?.classList.remove("maplibregl-compact-show"));
    this.map.on("moveend", () => this.last && this.render(this.last));
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  fly(frame: keyof typeof FRAMES, duration = 1600, besideCard = false): void {
    const width = this.map.getContainer().clientWidth;
    const narrow = width < 700;
    const right = besideCard && !narrow ? Math.min(400, width * 0.38) : 24;
    this.map.fitBounds(FRAMES[frame], { padding: { top: narrow && besideCard ? 220 : 24, bottom: 24, left: 24, right }, duration, essential: true });
  }

  reveal(points: [number, number][]): void {
    if (!points.length) return;
    const bounds = this.map.getBounds();
    if (points.every(([lon, lat]) => bounds.contains([lon, lat]))) return;
    const lons = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    const narrow = this.map.getContainer().clientWidth < 700;
    this.map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], {
      padding: { top: 90, bottom: 60, left: narrow ? 30 : 60, right: narrow ? 30 : 60 },
      maxZoom: FIT_MAX_ZOOM,
      duration: 1200,
      essential: true,
    });
  }

  restyle(): void {
    const t = tokens();
    this.map.setPaintProperty("sea", "background-color", t.sea);
    this.map.setPaintProperty("land", "fill-color", t.land);
    this.map.setPaintProperty("seen", "fill-color", t.sea);
    this.map.setPaintProperty("fluesse", "line-color", t.river);
    this.map.setPaintProperty("coast", "line-color", t.landLine);
  }

  render(view: AtlasView): void {
    const t = tokens();
    this.last = view;
    const bremen = this.map.project(BREMEN);
    this.placed = [[bremen.x - 8, bremen.y - 10, bremen.x + 64, bremen.y + 10]];
    const layers = [
      ...(view.kind === "herkunft" ? this.herkunft(view, t) : []),
      ...(view.kind === "ziele" ? this.ziele(view, t) : []),
      ...(view.kind === "ketten" ? this.ketten(view, t) : []),
      ...this.bremen(t),
    ];
    this.overlay.setProps({ layers });
  }

  private hover = (info: PickingInfo): boolean => {
    const object = info.object as any;
    const html = object ? object.tip ?? `<strong>${escapeHtml(object.name)}</strong>${fmt(object.n)} Einträge` : null;
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

  private labels(id: string, list: PlacePoint[], t: Tokens, count = LABELS, size = 12) {
    return new TextLayer<PlacePoint>({
      id,
      data: this.declutter(list, count, size),
      getPosition: (d: PlacePoint) => [d.lon, d.lat],
      getText: (d: PlacePoint) => d.name,
      getSize: size,
      getColor: rgb(t.ink, 235),
      getPixelOffset: [0, -10],
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
      new ScatterplotLayer({ id: "bremen", data, getPosition: (d: any) => d.position, getRadius: 5, radiusUnits: "pixels", getFillColor: rgb(t.ink), getLineColor: rgb(t.paper), stroked: true, lineWidthUnits: "pixels", getLineWidth: 2 }),
      new TextLayer({ id: "bremen-label", data, getPosition: (d: any) => d.position, getText: (d: any) => d.name, getSize: 14, getColor: rgb(t.ink), getPixelOffset: [10, 0], getTextAnchor: "start", getAlignmentBaseline: "center", fontFamily: "Newsreader Variable, Georgia, serif", fontWeight: 600, characterSet: "auto", fontSettings: { sdf: true }, outlineWidth: 4, outlineColor: rgb(t.paper, 230) }),
    ];
  }

  private places(id: string, list: PlacePoint[], color: string, selected: SelectionView | null, t: Tokens, onClick: (p: PlacePoint) => void) {
    const max = list[0]?.n ?? 1;
    const dim = selected !== null;
    return new ScatterplotLayer<PlacePoint>({
      id,
      data: list,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => placeRadius(d.n, max),
      radiusUnits: "pixels",
      getFillColor: rgb(color, dim ? 28 : 175),
      getLineColor: rgb(t.paper, dim ? 30 : 190),
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 0.5,
      pickable: true,
      onHover: this.hover,
      onClick: (info: PickingInfo) => {
        if (info.object) onClick(info.object as PlacePoint);
        return true;
      },
      updateTriggers: { getRadius: [max], getFillColor: [color, dim], getLineColor: [t.paper, dim] },
    });
  }

  private selection(selected: SelectionView | null, from: string, to: string, t: Tokens) {
    if (!selected) return [];
    const { selection, profile } = selected;
    const others = (profile?.counterparts ?? []).filter((c) => c.lat != null && c.lon != null);
    const max = Math.max(1, ...others.map((c) => c.n));
    const outward = selection.kind === "herkunft";
    const here: [number, number] = [selection.lon, selection.lat];
    return [
      new ArcLayer<any>({
        id: "auswahl-boegen",
        data: others.map((c) => ({ ...c, tip: `<strong>${escapeHtml(outward ? `${selection.name} → ${c.name}` : `${c.name} → ${selection.name}`)}</strong>${fmt(c.n)} Einträge` })),
        getSourcePosition: (d: any) => (outward ? here : [d.lon, d.lat]),
        getTargetPosition: (d: any) => (outward ? [d.lon, d.lat] : here),
        getWidth: (d: any) => 1.2 + 6 * Math.sqrt(d.n / max),
        getSourceColor: rgb(from, 235),
        getTargetColor: rgb(to, 235),
        getHeight: 0.45,
        pickable: true,
        onHover: this.hover,
      }),
      new ScatterplotLayer<any>({
        id: "auswahl-enden",
        data: others,
        getPosition: (d: any) => [d.lon, d.lat],
        getRadius: (d: any) => 2.5 + 4 * Math.sqrt(d.n / max),
        radiusUnits: "pixels",
        getFillColor: rgb(outward ? to : from, 255),
        getLineColor: rgb(t.paper),
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: 1.2,
      }),
      new ScatterplotLayer({
        id: "auswahl-ring",
        data: [selection],
        getPosition: () => here,
        getRadius: 11,
        radiusUnits: "pixels",
        getFillColor: rgb(outward ? from : to, 255),
        getLineColor: rgb(t.paper),
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: 2.5,
      }),
      this.labels("auswahl-labels", [{ name: selection.name, land: null, lat: selection.lat, lon: selection.lon, n: Infinity }, ...others.map((c) => ({ ...c }))], t, 7, 12),
    ];
  }

  private herkunft(view: HerkunftView, t: Tokens) {
    const color = viewColor(t, "herkunft");
    return [
      this.places("herkunft", view.points, color, view.selected, t, (p) => this.handlers.selectPlace("herkunft", p)),
      ...(view.selected ? [] : [this.labels("herkunft-labels", view.points, t)]),
      ...this.selection(view.selected, color, viewColor(t, "ziele"), t),
    ];
  }

  private ziele(view: ZieleView, t: Tokens) {
    const color = viewColor(t, "ziele");
    const routes = view.ports.slice(0, ROUTES);
    const portMax = Math.max(1, routes[0]?.n ?? 1);
    const dim = view.selected !== null;
    const share = (d: PlacePoint) => Math.sqrt(d.n / portMax);
    return [
      new ArcLayer<PlacePoint>({
        id: "seewege",
        data: routes.map((p) => ({ ...p, tip: `<strong>Bremen → ${escapeHtml(p.name)}</strong>${fmt(p.n)} Einträge mit diesem Ankunftshafen` })),
        getSourcePosition: () => BREMEN,
        getTargetPosition: (d) => [d.lon, d.lat],
        getWidth: (d) => 0.8 + 7 * share(d),
        getSourceColor: (d) => rgb(t.series[0], dim ? 25 : 40 + Math.round(150 * share(d))),
        getTargetColor: (d) => rgb(t.series[0], dim ? 25 : 40 + Math.round(150 * share(d))),
        getHeight: 0.5,
        pickable: !dim,
        onHover: this.hover,
        updateTriggers: { getWidth: [portMax], getSourceColor: [portMax, dim, t.series[0]], getTargetColor: [portMax, dim, t.series[0]] },
      }),
      this.places("ziele", view.points, color, view.selected, t, (p) => this.handlers.selectPlace("ziel", p)),
      new ScatterplotLayer<PlacePoint>({
        id: "haefen",
        data: routes.map((p) => ({ ...p, tip: `<strong>Ankunftshafen ${escapeHtml(p.name)}</strong>${fmt(p.n)} Einträge` })),
        getPosition: (d) => [d.lon, d.lat],
        getRadius: 3.5,
        radiusUnits: "pixels",
        getFillColor: rgb(t.series[0], dim ? 80 : 255),
        getLineColor: rgb(t.paper),
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: 1.5,
        pickable: !dim,
        onHover: this.hover,
        updateTriggers: { getFillColor: [dim] },
      }),
      ...(view.selected ? [] : [this.labels("ziele-labels", view.points, t)]),
      ...this.selection(view.selected, viewColor(t, "herkunft"), color, t),
    ];
  }

  private ketten(view: KettenView, t: Tokens) {
    const max = Math.max(1, ...view.corridors.map((c) => c.inWindow));
    const selected = view.selected;
    const strength = (c: CorridorView) => Math.sqrt(c.inWindow / max);
    const tip = (c: CorridorView) => `<strong>${escapeHtml(c.herkunft)} → ${escapeHtml(c.ziel)}</strong>${fmt(c.inWindow)} Reisegruppen, ${c.von}–${c.bis}<br>${escapeHtml(c.beruf ?? c.kategorie)}`;
    const alpha = (c: CorridorView) => (selected ? (selected.id === c.id ? 255 : 24) : Math.round(30 + 220 * strength(c) ** 1.5));
    const layers: any[] = [
      new ArcLayer<CorridorView>({
        id: "ketten",
        data: [...view.corridors].reverse().map((c) => ({ ...c, tip: tip(c) })),
        getSourcePosition: (d) => [d.herkunft_lon, d.herkunft_lat],
        getTargetPosition: (d) => [d.ziel_lon, d.ziel_lat],
        getWidth: (d) => 0.6 + 5 * strength(d) + (selected?.id === d.id ? 2 : 0),
        getSourceColor: (d) => categoryColor(t, d.kategorie, alpha(d)),
        getTargetColor: (d) => categoryColor(t, d.kategorie, alpha(d)),
        getHeight: 0.25,
        pickable: true,
        onHover: this.hover,
        onClick: (info: PickingInfo) => {
          if (info.object) this.handlers.selectCorridor((info.object as CorridorView).id);
          return true;
        },
        updateTriggers: { getWidth: [max, selected?.id], getSourceColor: [max, selected?.id], getTargetColor: [max, selected?.id] },
      }),
    ];
    if (selected) {
      const ends: PlacePoint[] = [
        { name: selected.herkunft, land: selected.herkunft_land, lat: selected.herkunft_lat, lon: selected.herkunft_lon, n: 2 },
        { name: selected.ziel, land: selected.ziel_land, lat: selected.ziel_lat, lon: selected.ziel_lon, n: 1 },
      ];
      layers.push(
        new ScatterplotLayer<PlacePoint>({ id: "ketten-enden", data: ends, getPosition: (d) => [d.lon, d.lat], getRadius: 6, radiusUnits: "pixels", getFillColor: categoryColor(t, selected.kategorie), getLineColor: rgb(t.paper), stroked: true, lineWidthUnits: "pixels", getLineWidth: 2 }),
        this.labels("ketten-labels", ends, t, 2, 13),
      );
    }
    return layers;
  }
}
