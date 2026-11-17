import type { CaseGraphFeatureRecord } from './featureExtraction';

export const CASE_GRAPH_RARITY_VERSION = 'case-graph-rarity-v1' as const;

export type CaseGraphCorpusRarity = {
  version: typeof CASE_GRAPH_RARITY_VERSION;
  corpusVersion: string;
  documentCount: number;
  documentFrequency: Record<string, number>;
  rarity: Record<string, number>;
};

export const buildCaseGraphRarityFromDocumentFrequency = (
  documentFrequency: Readonly<Record<string, number>>,
  documentCount: number,
  corpusVersion: string,
): CaseGraphCorpusRarity => {
  const normalizedVersion = String(corpusVersion || '').trim();
  if (!normalizedVersion) throw new Error('case_graph_corpus_version_required');
  if (!Number.isSafeInteger(documentCount) || documentCount < 0) {
    throw new Error('case_graph_document_count_invalid');
  }
  const entries = Object.entries(documentFrequency)
    .map(([rawTerm, rawCount]) => [String(rawTerm).trim(), Number(rawCount)] as const)
    .filter(([term]) => Boolean(term))
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [term, count] of entries) {
    if (!Number.isSafeInteger(count) || count < 1 || count > documentCount) {
      throw new Error(`case_graph_document_frequency_invalid:${term}`);
    }
  }
  const denominator = Math.log(documentCount + 1) || 1;
  return {
    version: CASE_GRAPH_RARITY_VERSION,
    corpusVersion: normalizedVersion,
    documentCount,
    documentFrequency: Object.fromEntries(entries),
    rarity: Object.fromEntries(entries.map(([term, count]) => [
      term,
      Number((Math.log((documentCount + 1) / (count + 1)) / denominator).toFixed(6)),
    ])),
  };
};

const recordTerms = (record: CaseGraphFeatureRecord) => new Set([
  ...record.traits.visual,
  ...record.traits.behaviour,
  ...record.traits.sensory,
  ...record.traits.entities,
  ...record.traits.keywords,
].map((item) => item.term));

export const buildCaseGraphCorpusRarity = (
  records: CaseGraphFeatureRecord[],
  corpusVersion: string,
): CaseGraphCorpusRarity => {
  const normalizedVersion = String(corpusVersion || '').trim();
  if (!normalizedVersion) throw new Error('case_graph_corpus_version_required');
  const ids = new Set<string>();
  const frequency = new Map<string, number>();
  const sortedRecords = [...records].sort((a, b) => a.caseId.localeCompare(b.caseId));
  for (const record of sortedRecords) {
    if (record.corpusVersion !== normalizedVersion) throw new Error('case_graph_corpus_version_mismatch');
    if (ids.has(record.caseId)) throw new Error(`case_graph_duplicate_case_id:${record.caseId}`);
    ids.add(record.caseId);
    for (const term of recordTerms(record)) frequency.set(term, (frequency.get(term) || 0) + 1);
  }
  const documentCount = sortedRecords.length;
  const entries = [...frequency.entries()].sort(([left], [right]) => left.localeCompare(right));
  return buildCaseGraphRarityFromDocumentFrequency(Object.fromEntries(entries), documentCount, normalizedVersion);
};
