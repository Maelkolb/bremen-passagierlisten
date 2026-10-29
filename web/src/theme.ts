import type { EChartsOption } from "echarts";

export interface Tokens {
  paper: string;
  surface: string;
  ink: string;
  ink2: string;
  ink3: string;
  rule: string;
  ruleStrong: string;
  accent: string;
  origin: string;
  destination: string;
  sea: string;
  land: string;
  landLine: string;
  river: string;
  series: string[];
  sequential: string[];
  serif: string;
  sans: string;
}

export function tokens(): Tokens {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    paper: read("--paper"),
    surface: read("--surface"),
    ink: read("--ink"),
    ink2: read("--ink-2"),
    ink3: read("--ink-3"),
    rule: read("--rule"),
    ruleStrong: read("--rule-strong"),
    accent: read("--accent"),
    origin: read("--origin"),
    destination: read("--destination"),
    sea: read("--sea"),
    land: read("--land"),
    landLine: read("--land-line"),
    river: read("--river"),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => read(`--s${i}`)),
    sequential: [0, 1, 2, 3, 4, 5].map((i) => read(`--seq-${i}`)),
    serif: read("--font-serif"),
    sans: read("--font-sans"),
  };
}

export function baseOption(t: Tokens): EChartsOption {
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: t.sans, color: t.ink2, fontSize: 12 },
    animationDuration: 700,
    animationDurationUpdate: 700,
    animationEasingUpdate: "cubicInOut",
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.ruleStrong,
      borderWidth: 1,
      padding: [6, 10],
      textStyle: { color: t.ink, fontSize: 13, fontFamily: t.sans },
      extraCssText: "border-radius:3px;box-shadow:none;",
    },
  };
}

export function axisStyle(t: Tokens) {
  return {
    axisLine: { lineStyle: { color: t.ruleStrong, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: t.ink3, fontSize: 11.5, fontFamily: t.sans },
    splitLine: { lineStyle: { color: t.rule, width: 1 } },
    nameTextStyle: { color: t.ink3, fontSize: 12 },
  };
}

const listeners = new Set<() => void>();

export function onThemeChange(listener: () => void): void {
  listeners.add(listener);
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => listeners.forEach((l) => l()));

const SECTOR_SLOTS: Record<string, number> = {
  "Hauswirtschaft, Soziales": 0,
  Landwirtschaft: 1,
  Produktion: 2,
  Handel: 3,
  "Kultur, Bildung": 4,
  Verwaltung: 5,
  Bau: 6,
};

export function sectorColor(name: string, t: Tokens): string {
  const slot = SECTOR_SLOTS[name];
  return slot === undefined ? t.ruleStrong : t.series[slot];
}
