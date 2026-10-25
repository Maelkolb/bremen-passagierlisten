import "./styles.css";
import { renderAtlas } from "./sections/atlas";
import { renderHero } from "./sections/hero";
import { renderQuellen } from "./sections/quellen";
import { renderReportage } from "./sections/reportage";
import { renderSankey } from "./sections/sankey";
import { renderWerkbank } from "./sections/werkbank";

const sections: [string, (root: HTMLElement) => Promise<void>][] = [
  ["hero", renderHero],
  ["reportage-body", renderReportage],
  ["atlas-body", renderAtlas],
  ["sankey-body", renderSankey],
  ["werkbank-body", renderWerkbank],
  ["quellen-body", renderQuellen],
];

for (const [id, render] of sections) {
  const root = document.getElementById(id);
  if (!root) continue;
  render(root).catch((error) => {
    console.error(error);
    root.innerHTML = `<p class="muted">Dieser Abschnitt konnte nicht geladen werden: ${String(error.message ?? error)}</p>`;
  });
}

const links = [...document.querySelectorAll<HTMLAnchorElement>("#nav a[href^='#']")];
const navObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    links.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === `#${entry.target.id}`)));
  }
}, { rootMargin: "-40% 0px -55% 0px" });
links.forEach((a) => {
  const target = document.querySelector(a.getAttribute("href")!);
  if (target) navObserver.observe(target);
});
