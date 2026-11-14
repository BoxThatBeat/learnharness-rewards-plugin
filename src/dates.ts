/** Local calendar dates as YYYY-MM-DD, with UTC arithmetic so DST cannot shift days. */

export function localDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  return new Date(toUtc(date)).getUTCDay();
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** Local date and hour of a timestamp (ms or ISO string); null when unparseable. */
export function localStamp(value: unknown): { date: string; hour: number } | null {
  const time = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time) || time <= 0) return null;
  const date = new Date(time);
  return { date: localDate(date), hour: date.getHours() };
}
