import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";
import { inflateSync } from "node:zlib";
import fontkit from "fontkit";

export type PdfConfidence = "high" | "medium" | "low";
export type PdfTaskStatus = "pending" | "completed" | "cancelled";
export type PdfTaskPriority = "high" | "medium" | "low";
export type PdfSeverity = "info" | "warning" | "critical";
export type PdfChangeSource = "ai" | "user" | "clarification" | "reanalyze";

export interface PdfTaskRow {
  title: string;
  simpleTitle: string | null;
  description: string | null;
  simpleDescription: string | null;
  dueAt: string | null;
  status: PdfTaskStatus;
  priority: PdfTaskPriority;
}

export interface PdfWarningRow {
  code: string;
  message: string;
  severity: PdfSeverity;
}

export interface PdfImportantDataRow {
  label: string;
  value: string;
  confidence: PdfConfidence;
  sourcePage: number | null;
  sourceExcerpt: string | null;
}

export interface PdfUserEditRow {
  version: number;
  changeSource: PdfChangeSource;
  createdAt: string;
  changedFields: unknown | null;
}

export interface PdfExportData {
  analysisId: string;
  title: string;
  createdAt: string;
  documentType: string;
  outputLanguage: string;
  overallConfidence: PdfConfidence;
  summary: string;
  simpleExplanation: string;
  importantData: PdfImportantDataRow[];
  warnings: PdfWarningRow[];
  tasks: PdfTaskRow[];
  userEdits: PdfUserEditRow[];
}

export interface PdfRenderOptions {
  /** TTF-шрифт с кириллицей для встраивания; null → стандартный Helvetica. */
  fontBytes: Uint8Array | null;
  boldFontBytes: Uint8Array | null;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT = 15;
const PARAGRAPH_GAP = 10;
const SECTION_GAP = 22;

const LABELS = {
  createdBy: "Создано в Fahmo AI",
  disclaimer: "Экспорт из анализа · оригинальный документ не включён",
  sectionSummary: "Объяснение",
  sectionSimple: "Простая версия",
  sectionImportantData: "Важные данные",
  sectionTasks: "Задачи",
  sectionWarnings: "Предупреждения",
  sectionUserEdits: "Пользовательские изменения",
  noTasks: "Задачи не обнаружены.",
  noWarnings: "Предупреждений нет.",
  noEdits: "Пользовательских изменений нет.",
  due: "Срок",
  priority: "Приоритет",
  statusCompleted: "выполнено",
  statusCancelled: "отменено",
  confidence: "Уверенность",
  documentType: "Тип документа",
  version: "версия",
  changedFields: "Изменённые поля",
  source: "Источник",
} as const;

function label(key: keyof typeof LABELS): string {
  return LABELS[key] ?? "";
}

function statusLabel(status: PdfTaskStatus): string {
  switch (status) {
    case "completed":
      return label("statusCompleted");
    case "cancelled":
      return label("statusCancelled");
    default:
      return "";
  }
}

export class PdfExportRenderer {
  async render(data: PdfExportData, options: PdfRenderOptions): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    if (options.fontBytes !== null || options.boldFontBytes !== null) {
      doc.registerFontkit(fontkit as never);
    }
    const standardFont = options.fontBytes === null;
    const font = options.fontBytes !== null
      ? await doc.embedFont(options.fontBytes)
      : await doc.embedStandardFont(StandardFonts.Helvetica);
    const boldFont = options.boldFontBytes !== null
      ? await doc.embedFont(options.boldFontBytes)
      : options.fontBytes !== null
        ? font
        : await doc.embedStandardFont(StandardFonts.HelveticaBold);

    const writer = new PageWriter(doc, font, boldFont, standardFont);
    writer.drawTitle(data.title);
    writer.drawMeta(data);
    writer.drawDisclaimer();

    writer.drawSection(label("sectionSummary"));
    writer.drawParagraph(data.summary);

    writer.drawSection(label("sectionSimple"));
    writer.drawParagraph(data.simpleExplanation);

    if (data.importantData.length > 0) {
      writer.drawSection(label("sectionImportantData"));
      for (const item of data.importantData) {
        writer.drawImportantData(item);
      }
    }

    writer.drawSection(label("sectionTasks"));
    if (data.tasks.length === 0) {
      writer.drawParagraph(label("noTasks"));
    } else {
      for (const task of data.tasks) {
        writer.drawTask(task);
      }
    }

    writer.drawSection(label("sectionWarnings"));
    if (data.warnings.length === 0) {
      writer.drawParagraph(label("noWarnings"));
    } else {
      for (const warning of data.warnings) {
        writer.drawWarning(warning);
      }
    }

    writer.drawSection(label("sectionUserEdits"));
    if (data.userEdits.length === 0) {
      writer.drawParagraph(label("noEdits"));
    } else {
      for (const edit of data.userEdits) {
        writer.drawUserEdit(edit);
      }
    }

    writer.drawFooter(data.analysisId);
    return doc.save();
  }
}

class PageWriter {
  private y = PAGE_HEIGHT - MARGIN;

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly boldFont: PDFFont,
    private readonly isStandardFont: boolean
  ) {}

  private page() {
    if (this.doc.getPageCount() === 0) {
      this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
    return this.doc.getPage(this.doc.getPageCount() - 1);
  }

  private ensureSpace(needed: number): void {
    if (this.y - needed < MARGIN + 40) {
      this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  drawTitle(title: string): void {
    this.ensureSpace(40);
    this.drawWrappedText(title, 17, true, dark, 22);
    this.y -= 6;
  }

  drawMeta(data: PdfExportData): void {
    this.drawWrappedText(
      `${label("documentType")}: ${data.documentType} · ${label("confidence")}: ${data.overallConfidence} · ${data.outputLanguage.toUpperCase()}`,
      9,
      false,
      dim,
      13
    );
    this.y -= 4;
  }

  drawDisclaimer(): void {
    this.drawWrappedText(`${label("createdBy")} · ${label("disclaimer")}`, 9, false, dim, 13);
    this.y -= SECTION_GAP;
  }

  drawSection(label: string): void {
    // Keep enough room for the heading and at least one following text line.
    this.ensureSpace(42);
    this.drawWrappedText(label, 13, true, accent, 18);
    this.y -= 4;
  }

  drawParagraph(text: string): void {
    this.drawWrappedText(text, 10.5, false, dark, LINE_HEIGHT);
    this.y -= PARAGRAPH_GAP;
  }

  drawTask(task: PdfTaskRow): void {
    this.ensureSpace(60);
    this.drawWrappedText(task.title, 11, true, dark, 16);
    this.y -= 2;
    const status = statusLabel(task.status);
    const due = task.dueAt === null ? "" : `${label("due")}: ${formatIso(task.dueAt)}`;
    const prio = `${label("priority")}: ${task.priority}`;
    const meta = [status, due, prio].filter(Boolean).join(" · ");
    if (meta.length > 0) {
      this.drawWrappedText(meta, 9, false, dim, 13);
      this.y -= 2;
    }
    if (task.description !== null && task.description.length > 0) {
      this.drawWrappedText(task.description, 9.5, false, dark, 14);
    }
    this.y -= PARAGRAPH_GAP;
  }

  drawImportantData(item: PdfImportantDataRow): void {
    this.ensureSpace(45);
    this.drawWrappedText(`${item.label}: ${item.value}`, 10.5, true, dark, LINE_HEIGHT);
    const source = [
      item.sourcePage === null ? "" : `${label("source")}: стр. ${item.sourcePage}`,
      item.sourceExcerpt ?? "",
    ].filter(Boolean).join(" · ");
    if (source !== "") {
      this.drawWrappedText(source, 8.5, false, dim, 13);
    }
    this.y -= PARAGRAPH_GAP;
  }

  drawWarning(warning: PdfWarningRow): void {
    this.ensureSpace(30);
    this.drawWrappedText(
      `[${warning.severity}] ${warning.message}`,
      10,
      warning.severity === "critical",
      dark,
      LINE_HEIGHT
    );
    this.y -= PARAGRAPH_GAP;
  }

  drawUserEdit(edit: PdfUserEditRow): void {
    this.ensureSpace(50);
    const fields = humanizeChangedFields(edit.changedFields);
    const fieldsText = fields === "" ? "" : ` · ${label("changedFields")}: ${fields}`;
    this.drawWrappedText(
      `${label("version")} ${edit.version} (${edit.changeSource}, ${formatIso(edit.createdAt)})${fieldsText}`,
      10,
      true,
      dark,
      LINE_HEIGHT
    );
    this.y -= PARAGRAPH_GAP;
  }

  drawFooter(analysisId: string): void {
    const text = `Fahmo AI · analysis ${analysisId}`;
    this.ensureSpace(20);
    this.drawWrappedText(text, 8, false, dim, 12);
  }

  private drawWrappedText(
    text: string,
    size: number,
    bold: boolean,
    color = dark,
    lineHeight = size + 4
  ): void {
    const selectedFont = bold ? this.boldFont : this.font;
    for (const line of this.wrap(text, size, selectedFont)) {
      this.ensureSpace(lineHeight);
      this.page().drawText(line, {
        x: MARGIN,
        y: this.y,
        size,
        font: selectedFont,
        color,
      });
      this.y -= lineHeight;
    }
  }

  private safeText(text: string): string {
    return this.isStandardFont ? sanitizeForStandardFont(text) : text;
  }

  private wrap(text: string, size: number, font: PDFFont): string[] {
    const maxWidth = CONTENT_WIDTH;
    const lines: string[] = [];
    for (const paragraph of this.safeText(text).split(/\r?\n/)) {
      const words = paragraph.trim().split(/\s+/).filter(Boolean);
      let current = "";
      const push = (word: string): void => {
        if (font.widthOfTextAtSize(word, size) <= maxWidth) {
          if (current === "") {
            current = word;
          } else {
            lines.push(current);
            current = word;
          }
          return;
        }
        if (current !== "") {
          lines.push(current);
          current = "";
        }
        let part = "";
        for (const char of word) {
          const candidate = part + char;
          if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
            part = candidate;
          } else {
            if (part !== "") {
              lines.push(part);
            }
            part = char;
          }
        }
        if (part !== "") {
          lines.push(part);
        }
      };
      for (const word of words) {
        const candidate = current === "" ? word : `${current} ${word}`;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          current = candidate;
        } else {
          push(word);
        }
      }
      if (current !== "") {
        lines.push(current);
      }
    }
    return lines;
  }
}

/**
 * Стандартные шрифты PDF (WinAnsi) не содержат кириллицы: заменяем
 * символы вне Latin-1 на «?», чтобы рендер не падал без системного TTF.
 * Встраивание TTF/WOFF (FontResolver) полностью сохраняет кириллицу/таджикский.
 */
function sanitizeForStandardFont(text: string): string {
  return text.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

const dark = rgb(0.12, 0.12, 0.14);
const dim = rgb(0.45, 0.45, 0.5);
const accent = rgb(0.1, 0.35, 0.65);

function formatIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 16).replace("T", " ");
}

function humanizeChangedFields(fields: unknown): string {
  if (fields === null || fields === undefined) {
    return "";
  }
  if (Array.isArray(fields)) {
    return fields.map(String).join(", ");
  }
  if (typeof fields === "object") {
    return Object.keys(fields as Record<string, unknown>).join(", ");
  }
  return String(fields);
}

/**
 * Лёгкий извлекатель текста из сгенерированных pdf-lib PDF-файлов
 * (используется в тестах): декомпрессирует потоки страниц и собирает
 * строки операторов Tj/TJ, включая UTF-16BE hex-строки встроенных шрифтов.
 */
export function extractPdfText(pdfBytes: Uint8Array): string {
  const text = Buffer.from(pdfBytes).toString("latin1");
  const streams: Buffer[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(text)) !== null) {
    const content = match[1];
    if (content !== undefined) {
      streams.push(Buffer.from(content, "latin1"));
    }
  }
  const decodedStreams: string[] = [];
  for (const stream of streams) {
    try {
      decodedStreams.push(inflateSync(stream).toString("latin1"));
    } catch {
      decodedStreams.push(stream.toString("latin1"));
    }
  }
  let unicodeMap: Map<string, string> | null = null;
  const contentStreams: string[] = [];
  for (const content of decodedStreams) {
    if (content.startsWith("/CIDInit")) {
      unicodeMap = parseToUnicodeMap(content);
      continue;
    }
    // Обрабатываем только content stream'ы страниц: pdf-lib всегда начинает
    // их с «q» (сохранение состояния) и использует текстовые блоки BT;
    // потоки шрифтов отфильтровываются.
    if (!/^q\b/.test(content) || !content.includes("BT")) {
      continue;
    }
    contentStreams.push(content);
  }
  const pages: string[] = [];
  for (const content of contentStreams) {
    const pageText = readShowOperators(content, unicodeMap);
    if (pageText !== "") {
      pages.push(pageText);
    }
  }
  return pages.join("\n");
}

/** ToUnicode CMap pdf-lib: <gid> <UTF-16BE hex>. */
function parseToUnicodeMap(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const bfcharRe = /beginbfchar\r?\n([\s\S]*?)endbfchar/g;
  let block: RegExpExecArray | null;
  while ((block = bfcharRe.exec(content)) !== null) {
    const entries = block[1] ?? "";
    const pairRe = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let pair: RegExpExecArray | null;
    while ((pair = pairRe.exec(entries)) !== null) {
      const gid = pair[1] ?? "";
      const unicodeHex = pair[2] ?? "";
      map.set(gid, utf16beToUnicode(unicodeHex));
    }
  }
  return map;
}

function utf16beToUnicode(hex: string): string {
  const bytes = Buffer.from(hex, "hex");
  return bytes.swap16().toString("utf16le").replace(/^\uFEFF/, "");
}

function readShowOperators(content: string, unicodeMap: Map<string, string> | null): string {
  const parts: string[] = [];
  const textRe =
    /(?:\([^()\\]*(?:\\.[^()\\]*)*\)|<[0-9A-Fa-f\s]+>)\s*Tj|\[[\s\S]*?\]\s*TJ/g;
  let match: RegExpExecArray | null;
  while ((match = textRe.exec(content)) !== null) {
    const token = match[0];
    const open = token[0];
    if (open === "(") {
      const inner = token.slice(1, token.lastIndexOf(")"));
      parts.push(unescapeLiteral(inner));
    } else if (open === "<") {
      const close = token.indexOf(">");
      const hex = token.slice(1, close);
      parts.push(unicodeMap !== null ? decodeHexWithMap(hex, unicodeMap) : hexToUtf16(hex));
    } else if (open === "[") {
      const innerRe = /\(([^()\\]*(?:\\.[^()\\]*)*)\)|<([0-9A-Fa-f\s]*)>/g;
      let item: RegExpExecArray | null;
      while ((item = innerRe.exec(token)) !== null) {
        const literal = item[1];
        const hex = item[2];
        parts.push(
          literal !== undefined
            ? unescapeLiteral(literal)
            : unicodeMap !== null
              ? decodeHexWithMap(hex ?? "", unicodeMap)
              : hexToUtf16(hex ?? "")
        );
      }
    }
  }
  return parts.join("");
}

/** Декодирует коды глифов (по 4 hex-цифры) через ToUnicode CMap. */
function decodeHexWithMap(hex: string, unicodeMap: Map<string, string>): string {
  const clean = hex.replace(/\s/g, "");
  let result = "";
  for (let i = 0; i + 4 <= clean.length; i += 4) {
    result += unicodeMap.get(clean.slice(i, i + 4)) ?? "\uFFFD";
  }
  return result;
}

function unescapeLiteral(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\[0-7]{1,3}/g, (octal) => String.fromCharCode(parseInt(octal.slice(1), 8)));
}

function hexToUtf16(hex: string): string {
  const clean = hex.replace(/\s/g, "");
  if (clean.startsWith("FEFF")) {
    const bytes = Buffer.from(clean, "hex");
    // PDF хранит текст во встроенных шрифтах в UTF-16BE → LE для JS.
    return bytes.swap16().toString("utf16le").replace(/^\uFEFF/, "");
  }
  const bytes = Buffer.from(clean, "hex");
  return bytes.toString("latin1");
}
