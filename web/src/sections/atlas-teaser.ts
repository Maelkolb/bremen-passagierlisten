import { CHAPTERS } from "../atlas/chapters";
import { assetUrl, load } from "../data";
import { fmt } from "../format";
import { tokens } from "../theme";

const BOUNDS = { west: -10, east: 40, south: 37, north: 59 };
const YEAR_MS = 220;

export async function renderAtlasTeaser(root: HTMLElement): Promise<void> {
  const kapitel = await load("atlas/kapitel");
  root.innerHTML = `
    <div class="atlas-band-grid">
      <a class="atlas-figure" href="atlas.html" aria-label="Atlas öffnen">
        <canvas id="atlas-teaser-canvas" role="img" aria-label="Herkunftsorte der Reisenden, Jahr für Jahr"></canvas>
        <span class="atlas-figure-year" id="atlas-teaser-year" aria-hidden="true"></span>
      </a>
      <div class="atlas-band-text">
        <h2 class="section-title">Atlas der Auswanderung</h2>
        <p class="section-lede">${fmt(kapitel.alle.orte)} Herkunftsorte, ${fmt(kapitel.alle.ziele)} Reiseziele und ${fmt(kapitel.alle.korridore)} wiederkehrende Wege, mit Zeitleiste und Namenssuche.</p>
        <ol class="chapter-list" aria-label="Rundgang">
          ${CHAPTERS.map((c, i) => `<li><a href="atlas.html#kapitel=${i + 1}">${c.title}</a></li>`).join("")}
        </ol>
        <a class="button" href="atlas.html">Atlas öffnen</a>
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
  const height = canvas.clientHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(ratio, ratio);
  const midLat = ((BOUNDS.north + BOUNDS.south) / 2) * (Math.PI / 180);
  const spanX = (BOUNDS.east - BOUNDS.west) * Math.cos(midLat);
  const spanY = BOUNDS.north - BOUNDS.south;
  const scale = Math.max(width / spanX, height / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const project = (lon: number, lat: number): [number, number] => [offsetX + (lon - BOUNDS.west) * Math.cos(midLat) * scale, offsetY + (BOUNDS.north - lat) * scale];
  const t = tokens();
  const drawLand = () => {
    ctx.fillStyle = t.sea;
    ctx.fillRect(0, 0, width, height);
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
    ctx.fillStyle = t.origin;
    ctx.strokeStyle = t.paper;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.72;
    totals.forEach((n, i) => {
      if (!n) return;
      const [x, y] = project(basis.orte.lon[i], basis.orte.lat[i]);
      if (x < 0 || y < 0 || x > width || y > height) return;
      ctx.beginPath();
      ctx.arc(x, y, 0.7 + 9 * Math.sqrt(n / (max * 4)), 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    const [bx, by] = project(8.807, 53.076);
    ctx.fillStyle = t.paper;
    ctx.beginPath();
    ctx.arc(bx, by, 6, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = t.ink;
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, 2 * Math.PI);
    ctx.fill();
    ctx.font = `600 13px ${t.sans}`;
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = t.land;
    ctx.strokeText("Bremen", bx + 9, by);
    ctx.fillText("Bremen", bx + 9, by);
  };
  const step = () => {
    const year = years[index];
    for (const k of byYear.get(year) ?? []) totals[basis.zaehlung.i[k]] += basis.zaehlung.n[k];
    label.textContent = String(year);
    index += 1;
    draw();
    if (index < years.length) window.setTimeout(step, reduced ? 0 : YEAR_MS);
  };
  step();
}
