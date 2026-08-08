import type { ShareRecord, ShareSnapshot } from "../domain/share";

export interface ShareCreateInput {
  id: string;
  analysisId: string;
  tokenHash: string;
  snapshot: ShareSnapshot;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface ShareRepository {
  create(input: ShareCreateInput): Promise<ShareRecord>;
  get(id: string): Promise<ShareRecord | null>;
  getByTokenHash(tokenHash: string): Promise<ShareRecord | null>;
  incrementViewCount(id: string, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
  listByAnalysisId(analysisId: string): Promise<ShareRecord[]>;
  deleteByAnalysisId(analysisId: string): Promise<void>;
}
