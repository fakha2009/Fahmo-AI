import { downloadBlob, formatShortDate, normalizeWhitespace, uid } from '../core/utils.js';

const encoder = new TextEncoder();

function parseDateValue(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T09:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const numeric = raw.match(/\b([0-3]?\d)[.\/-]([01]?\d)[.\/-]((?:19|20)\d{2})\b/);
  if (numeric) {
    const date = new Date(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1]), 9, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const months = {
    январь: 0, января: 0, январ: 0, январи: 0, january: 0,
    февраль: 1, февраля: 1, феврал: 1, феврали: 1, february: 1,
    март: 2, марта: 2, march: 2,
    апрель: 3, апреля: 3, апрел: 3, april: 3,
    май: 4, мая: 4, may: 4,
    июнь: 5, июня: 5, июн: 5, june: 5,
    июль: 6, июля: 6, июл: 6, july: 6,
    август: 7, августа: 7, august: 7,
    сентябрь: 8, сентября: 8, сентябр: 8, september: 8,
    октябрь: 9, октября: 9, октябр: 9, october: 9,
    ноябрь: 10, ноября: 10, ноябр: 10, november: 10,
    декабрь: 11, декабря: 11, декабр: 11, december: 11
  };
  const named = raw.toLowerCase().match(/\b([0-3]?\d)\s+([a-zа-яёӣқғҳҷў]+)\s+((?:19|20)\d{2})\b/u);
  if (named && months[named[2]] != null) {
    const date = new Date(Number(named[3]), months[named[2]], Number(named[1]), 9, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function icsDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function escapeIcs(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;');
}

export function createIcsBlob(task, options = {}) {
  const start = parseDateValue(task.dueDate);
  if (!start) throw new Error('Task date is missing or cannot be parsed');
  if (task.dueTime && /^\d{1,2}:\d{2}$/.test(task.dueTime)) {
    const [hours, minutes] = task.dueTime.split(':').map(Number);
    start.setHours(hours, minutes, 0, 0);
  }
  const end = new Date(start.getTime() + (options.durationMinutes ?? 60) * 60_000);
  const now = new Date();
  const alarm = Number(task.reminderMinutes ?? options.reminderMinutes ?? 60);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Fahmo AI//Document Plan//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid('event')}@fahmo.local`,
    `DTSTAMP:${icsDate(now)}Z`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeIcs(task.title)}`,
    `DESCRIPTION:${escapeIcs(task.description || task.source?.excerpt || '')}`,
    task.location ? `LOCATION:${escapeIcs(task.location)}` : '',
    Number.isFinite(alarm) && alarm > 0 ? 'BEGIN:VALARM' : '',
    Number.isFinite(alarm) && alarm > 0 ? `TRIGGER:-PT${alarm}M` : '',
    Number.isFinite(alarm) && alarm > 0 ? 'ACTION:DISPLAY' : '',
    Number.isFinite(alarm) && alarm > 0 ? `DESCRIPTION:${escapeIcs(task.title)}` : '',
    Number.isFinite(alarm) && alarm > 0 ? 'END:VALARM' : '',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean);
  return new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
}

export function downloadTaskCalendar(task, filename = 'fahmo-task.ics') {
  downloadBlob(createIcsBlob(task), filename);
}

function canvasToJpeg(canvas, quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('Could not render PDF page')); return; }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/jpeg', quality);
  });
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function ascii(value) { return encoder.encode(value); }

function buildPdfFromJpegs(images) {
  const objectCount = 2 + images.length * 3;
  const objects = new Array(objectCount + 1);
  const pageRefs = images.map((_, index) => `${3 + index * 3} 0 R`).join(' ');
  objects[1] = ascii('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = ascii(`<< /Type /Pages /Kids [${pageRefs}] /Count ${images.length} >>`);

  images.forEach((image, index) => {
    const pageNo = 3 + index * 3;
    const contentNo = pageNo + 1;
    const imageNo = pageNo + 2;
    objects[pageNo] = ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imageNo} 0 R >> >> /Contents ${contentNo} 0 R >>`);
    const content = ascii('q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ\n');
    objects[contentNo] = concatBytes([ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii('endstream')]);
    objects[imageNo] = concatBytes([
      ascii(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`),
      image.bytes,
      ascii('\nendstream')
    ]);
  });

  const parts = [ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  const offsets = new Array(objectCount + 1).fill(0);
  let length = parts[0].length;
  for (let number = 1; number <= objectCount; number += 1) {
    offsets[number] = length;
    const object = concatBytes([ascii(`${number} 0 obj\n`), objects[number], ascii('\nendobj\n')]);
    parts.push(object);
    length += object.length;
  }
  const xrefOffset = length;
  const xref = [`xref\n0 ${objectCount + 1}\n`, '0000000000 65535 f \n'];
  for (let number = 1; number <= objectCount; number += 1) xref.push(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  parts.push(ascii(xref.join('')));
  return new Blob([concatBytes(parts)], { type: 'application/pdf' });
}

function wrapCanvasText(context, text, maxWidth) {
  const paragraphs = String(text ?? '').split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth || !line) line = candidate;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export async function createResultPdf(result, options = {}) {
  const width = 1240;
  const height = 1754;
  const margin = 104;
  const pages = [];
  let canvas;
  let context;
  let y;

  const newPage = () => {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.textBaseline = 'top';
    y = margin;
  };
  const flushPage = async () => {
    if (!canvas) return;
    pages.push({ bytes: await canvasToJpeg(canvas), width, height });
  };
  const ensure = async (needed) => {
    if (y + needed <= height - margin) return;
    await flushPage();
    newPage();
  };
  const drawText = async (text, style = {}) => {
    const size = style.size ?? 30;
    const lineHeight = style.lineHeight ?? Math.round(size * 1.38);
    context.font = `${style.weight ?? 400} ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
    context.fillStyle = style.color ?? '#17182d';
    const lines = wrapCanvasText(context, text, width - margin * 2 - (style.indent ?? 0));
    await ensure(lines.length * lineHeight + (style.after ?? 0));
    for (const line of lines) {
      context.fillText(line, margin + (style.indent ?? 0), y);
      y += lineHeight;
    }
    y += style.after ?? 0;
  };
  const drawRule = async () => {
    await ensure(36);
    context.strokeStyle = '#dedfeb';
    context.lineWidth = 2;
    context.beginPath(); context.moveTo(margin, y + 12); context.lineTo(width - margin, y + 12); context.stroke();
    y += 36;
  };

  newPage();
  await drawText('Фаҳмо AI', { size: 28, weight: 700, color: '#6746f5', after: 18 });
  await drawText(result.title || 'Результат анализа', { size: 54, weight: 750, lineHeight: 66, after: 14 });
  await drawText(`${options.analyzedLabel ?? 'Проанализировано'}: ${formatShortDate(result.createdAt, options.locale ?? 'ru')}`, { size: 24, color: '#62647b', after: 30 });
  await drawRule();
  await drawText(options.summaryLabel ?? 'Простое объяснение', { size: 34, weight: 720, after: 14 });
  await drawText(normalizeWhitespace(result.summary?.standard || result.summary?.simple || '—'), { size: 27, lineHeight: 40, after: 30 });

  if (result.tasks?.length) {
    await drawText(options.tasksLabel ?? 'Что нужно сделать', { size: 34, weight: 720, after: 14 });
    for (let index = 0; index < result.tasks.length; index += 1) {
      const task = result.tasks[index];
      await drawText(`${task.completed ? '☑' : '☐'} ${index + 1}. ${task.title}`, { size: 27, weight: 620, lineHeight: 39, after: 4 });
      const meta = [task.dueDate ? `${options.dueLabel ?? 'Срок'}: ${task.dueDate}` : '', task.priority ? `${options.priorityLabel ?? 'Приоритет'}: ${task.priority}` : ''].filter(Boolean).join(' · ');
      if (meta) await drawText(meta, { size: 22, color: '#62647b', indent: 38, after: 13 });
    }
    y += 16;
  }

  if (result.importantData?.length) {
    await drawText(options.dataLabel ?? 'Важные данные', { size: 34, weight: 720, after: 14 });
    for (const item of result.importantData) await drawText(`${item.type}: ${item.value}`, { size: 26, lineHeight: 38, after: 8 });
    y += 12;
  }

  if (result.warnings?.length) {
    await drawText(options.warningsLabel ?? 'Предупреждения', { size: 34, weight: 720, color: '#9b5e00', after: 14 });
    for (const warning of result.warnings) {
      await drawText(warning.title, { size: 27, weight: 650, color: '#9b5e00', after: 4 });
      await drawText(warning.message, { size: 24, color: '#704800', after: 12 });
    }
  }

  await drawRule();
  await drawText(options.footer ?? 'Создано в Фаҳмо AI. Пользовательские исправления отмечаются в приложении.', { size: 20, color: '#85879c' });
  await flushPage();
  return buildPdfFromJpegs(pages);
}
