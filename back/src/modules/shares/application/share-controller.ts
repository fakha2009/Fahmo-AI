import type { ShareService } from "./share-service";
import type { ShareRecord } from "../domain/share";

export interface CreateShareInput {
  analysisId: string;
  expiresAt: Date | null;
}

export interface CreateShareOutput {
  token: string;
  share: ShareRecord;
}

export class ShareController {
  constructor(private readonly service: ShareService) {}

  async create(input: CreateShareInput): Promise<CreateShareOutput> {
    return this.service.create(input.analysisId, input.expiresAt);
  }

  async revoke(shareId: string): Promise<void> {
    await this.service.revoke(shareId);
  }

  async getPublic(token: string): Promise<ShareRecord> {
    return this.service.getPublicShare(token);
  }
}
