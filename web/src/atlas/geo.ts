export const BREMEN: [number, number] = [8.8071646, 53.0758196];

export function inEurope(lat: number, lon: number): boolean {
  return lat >= 34 && lat <= 72 && lon >= -25 && lon <= 45;
}
