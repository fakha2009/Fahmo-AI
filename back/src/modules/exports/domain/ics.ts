export interface IcsEventInput {
  uid: string;
  title: string;
  description: string | null;
  /** ISO-дата/время начала (может включать смещение). */
  start: string;
  /** true → использовать TZID (часовой пояс контекста), false → UTC (Z). */
  timezone: string | null;
  status: "confirmed" | "cancelled";
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
        "END:VEVENT"
      );
    }

    lines.push("END:VCALENDAR");
    return `${lines.join("\r\n")}\r\n`;
  }

  private startLines(event: IcsEventInput): string[] {
    if (event.timezone !== null && event.timezone.trim() !== "") {
      return [`DTSTART;TZID=${escapeParam(event.timezone)}:${toIcsDateTime(new Date(event.start))}`];
    }
    return [`DTSTART:${toIcsUtcDateTime(new Date(event.start))}`];
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

function toIcsUtcDateTime(date: Date): string {
  return toIcsDateTime(date);
}
