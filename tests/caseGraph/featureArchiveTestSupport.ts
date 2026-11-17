import type {
  CaseGraphArchiveWriteCondition,
  CaseGraphConditionalArchiveStorage,
  CaseGraphSourceCensus,
  CaseGraphSourceStats,
} from '../../src/caseGraph/archiveTypes';

export class ConditionalMemoryStorage implements CaseGraphConditionalArchiveStorage {
  objects = new Map<string, Buffer>();
  private versions = new Map<string, number>();

  async readObject(key: string) {
    const body = this.objects.get(key);
    return body ? Buffer.from(body) : null;
  }

  async readObjectVersioned(key: string) {
    const body = this.objects.get(key);
    const version = this.versions.get(key);
    return body && version ? { body: Buffer.from(body), version: `v${version}` } : null;
  }

  async uploadFile(body: Buffer, key: string) {
    this.objects.set(key, Buffer.from(body));
    this.versions.set(key, (this.versions.get(key) || 0) + 1);
    return key;
  }

  async uploadFileConditional(
    body: Buffer,
    key: string,
    _options: unknown,
    condition: CaseGraphArchiveWriteCondition,
  ) {
    const current = this.versions.get(key);
    if (
      ('ifAbsent' in condition && current !== undefined)
      || ('ifVersion' in condition && condition.ifVersion !== `v${current}`)
    ) return { status: 'precondition_failed' as const };
    await this.uploadFile(body, key);
    const version = this.versions.get(key)!;
    return { status: 'written' as const, key, version: `v${version}` };
  }
}

export const materializedCaseGraphStats = (
  census: CaseGraphSourceCensus,
  overrides: Partial<CaseGraphSourceStats> = {},
): CaseGraphSourceStats => ({
  snapshot_id: '00000000-0000-4000-8000-000000000123',
  snapshot_policy: 'evidence-universe-materialized-v1',
  capture_policy: 'publishable-public-v2-materialized-v1',
  materialized_at: '2026-07-18T00:29:59.999321Z',
  source_mvcc_snapshot: '100:200:150,175',
  ...census,
  ...overrides,
});
