import { dbDelete, dbGet, dbGetAll, dbPut } from './db.js';

export async function saveDraft(draft) {
  const value = { ...draft, updatedAt: new Date().toISOString() };
  await dbPut('drafts', value);
  return value;
}
export function getDraft(id = 'active-draft') { return dbGet('drafts', id); }
export function deleteDraft(id = 'active-draft') { return dbDelete('drafts', id); }

export async function saveAnalysis(analysis) {
  const value = { ...analysis, updatedAt: new Date().toISOString() };
  await dbPut('analyses', value);
  return value;
}
export function getAnalysis(id) { return dbGet('analyses', id); }
export async function listAnalyses() {
  const items = await dbGetAll('analyses');
  return items.sort((a, b) => new Date(b.updatedAt ?? b.createdAt).getTime() - new Date(a.updatedAt ?? a.createdAt).getTime());
}
export function deleteAnalysis(id) { return dbDelete('analyses', id); }

export async function saveShare(share) {
  const value = { ...share, updatedAt: new Date().toISOString() };
  await dbPut('shares', value);
  return value;
}
export function getShare(id) { return dbGet('shares', id); }
export function deleteShare(id) { return dbDelete('shares', id); }
