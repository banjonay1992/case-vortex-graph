import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { open, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CONTEXTUAL_ARCHIVE_LOCAL_SOURCE_MANIFEST_VERSION,
  decodeContextualArchiveLocalSourceManifest,
  openContextualArchiveLocalSource,
  readStableContextualArchiveLocalFile,
} from '../../src/caseGraph/contextualArchiveLocalSource';
import { buildGovernedContextualSourcePage } from '../../src/caseGraph/contextualObservationArchive';
import {
  CONTEXTUAL_SOURCE_SNAPSHOT_PLAN_VERSION,
  CONTEXTUAL_SUBJECT_COHORT_POLICY_DIGEST,
  CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION,
  contextualSourceCensusSha256,
  type ContextualSourceSnapshotPlan,
} from '../../src/caseGraph/contextualSourceMaterializationCensus';
import { canonicalizeRelationshipInput, relationshipInputSha256 } from '../../src/caseGraph/relationshipInputSnapshot';
import { buildCanonicalContextualSourceRowFixture } from './contextualRelationshipCompletionTestSupport';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
const canonical = (value: unknown) => Buffer.from(`${canonicalizeRelationshipInput(value)}\n`, 'utf8');
const fileSha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const hash = (value: unknown) => relationshipInputSha256(value);

const buildFixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'contextual-local-source-'));
  directories.push(directory);
  const sourceFixture = buildCanonicalContextualSourceRowFixture();
  const { snapshot, row } = sourceFixture;
  const address = row.relationshipRecord.address;
  const contentSha256 = snapshot.contentSha256;
  const planWithoutDigest: Omit<ContextualSourceSnapshotPlan, 'planDigest'> = {
    recordType: 'contextual_source_snapshot_plan',
    schemaVersion: CONTEXTUAL_SOURCE_SNAPSHOT_PLAN_VERSION,
    sourceFamily: snapshot.sourceFamily,
    kind: snapshot.kind,
    targetBinding: {
      universe: snapshot.binding,
      relationshipInputSnapshotDigest: hash('relationship-snapshot'),
      relationshipInputRecordSetSha256: hash('relationship-record-set'),
      relationshipInputRecordCount: snapshot.binding.universeRecordCount,
      subjectCohortPolicyVersion: CONTEXTUAL_SUBJECT_COHORT_POLICY_VERSION,
      subjectCohortPolicyDigest: CONTEXTUAL_SUBJECT_COHORT_POLICY_DIGEST,
      subjectAddressSetSha256: hash([address]),
      subjectCount: 1,
      requiredCoverageWindow: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-01T01:00:00.000Z' },
    },
    sourceIdentity: {
      sourceId: snapshot.sourceId,
      providerId: snapshot.providerId,
      datasetVersion: snapshot.datasetVersion,
      snapshotId: `snapshot:${snapshot.sourceFamily}:v1`,
      contentSha256,
      manifestSha256: hash('provider-manifest'),
    },
    capture: { mode: 'immutable_historical_snapshot', mutable: false, current: false, live: false, contentAddressed: true },
    declaredCoverage: {
      start: snapshot.coverageWindow.start,
      end: snapshot.coverageWindow.end,
      observedRecordCount: 1,
      coveredSubjectLedgerSha256: hash('covered-ledger'),
      missingSubjectLedgerSha256: hash('missing-ledger'),
    },
  };
  const plan = { ...planWithoutDigest, planDigest: contextualSourceCensusSha256(planWithoutDigest) };
  const page = buildGovernedContextualSourcePage({ snapshot, cursor: null, nextCursor: null, rows: [row] });
  const pageBody = canonical(page);
  const pageReceipt = {
    pageNumber: 0, cursor: null, nextCursor: null, relativePath: 'pages/000000.json',
    bytes: pageBody.byteLength, canonicalSha256: fileSha(pageBody), rowCount: page.rows.length,
    pageDigest: page.pageDigest,
  };
  const manifestWithoutDigest = {
    recordType: 'contextual_archive_local_source_manifest' as const,
    schemaVersion: CONTEXTUAL_ARCHIVE_LOCAL_SOURCE_MANIFEST_VERSION,
    sourceFamily: plan.sourceFamily,
    planDigest: plan.planDigest,
    snapshot,
    pages: [pageReceipt],
    accounting: {
      observedRecordCount: 1,
      coveredSubjectCount: 1,
      coveredSubjectAddressSetSha256: hash([address]),
      sourceRowDigestSetSha256: hash([row.rowDigest]),
    },
    sourceContentSha256: contentSha256,
    pageSetSha256: relationshipInputSha256(`0:null:null:${pageReceipt.rowCount}:${pageReceipt.pageDigest}`),
  };
  const manifest = { ...manifestWithoutDigest, manifestDigest: relationshipInputSha256(manifestWithoutDigest) };
  await mkdir(join(directory, 'pages'));
  await writeFile(join(directory, 'manifest.json'), canonical(manifest), { flag: 'wx' });
  await writeFile(join(directory, pageReceipt.relativePath), pageBody, { flag: 'wx' });
  return { directory, plan, manifest, page };
};

describe('canonical local contextual source adapter', () => {
  it('opens only digest-bound canonical pages and serves the exact cursor chain', async () => {
    const fixture = await buildFixture();
    const opened = await openContextualArchiveLocalSource({ manifestPath: join(fixture.directory, 'manifest.json'), plan: fixture.plan });
    await expect(opened.source.inspectSnapshot()).resolves.toEqual(fixture.manifest.snapshot);
    await expect(opened.source.fetchPage({ snapshot: fixture.manifest.snapshot, cursor: null, limit: 1 })).resolves.toEqual(fixture.page);
    expect(opened.manifest.accounting).toEqual(fixture.manifest.accounting);
  });

  it('rejects a changed page and a resealed manifest with a mismatched page-set receipt', async () => {
    const fixture = await buildFixture();
    const firstOpen = await openContextualArchiveLocalSource({ manifestPath: join(fixture.directory, 'manifest.json'), plan: fixture.plan });
    await writeFile(join(fixture.directory, 'pages/000000.json'), Buffer.from('{}\n'));
    await expect(firstOpen.source.fetchPage({ snapshot: fixture.manifest.snapshot, cursor: null, limit: 1 }))
      .rejects.toThrow('contextual_archive_local_source_page_file_digest_mismatch');
    await expect(openContextualArchiveLocalSource({ manifestPath: join(fixture.directory, 'manifest.json'), plan: fixture.plan }))
      .rejects.toThrow('contextual_archive_local_source_page_file_digest_mismatch');

    const { manifestDigest: _old, ...body } = { ...fixture.manifest, pageSetSha256: hash('wrong-page-set') };
    expect(() => decodeContextualArchiveLocalSourceManifest({ ...body, manifestDigest: relationshipInputSha256(body) }, fixture.plan))
      .toThrow('contextual_archive_local_source_content_digest_mismatch');
    expect((await readFile(join(fixture.directory, 'manifest.json'))).byteLength).toBeGreaterThan(0);
  });

  it('derives row and covered-address accounting instead of trusting a resealed manifest', async () => {
    const fixture = await buildFixture();
    const { manifestDigest: _old, ...changed } = {
      ...fixture.manifest,
      accounting: { ...fixture.manifest.accounting, observedRecordCount: 2 },
    };
    await writeFile(join(fixture.directory, 'manifest.json'), canonical({
      ...changed,
      manifestDigest: relationshipInputSha256(changed),
    }));
    await expect(openContextualArchiveLocalSource({
      manifestPath: join(fixture.directory, 'manifest.json'), plan: fixture.plan,
    })).rejects.toThrow('contextual_archive_local_source_accounting_mismatch');
  });

  it('rejects repeated cursors and sparse pages', async () => {
    const fixture = await buildFixture();
    const base = fixture.manifest.pages[0];
    const pages = [
      { ...base, pageNumber: 0, cursor: null, nextCursor: 'A', relativePath: 'pages/0.json', canonicalSha256: hash('page-0'), pageDigest: hash('digest-0') },
      { ...base, pageNumber: 1, cursor: 'A', nextCursor: 'A', relativePath: 'pages/1.json', canonicalSha256: hash('page-1'), pageDigest: hash('digest-1') },
      { ...base, pageNumber: 2, cursor: 'A', nextCursor: null, relativePath: 'pages/2.json', canonicalSha256: hash('page-2'), pageDigest: hash('digest-2') },
    ];
    const draft = { ...fixture.manifest, pages, pageSetSha256: relationshipInputSha256(pages.map((page) => `${page.pageNumber}:${JSON.stringify(page.cursor)}:${JSON.stringify(page.nextCursor)}:${page.rowCount}:${page.pageDigest}`).join('\n')) };
    const { manifestDigest: _manifestDigest, ...withoutDigest } = draft;
    expect(() => decodeContextualArchiveLocalSourceManifest({ ...withoutDigest, manifestDigest: relationshipInputSha256(withoutDigest) }, fixture.plan))
      .toThrow('contextual_archive_local_source_page_chain_invalid');

    const emptyPage = buildGovernedContextualSourcePage({ snapshot: fixture.manifest.snapshot, cursor: null, nextCursor: null, rows: [] });
    const emptyBody = canonical(emptyPage);
    const emptyReceipt = { ...base, bytes: emptyBody.length, canonicalSha256: fileSha(emptyBody), rowCount: 0, pageDigest: emptyPage.pageDigest };
    const emptyManifestBody = {
      ...withoutDigest,
      pages: [emptyReceipt],
      accounting: { ...fixture.manifest.accounting },
      pageSetSha256: relationshipInputSha256(`0:null:null:0:${emptyReceipt.pageDigest}`),
    };
    await writeFile(join(fixture.directory, emptyReceipt.relativePath), emptyBody);
    await writeFile(join(fixture.directory, 'manifest.json'), canonical({ ...emptyManifestBody, manifestDigest: relationshipInputSha256(emptyManifestBody) }));
    await expect(openContextualArchiveLocalSource({ manifestPath: join(fixture.directory, 'manifest.json'), plan: fixture.plan }))
      .rejects.toThrow('contextual_archive_local_source_sparse_page');
  });

  it('uses a no-follow bounded single-fd read and rejects changed inode metadata', async () => {
    const fixture = await buildFixture();
    const target = join(fixture.directory, 'target.json');
    const link = join(fixture.directory, 'link.json');
    await writeFile(target, '{}\n');
    await symlink(target, link);
    await expect(readStableContextualArchiveLocalFile(link, 16, 'stable_file_invalid')).rejects.toThrow('stable_file_invalid');
    const fifo = join(fixture.directory, 'named-pipe');
    execFileSync('mkfifo', [fifo]);
    await expect(readStableContextualArchiveLocalFile(fifo, 16, 'stable_file_invalid'))
      .rejects.toThrow('stable_file_invalid');

    const oversized = join(fixture.directory, 'oversized.json');
    await writeFile(oversized, Buffer.alloc(17, 1));
    await expect(readStableContextualArchiveLocalFile(oversized, 16, 'stable_file_invalid')).rejects.toThrow('stable_file_invalid');

    const growingBytes = Buffer.alloc(17, 1);
    const statHandle = await open(target, 'r');
    const initialStat = await statHandle.stat();
    await statHandle.close();
    await expect(readStableContextualArchiveLocalFile(target, 16, 'stable_file_invalid', {
      openFile: (async () => ({
        stat: async () => ({ ...initialStat, size: 3, isFile: () => true }),
        read: async (buffer: Buffer, _offset: number, length: number, position: number) => {
          const bytesRead = Math.min(length, growingBytes.length - position);
          if (bytesRead > 0) growingBytes.copy(buffer, 0, position, position + bytesRead);
          return { bytesRead: Math.max(0, bytesRead), buffer };
        },
        close: async () => undefined,
      })) as never,
    })).rejects.toThrow('stable_file_invalid');

    const realHandle = await open(target, 'r');
    let stats = 0;
    const changedHandle = {
      read: realHandle.read.bind(realHandle),
      close: realHandle.close.bind(realHandle),
      stat: async () => {
        const value = await realHandle.stat();
        stats += 1;
        return stats === 1 ? value : { ...value, ino: Number(value.ino) + 1, isFile: () => true };
      },
    };
    await expect(readStableContextualArchiveLocalFile(target, 16, 'stable_file_invalid', {
      openFile: (async () => changedHandle) as never,
    })).rejects.toThrow('stable_file_invalid_changed');
  });
});
