import { CHAPTERS } from "../atlas/chapters";
import { assetUrl, load } from "../data";
import { fmt } from "../format";
import { tokens } from "../theme";

const BOUNDS = { west: -10, east: 40, south: 37, north: 59 };
const HEIGHT = 440;
const YEAR_MS = 220;

export async function renderAtlasTeaser(root: HTMLElement): Promise<void> {
  const kapitel = await load("atlas/kapitel");
  root.innerHTML = `
    <div class="grid gap-10 lg:grid-cols-[1.4fr_1fr] items-start">
      <figure class="m-0">
        <canvas id="atlas-teaser-canvas" class="w-full block" style="height:${HEIGHT}px;background:var(--sea);border:1px solid var(--rule)" role="img" aria-label="Herkunftsorte der Überfahrten, Jahr für Jahr"></canvas>
        <figcaption class="flex justify-between text-sm text-[var(--ink-3)] mt-2"><span>Herkunftsorte der Überfahrten, Jahr für Jahr</span><span id="atlas-teaser-year"></span></figcaption>
      </figure>
      <div>
        <p class="lede m-0">Woher die Reisenden kamen, wohin sie wollten und welche Wege sich Jahr für Jahr wiederholten: als eigene Karte mit Zeitleiste, Filtern bis zum Nachnamen und Profilen für jeden Ort.</p>
        <dl class="facts mt-8 mb-0" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          <div><dt>Herkunftsorte</dt><dd>${fmt(kapitel.alle.orte)}</dd></div>
          <div><dt>Reiseziele</dt><dd>${fmt(kapitel.alle.ziele)}</dd></div>
          <div><dt>Korridore</dt><dd>${fmt(kapitel.alle.korridore)}</dd></div>
        </dl>
        <h3 class="text-lg mt-8 mb-2">Rundgang</h3>
        <ol class="m-0 p-0 list-none">
          ${CHAPTERS.slice(0, -1).map((c, i) => `<li class="border-b border-[var(--rule)] py-2"><a href="atlas.html#kapitel=${i + 1}" class="flex gap-3" style="text-decoration:none"><span class="text-[var(--ink-3)] w-5">${i + 1}</span><span class="serif text-[18px]">${c.title}</span></a></li>`).join("")}
        </ol>
        <div class="flex gap-3 mt-8">
          <a class="button" href="atlas.html" style="text-decoration:none">Atlas öffnen</a>
          <a class="button secondary" href="atlas.html#kapitel=1" style="text-decoration:none">Rundgang starten</a>
        </div>
      </div>
    </div>`;
  const canvas = root.querySelector<HTMLCanvasElement>("#atlas-teaser-canvas")!;
  const yearLabel = root.querySelector<HTMLElement>("#atlas-teaser-year")!;
  const observer = new IntersectionObserver(async (entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    observer.disconnect();
    const [land, basis] = await Promise.all([fetch(assetUrl("geo/land.json")).then((r) => r.json()), load("atlas/basis")]);
    animate(canvas, yearLabel, land, basis);
  }, { rootMargin: "200px" });
  observer.observe(canvas);
}

function animate(canvas: HTMLCanvasElement, label: HTMLElement, land: any, basis: any): void {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  canvas.width = width * ratio;
  canvas.height = HEIGHT * ratio;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(ratio, ratio);
  const midLat = ((BOUNDS.north + BOUNDS.south) / 2) * (Math.PI / 180);
  const spanX = (BOUNDS.east - BOUNDS.west) * Math.cos(midLat);
  const spanY = BOUNDS.north - BOUNDS.south;
  const scale = Math.max(width / spanX, HEIGHT / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (HEIGHT - spanY * scale) / 2;
  const project = (lon: number, lat: number): [number, number] => [offsetX + (lon - BOUNDS.west) * Math.cos(midLat) * scale, offsetY + (BOUNDS.north - lat) * scale];
  const t = tokens();
  const drawLand = () => {
    ctx.fillStyle = t.sea;
    ctx.fillRect(0, 0, width, HEIGHT);
    ctx.fillStyle = t.land;
    ctx.strokeStyle = t.landLine;
    ctx.lineWidth = 0.6;
    for (const feature of land.features) {
      const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      for (const polygon of polygons) {
        ctx.beginPath();
        for (const ring of polygon) {
          ring.forEach(([lon, lat]: [number, number], i: number) => {
            const [x, y] = project(lon, lat);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.closePath();
        }
        ctx.fill("evenodd");
        ctx.stroke();
      }
    }
  };
  const years = [...new Set<number>(basis.zaehlung.jahr)].filter((y) => y >= 1907).sort((a, b) => a - b);
  const byYear = new Map<number, number[]>();
  basis.zaehlung.jahr.forEach((year: number, k: number) => {
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(k);
  });
  const totals = new Float64Array(basis.orte.name.length);
  const max = Math.max(...basis.zaehlung.n);
  let index = 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const draw = () => {
    drawLand();
    ctx.fillStyle = t.brass;
    ctx.globalAlpha = 0.55;
    totals.forEach((n, i) => {
      if (!n) return;
      const [x, y] = project(basis.orte.lon[i], basis.orte.lat[i]);
      if (x < 0 || y < 0 || x > width || y > HEIGHT) return;
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + 9 * Math.sqrt(n / (max * 4)), 0, 2 * Math.PI);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = t.ink;
    const [bx, by] = project(8.807, 53.076);
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, 2 * Math.PI);
    ctx.fill();
  };
  const step = () => {
    const year = years[index];
    for (const k of byYear.get(year) ?? []) totals[basis.zaehlung.i[k]] += basis.zaehlung.n[k];
    label.textContent = `bis ${year}`;
    index += 1;
    draw();
    if (index < years.length) window.setTimeout(step, reduced ? 0 : YEAR_MS);
  };
  step();
}
