const VOWELS = new Set("AEIJOUY");
const C_HARD_AT_START = new Set("AHKLOQRUX");
const C_HARD_INSIDE = new Set("AHKOQUX");
const FOLD: Record<string, string> = { Ä: "A", Ö: "O", Ü: "U", ß: "S", É: "E", È: "E", Á: "A", À: "A", Ó: "O", Ú: "U", Í: "I" };
const UMLAUT_FOLD: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", é: "e", è: "e", á: "a", ó: "o", í: "i", ú: "u" };

export function koelnerPhonetik(name: string): string | null {
  const upper = name.toUpperCase().replace(/[ÄÖÜßÉÈÁÀÓÚÍ]/g, (c) => FOLD[c] ?? c);
  const word = upper.replace(/[^A-Z]/g, "");
  if (!word) return null;
  let digits = "";
  for (let i = 0; i < word.length; i++) digits += letterCode(word, i);
  const collapsed = digits.replace(/(\d)\1+/g, "$1");
  return (collapsed.slice(0, 1) + collapsed.slice(1).replace(/0/g, "")) || null;
}

function letterCode(word: string, i: number): string {
  const letter = word[i];
  const before = i > 0 ? word[i - 1] : "";
  const after = i + 1 < word.length ? word[i + 1] : "";
  if (VOWELS.has(letter)) return "0";
  if (letter === "H") return "";
  if (letter === "B") return "1";
  if (letter === "P") return after === "H" ? "3" : "1";
  if (letter === "D" || letter === "T") return "CSZ".includes(after) && after ? "8" : "2";
  if ("FVW".includes(letter)) return "3";
  if ("GKQ".includes(letter)) return "4";
  if (letter === "C") {
    if (i === 0) return C_HARD_AT_START.has(after) ? "4" : "8";
    if (before === "S" || before === "Z") return "8";
    return C_HARD_INSIDE.has(after) ? "4" : "8";
  }
  if (letter === "X") return "CKQ".includes(before) && before ? "8" : "48";
  if (letter === "L") return "5";
  if (letter === "M" || letter === "N") return "6";
  if (letter === "R") return "7";
  if (letter === "S" || letter === "Z") return "8";
  return "";
}

export function normalizedSurname(name: string): string {
  return name
    .toLowerCase()
    .replace(/[äöüßéèáóíú]/g, (c) => UMLAUT_FOLD[c] ?? c)
    .replace(/[^a-z]/g, "");
}
