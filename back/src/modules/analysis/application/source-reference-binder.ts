import type { AnalysisResult } from "../../../validation/ai/analysis-result";
import type { SourceReference } from "../../../validation/ai/source-reference";

export function attachSourceAssetIds(
  result: AnalysisResult,
  assetIdsByClientPageId: ReadonlyMap<string, string>
): AnalysisResult {
  const bindRefs = (refs: SourceReference[]): SourceReference[] => refs.map((reference) => ({
    ...reference,
    sourceAssetId:
      reference.sourceAssetId ?? assetIdsByClientPageId.get(reference.clientPageId) ?? null,
  }));

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
