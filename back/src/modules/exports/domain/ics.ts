export interface IcsEventInput {
  uid: string;
  title: string;
  description: string | null;
  /** ISO-дата/время начала (может включать смещение). */
  start: string;
  /** true → использовать TZID (часовой пояс контекста), false → UTC (Z). */
  timezone: string | null;
  status: "confirmed" | "cancelled";
  allDay?: boolean;
  alarmMinutesBefore?: number[];
  /** Произвольные необязательные поля VTIMEZONE (offset из timezone). */
}

export interface IcsCalendarOptions {
  productId: string;
  calendarName: string;
}

/**
 * Генератор iCalendar (RFC 5545): даты в UTC (Z) либо с TZID, когда
 * задача имеет часовой пояс; строки экранируются по RFC 5545.
 */
export class IcsGenerator {
  private readonly nowUtc: string;

  constructor(private readonly options: IcsCalendarOptions) {
    this.nowUtc = toIcsDateTime(new Date());
  }

  generate(events: IcsEventInput[]): string {
    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      `PRODID:${this.options.productId}`,
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${escapeText(this.options.calendarName)}`,
    ];

    for (const event of events) {
      lines.push(
        "BEGIN:VEVENT",
        `UID:${escapeText(event.uid)}`,
        `DTSTAMP:${this.nowUtc}`,
        ...this.startLines(event),
        `SUMMARY:${escapeText(event.title)}`,
        ...(event.description === null || event.description === ""
          ? []
          : [`DESCRIPTION:${escapeLines(event.description)}`]),
        `STATUS:${event.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
        ...this.alarmLines(event),
        "END:VEVENT"
      );
    }

    lines.push("END:VCALENDAR");
    return `${lines.join("\r\n")}\r\n`;
  }

  private startLines(event: IcsEventInput): string[] {
    const start = new Date(event.start);
    if (Number.isNaN(start.getTime())) {
      throw new Error("invalid calendar event start");
    }
    if (event.allDay === true) {
      const end = new Date(start.getTime());
      end.setUTCDate(end.getUTCDate() + 1);
      return [
        `DTSTART;VALUE=DATE:${toIcsDate(start)}`,
        `DTEND;VALUE=DATE:${toIcsDate(end)}`,
      ];
    }
    if (event.timezone !== null && event.timezone.trim() !== "") {
      return [`DTSTART;TZID=${escapeParam(event.timezone)}:${toIcsZonedDateTime(start, event.timezone)}`];
    }
    return [`DTSTART:${toIcsUtcDateTime(start)}`];
  }

  private alarmLines(event: IcsEventInput): string[] {
    const values = [...new Set(event.alarmMinutesBefore ?? [])]
      .filter((value) => Number.isInteger(value) && value > 0 && value <= 525_600)
      .sort((left, right) => left - right);
    return values.flatMap((minutes) => [
      "BEGIN:VALARM",
      `TRIGGER:-PT${minutes}M`,
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(event.title)}`,
      "END:VALARM",
    ]);
  }
}

const ESCAPE_RE = /([\\;,])/g;

function escapeText(value: string): string {
  return value.replace(ESCAPE_RE, "\\$1").replace(/\n/g, "\\n").replace(/\r/g, "");
}

function escapeParam(value: string): string {
  return value.replace(/[\\;,:"']/g, (c) => `\\${c}`);
}

function escapeLines(value: string): string {
  const lines = value.split(/\r?\n/);
  return lines.map((line) => escapeText(line)).join("\\n");
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function toIcsDateTime(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(
    date.getUTCHours()
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function toIcsDate(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

function toIcsZonedDateTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}${part("month")}${part("day")}T${part("hour")}${part("minute")}${part("second")}`;
}

function toIcsUtcDateTime(date: Date): string {
  return toIcsDateTime(date);
}
