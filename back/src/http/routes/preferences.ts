import { z } from "zod";
import { AppError } from "../../shared/errors";
import type { PreferencesRecord } from "../../modules/preferences/application/preferences-repository";
import { UserPreferencesUpdateSchema } from "../../validation/response/preferences";
import { readJsonBody } from "../body";
import type { RouteHandler } from "../router";
import { sendJson } from "../responses";
import { requireSession } from "../session";

const PreferencesPatchSchema = UserPreferencesUpdateSchema.safeExtend({
  expectedRevision: z.number().int().min(1),
});

export const getPreferencesRoute: RouteHandler = async ({ res, ctx, rc }) => {
  const session = await requireSession(ctx.sessions, rc);
  const record = await ctx.preferencesService.getOrCreate(owner(session.session.id));
  sendJson({ res, rc, body: preferencesToResponse(record) });
};

export const patchPreferencesRoute: RouteHandler = async ({ req, res, ctx, rc }) => {
  const session = await requireSession(ctx.sessions, rc);
  const parsed = PreferencesPatchSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) {
    throw new AppError({ code: "VALIDATION_ERROR", message: "Некорректные настройки", details: parsed.error.issues });
  }
  const { expectedRevision, ...patch } = parsed.data;
  const record = await ctx.preferencesService.patch(owner(session.session.id), expectedRevision, patch);
  sendJson({ res, rc, body: preferencesToResponse(record) });
};

function owner(sessionId: string) {
  return { sessionId, userId: null };
}

function preferencesToResponse(preferences: PreferencesRecord) {
  return {
    interfaceLanguage: preferences.interfaceLanguage,
    outputLanguage: preferences.outputLanguage,
    explanationMode: preferences.explanationMode,
    theme: preferences.theme,
    reducedMotion: preferences.reducedMotion,
    textScale: preferences.textScale,
    timezone: preferences.timezone,
    preferredProvider: preferences.preferredProvider,
    saveHistory: preferences.saveHistory,
    sourcePreviewMode: preferences.sourcePreviewMode,
    retentionMode: preferences.retentionMode,
    defaultReminderOffsetMinutes: preferences.defaultReminderOffsetMinutes,
    pushEnabled: preferences.pushEnabled,
    revision: preferences.revision,
    updatedAt: preferences.updatedAt.toISOString(),
  };
}
