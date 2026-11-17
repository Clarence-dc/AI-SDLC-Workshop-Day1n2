const SINGAPORE_TIME_ZONE = "Asia/Singapore";
const SINGAPORE_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

type DateParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

function getSingaporeDateParts(date: Date): DateParts {
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Cannot format an invalid date.");
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SINGAPORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

export function getSingaporeNow(): Date {
  return new Date();
}

export function normalizeTimestamp(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, day, hour, minute, second, , offset] = match;
  const wallTime = new Date(`${day}T${hour}:${minute}:${second}.000Z`);
  if (!Number.isFinite(wallTime.getTime())
    || wallTime.toISOString().slice(0, 19) !== `${day}T${hour}:${minute}:${second}`) return null;
  if (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function formatSingaporeDate(
  value: Date | string,
  pattern = "yyyy-MM-dd HH:mm:ss",
): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = getSingaporeDateParts(date);
  const tokens: Record<string, string> = {
    yyyy: parts.year,
    YYYY: parts.year,
    MM: parts.month,
    dd: parts.day,
    DD: parts.day,
    HH: parts.hour,
    mm: parts.minute,
    ss: parts.second,
  };

  return pattern.replace(/yyyy|YYYY|MM|dd|DD|HH|mm|ss/g, (token) => tokens[token]);
}

export function toSingaporeDateTimeInput(value: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const parts = getSingaporeDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function fromSingaporeDateTimeInput(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (month < 1 || month > 12 || hour > 23 || minute > 59) {
    return null;
  }

  const singaporeWallTime = new Date(0);
  singaporeWallTime.setUTCFullYear(year, month - 1, day);
  singaporeWallTime.setUTCHours(hour, minute, 0, 0);

  if (
    singaporeWallTime.getUTCFullYear() !== year ||
    singaporeWallTime.getUTCMonth() !== month - 1 ||
    singaporeWallTime.getUTCDate() !== day
  ) {
    return null;
  }

  return new Date(
    singaporeWallTime.getTime() - SINGAPORE_UTC_OFFSET_MS,
  ).toISOString();
}

export function getSingaporeDateTimeInputAfter(offsetMs: number): string {
  return toSingaporeDateTimeInput(
    new Date(getSingaporeNow().getTime() + offsetMs).toISOString(),
  );
}
