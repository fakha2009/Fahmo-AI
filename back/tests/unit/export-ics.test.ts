import { strict as assert } from "node:assert";
import { test } from "node:test";
import { IcsGenerator, toIcsDateTime, type IcsEventInput } from "../../src/modules/exports/domain/ics";

function event(overrides: Partial<IcsEventInput> = {}): IcsEventInput {
  return {
    uid: "fahmo-task1@fahmo.ai",
    title: "Оплатить аренду",
    description: "Перевод на счёт; банк: «Спитамен»\nВторая строка",
    start: "2026-09-05T00:00:00.000Z",
    timezone: null,
    status: "confirmed",
    ...overrides,
  };
}

test("ICS: структура календаря с VEVENT", () => {
  const generator = new IcsGenerator({ productId: "-//Fahmo//RU", calendarName: "Fahmo AI" });
  const ics = generator.generate([event()]);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR"));
  assert.ok(ics.includes("VERSION:2.0"));
  assert.ok(ics.includes("BEGIN:VEVENT"));
  assert.ok(ics.includes("END:VEVENT"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
});

test("ICS: экранирование ; , \\ и переносов строк", () => {
  const generator = new IcsGenerator({ productId: "-//Fahmo//RU", calendarName: "X" });
  const ics = generator.generate([
    event({ title: "Задача; с запятой, и слешем \\", description: "line1\nline2" }),
  ]);
  assert.ok(ics.includes("Задача\\; с запятой\\, и слешем \\\\"));
  assert.ok(ics.includes("line1\\nline2"));
});

test("ICS: UTC формат DTSTART без часового пояса", () => {
  const generator = new IcsGenerator({ productId: "-//Fahmo//RU", calendarName: "X" });
  const ics = generator.generate([event()]);
  assert.ok(ics.includes("DTSTART:20260905T000000Z"));
});

test("ICS: TZID при наличии часового пояса", () => {
  const generator = new IcsGenerator({ productId: "-//Fahmo//RU", calendarName: "X" });
  const ics = generator.generate([event({ start: "2026-09-05T05:00:00.000Z", timezone: "Asia/Dushanbe" })]);
  assert.ok(ics.includes("DTSTART;TZID=Asia/Dushanbe:20260905T100000"));
  assert.ok(!ics.includes("DTSTART;TZID=Asia/Dushanbe:20260905T100000Z"));
});

test("ICS: дата без времени создаёт событие на весь день", () => {
  const generator = new IcsGenerator({ productId: "-//Fahmo//RU", calendarName: "X" });
  const ics = generator.generate([event({ allDay: true })]);
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20260905"));
  assert.ok(ics.includes("DTEND;VALUE=DATE:20260906"));
});

test("ICS: напоминания сохраняются как VALARM относительно срока задачи", () => {
  const generator = new IcsGenerator({ productId: "-//Fahmo//RU", calendarName: "X" });
  const ics = generator.generate([event({ alarmMinutesBefore: [10, 5, 10] })]);
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 2);
  assert.ok(ics.includes("TRIGGER:-PT5M"));
  assert.ok(ics.includes("TRIGGER:-PT10M"));
});

test("ICS: отменённые напоминания → STATUS:CANCELLED", () => {
  const generator = new IcsGenerator({ productId: "-//Fahmo//RU", calendarName: "X" });
  const ics = generator.generate([event({ status: "cancelled" })]);
  assert.ok(ics.includes("STATUS:CANCELLED"));
});

test("ICS: CRLF и отсутствие сырых переводов строк в полях", () => {
  const generator = new IcsGenerator({ productId: "-//Fahmo//RU", calendarName: "X" });
  const ics = generator.generate([event()]);
  const withoutHeaders = ics.split("\r\n").slice(1, -2).join("\n");
  assert.ok(!withoutHeaders.includes("\n\n"));
});

test("toIcsDateTime: формат YYYYMMDDTHHMMSSZ", () => {
  const value = toIcsDateTime(new Date("2026-09-05T10:05:07.000Z"));
  assert.equal(value, "20260905T100507Z");
});
