import { literal } from "./db";
import { koelnerPhonetik, normalizedSurname } from "./phonetik";

const SIMILARITY = 0.9;

export const hasWildcard = (value: string) => /[*?]/.test(value);
export const toLike = (value: string) => value.replace(/[%_]/g, "").replace(/\*/g, "%").replace(/\?/g, "_");
export const contains = (value: string) => literal(hasWildcard(value) ? toLike(value) : `%${toLike(value)}%`);

function normalizedPattern(value: string): string {
  return value.split(/([*?])/).map((part) => (part === "*" || part === "?" ? part : normalizedSurname(part))).join("");
}

export function surnameCondition(name: string, similar: boolean): string {
  if (hasWildcard(name)) {
    return `(nachname ILIKE ${literal(toLike(name))} OR nachname_norm LIKE ${literal(toLike(normalizedPattern(name)))})`;
  }
  if (similar) {
    const code = koelnerPhonetik(name) ?? "";
    return `(phonetik = ${literal(code)} OR jaro_winkler_similarity(nachname_norm, ${literal(normalizedSurname(name))}) >= ${SIMILARITY})`;
  }
  return `nachname_norm = ${literal(normalizedSurname(name))}`;
}

export function occupationCondition(text: string): string {
  return `(beruf ILIKE ${contains(text)} OR beruf_norm ILIKE ${contains(text)})`;
}
