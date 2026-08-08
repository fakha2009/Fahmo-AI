import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import * as contracts from "../src/validation/index";

const namedSchemas: Record<string, z.ZodType> = {
  AnalysisResult: contracts.AnalysisResultSchema,
  ExtractedTask: contracts.ExtractedTaskSchema,
  ExtractedDate: contracts.ExtractedDateSchema,
  ExtractedAmount: contracts.ExtractedAmountSchema,
  SourceReference: contracts.SourceReferenceSchema,
  AnalysisWarning: contracts.AnalysisWarningSchema,
  ClarificationQuestion: contracts.ClarificationQuestionSchema,
  InputManifest: contracts.InputManifestSchema,
  UserPreferences: contracts.UserPreferencesSchema,
  Reminder: contracts.ReminderSchema,
  AnalysisStatusResponse: contracts.AnalysisStatusResponseSchema,
  ErrorResponse: contracts.ErrorResponseSchema,
  VersionConflictError: contracts.VersionConflictErrorSchema,
  PaginationQuery: contracts.PaginationQuerySchema,
};

const outDir = path.join(process.cwd(), "openapi", "schemas");
mkdirSync(outDir, { recursive: true });

for (const [name, schema] of Object.entries(namedSchemas)) {
  const jsonSchema = z.toJSONSchema(schema);
  writeFileSync(
    path.join(outDir, `${name}.json`),
    `${JSON.stringify(jsonSchema, null, 2)}\n`
  );
}

console.log(`exported ${Object.keys(namedSchemas).length} JSON Schemas to ${outDir}`);
