// All timestamps are "naive local" seconds from the backend, so format them as UTC.
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
});

export const fmtDate = (s: number) => (s ? dateFmt.format(new Date(s * 1000)) : "");
export const fmtMonth = (s: number) => (s ? monthFmt.format(new Date(s * 1000)) : "Unknown date");
export const fmtDateTime = (s: number) => (s ? dateTimeFmt.format(new Date(s * 1000)) : "");

export function fmtBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)}GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)}MB`;
  if (n >= 1 << 10) return `${Math.round(n / (1 << 10))}KB`;
  return `${n} bytes`;
}

export const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
