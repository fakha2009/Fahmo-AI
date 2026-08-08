import { z } from "zod";
import {
  ExplanationModeSchema,
  OutputLanguageSchema,
  RetentionModeSchema,
  SourcePreviewModeSchema,
  TextScaleSchema,
  ThemeModeSchema,
  TimezoneSchema,
} from "../common";
import { RevisionNumberSchema } from "../request/revision";

const preferenceFields = {
  interfaceLanguage: OutputLanguageSchema,
  outputLanguage: OutputLanguageSchema,
  explanationMode: ExplanationModeSchema,
  theme: ThemeModeSchema,
  reducedMotion: z.boolean(),
  textScale: TextScaleSchema,
  timezone: TimezoneSchema,
  preferredProvider: z.string().max(64).nullable(),
  saveHistory: z.boolean(),
  sourcePreviewMode: SourcePreviewModeSchema,
  retentionMode: RetentionModeSchema,
  defaultReminderOffsetMinutes: z.number().int().min(0).max(525600).nullable(),
  pushEnabled: z.boolean(),
} as const;

export const UserPreferencesSchema = z
  .object({
    ...preferenceFields,
    revision: RevisionNumberSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const UserPreferencesUpdateSchema = z
  .object(preferenceFields)
  .partial()
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "PATCH должен содержать хотя бы одно поле",
      });
    }
  });

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
export type UserPreferencesUpdate = z.infer<typeof UserPreferencesUpdateSchema>;
