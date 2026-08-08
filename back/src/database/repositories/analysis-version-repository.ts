import { Prisma, type AnalysisVersion as PrismaAnalysisVersion } from "@prisma/client";
import { prisma } from "../client";
import type {
  AnalysisVersionRecord,
  AnalysisVersionRepository,
} from "../../modules/analysis/application/analysis-version-repository";
import { ChangeSourceSchema, type ChangeSource } from "../../validation/common";

const CHANGE_SOURCE_MAP: Record<PrismaAnalysisVersion["change_source"], ChangeSource> = {
  AI: "ai",
  USER: "user",
  CLARIFICATION: "clarification",
  REANALYZE: "reanalyze",
};

const CHANGE_SOURCE_DOMAIN = ChangeSourceSchema.options;

export class PrismaAnalysisVersionRepository implements AnalysisVersionRepository {
  async listForAnalysis(analysisId: string): Promise<AnalysisVersionRecord[]> {
    const rows = await prisma.analysisVersion.findMany({
      where: { analysis_id: analysisId },
      orderBy: { version: "asc" },
    });
    return rows.map(versionToRecord);
  }

  async listUserEdits(analysisId: string): Promise<AnalysisVersionRecord[]> {
    const rows = await prisma.analysisVersion.findMany({
      where: {
        analysis_id: analysisId,
        user_edited: { not: Prisma.DbNull },
      },
      orderBy: { version: "asc" },
    });
    return rows.map(versionToRecord);
  }
}

function versionToRecord(row: PrismaAnalysisVersion): AnalysisVersionRecord {
  const source = CHANGE_SOURCE_MAP[row.change_source];
  if (!CHANGE_SOURCE_DOMAIN.includes(source)) {
    throw new Error(`unknown change source: ${row.change_source}`);
  }
  return {
    id: row.id,
    analysisId: row.analysis_id,
    version: row.version,
    changeSource: source,
    aiOriginal: row.ai_original,
    userEdited: row.user_edited,
    structuredResult: row.structured_result,
    changedFields: row.changed_fields,
    createdAt: row.created_at,
  };
}
