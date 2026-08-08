export interface CleanupResult {
  stagedRemoved: number;
  expiredAssetsRemoved: number;
  eventsRemoved: number;
  staleJobsReclaimed: number;
}

export interface CleanupStagingLike {
  cleanupExpired(now?: Date): Promise<number>;
}

export interface CleanupAssetsLike {
  deleteExpired(now?: Date): Promise<number>;
}

export interface CleanupEventsLike {
  deleteOlderThan(now?: Date): Promise<number>;
}

export interface CleanupJobsLike {
  reclaimStale(queue: string, before: Date): Promise<number>;
}

export interface CleanupDeps {
  staging: CleanupStagingLike;
  assets: CleanupAssetsLike;
  events?: CleanupEventsLike;
  jobs?: CleanupJobsLike;
}

export const ANALYSIS_EVENTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ANALYSIS_JOB_STALE_MS = 10 * 60 * 1000;
export const ANALYSIS_QUEUE_NAME = "analysis";

export async function runCleanup(
  deps: CleanupDeps,
  now: Date = new Date()
): Promise<CleanupResult> {
  const [stagedRemoved, expiredAssetsRemoved, eventsRemoved, staleJobsReclaimed] = await Promise.all([
    deps.staging.cleanupExpired(now),
    deps.assets.deleteExpired(now),
    deps.events !== undefined
      ? deps.events.deleteOlderThan(new Date(now.getTime() - ANALYSIS_EVENTS_TTL_MS))
      : Promise.resolve(0),
    deps.jobs !== undefined
      ? deps.jobs.reclaimStale(ANALYSIS_QUEUE_NAME, new Date(now.getTime() - ANALYSIS_JOB_STALE_MS))
      : Promise.resolve(0),
  ]);
  return { stagedRemoved, expiredAssetsRemoved, eventsRemoved, staleJobsReclaimed };
}
