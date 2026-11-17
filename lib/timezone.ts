/** Instants stay real instants; only parsing/display/calendar math apply Singapore's UTC+8. */
export const TIMEZONE = "Asia/Singapore";
export function getSingaporeNow() {
  return new Date();
}
export function parseSingaporeDate(value: string) {
  return new Date(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
      ? value
      : `${value.length === 10 ? value + "T00:00:00" : value}+08:00`,
  );
}
export function singaporeISO(date = getSingaporeNow()) {
  return (
    new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 23) + "+08:00"
  );
}
export function singaporeDay(value: string | Date = getSingaporeNow()) {
  return singaporeISO(
    typeof value === "string" ? parseSingaporeDate(value) : value,
  ).slice(0, 10);
}
export function formatSingaporeDate(
  value: string,
  options?: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(parseSingaporeDate(value));
}
export function addMinutes(minutes: number, date = getSingaporeNow()) {
  return singaporeISO(new Date(date.getTime() + minutes * 60000));
}
export function calculateNextDueDate(
  value: string,
  pattern: "daily" | "weekly" | "monthly" | "yearly",
) {
  const shifted = new Date(parseSingaporeDate(value).getTime() + 8 * 3600000);
  if (pattern === "daily" || pattern === "weekly")
    shifted.setUTCDate(shifted.getUTCDate() + (pattern === "daily" ? 1 : 7));
  else {
    const day = shifted.getUTCDate();
    shifted.setUTCDate(1);
    if (pattern === "monthly") shifted.setUTCMonth(shifted.getUTCMonth() + 1);
    else shifted.setUTCFullYear(shifted.getUTCFullYear() + 1);
    const last = new Date(
      Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
    ).getUTCDate();
    shifted.setUTCDate(Math.min(day, last));
  }
  return shifted.toISOString().slice(0, 23) + "+08:00";
}
export function calendarMonth(value?: string | null) {
  return value &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(value) &&
    +value.slice(0, 4) >= 1900 &&
    +value.slice(0, 4) <= 9998
    ? value
    : singaporeDay().slice(0, 7);
}
export function shiftMonth(value: string, step: number) {
  const d = new Date(
    Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1 + step, 1),
  );
  return calendarMonth(d.toISOString().slice(0, 7));
}
export function generateCalendarGrid(
  year: number,
  month: number,
  today = singaporeDay(),
) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const length = Math.max(
    35,
    Math.ceil(
      (first.getUTCDay() + new Date(Date.UTC(year, month, 0)).getUTCDate()) / 7,
    ) * 7,
  );
  return Array.from({ length }, (_, i) => {
    const date = new Date(Date.UTC(year, month - 1, 1 - first.getUTCDay() + i));
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      day: date.getUTCDate(),
      isCurrentMonth: date.getUTCMonth() === month - 1,
      isToday: key === today,
      isPast: key < today,
      isWeekend: i % 7 === 0 || i % 7 === 6,
    };
  });
}
