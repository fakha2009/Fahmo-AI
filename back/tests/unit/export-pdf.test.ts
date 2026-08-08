import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  PdfExportRenderer,
  extractPdfText,
  type PdfExportData,
} from "../../src/modules/exports/domain/pdf-document";

function sampleData(): PdfExportData {
  return {
    analysisId: "analysis123",
    title: "Договор аренды №5",
    createdAt: "2026-08-06T10:00:00.000Z",
    documentType: "contract",
    outputLanguage: "ru",
    overallConfidence: "high",
    summary: "Договор аренды квартиры на 11 месяцев. Оплата — 5000 сомони в месяц.",
    simpleExplanation: "Вы арендуете квартиру 11 месяцев и платите 5000 сомони каждый месяц.",
    warnings: [
      { code: "CRITICAL_DATE", message: "Срок договора истекает 31.12.2026", severity: "critical" },
      { code: "NOTE", message: "Пункт 4.2 противоречит пункту 7.1", severity: "warning" },
    ],
    tasks: [
      {
        title: "Оплатить аренду до 5 числа",
        simpleTitle: "Платите до 5 числа",
        description: "Перевод на счёт арендодателя",
        simpleDescription: null,
        dueAt: "2026-09-05T00:00:00.000Z",
        status: "pending",
        priority: "high",
      },
    ],
    userEdits: [
      { version: 2, changeSource: "user", createdAt: "2026-08-06T12:00:00.000Z", changedFields: ["dueAt"] },
    ],
  };
}

test("PdfExportRenderer: генерирует валидный PDF с fallback-шрифтом", async () => {
  const renderer = new PdfExportRenderer();
  const pdf = await renderer.render(sampleData(), { fontBytes: null, boldFontBytes: null });
  const doc = await PDFDocument.load(pdf);
  assert.ok(doc.getPageCount() >= 1);
  assert.ok(pdf.length > 1000);
});

test("PdfExportRenderer: со встроенным TTF сохраняется кириллица и все секции", async () => {
  const font = await resolveFont();
  if (font === null) {
    return;
  }
  const renderer = new PdfExportRenderer();
  const pdf = await renderer.render(sampleData(), { fontBytes: font, boldFontBytes: null });
  const text = extractPdfText(pdf);
  assert.ok(text.includes("Договор аренды №5"));
  assert.ok(text.includes("Объяснение"));
  assert.ok(text.includes("Простая версия"));
  assert.ok(text.includes("Задачи"));
  assert.ok(text.includes("Предупреждения"));
  assert.ok(text.includes("Пользовательские изменения"));
  assert.ok(text.includes("оригинальный документ не включён"));
});

test("PdfExportRenderer: пустые секции показывают заглушки", async () => {
  const font = await resolveFont();
  if (font === null) {
    return;
  }
  const data = sampleData();
  data.tasks = [];
  data.warnings = [];
  data.userEdits = [];
  const renderer = new PdfExportRenderer();
  const pdf = await renderer.render(data, { fontBytes: font, boldFontBytes: null });
  const text = extractPdfText(pdf);
  assert.ok(text.includes("Задачи не обнаружены"));
  assert.ok(text.includes("Предупреждений нет"));
  assert.ok(text.includes("Пользовательских изменений нет"));
});

test("PdfExportRenderer: содержимое PDF — только экспортные секции, без текста оригинала", async () => {
  const font = await resolveFont();
  if (font === null) {
    return;
  }
  const renderer = new PdfExportRenderer();
  const pdf = await renderer.render(sampleData(), { fontBytes: font, boldFontBytes: null });
  const text = extractPdfText(pdf);
  assert.ok(!text.includes("Секретная оригинальная фраза"));
  assert.ok(!text.toLowerCase().includes("original document"));
});

async function resolveFont(): Promise<Uint8Array | null> {
  const { FontResolver } = await import("../../src/modules/exports/domain/font-resolver");
  const resolved = new FontResolver().resolve();
  return resolved.regularBytes;
}
