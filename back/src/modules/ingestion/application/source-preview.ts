import { Readable as ReadableStream } from "node:stream";
import { AppError } from "../../../shared/errors";
import { randomHex } from "../../../shared/utils/hash";
import type { StoragePort } from "../../../storage/contracts/storage-port";
import type { PreviewPolicy, SourcePreviewAsset } from "../domain/types";

export interface PreviewCreateInput {
  image: {
    buffer: Buffer;
    width: number;
    height: number;
    sha256: string;
  };
  page: {
    clientPageId: string;
    inputIndex: number;
    pageNumber: number;
  };
  policy: PreviewPolicy;
}

function addTtl(from: Date, ttl: { days?: number; hours?: number }): Date {
  const milliseconds =
    (ttl.days ?? 0) * 24 * 60 * 60 * 1000 + (ttl.hours ?? 0) * 60 * 60 * 1000;
  return new Date(from.getTime() + milliseconds);
}

export class SourcePreviewService {
  constructor(private readonly storage: StoragePort) {}

  async create(input: PreviewCreateInput): Promise<SourcePreviewAsset | null> {
    if (input.policy.mode === "no_preview") {
      return null;
    }
    if (input.policy.ttl === null) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Для режима preview требуется политика TTL",
        params: { mode: input.policy.mode },
      });
    }
    const createdAt = new Date();
    const expiresAt = addTtl(createdAt, input.policy.ttl);
    const stored = await this.storage.put({
      key: `previews/${randomHex()}.jpeg`,
      contentType: "image/jpeg",
      body: ReadableStream.from(input.image.buffer),
      expiresAt,
    });
    return {
      clientPageId: input.page.clientPageId,
      inputIndex: input.page.inputIndex,
      pageNumber: input.page.pageNumber,
      storageKey: stored.key,
      mimeType: "image/jpeg",
      width: input.image.width,
      height: input.image.height,
      sha256: stored.sha256,
      expiresAt: stored.expiresAt ?? createdAt,
      createdAt,
    };
  }

  async remove(asset: SourcePreviewAsset): Promise<void> {
    await this.storage.delete(asset.storageKey);
  }
}
