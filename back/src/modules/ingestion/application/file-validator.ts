import { AppError } from "../../../shared/errors";
import {
  EXTENSION_TO_TYPE,
  extensionOf,
  isImageType,
  type FileLimits,
  type InputEnvelope,
  type SupportedFileType,
} from "../domain/types";
import { MimeDetector } from "./mime-detector";

const MIME_ALIASES: Readonly<Record<string, string>> = {
  "image/jpg": "image/jpeg",
  "application/x-pdf": "application/pdf",
  "text/x-plain": "text/plain",
};

function normalizedMime(mime: string | null): string | null {
  if (mime === null) {
    return null;
  }
  const value = mime.toLowerCase();
  return MIME_ALIASES[value] ?? value;
}

export class FileValidator {
  constructor(private readonly limits: FileLimits) {}

  validateBatchCount(fileCount: number): void {
    if (fileCount > this.limits.maxImageCount) {
      throw new AppError({
        code: "TOO_MANY_FILES",
        message: "Превышено максимальное количество файлов",
        params: { actualCount: fileCount, maximumCount: this.limits.maxImageCount },
      });
    }
  }

  validateEnvelope(file: InputEnvelope): void {
    if (file.sizeBytes > this.limits.maxUploadBytes) {
      throw new AppError({
        code: "FILE_TOO_LARGE",
        message: "Файл превышает допустимый размер",
        params: {
          actualBytes: file.sizeBytes,
          maximumBytes: this.limits.maxUploadBytes,
          fileIndex: file.index,
        },
      });
    }
    const extension = extensionOf(file.originalName);
    const extensionType = extension === null ? undefined : EXTENSION_TO_TYPE[extension];
    if (extensionType === undefined) {
      throw new AppError({
        code: "UNSUPPORTED_FILE_TYPE",
        message: "Неподдерживаемое расширение файла",
        params: { fileIndex: file.index, extension: extension ?? "" },
      });
    }
  }

  checkTypeConsistency(
    declaredMimeType: string | null,
    extensionType: SupportedFileType,
    detected: SupportedFileType | null,
    firstBytes: Buffer
  ): SupportedFileType {
    const declared = normalizedMime(declaredMimeType);
    if (detected !== null) {
      if (detected !== extensionType) {
        throw new AppError({
          code: "CORRUPTED_FILE",
          message: "Сигнатура файла не соответствует расширению",
          params: { fileIndex: -1, detected, extensionType },
        });
      }
      if (declared !== null && declared !== detected) {
        throw new AppError({
          code: "CORRUPTED_FILE",
          message: "MIME-тип не соответствует сигнатуре файла",
          params: { declared, detected },
        });
      }
      return detected;
    }
    if (extensionType === "text/plain") {
      if (declared !== null && declared !== "text/plain") {
        throw new AppError({
          code: "CORRUPTED_FILE",
          message: "Текстовый файл не имеет сигнатуры, но MIME-тип указан иной",
          params: { declared },
        });
      }
      if (!MimeDetector.looksLikeText(firstBytes)) {
        throw new AppError({
          code: "CORRUPTED_FILE",
          message: "Содержимое не является корректным UTF-8 текстом",
        });
      }
      return "text/plain";
    }
    throw new AppError({
      code: "UNSUPPORTED_FILE_TYPE",
      message: "Сигнатура файла не соответствует ни одному поддерживаемому типу",
      params: { extensionType },
    });
  }

  validatePdfPageCount(pageCount: number): void {
    if (pageCount > this.limits.maxPdfPages) {
      throw new AppError({
        code: "PDF_PAGE_LIMIT_EXCEEDED",
        message: "PDF содержит слишком много страниц",
        params: { actualPages: pageCount, maximumPages: this.limits.maxPdfPages },
      });
    }
  }

  validateTextLength(text: string): void {
    if (text.length > this.limits.maxTextLengthChars) {
      throw new AppError({
        code: "TEXT_TOO_LONG",
        message: "Текст превышает допустимую длину",
        params: {
          actualCharacters: text.length,
          maximumCharacters: this.limits.maxTextLengthChars,
        },
      });
    }
  }

  isImage(type: SupportedFileType): boolean {
    return isImageType(type);
  }
}
