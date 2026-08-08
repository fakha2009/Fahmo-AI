import type { SourcePreviewMode } from "../../../validation/common";
import type { PreviewPolicy } from "../../ingestion/domain/types";

export const HISTORY_TTL_DAYS = 30;
export const TEMPORARY_TTL_HOURS = 24;

export function previewPolicyFor(mode: SourcePreviewMode): PreviewPolicy {
  switch (mode) {
    case "history":
      return { mode, ttl: { days: HISTORY_TTL_DAYS } };
    case "temporary":
      return { mode, ttl: { hours: TEMPORARY_TTL_HOURS } };
    case "no_preview":
      return { mode, ttl: null };
  }
}
