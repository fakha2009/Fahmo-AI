import { AppError } from "../../../shared/errors";
import { randomHex } from "../../../shared/utils/hash";
import { revisionConflict } from "../../versioning/domain/concurrency";
import type {
  PreferencesRecord,
  PreferencesRepository,
  PreferencesUpdatePatch,
} from "./preferences-repository";

export interface PreferencesOwner {
  sessionId: string | null;
  userId: string | null;
}

export interface PreferencesDefaults {
  interfaceLanguage: PreferencesRecord["interfaceLanguage"];
  outputLanguage: PreferencesRecord["outputLanguage"];
  explanationMode: PreferencesRecord["explanationMode"];
  theme: PreferencesRecord["theme"];
  reducedMotion: boolean;
  textScale: PreferencesRecord["textScale"];
  timezone: string;
  preferredProvider: string | null;
  saveHistory: boolean;
  sourcePreviewMode: PreferencesRecord["sourcePreviewMode"];
  retentionMode: PreferencesRecord["retentionMode"];
  defaultReminderOffsetMinutes: number | null;
  pushEnabled: boolean;
}

export const DEFAULT_PREFERENCES: PreferencesDefaults = {
  interfaceLanguage: "ru",
  outputLanguage: "ru",
  explanationMode: "standard",
  theme: "system",
  reducedMotion: false,
  textScale: "normal",
  timezone: "Asia/Dushanbe",
  preferredProvider: null,
  saveHistory: true,
  sourcePreviewMode: "history",
  retentionMode: "history",
  defaultReminderOffsetMinutes: null,
  pushEnabled: false,
};

export class PreferencesService {
  constructor(
    private readonly repository: PreferencesRepository,
    private readonly defaults: PreferencesDefaults = DEFAULT_PREFERENCES
  ) {}

  /**
   * GET /preferences: возвращает настройки владельца, создавая запись
   * с дефолтами при первом обращении (revision = 1).
   */
  async getOrCreate(owner: PreferencesOwner): Promise<PreferencesRecord> {
    this.assertOwner(owner);
    const existing = await this.repository.getForOwner(owner.sessionId, owner.userId);
    if (existing !== null) {
      return existing;
    }
    return this.repository.create({
      id: randomHex(16),
      sessionId: owner.sessionId,
      userId: owner.userId,
      ...this.defaults,
    });
  }

  /**
   * PATCH /preferences с optimistic concurrency (If-Match / expectedRevision):
   * при расхождении версии — VERSION_CONFLICT с serverRevision клиенту.
   */
  async patch(
    owner: PreferencesOwner,
    expectedRevision: number,
    patch: PreferencesUpdatePatch
  ): Promise<PreferencesRecord> {
    this.assertOwner(owner);
    if (Object.keys(patch).length === 0) {
      throw new AppError({ code: "VALIDATION_ERROR", message: "PATCH не содержит полей" });
    }
    const existing = await this.repository.getForOwner(owner.sessionId, owner.userId);
    if (existing === null) {
      throw new AppError({ code: "NOT_FOUND", message: "Настройки не найдены" });
    }
    const result = await this.repository.update(existing.id, expectedRevision, patch);
    switch (result.kind) {
      case "ok":
        return result.record;
      case "conflict":
        throw revisionConflict(result.serverRevision);
      case "not_found":
        throw new AppError({ code: "NOT_FOUND", message: "Настройки не найдены" });
    }
  }

  private assertOwner(owner: PreferencesOwner): void {
    const hasSession = owner.sessionId !== null;
    const hasUser = owner.userId !== null;
    if (hasSession === hasUser) {
      throw new AppError({ code: "UNAUTHORIZED", message: "Владелец: session XOR user" });
    }
  }
}
