import "./styles.css";
import "./bericht.css";
import { marked } from "marked";
import report from "../../FORSCHUNGSBERICHT_MAUS.md?raw";

const article = document.getElementById("bericht")!;
const toc = document.getElementById("toc")!;
article.innerHTML = await marked.parse(report);

const slug = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const headings = [...article.querySelectorAll<HTMLHeadingElement>("h2")];
headings.forEach((heading) => (heading.id = slug(heading.textContent ?? "")));
article.querySelectorAll("table").forEach((table) => {
  table.classList.add("ledger");
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  table.replaceWith(scroll);
  scroll.appendChild(table);
});
toc.innerHTML = `<p class="report-toc-title">Inhalt</p><ol>${headings.map((h) => `<li><a href="#${h.id}">${h.textContent}</a></li>`).join("")}</ol>`;

const links = new Map([...toc.querySelectorAll<HTMLAnchorElement>("a")].map((a) => [a.hash.slice(1), a]));
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    links.forEach((a, id) => a.toggleAttribute("aria-current", id === entry.target.id));
  }
}, { rootMargin: "0px 0px -70% 0px" });
headings.forEach((h) => observer.observe(h));
