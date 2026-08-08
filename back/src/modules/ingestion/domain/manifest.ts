import { InputManifestSchema, type InputManifest, type InputManifestItem } from "../../../validation/request/manifest";
import { AppError } from "../../../shared/errors";
import { isImageType, type ProcessedFile } from "./types";

export type NormalizedManifestItem = InputManifestItem;

export function normalizeManifest(
  manifest: InputManifest | null,
  fileCount: number
): NormalizedManifestItem[] {
  if (fileCount === 1) {
    if (manifest === null) {
      return [
        {
          clientPageId: "page-0",
          fileIndex: 0,
          sourcePageNumber: null,
          finalOrder: 0,
          rotation: 0,
          crop: null,
        },
      ];
    }
    return parseManifest(manifest);
  }
  if (manifest === null) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      message: "InputManifest обязателен при нескольких файлах",
      params: { fileCount },
    });
  }
  return parseManifest(manifest);
}

function parseManifest(manifest: InputManifest): NormalizedManifestItem[] {
  try {
    return InputManifestSchema.parse(manifest);
  } catch (error) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      message: "Некорректный InputManifest",
      details: error,
    });
  }
}

export function validateManifestBounds(
  items: NormalizedManifestItem[],
  processed: ProcessedFile[]
): void {
  for (const item of items) {
    if (item.fileIndex < 0 || item.fileIndex >= processed.length) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: `fileIndex вне границ: ${item.fileIndex}`,
        params: { fileIndex: item.fileIndex, fileCount: processed.length },
      });
    }
    const file = processed[item.fileIndex];
    if (file === undefined) {
      throw new AppError({ code: "VALIDATION_ERROR", message: "Файл манифеста не найден" });
    }
    if (isImageType(file.type)) {
      if (item.sourcePageNumber !== null && item.sourcePageNumber !== 1) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Изображение — одна страница",
          params: { clientPageId: item.clientPageId, sourcePageNumber: item.sourcePageNumber },
        });
      }
    } else if (file.type === "application/pdf") {
      if (item.sourcePageNumber === null) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "Для PDF необходимо указать sourcePageNumber",
          params: { clientPageId: item.clientPageId },
        });
      }
      if (item.sourcePageNumber > (file.pageCount ?? 0)) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: "sourcePageNumber не существует в PDF",
          params: {
            clientPageId: item.clientPageId,
            sourcePageNumber: item.sourcePageNumber,
            pageCount: file.pageCount ?? 0,
          },
        });
      }
    }
  }
  const covered = new Set(items.map((item) => item.fileIndex));
  for (let index = 0; index < processed.length; index += 1) {
    if (!covered.has(index)) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: `Манифест не покрывает файл ${index}`,
        params: { fileIndex: index },
      });
    }
  }
}
