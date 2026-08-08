export interface SourceAssetRecord {
  id: string;
  analysisId: string;
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

export interface SourceAssetCreateInput {
  id: string;
  analysisId: string;
  clientPageId: string;
  inputIndex: number;
  pageNumber: number;
  storageKey: string;
  mimeType: "image/jpeg" | "image/webp";
  width: number;
  height: number;
  sha256: string;
  expiresAt: Date;
}

export interface SourceAssetRepository {
  create(input: SourceAssetCreateInput): Promise<SourceAssetRecord>;
  getById(id: string): Promise<SourceAssetRecord | null>;
  getByAnalysisId(analysisId: string): Promise<SourceAssetRecord[]>;
  deleteById(id: string): Promise<void>;
  listExpired(now: Date): Promise<SourceAssetRecord[]>;
}
