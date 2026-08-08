import type { AnalysisResult } from "../../../validation/ai/analysis-result";
import type { SourceReference } from "../../../validation/ai/source-reference";

export interface SourceAssetBinding {
  id: string;
  clientPageId: string;
  inputIndex: number;
  pageNumber: number;
}

export function attachSourceAssetIds(
  result: AnalysisResult,
  assets: readonly SourceAssetBinding[]
): AnalysisResult {
  const byClientPageId = new Map(assets.map((asset) => [asset.clientPageId, asset]));
  const byInputPage = new Map(assets.map((asset) => [`${asset.inputIndex}:${asset.pageNumber}`, asset]));
  const bindRefs = (refs: SourceReference[]): SourceReference[] => refs.map((reference) => {
    const asset = byClientPageId.get(reference.clientPageId)
      ?? byInputPage.get(`${reference.inputIndex}:${reference.pageNumber ?? 1}`);
    return {
      ...reference,
      clientPageId: asset?.clientPageId ?? reference.clientPageId,
      sourceAssetId: reference.sourceAssetId ?? asset?.id ?? null,
    };
  });

  return {
    ...result,
    tasks: result.tasks.map((task) => ({
      ...task,
      sourceRefs: bindRefs(task.sourceRefs),
      deadline: task.deadline === null
        ? null
        : { ...task.deadline, sourceRefs: bindRefs(task.deadline.sourceRefs) },
    })),
    dates: result.dates.map((item) => ({ ...item, sourceRefs: bindRefs(item.sourceRefs) })),
    amounts: result.amounts.map((item) => ({ ...item, sourceRefs: bindRefs(item.sourceRefs) })),
    locations: result.locations.map((item) => ({ ...item, sourceRefs: bindRefs(item.sourceRefs) })),
    contacts: result.contacts.map((item) => ({ ...item, sourceRefs: bindRefs(item.sourceRefs) })),
    requiredDocuments: result.requiredDocuments.map((item) => ({ ...item, sourceRefs: bindRefs(item.sourceRefs) })),
    links: result.links.map((item) => ({ ...item, sourceRefs: bindRefs(item.sourceRefs) })),
    warnings: result.warnings.map((item) => ({ ...item, sourceRefs: bindRefs(item.sourceRefs) })),
  };
}
