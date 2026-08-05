import { normalizeWhitespace, splitSentences, truncate, uid } from '../core/utils.js';

const monthNames = '(?:январ[ья]|феврал[ья]|март[ае]?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|август[ае]?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья]|январи|феврали|март|апрел|май|июн|июл|август|сентябр|октябр|ноябр|декабр|january|february|march|april|may|june|july|august|september|october|november|december)';
const datePatterns = [
  new RegExp(`\\b(?:до\\s+|на\\s+|с\\s+|по\\s+)?(?:[0-3]?\\d)\\s+${monthNames}(?:\\s+\\d{4}(?:\\s*г(?:ода|\\.)?)?)?`, 'giu'),
  /\b(?:до\s+|на\s+|с\s+|по\s+)?(?:0?[1-9]|[12]\d|3[01])[.\/-](?:0?[1-9]|1[0-2])(?:[.\/-](?:19|20)\d{2})?\b/giu,
  /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/gu
];
const amountPattern = /(?:(?:USD|EUR|RUB|TJS|сомони|сомон[ӣи]|рубл(?:ей|я|ь)?|доллар(?:ов|а)?|евро)\s*)?\d{1,3}(?:[\s\u00A0.,]\d{3})*(?:[.,]\d{1,2})?\s*(?:₽|\$|€|TJS|USD|EUR|RUB|сомони|сомон[ӣи]|рубл(?:ей|я|ь)?|доллар(?:ов|а)?|евро)/giu;
const phonePattern = /(?:\+?\d[\d\s()\-]{7,}\d)/g;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const urlPattern = /\bhttps?:\/\/[^\s<>()]+/giu;
const timePattern = /\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*[–-]\s*(?:[01]?\d|2[0-3]):[0-5]\d)?\b/g;
const addressPattern = /(?:по\s+адресу|адрес|место|ҷой|суроға|location|address)\s*[:—-]?\s*([^\n.;]{5,120})/giu;
const actionCue = /(?:необходимо|нужно|следует|требуется|должен|должна|должны|обязан|обязана|пожалуйста|просим|предоставить|подать|принести|оплатить|подписать|зарегистрироваться|заполнить|отправить|проверить|явиться|передать|застраховать|сделать|зарур|лозим|бояд|пешниҳод|супоридан|пардохт|имзо|сабтином|пур кардан|фиристодан|санҷидан|овардан|submit|provide|pay|sign|register|complete|send|check|attend|bring|must|should|required)/iu;
const actionVerbSource = '(?:предоставить|подать|принести|оплатить|подписать|зарегистрироваться|заполнить|отправить|проверить|явиться|передать|застраховать|сделать|подготовить|загрузить|позвонить|прийти|пешниҳод|супоридан|пардохт|имзо|сабтином|пур\s+кардан|фиристодан|санҷидан|овардан|submit|provide|pay|sign|register|complete|send|check|attend|bring|upload|call)';
const actionVerbBoundary = '(?=$|[\\s,.;:!?])';
const actionVerbAtStart = new RegExp(`^${actionVerbSource}${actionVerbBoundary}`, 'iu');
const actionSplitPattern = new RegExp(`(?:,\\s*|\\s+(?:и|а\\s+также|ҳамчунин|and|also)\\s+)(?=${actionVerbSource}${actionVerbBoundary})`, 'giu');
const highPriorityCue = /(?:срочно|немедленно|обязательно|не позднее|крайний срок|муҳлати охир|фавран|urgent|immediately|deadline)/iu;
const mediumPriorityCue = /(?:до\s+\d|необходимо|нужно|требуется|бояд|лозим|required|must|should)/iu;

function uniqueMatches(text, patterns) {
  const values = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = match[0].trim().replace(/[),.;:]+$/, '');
      if (value && !values.some((item) => item.value.toLowerCase() === value.toLowerCase())) values.push({ value, index: match.index ?? 0 });
    }
  }
  return values;
}

function locatePage(pageTexts, globalIndex) {
  let offset = 0;
  for (const page of pageTexts) {
    const end = offset + page.text.length + 2;
    if (globalIndex <= end) return page;
    offset = end;
  }
  return pageTexts[0] ?? { page: 1, sourceId: null, text: '' };
}

function sourceFor(page, excerpt) {
  return {
    page: page?.page ?? 1,
    sourceId: page?.sourceId ?? null,
    excerpt: truncate(excerpt, 260),
    coordinates: null
  };
}

function detectDocumentType(text, requested = 'auto') {
  if (requested && requested !== 'auto') return requested;
  const lower = text.toLowerCase();
  if (/объявлен|эълон|announcement|мероприят|чорабин/.test(lower)) return 'announcement';
  if (/поручен|супориш|assignment|task|работ/.test(lower)) return 'work-order';
  if (/записк|ёддошт|note/.test(lower)) return 'handwritten';
  return 'other';
}

function titleFromText(text, type) {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length >= 4);
  const candidate = lines.find((line) => line.length <= 100 && !/^\d+[.)]/.test(line)) ?? splitSentences(text)[0];
  if (candidate) return truncate(candidate.replace(/^[#*\-\s]+/, ''), 90);
  return ({ announcement: 'Объявление', 'work-order': 'Рабочее поручение', handwritten: 'Записка', other: 'Документ' })[type] ?? 'Документ';
}

function buildSummary(text, title) {
  const normalizedTitle = normalizeWhitespace(title).replace(/[.!?…]+$/u, '').toLowerCase();
  const sentences = splitSentences(text)
    .filter((sentence) => sentence.length > 15)
    .filter((sentence) => sentence.replace(/[.!?…]+$/u, '').toLowerCase() !== normalizedTitle);
  if (!sentences.length) return '';
  const selected = [];
  for (const sentence of sentences) {
    if (!selected.includes(sentence)) selected.push(sentence);
    if (selected.join(' ').length >= 260 || selected.length === 3) break;
  }
  return truncate(selected.join(' '), 520);
}

function simpleSentence(value) {
  return value
    .replace(/\b(?:необходимо|нужно|следует|требуется|просим|пожалуйста)\s+/giu, '')
    .replace(/\b(?:you must|you should|required to)\s+/giu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferPriority(sentence) {
  if (highPriorityCue.test(sentence)) return 'high';
  if (mediumPriorityCue.test(sentence)) return 'medium';
  return 'low';
}

function nearestDate(sentence, dates) {
  const lower = sentence.toLowerCase();
  return dates.find((date) => lower.includes(date.value.toLowerCase()))?.value ?? null;
}

function taskTitle(sentence) {
  const clean = sentence.replace(/^[-–—•\d.)\s]+/, '').trim();
  const titled = clean ? clean[0].toLocaleUpperCase() + clean.slice(1) : clean;
  return truncate(titled, 120);
}

function splitActionSentence(sentence) {
  const withoutModal = sentence
    .replace(/^(?:необходимо|нужно|следует|требуется|пожалуйста|просим|зарур|лозим|бояд|please|you\s+must|you\s+should|required\s+to)\s*[:—-]?\s*/iu, '')
    .trim();
  const pieces = withoutModal.split(actionSplitPattern).map((part) => part.trim()).filter(Boolean);
  if (pieces.length < 2 || !pieces.every((part) => actionVerbAtStart.test(part))) return [sentence];
  return pieces.map((part) => /[.!?…]$/u.test(part) ? part : `${part}.`);
}

function extractTasks(text, pageTexts, dates) {
  const sentences = splitSentences(text);
  const tasks = [];
  let globalOffset = 0;
  for (const sentence of sentences) {
    const index = text.indexOf(sentence, globalOffset);
    globalOffset = Math.max(globalOffset, index + sentence.length);
    if (!actionCue.test(sentence) || sentence.length < 8 || sentence.length > 620) continue;
    const page = locatePage(pageTexts, Math.max(0, index));
    const fragments = splitActionSentence(sentence);
    for (const fragment of fragments) {
      const normalized = taskTitle(fragment);
      if (!normalized || tasks.some((task) => task.title.toLowerCase() === normalized.toLowerCase())) continue;
      tasks.push({
        id: uid('task'),
        title: normalized,
        simpleTitle: simpleSentence(normalized),
        description: '',
        completed: false,
        priority: inferPriority(sentence),
        dueDate: nearestDate(sentence, dates),
        dueTime: (sentence.match(timePattern) ?? [])[0] ?? null,
        location: null,
        reminderMinutes: null,
        source: sourceFor(page, sentence),
        userEdited: false
      });
      if (tasks.length >= 24) break;
    }
    if (tasks.length >= 24) break;
  }
  return tasks;
}

function extractData(text, pageTexts) {
  const items = [];
  const dates = uniqueMatches(text, datePatterns);
  const amounts = uniqueMatches(text, [amountPattern]);
  const phones = uniqueMatches(text, [phonePattern]);
  const emails = uniqueMatches(text, [emailPattern]);
  const urls = uniqueMatches(text, [urlPattern]);
  const times = uniqueMatches(text, [timePattern]);
  const addresses = [];
  addressPattern.lastIndex = 0;
  for (const match of text.matchAll(addressPattern)) {
    const value = match[1].trim();
    if (!addresses.some((item) => item.value.toLowerCase() === value.toLowerCase())) addresses.push({ value, index: match.index ?? 0, full: match[0] });
  }

  const append = (type, value, index, confidence = 'high', excerpt = value) => {
    const page = locatePage(pageTexts, index);
    items.push({ id: uid('data'), type, value, confidence, source: sourceFor(page, excerpt), userEdited: false });
  };
  dates.slice(0, 12).forEach((item) => append('date', item.value, item.index, /\d{4}/.test(item.value) ? 'high' : 'medium'));
  times.slice(0, 8).forEach((item) => append('time', item.value, item.index));
  amounts.slice(0, 12).forEach((item) => append('amount', item.value, item.index));
  addresses.slice(0, 8).forEach((item) => append('address', item.value, item.index, 'medium', item.full));
  phones.slice(0, 8).forEach((item) => append('contact', item.value, item.index));
  emails.slice(0, 8).forEach((item) => append('contact', item.value, item.index));
  urls.slice(0, 8).forEach((item) => append('link', item.value, item.index));
  return { items, dates };
}

function buildClarifications(dataItems) {
  const clarifications = [];
  for (const item of dataItems) {
    if (item.type === 'date' && !/\b(?:19|20)\d{2}\b/.test(item.value)) {
      clarifications.push({
        id: uid('clarification'),
        type: 'missing-year',
        question: `Какой год относится к дате «${item.value}»?`,
        targetDataId: item.id,
        answered: false,
        answer: null
      });
    }
  }
  return clarifications.slice(0, 6);
}

function buildWarnings(text, pageTexts, dataItems) {
  const warnings = [];
  if (!text.trim()) {
    warnings.push({ id: uid('warning'), code: 'NO_TEXT', title: 'Текст не извлечён', message: 'Для изображения или сканированного PDF требуется OCR backend либо ручная вставка текста.', severity: 'warning' });
  }
  if (pageTexts.some((page) => page.confidence === 'low' && page.text)) {
    warnings.push({ id: uid('warning'), code: 'LOW_EXTRACTION_CONFIDENCE', title: 'Проверьте распознанный текст', message: 'Часть текста была извлечена с низкой уверенностью. Сверьте даты и суммы с оригиналом.', severity: 'warning' });
  }
  if (dataItems.some((item) => item.type === 'date' && item.confidence !== 'high')) {
    warnings.push({ id: uid('warning'), code: 'DATE_WITHOUT_YEAR', title: 'Дата указана не полностью', message: 'В одной или нескольких датах не найден год.', severity: 'warning' });
  }
  return warnings;
}

export function analyzeTextDocument({ pageTexts, settings = {}, analysisId }) {
  const normalizedPages = (pageTexts ?? []).map((page) => ({ ...page, text: normalizeWhitespace(page.text ?? '') }));
  const text = normalizeWhitespace(normalizedPages.map((page) => page.text).filter(Boolean).join('\n\n'));
  const type = detectDocumentType(text, settings.documentType);
  const { items: importantData, dates } = extractData(text, normalizedPages);
  const tasks = extractTasks(text, normalizedPages, dates);
  const title = titleFromText(text, type);
  const summary = buildSummary(text, title);
  return {
    analysisId,
    title,
    documentType: type,
    resultLanguage: settings.resultLanguage ?? 'ru',
    createdAt: new Date().toISOString(),
    summary: {
      standard: summary,
      simple: summary ? splitSentences(summary).map(simpleSentence).filter(Boolean).join('\n') : ''
    },
    tasks,
    importantData,
    clarifications: buildClarifications(importantData),
    warnings: buildWarnings(text, normalizedPages, importantData),
    sourceText: text,
    pageTexts: normalizedPages,
    provider: 'local',
    userCorrections: []
  };
}
