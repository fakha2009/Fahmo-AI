import type { Readable } from "node:stream";
import { AppError } from "../../../shared/errors";
import { readTextValidated, streamToBuffer } from "../../../shared/utils/stream";
import { sha256Hex } from "../../../shared/utils/hash";
import type { InputManifest } from "../../../validation/request/manifest";
import {
  EXTENSION_TO_TYPE,
  extensionOf,
  type IngestionResult,
  type InputEnvelope,
  type PreviewPolicy,
  type ProcessedFile,
  type SourcePreviewAsset,
} from "../domain/types";
import {
  normalizeManifest,
  validateManifestBounds,
  type NormalizedManifestItem,
} from "../domain/manifest";
import { SignatureChecker } from "./signature-checker";
import { FileValidator } from "./file-validator";
import { ImageProcessor } from "./image-processor";
import { PdfProcessor } from "./pdf-processor";
import { TemporaryStorageService } from "./temporary-storage";
import { SourcePreviewService } from "./source-preview";

export interface IngestOptions {
  previewPolicy: PreviewPolicy;
  expiresAt?: Date | null;
}

export class IngestionService {
  constructor(
    private readonly validator: FileValidator,
    private readonly images: ImageProcessor,
    private readonly pdfs: PdfProcessor,
    private readonly staging: TemporaryStorageService,
    private readonly previews: SourcePreviewService
  ) {}

  async ingest(
    files: InputEnvelope[],
    manifest: InputManifest | null,
    options: IngestOptions
  ): Promise<IngestionResult> {
    this.validator.validateBatchCount(files.length);
    const stagedKeys: string[] = [];
    const previewAssets: SourcePreviewAsset[] = [];
    try {
      const items = normalizeManifest(manifest, files.length);
      const processed: ProcessedFile[] = [];
      for (const file of files) {
        this.validator.validateEnvelope(file);
        const { stream, firstBytes } = await SignatureChecker.probe(file.content);
        const extension = extensionOf(file.originalName);
        const extensionType = extension === null ? undefined : EXTENSION_TO_TYPE[extension];
        if (extensionType === undefined) {
          throw new AppError({
            code: "UNSUPPORTED_FILE_TYPE",
            message: "Неподдерживаемое расширение файла",
            params: { fileIndex: file.index, extension: extension ?? "" },
          });
        }
        const type = this.validator.checkTypeConsistency(
          file.declaredMimeType,
          extensionType,
          SignatureChecker.check(firstBytes),
          firstBytes
        );
        const result = await this.processFile(file, stream, type, items, options, stagedKeys, previewAssets);
        processed.push(result);
      }
      validateManifestBounds(items, processed);
      const totalBytes = processed.reduce((sum, file) => sum + file.sizeBytes, 0);
      return { files: processed, totalBytes };
    } catch (error) {
      for (const asset of previewAssets) {
        await this.previews.remove(asset).catch(() => undefined);
      }
      for (const key of stagedKeys) {
        await this.staging.remove(key).catch(() => undefined);
      }
      throw error;
    }
  }

  private async processFile(
    file: InputEnvelope,
    stream: Readable,
    type: ProcessedFile["type"],
    items: NormalizedManifestItem[],
    options: IngestOptions,
    stagedKeys: string[],
    previewAssets: SourcePreviewAsset[]
  ): Promise<ProcessedFile> {
    if (type === "text/plain") {
      return this.processText(file, stream);
    }
    if (type === "application/pdf") {
      return this.processPdf(file, stream, type, options, stagedKeys);
    }
    return this.processImage(file, stream, type, items, options, stagedKeys, previewAssets);
  }

  private async processImage(
    file: InputEnvelope,
    stream: Readable,
    type: ProcessedFile["type"],
    items: NormalizedManifestItem[],
    options: IngestOptions,
    stagedKeys: string[],
    previewAssets: SourcePreviewAsset[]
  ): Promise<ProcessedFile> {
    const manifestItems = items.filter((item) => item.fileIndex === file.index);
    if (manifestItems.length === 0) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: `Манифест не содержит позицию для файла ${file.index}`,
        params: { fileIndex: file.index },
      });
    }
    if (manifestItems.length > 1) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Несколько манифест-позиций для одного изображения",
        params: { fileIndex: file.index, itemCount: manifestItems.length },
      });
    }
    const item = manifestItems[0];
    if (item === undefined) {
      throw new AppError({ code: "INTERNAL_ERROR" });
    }
    const buffer = await streamToBuffer(stream);
    const processed = await this.images.process({ buffer, rotation: item.rotation, crop: item.crop });
    const staged = await this.staging.stageBuffer({
      prefix: "processed",
      contentType: "image/jpeg",
      buffer: processed.buffer,
      expiresAt: options.expiresAt ?? null,
    });
    stagedKeys.push(staged.key);
    const preview = await this.previews.create({
      image: processed,
      page: {
        clientPageId: item.clientPageId,
        inputIndex: file.index,
        pageNumber: item.sourcePageNumber ?? 1,
      },
      policy: options.previewPolicy,
    });
    if (preview !== null) {
      previewAssets.push(preview);
    }
    return {
      index: file.index,
      originalName: file.originalName,
      type,
      sha256: staged.sha256,
      sizeBytes: staged.sizeBytes,
      pageCount: 1,
      width: processed.width,
      height: processed.height,
      stagingKey: staged.key,
      text: null,
      previews: preview === null ? [] : [preview],
    };
  }

  private async processPdf(
    file: InputEnvelope,
    stream: Readable,
    type: ProcessedFile["type"],
    options: IngestOptions,
    stagedKeys: string[]
  ): Promise<ProcessedFile> {
    const buffer = await streamToBuffer(stream);
    const analysis = await this.pdfs.analyze(buffer);
    this.validator.validatePdfPageCount(analysis.pageCount);
    const staged = await this.staging.stageBuffer({
      prefix: "pdf",
      contentType: "application/pdf",
      buffer,
      expiresAt: options.expiresAt ?? null,
    });
    stagedKeys.push(staged.key);
    return {
      index: file.index,
      originalName: file.originalName,
      type,
      sha256: staged.sha256,
      sizeBytes: staged.sizeBytes,
      pageCount: analysis.pageCount,
      width: null,
      height: null,
      stagingKey: staged.key,
      text: null,
      previews: [],
    };
  }

  private async processText(
    file: InputEnvelope,
    stream: Readable
  ): Promise<ProcessedFile> {
    let text: string;
    try {
      text = await readTextValidated(stream);
    } catch (error) {
      throw new AppError({
        code: "CORRUPTED_FILE",
        message: "Файл не является корректным UTF-8 текстом",
        cause: error,
      });
    }
    this.validator.validateTextLength(text);
    const bytes = Buffer.from(text, "utf8");
    return {
      index: file.index,
      originalName: file.originalName,
      type: "text/plain",
      sha256: sha256Hex(bytes),
      sizeBytes: bytes.length,
      pageCount: null,
      width: null,
      height: null,
      stagingKey: null,
      text,
      previews: [],
    };
  }
}
