import { load, rows } from "../data";
import { fmt } from "../format";

interface YearRow {
  jahr: number;
  datensaetze: number;
}

const DURATION_MS = 5200;
const STRIP_HEIGHT = 72;

export async function renderHero(root: HTMLElement): Promise<void> {
  const [kennzahlen, quellen] = await Promise.all([load("kennzahlen"), load("quellen")]);
  const years = rows<YearRow>(quellen.jahre);
  const gap = (quellen.luecken as number[][]).reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));

  root.innerHTML = `
    <div class="grid gap-10 lg:grid-cols-[1fr_1.15fr] items-end">
      <div>
        <div class="figure-number text-[clamp(56px,9vw,112px)]" id="hero-count">0</div>
        <p class="mt-3 mb-0 text-[var(--ink-2)] max-w-[44ch]">Einträge aus den Bremer Passagierlisten, Jahr für Jahr, so wie sie überliefert sind.</p>
        <p class="mt-1 mb-0 text-sm text-[var(--ink-3)]">bis <span class="text-[var(--ink)]" id="hero-year">1830</span></p>
      </div>
      <figure class="m-0">
        <svg id="hero-strip" viewBox="0 0 ${years.length * 6} ${STRIP_HEIGHT + 22}" class="w-full h-auto" role="img" aria-label="Einträge je Jahr 1830 bis 1939"></svg>
      </figure>
    </div>
    <dl class="facts mt-12 mb-0" id="hero-facts"></dl>
    <div class="grid gap-8 md:grid-cols-[1fr_1fr] mt-12">
      <p class="serif text-[21px] leading-snug m-0">Jeder dieser Einträge wurde von Hand gelesen und abgeschrieben: von Ehrenamtlichen der <a href="https://www.die-maus-bremen.de/">MAUS – Gesellschaft für Familienforschung e. V. Bremen</a>, gemeinsam mit der Handelskammer Bremen und dem Staatsarchiv Bremen.</p>
      <p class="m-0 text-[var(--ink-2)]">Entstanden für die Familienforschung, ist die Abschrift zugleich eine Quelle für die Geschichte der Migration. Diese Seite gibt die Auswertung an die zurück, die sie möglich gemacht haben: als Reportage, als Atlas und als Werkbank, in der sich alle ${fmt(kennzahlen.datensaetze)} Einträge im Browser durchsuchen lassen.</p>
    </div>
  `;

  renderFacts(root.querySelector("#hero-facts")!, kennzahlen);
  const strip = root.querySelector<SVGSVGElement>("#hero-strip")!;
  const bars = drawStrip(strip, years, gap);
  animate(years, bars, root.querySelector("#hero-count")!, root.querySelector("#hero-year")!, kennzahlen.datensaetze);
}

function renderFacts(dl: HTMLElement, k: any): void {
  const facts: [string, number][] = [
    ["Jahrgänge mit Listen", k.jahre_mit_listen],
    ["Schiffe", k.schiffe],
    ["Überfahrten", k.reisen],
    ["Archivlisten", k.listen],
    ["Berufsbezeichnungen", k.berufe],
    [k.herkunftsorte ? "Herkunftsorte" : "Nachnamen", k.herkunftsorte ?? k.nachnamen],
  ];
  dl.innerHTML = facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${fmt(value)}</dd></div>`).join("");
}

function drawStrip(svg: SVGSVGElement, years: YearRow[], gap: number[]): SVGRectElement[] {
  const ns = "http://www.w3.org/2000/svg";
  const max = Math.max(...years.map((y) => y.datensaetze));
  const scale = (n: number) => (n === 0 ? 0 : Math.max(2, Math.sqrt(n / max) * STRIP_HEIGHT));
  const first = years[0].jahr;
  const gapX = (gap[0] - first) * 6;
  const gapW = (gap[1] - gap[0] + 1) * 6;
  svg.innerHTML = `
    <defs><pattern id="hatch" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><line x1="0" y1="0" x2="0" y2="5" stroke="var(--rule-strong)" stroke-width="1.2"/></pattern></defs>
    <rect x="${gapX}" y="0" width="${gapW}" height="${STRIP_HEIGHT}" fill="url(#hatch)" opacity="0.8"/>
    <text x="${gapX + gapW / 2}" y="${STRIP_HEIGHT / 2}" text-anchor="middle" font-size="9" fill="var(--ink-3)" font-family="var(--font-sans)">${gap[0]}–${gap[1]} keine Listen erhalten</text>
    <line x1="0" x2="${years.length * 6}" y1="${STRIP_HEIGHT}" y2="${STRIP_HEIGHT}" stroke="var(--rule-strong)" stroke-width="1"/>
  `;
  const bars = years.map((y, i) => {
    const rect = document.createElementNS(ns, "rect");
    const h = scale(y.datensaetze);
    rect.setAttribute("x", String(i * 6 + 1));
    rect.setAttribute("width", "4");
    rect.setAttribute("y", String(STRIP_HEIGHT - h));
    rect.setAttribute("height", String(h));
    rect.setAttribute("rx", "1");
    rect.setAttribute("fill", "var(--ink)");
    rect.setAttribute("opacity", "0.12");
    const title = document.createElementNS(ns, "title");
    title.textContent = `${y.jahr}: ${fmt(y.datensaetze)} Einträge`;
    rect.appendChild(title);
    svg.appendChild(rect);
    return rect;
  });
  const last = years[years.length - 1].jahr;
  for (const label of [first, 1850, 1870, 1890, 1910, last]) {
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", String((label - first) * 6 + 3));
    text.setAttribute("y", String(STRIP_HEIGHT + 16));
    text.setAttribute("text-anchor", label === first ? "start" : label === last ? "end" : "middle");
    text.setAttribute("font-size", "10");
    text.setAttribute("fill", "var(--ink-3)");
    text.setAttribute("font-family", "var(--font-sans)");
    text.textContent = String(label);
    svg.appendChild(text);
  }
  return bars;
}

function animate(years: YearRow[], bars: SVGRectElement[], counter: HTMLElement, yearLabel: HTMLElement, total: number): void {
  const cumulative: number[] = [];
  years.reduce((sum, y, i) => (cumulative[i] = sum + y.datensaetze), 0);
  const show = (index: number, fraction: number) => {
    const before = index > 0 ? cumulative[index - 1] : 0;
    const value = index >= years.length ? total : before + (cumulative[index] - before) * fraction;
    counter.textContent = fmt(Math.round(value));
    yearLabel.textContent = String(years[Math.min(index, years.length - 1)].jahr);
    bars.forEach((bar, i) => {
      bar.setAttribute("opacity", i < index || (i === index && fraction > 0) ? "1" : "0.12");
      bar.setAttribute("fill", i === index ? "var(--brass)" : "var(--ink)");
    });
  };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    show(years.length, 1);
    bars.forEach((bar) => bar.setAttribute("fill", "var(--ink)"));
    return;
  }
  const start = performance.now();
  const frame = (now: number) => {
    const progress = Math.min(1, (now - start) / DURATION_MS);
    const position = progress * years.length;
    const index = Math.min(years.length - 1, Math.floor(position));
    show(index, position - index);
    if (progress < 1) requestAnimationFrame(frame);
    else {
      counter.textContent = fmt(total);
      bars.forEach((bar) => bar.setAttribute("fill", "var(--ink)"));
    }
  };
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      observer.disconnect();
      requestAnimationFrame(frame);
    }
  });
  observer.observe(counter);
}
