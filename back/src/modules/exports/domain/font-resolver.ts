import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

interface FontPair {
  regular: string;
  bold: string | null;
}

const require = createRequire(import.meta.url);

function bundledFont(modulePath: string): string | null {
  try {
    return require.resolve(modulePath);
  } catch {
    return null;
  }
}

const bundledRegular = bundledFont("dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
const bundledBold = bundledFont("dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf");

const CANDIDATES: FontPair[] = [
  // Deterministic production font: Latin, Russian and Tajik glyphs are bundled
  // with the backend instead of depending on the Railway base image.
  ...(bundledRegular === null ? [] : [{ regular: bundledRegular, bold: bundledBold }]),
  // Windows
  { regular: "C:\\Windows\\Fonts\\arial.ttf", bold: "C:\\Windows\\Fonts\\arialbd.ttf" },
  { regular: "C:\\Windows\\Fonts\\segoeui.ttf", bold: "C:\\Windows\\Fonts\\segoeuib.ttf" },
  { regular: "C:\\Windows\\Fonts\\times.ttf", bold: "C:\\Windows\\Fonts\\timesbd.ttf" },
  // Debian/Ubuntu
  { regular: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", bold: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" },
  { regular: "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", bold: "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" },
  { regular: "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf", bold: "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" },
  // Fedora/Arch
  { regular: "/usr/share/fonts/dejavu/DejaVuSans.ttf", bold: "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf" },
  { regular: "/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf", bold: "/usr/share/fonts/liberation-sans/LiberationSans-Bold.ttf" },
  // macOS
  { regular: "/System/Library/Fonts/Supplemental/Arial.ttf", bold: "/System/Library/Fonts/Supplemental/Arial Bold.ttf" },
];

export interface ResolvedFont {
  /** TTF/WOFF-байты для встраивания (pdf-lib) или null → стандартный шрифт. */
  regularBytes: Uint8Array | null;
  boldBytes: Uint8Array | null;
  /** Имя для диагностики. */
  name: string;
}

function loadFont(path: string): Uint8Array | null {
  try {
    if (!existsSync(path)) {
      return null;
    }
    const bytes = readFileSync(path);
    if (!isTrueTypeCollection(bytes)) {
      return bytes;
    }
  } catch {
    // пробуем следующий кандидат
  }
  return null;
}

/**
 * Находит bundled или системный шрифт с поддержкой кириллицы/таджикского
 * для встраивания в PDF. Результат кешируется.
 */
export class FontResolver {
  private cached: ResolvedFont | null = null;

  constructor(private readonly candidates: FontPair[] = CANDIDATES) {}

  resolve(): ResolvedFont {
    if (this.cached !== null) {
      return this.cached;
    }
    for (const pair of this.candidates) {
      const regular = loadFont(pair.regular);
      if (regular === null) {
        continue;
      }
      const bold = pair.bold === null ? null : loadFont(pair.bold);
      this.cached = {
        regularBytes: regular,
        boldBytes: bold,
        name: pair.bold !== null && bold !== null ? `${pair.regular} + bold` : pair.regular,
      };
      return this.cached;
    }
    this.cached = { regularBytes: null, boldBytes: null, name: "builtin" };
    return this.cached;
  }
}

/** .ttc (TrueType Collection) pdf-lib не встраивает — пропускаем. */
function isTrueTypeCollection(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x74 &&
    bytes[1] === 0x74 &&
    bytes[2] === 0x63 &&
    bytes[3] === 0x66
  );
}
