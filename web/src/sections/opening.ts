import { load } from "../data";
import { escapeHtml, fmt } from "../format";

interface Line {
  id: number;
  nr: number | null;
  nachname: string | null;
  vorname: string | null;
  alter: number | null;
  beruf: string | null;
  wohnort: string | null;
  ziel: string | null;
  gruppe: number | null;
}

interface Excerpt {
  liste: string;
  schiff: string | null;
  abfahrt: string | null;
  jahr: number | null;
  hafen: string | null;
  eintraege: number;
  zeilen: Line[];
}

const PREVIOUS_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const NEXT_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const longDate = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export async function renderOpening(root: HTMLElement): Promise<void> {
  const [kennzahlen, excerpts] = await Promise.all([load("kennzahlen"), load<Excerpt[]>("listen")]);
  document.getElementById("opening-intro")!.innerHTML = `
    <p class="opening-intro">${fmt(kennzahlen.datensaetze)} Einträge aus ${fmt(kennzahlen.listen)} Listen von ${fmt(kennzahlen.schiffe)} Schiffen, Name für Name abgeschrieben von Ehrenamtlichen der <a href="https://www.die-maus-bremen.de/">MAUS – Gesellschaft für Familienforschung</a> in Bremen.</p>`;

  let index = Math.floor(Math.random() * excerpts.length);
  root.innerHTML = `
    <div class="excerpt-head">
      <div class="excerpt-voyage" aria-live="polite"></div>
      <div class="excerpt-nav">
        <button type="button" class="icon-button" data-step="-1" aria-label="Vorige Liste">${PREVIOUS_ICON}</button>
        <span class="excerpt-count"></span>
        <button type="button" class="icon-button" data-step="1" aria-label="Nächste Liste">${NEXT_ICON}</button>
      </div>
    </div>
    <div class="excerpt-sheet">
      <table class="ledger excerpt-table">
        <thead><tr><th class="num">Nr.</th><th>Name</th><th class="num">Alter</th><th class="excerpt-job">Beruf</th><th>Wohnort</th><th>Reiseziel</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <figcaption class="caption excerpt-caption"></figcaption>`;

  const show = () => {
    const excerpt = excerpts[index];
    root.querySelector(".excerpt-voyage")!.innerHTML = voyage(excerpt);
    root.querySelector(".excerpt-count")!.textContent = `${index + 1} von ${excerpts.length}`;
    root.querySelector("tbody")!.innerHTML = excerpt.zeilen.map((line, i) => row(line, i, excerpt.zeilen)).join("");
    root.querySelector(".excerpt-caption")!.textContent = `Die ersten ${excerpt.zeilen.length} von ${fmt(excerpt.eintraege)} Einträgen der Liste ${excerpt.liste}. Ein Name führt zur Reise im Atlas.`;
  };
  root.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((button) =>
    button.addEventListener("click", () => {
      index = (index + Number(button.dataset.step) + excerpts.length) % excerpts.length;
      show();
    }),
  );
  show();
}

function voyage(excerpt: Excerpt): string {
  const date = excerpt.abfahrt ? longDate.format(new Date(excerpt.abfahrt)) : String(excerpt.jahr ?? "");
  return `
    <p class="excerpt-ship">${escapeHtml(excerpt.schiff ?? "Schiff unbekannt")}</p>
    <p class="excerpt-route">ab Bremen ${date}${excerpt.hafen ? `, nach ${escapeHtml(excerpt.hafen)}` : ""}</p>`;
}

function row(line: Line, position: number, lines: Line[]): string {
  const sameGroup = (other: Line | undefined) => line.gruppe !== null && other?.gruppe === line.gruppe;
  const before = sameGroup(lines[position - 1]);
  const after = sameGroup(lines[position + 1]);
  const brace = before || after ? ` class="name grouped${before ? "" : " group-start"}${after ? "" : " group-end"}"` : ` class="name"`;
  const name = [line.nachname, line.vorname].filter(Boolean).join(", ") || "ohne Namen";
  const number = line.nr ?? position + 1;
  return `<tr>
    <td class="num${line.nr === null ? " derived" : ""}">${number}</td>
    <td${brace}><a href="atlas.html#eintrag=${line.id}">${escapeHtml(name)}</a></td>
    <td class="num">${line.alter ?? ""}</td>
    <td class="excerpt-job">${escapeHtml(line.beruf)}</td>
    <td>${escapeHtml(line.wohnort)}</td>
    <td>${escapeHtml(line.ziel)}</td>
  </tr>`;
}
