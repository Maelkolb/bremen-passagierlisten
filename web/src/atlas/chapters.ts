import { fmt, pct } from "../format";
import type { FRAMES } from "./mapview";
import type { State } from "./state";

export interface Chapter {
  title: string;
  text: (k: any) => string;
  state: Partial<State>;
  frame: keyof typeof FRAMES;
  play?: boolean;
}

const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} und ${items[items.length - 1]}`);

export const CHAPTERS: Chapter[] = [
  {
    title: "Woher sie kamen",
    text: (k) => `${fmt(k.alle.eintraege)} Einträge lassen sich einem Herkunftsort zuordnen, ${fmt(k.alle.orte)} Orte in ${fmt(k.alle.laender)} heutigen Staaten. Die Karte füllt sich Jahr für Jahr, so wie die Listen überliefert sind.`,
    state: { view: "herkunft" },
    frame: "europa",
    play: true,
  },
  {
    title: "Vor 1914: aus dem Osten",
    text: (k) => `${pct(k.osten.anteil_osteuropa_vorkrieg)} der Herkunftsorte der Jahre 1907 bis 1914 liegen im heutigen Ost- und Südosteuropa, an der Spitze ${list(k.osten.regionen.map((r: any) => `${r.name} (${pct(r.anteil)})`))}. ${pct(k.osten.anteil_landwirtschaft_vorkrieg)} der Berufsangaben nennen die Landwirtschaft.`,
    state: { view: "herkunft", window: [1907, 1914] },
    frame: "osteuropa",
  },
  {
    title: "Nach 1919: aus dem Reich",
    text: (k) => `In den Zwanzigerjahren kommen ${pct(k.reich.anteil_de_zwanziger)} der Reisenden aus dem heutigen Deutschland, am häufigsten aus ${list(k.reich.regionen.map((r: any) => r.name))}. Zwischen ${k.schwerpunkt.von.jahr} und ${k.schwerpunkt.bis.jahr} rückt der Mittelpunkt aller Herkunftsorte um ${fmt(k.schwerpunkt.km)} km nach ${k.schwerpunkt.bis.lon < k.schwerpunkt.von.lon ? "Westen" : "Osten"}.`,
    state: { view: "herkunft", window: [1919, 1929] },
    frame: "mitteleuropa",
  },
  {
    title: "Schwestern für Amerika",
    text: (k) => `${fmt(k.orden.korridore)} Korridore der Kettenmigration werden überwiegend von Ordensleuten getragen, ${fmt(k.orden.personen)} Personen, darunter ${list(k.orden.beispiele.map((b: any) => `${b.herkunft} → ${b.ziel}`))}. Wahrscheinlich sind es Wege zwischen Mutterhäusern und ihren Niederlassungen in Nordamerika.`,
    state: { view: "ketten", category: "Orden" },
    frame: "nordatlantik",
  },
  {
    title: "Handwerk folgt Handwerk",
    text: (k) => `Andere Ketten folgen einem Gewerbe: ${list(k.gewerbe.beispiele.map((b: any) => `${b.herkunft} → ${b.ziel} (${b.beruf}, ${fmt(b.personen)} Personen)`))}.`,
    state: { view: "ketten", category: "Handwerk und Industrie" },
    frame: "nordatlantik",
  },
  {
    title: "1938 und 1939: Shanghai",
    text: (k) => {
      const late = k.shanghai["1938"] + k.shanghai["1939"];
      const ratio = late / Math.max(1, k.shanghai.vor_1938);
      return `${fmt(late)} Reisende nennen 1938 und 1939 Shanghai als Ziel, ${ratio >= 2 ? "mehr als doppelt so viele wie" : "mehr als"} in allen Jahren zuvor zusammen (${fmt(k.shanghai.vor_1938)}). Bei ${fmt(k.shanghai.mosaisch)} von ${fmt(k.shanghai.mit_religion)} mit Religionsangabe steht „mosaisch“. Sie kamen vor allem aus ${list(k.shanghai.herkunft.map((h: any) => h.name))}.`;
    },
    state: { view: "ziele", window: [1938, 1939] },
    frame: "welt",
  },
];
