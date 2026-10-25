const EARTH_RADIUS_KM = 6371;
const RAD = Math.PI / 180;

export const BREMEN: [number, number] = [8.8071646, 53.0758196];
export const EUROPE = { lat: [34, 72], lon: [-25, 45] };

export function inEurope(lat: number, lon: number): boolean {
  return lat >= EUROPE.lat[0] && lat <= EUROPE.lat[1] && lon >= EUROPE.lon[0] && lon <= EUROPE.lon[1];
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export interface Weighted {
  lat: number;
  lon: number;
  w: number;
}

export interface Centroid {
  lat: number;
  lon: number;
  n: number;
  spreadKm: number;
}

export function centroid(points: Weighted[]): Centroid | null {
  let x = 0;
  let y = 0;
  let z = 0;
  let total = 0;
  for (const p of points) {
    const phi = p.lat * RAD;
    const lam = p.lon * RAD;
    x += p.w * Math.cos(phi) * Math.cos(lam);
    y += p.w * Math.cos(phi) * Math.sin(lam);
    z += p.w * Math.sin(phi);
    total += p.w;
  }
  if (total === 0) return null;
  const lat = Math.atan2(z, Math.hypot(x, y)) / RAD;
  const lon = Math.atan2(y, x) / RAD;
  let squared = 0;
  for (const p of points) squared += p.w * distanceKm(p.lat, p.lon, lat, lon) ** 2;
  return { lat, lon, n: total, spreadKm: Math.sqrt(squared / total) };
}

export function deviationEllipse(points: Weighted[], center: Centroid, steps = 72): [number, number][] {
  const kmPerDegLat = EARTH_RADIUS_KM * RAD;
  const kmPerDegLon = kmPerDegLat * Math.cos(center.lat * RAD);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let total = 0;
  for (const p of points) {
    const dx = (p.lon - center.lon) * kmPerDegLon;
    const dy = (p.lat - center.lat) * kmPerDegLat;
    sxx += p.w * dx * dx;
    syy += p.w * dy * dy;
    sxy += p.w * dx * dy;
    total += p.w;
  }
  sxx /= total;
  syy /= total;
  sxy /= total;
  const trace = sxx + syy;
  const root = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy ** 2);
  const major = Math.sqrt(Math.max(trace / 2 + root, 0));
  const minor = Math.sqrt(Math.max(trace / 2 - root, 0));
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const ex = major * Math.cos(t);
    const ey = minor * Math.sin(t);
    const dx = ex * Math.cos(angle) - ey * Math.sin(angle);
    const dy = ex * Math.sin(angle) + ey * Math.cos(angle);
    ring.push([center.lon + dx / kmPerDegLon, center.lat + dy / kmPerDegLat]);
  }
  return ring;
}

export const GRID = { lat: 0.5, lon: 0.75 };

export function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat / GRID.lat)}:${Math.floor(lon / GRID.lon)}`;
}

export function cellPolygon(key: string): [number, number][] {
  const [row, col] = key.split(":").map(Number);
  const south = row * GRID.lat;
  const west = col * GRID.lon;
  return [[west, south], [west + GRID.lon, south], [west + GRID.lon, south + GRID.lat], [west, south + GRID.lat], [west, south]];
}

export function weightedMedian(values: number[], weights: number[]): number | null {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const total = weights.reduce((s, w) => s + w, 0);
  if (total === 0) return null;
  let running = 0;
  for (const i of order) {
    running += weights[i];
    if (running >= total / 2) return values[i];
  }
  return values[order[order.length - 1]];
}
