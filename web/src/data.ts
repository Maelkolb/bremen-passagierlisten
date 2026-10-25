export type Columns = Record<string, (string | number | boolean | null)[]>;

export function rows<T = Record<string, any>>(columns: Columns | null | undefined): T[] {
  if (!columns) return [];
  const names = Object.keys(columns);
  const length = names.length ? columns[names[0]].length : 0;
  const out: T[] = [];
  for (let i = 0; i < length; i++) {
    const row: Record<string, unknown> = {};
    for (const name of names) row[name] = columns[name][i];
    out.push(row as T);
  }
  return out;
}

const cache = new Map<string, Promise<any>>();

export function load<T = any>(name: string): Promise<T> {
  if (!cache.has(name)) {
    const url = new URL(`data/${name}.json`, document.baseURI).href;
    cache.set(name, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${name}.json: ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(name)!;
}

export function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

export const PERIOD_LABELS: Record<string, string> = {
  "1830–1869": "Segelschiffzeit",
  "1907–1914": "Vorkriegsjahre",
  "1919–1929": "Zwanziger Jahre",
  "1930–1939": "Dreißiger Jahre",
};
