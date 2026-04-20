const HELSINKI = "Europe/Helsinki";

export function helsinkiToday(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: HELSINKI,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function helsinkiWeekRange(ref: Date = new Date()): { from: string; to: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: HELSINKI,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ref);
  const weekdayIdx = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
    parts.find((p) => p.type === "weekday")!.value,
  );
  const ymd = parts
    .filter((p) => ["year", "month", "day"].includes(p.type))
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  const anchor = Date.UTC(Number(ymd.year), Number(ymd.month) - 1, Number(ymd.day));
  const monday = new Date(anchor - weekdayIdx * 86400_000);
  const sunday = new Date(monday.getTime() + 6 * 86400_000);
  return { from: isoDate(monday), to: isoDate(sunday) };
}

export function addDays(isoYmd: string, days: number): string {
  const [y, m, d] = isoYmd.split("-").map(Number);
  return isoDate(new Date(Date.UTC(y!, m! - 1, d! + days)));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
