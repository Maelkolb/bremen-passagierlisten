const integer = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const twoDecimals = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmt = (value: number | null | undefined): string => (value == null ? "–" : integer.format(value));
export const fmt1 = (value: number | null | undefined): string => (value == null ? "–" : oneDecimal.format(value));
export const fmt2 = (value: number | null | undefined): string => (value == null ? "–" : twoDecimals.format(value));
export const pct = (share: number | null | undefined, digits = 0): string =>
  share == null ? "–" : `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(share * 100)} %`;

export function escapeHtml(text: string | null | undefined): string {
  if (text == null) return "";
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}
