import { prisma } from "../client";
import type {
  AnalysisInputRecord,
  AnalysisInputRepository,
  PersistAnalysisInputInput,
} from "../../modules/analysis/application/analysis-input-repository";

export class PrismaAnalysisInputRepository implements AnalysisInputRepository {
  async saveForAnalysis(analysisId: string, inputs: PersistAnalysisInputInput[]): Promise<void> {
    await prisma.$transaction(
      inputs.map((input) =>
        prisma.analysisInputMetadata.upsert({
          where: {
            analysis_id_input_index: {
              analysis_id: analysisId,
              input_index: input.index,
            },
          },
          update: {
            original_type: input.mimeType,
            original_name: input.originalName,
            mime_type: input.mimeType,
            size_bytes: input.sizeBytes,
            staging_key: input.stagingKey,
            text_content: input.textContent,
          },
          create: {
            analysis_id: analysisId,
            input_index: input.index,
            original_type: input.mimeType,
            original_name: input.originalName,
            mime_type: input.mimeType,
            size_bytes: input.sizeBytes,
            sha256: input.sha256 ?? "rehydrated",
            staging_key: input.stagingKey,
            text_content: input.textContent,
          },
        })
      )
    );
  }

  async listForAnalysis(analysisId: string): Promise<AnalysisInputRecord[]> {
    const rows = await prisma.analysisInputMetadata.findMany({
      where: { analysis_id: analysisId },
      orderBy: { input_index: "asc" },
    });
    return rows.map((row) => ({
      index: row.input_index,
      originalName: row.original_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      stagingKey: row.staging_key,
      textContent: row.text_content,
    }));
  }
}
