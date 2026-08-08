import type { Readable } from "node:stream";
import type { SourcePreviewMode } from "../../../validation/common";

export const SUPPORTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain",
] as const;

export type SupportedFileType = (typeof SUPPORTED_MIME_TYPES)[number];

export const EXTENSION_TO_TYPE: Readonly<Record<string, SupportedFileType>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  text: "text/plain",
};

export interface FileLimits {
  maxUploadBytes: number;
  maxImageCount: number;
  maxPdfPages: number;
  maxTextLengthChars: number;
}

export interface InputEnvelope {
  index: number;
  originalName: string;
  declaredMimeType: string | null;
  sizeBytes: number;
  content: Readable;
}

export interface StagedObject {
  key: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  expiresAt: Date | null;
}

export interface SourcePreviewAsset {
  clientPageId: string;
  inputIndex: number;
  pageNumber: number;
  storageKey: string;
  mimeType: "image/jpeg" | "image/webp";
  width: number;
  height: number;
  sha256: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface ProcessedFile {
  index: number;
  originalName: string;
  type: SupportedFileType;
  sha256: string;
  sizeBytes: number;
  pageCount: number | null;
  width: number | null;
  height: number | null;
  stagingKey: string | null;
  text: string | null;
  previews: SourcePreviewAsset[];
}

export interface IngestionResult {
  files: ProcessedFile[];
  totalBytes: number;
}

export interface PreviewPolicy {
  mode: SourcePreviewMode;
  ttl: { days?: number; hours?: number } | null;
}

export function extensionOf(fileName: string): string | null {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return null;
  }
  return base.slice(dot + 1).toLowerCase();
}

export function isImageType(type: SupportedFileType): boolean {
  return type === "image/jpeg" || type === "image/png" || type === "image/webp";
}
