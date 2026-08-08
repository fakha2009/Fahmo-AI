import { Prisma, type UserPreferences as PrismaUserPreferences } from "@prisma/client";
import { prisma } from "../client";
import {
  explanationMode,
  outputLanguage,
  retentionMode,
  sourcePreviewMode,
  textScale,
  themeMode,
} from "../mappers/enums";
import type {
  PreferencesCreateInput,
  PreferencesRecord,
  PreferencesRepository,
  PreferencesUpdatePatch,
} from "../../modules/preferences/application/preferences-repository";
import type { RevisionedUpdateResult } from "../../modules/versioning/domain/concurrency";

export class PrismaPreferencesRepository implements PreferencesRepository {
  async getForOwner(
    sessionId: string | null,
    userId: string | null
  ): Promise<PreferencesRecord | null> {
    if ((sessionId === null) === (userId === null)) {
      return null;
    }
    const row =
      sessionId !== null
        ? await prisma.userPreferences.findUnique({ where: { session_id: sessionId } })
        : await prisma.userPreferences.findUnique({ where: { user_id: userId as string } });
    return row === null ? null : preferencesToRecord(row);
  }

  async create(input: PreferencesCreateInput): Promise<PreferencesRecord> {
    const row = await prisma.userPreferences.create({
      data: toCreateData(input),
    });
    return preferencesToRecord(row);
  }

  async update(
    id: string,
    expectedRevision: number,
    patch: PreferencesUpdatePatch
  ): Promise<RevisionedUpdateResult<PreferencesRecord>> {
    const updated = await prisma.userPreferences.updateMany({
      where: { id, revision: expectedRevision },
      data: {
        ...(patch.interfaceLanguage !== undefined && {
          interface_language: outputLanguage.toPrisma(patch.interfaceLanguage),
        }),
        ...(patch.outputLanguage !== undefined && {
          output_language: outputLanguage.toPrisma(patch.outputLanguage),
        }),
        ...(patch.explanationMode !== undefined && {
          explanation_mode: explanationMode.toPrisma(patch.explanationMode),
        }),
        ...(patch.theme !== undefined && { theme: themeMode.toPrisma(patch.theme) }),
        ...(patch.reducedMotion !== undefined && { reduced_motion: patch.reducedMotion }),
        ...(patch.textScale !== undefined && {
          text_scale: textScale.toPrisma(patch.textScale),
        }),
        ...(patch.timezone !== undefined && { timezone: patch.timezone }),
        ...(patch.preferredProvider !== undefined && {
          preferred_provider: patch.preferredProvider,
        }),
        ...(patch.saveHistory !== undefined && { save_history: patch.saveHistory }),
        ...(patch.sourcePreviewMode !== undefined && {
          source_preview_mode: sourcePreviewMode.toPrisma(patch.sourcePreviewMode),
        }),
        ...(patch.retentionMode !== undefined && {
          retention_mode: retentionMode.toPrisma(patch.retentionMode),
        }),
        ...(patch.defaultReminderOffsetMinutes !== undefined && {
          default_reminder_offset_minutes: patch.defaultReminderOffsetMinutes,
        }),
        ...(patch.pushEnabled !== undefined && { push_enabled: patch.pushEnabled }),
        revision: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      const current = await prisma.userPreferences.findUnique({ where: { id } });
      if (current === null) {
        return { kind: "not_found" };
      }
      return { kind: "conflict", serverRevision: current.revision };
    }
    const row = await prisma.userPreferences.findUnique({ where: { id } });
    if (row === null) {
      return { kind: "not_found" };
    }
    return { kind: "ok", record: preferencesToRecord(row) };
  }
}

function toCreateData(input: PreferencesCreateInput): Prisma.UserPreferencesCreateInput {
  return {
    id: input.id,
    session: input.sessionId === null ? undefined : { connect: { id: input.sessionId } },
    user: input.userId === null ? undefined : { connect: { id: input.userId } },
    interface_language: outputLanguage.toPrisma(input.interfaceLanguage),
    output_language: outputLanguage.toPrisma(input.outputLanguage),
    explanation_mode: explanationMode.toPrisma(input.explanationMode),
    theme: themeMode.toPrisma(input.theme),
    reduced_motion: input.reducedMotion,
    text_scale: textScale.toPrisma(input.textScale),
    timezone: input.timezone,
    preferred_provider: input.preferredProvider,
    save_history: input.saveHistory,
    source_preview_mode: sourcePreviewMode.toPrisma(input.sourcePreviewMode),
    retention_mode: retentionMode.toPrisma(input.retentionMode),
    default_reminder_offset_minutes: input.defaultReminderOffsetMinutes,
    push_enabled: input.pushEnabled,
  };
}

export function preferencesToRecord(row: PrismaUserPreferences): PreferencesRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    interfaceLanguage: outputLanguage.fromPrisma(row.interface_language),
    outputLanguage: outputLanguage.fromPrisma(row.output_language),
    explanationMode: explanationMode.fromPrisma(row.explanation_mode),
    theme: themeMode.fromPrisma(row.theme),
    reducedMotion: row.reduced_motion,
    textScale: textScale.fromPrisma(row.text_scale),
    timezone: row.timezone,
    preferredProvider: row.preferred_provider,
    saveHistory: row.save_history,
    sourcePreviewMode: sourcePreviewMode.fromPrisma(row.source_preview_mode),
    retentionMode: retentionMode.fromPrisma(row.retention_mode),
    defaultReminderOffsetMinutes: row.default_reminder_offset_minutes,
    pushEnabled: row.push_enabled,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
