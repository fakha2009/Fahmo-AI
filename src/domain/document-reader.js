import { normalizeWhitespace } from '../core/utils.js';

export async function estimatePdfPageCount(blob) {
  try {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const sample = new TextDecoder('latin1').decode(bytes);
    const matches = sample.match(/\/Type\s*\/Page(?!s)\b/g);
    return Math.max(1, Math.min(matches?.length ?? 1, 999));
  } catch {
    return 1;
  }
}

function decodePdfLiteral(value) {
  return value
    .replace(/\\([nrtbf])/g, (_, code) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' })[code] ?? code)
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function extractLiteralStrings(text) {
  const values = [];
  const pattern = /\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g;
  let match;
  while ((match = pattern.exec(text))) values.push(decodePdfLiteral(match[1]));

  const arrays = /\[((?:\s*\((?:\\.|[^\\)])*\)\s*-?\d*\s*)+)\]\s*TJ/g;
  while ((match = arrays.exec(text))) {
    const inner = match[1];
    const stringPattern = /\((?:\\.|[^\\)])*\)/g;
    const parts = inner.match(stringPattern)?.map((part) => decodePdfLiteral(part.slice(1, -1))) ?? [];
    if (parts.length) values.push(parts.join(''));
  }
  return values;
}

function extractHexStrings(text) {
  const values = [];
  const pattern = /<([0-9A-Fa-f]{4,})>\s*(?:Tj|'|")/g;
  let match;
  while ((match = pattern.exec(text))) {
    const hex = match[1];
    try {
      const bytes = new Uint8Array(hex.match(/.{2}/g).map((pair) => parseInt(pair, 16)));
      let decoded = '';
      if (bytes[0] === 0xfe && bytes[1] === 0xff) decoded = new TextDecoder('utf-16be').decode(bytes.slice(2));
      else decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      if (/\p{L}/u.test(decoded)) values.push(decoded);
    } catch { /* best effort */ }
  }
  return values;
}

async function inflateStreams(bytes, sourceText) {
  if (!('DecompressionStream' in globalThis)) return [];
  const results = [];
  const streamPattern = /<<(?:.|\n|\r)*?\/FlateDecode(?:.|\n|\r)*?>>\s*stream\r?\n/g;
  let match;
  while ((match = streamPattern.exec(sourceText))) {
    const start = match.index + match[0].length;
    const endMarker = sourceText.indexOf('endstream', start);
    if (endMarker === -1) continue;
    let end = endMarker;
    if (sourceText[end - 2] === '\r' && sourceText[end - 1] === '\n') end -= 2;
    else if (sourceText[end - 1] === '\n' || sourceText[end - 1] === '\r') end -= 1;
    const chunk = bytes.slice(start, end);
    try {
      const stream = new Blob([chunk]).stream().pipeThrough(new DecompressionStream('deflate'));
      const buffer = await new Response(stream).arrayBuffer();
      results.push(new TextDecoder('latin1').decode(buffer));
    } catch {
      try {
        const stream = new Blob([chunk]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const buffer = await new Response(stream).arrayBuffer();
        results.push(new TextDecoder('latin1').decode(buffer));
      } catch { /* unsupported stream */ }
    }
    if (results.length >= 80) break;
  }
  return results;
}

export async function extractTextFromPdf(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const sourceText = new TextDecoder('latin1').decode(bytes);
  const streams = await inflateStreams(bytes, sourceText);
  const candidates = [sourceText, ...streams];
  const strings = [];
  for (const candidate of candidates) {
    strings.push(...extractLiteralStrings(candidate));
    strings.push(...extractHexStrings(candidate));
  }
  const text = normalizeWhitespace(strings.join(' '));
  return {
    text,
    confidence: text.length > 120 ? 'medium' : 'low',
    pageCount: Math.max(1, (sourceText.match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length)
  };
}

export async function extractTextFromImage(blob) {
  if (!('TextDetector' in globalThis) || !('createImageBitmap' in globalThis)) {
    return { text: '', confidence: 'low', engine: 'none' };
  }
  try {
    const bitmap = await createImageBitmap(blob);
    const detector = new globalThis.TextDetector();
    const results = await detector.detect(bitmap);
    bitmap.close?.();
    const text = normalizeWhitespace(results.map((item) => item.rawValue ?? '').join('\n'));
    return { text, confidence: text.length > 60 ? 'medium' : 'low', engine: 'text-detector' };
  } catch {
    return { text: '', confidence: 'low', engine: 'none' };
  }
}

export async function readSource(source) {
  if (source.text != null) return { text: normalizeWhitespace(source.text), confidence: 'high', pageCount: 1 };
  const type = source.mimeType || source.blob?.type || '';
  if (type === 'text/plain') {
    return { text: normalizeWhitespace(await source.blob.text()), confidence: 'high', pageCount: 1 };
  }
  if (type === 'application/pdf') return extractTextFromPdf(source.blob);
  if (type.startsWith('image/')) return extractTextFromImage(source.blob);
  return { text: '', confidence: 'low', pageCount: 1 };
}

export async function collectDocumentText(analysis, onProgress = () => {}, signal) {
  const pageTexts = [];
  const sources = analysis.sources ?? [];
  for (let index = 0; index < sources.length; index += 1) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const source = sources[index];
    const extracted = await readSource(source);
    const pages = analysis.pages?.filter((page) => page.sourceId === source.id && page.included !== false).sort((a, b) => a.order - b.order) ?? [];
    if (pages.length <= 1 || extracted.pageCount <= 1) {
      pageTexts.push({ page: pages[0]?.sourcePage ?? pageTexts.length + 1, sourceId: source.id, text: extracted.text, confidence: extracted.confidence });
    } else {
      // The dependency-free PDF reader cannot map every text operator to a page reliably.
      pageTexts.push({ page: pages[0]?.sourcePage ?? 1, sourceId: source.id, text: extracted.text, confidence: extracted.confidence });
    }
    onProgress({ current: index + 1, total: sources.length, source, extracted });
  }
  return pageTexts;
}
