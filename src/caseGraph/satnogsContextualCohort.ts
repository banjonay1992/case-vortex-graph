import { createHash } from 'node:crypto';

import type { EvidenceUniverseCompletion } from './evidenceUniverseArchive';
import type { EvidenceUniverseNode } from './evidenceUniverse';
import { relationshipInputSha256 } from './relationshipInputSnapshot';
import {
  SATNOGS_DB_SNAPSHOT_ARCHIVE_VERSION,
  type SatnogsDbSnapshotArchive,
} from '../sky/satellites/satnogsArchive';
import type {
  SatelliteElementSnapshotInput,
  SatelliteOrbitClass,
} from '../sky/satellites/types';

export const SATNOGS_CONTEXTUAL_COHORT_VERSION =
  'case-vortex-satnogs-contextual-cohort-v1' as const;
export const SATNOGS_CONTEXTUAL_COHORT_AGE_POLICY_VERSION =
  'case-vortex-satnogs-orbit-age-policy-v1' as const;

export const SATNOGS_CONTEXTUAL_COHORT_MAX_AGE_DAYS: Record<SatelliteOrbitClass, number> = {
  leo: 3,
  meo: 14,
  geo: 30,
  heo: 14,
  unknown: 7,
};

type Direction = 'north' | 'northeast' | 'east' | 'southeast'
  | 'south' | 'southwest' | 'west' | 'northwest';

export type SatnogsContextualCohortCandidate = {
  candidateId: string;
  address: string;
  source: string;
  sourceRecordId: string | null;
  canonicalUrl: string | null;
  eventTimestamp: string;
  lat: number;
  lon: number;
  nodeDigest: string;
  sourceMaterialSha256: string;
  directionPhrases: Array<{
    sourceField: 'title' | 'summary';
    sourceText: string;
    sourceTextSha256: string;
    span: {
      unit: 'utf8_byte';
      start: number;
      end: number;
      text: string;
      textSha256: string;
    };
    normalizedDirection: Direction;
    disposition: 'pending_human_review';
  }>;
  satelliteCoverage: {
    compatibleSnapshotCount: number;
    compatibleObjectCount: number;
    compatibleOrbitClasses: SatelliteOrbitClass[];
    minimumEpochAgeDays: number;
    maximumEpochAgeDays: number;
    compatibleSnapshotSetSha256: string;
  };
  selectionRank: string;
  candidateDigest: string;
};

export type SatnogsContextualCohort = {
  recordType: 'satnogs_contextual_cohort';
  schemaVersion: typeof SATNOGS_CONTEXTUAL_COHORT_VERSION;
  builtAt: string;
  seed: string;
  targetCount: number;
  binding: {
    corpusVersion: string;
    snapshotId: string;
    universeArchiveVersion: string;
    universeSchemaVersion: string;
    universeLayoutVersion: string;
    universeArchiveSetSha256: string;
    universeRecordCount: number;
    universeSightingCount: number;
    universePartCount: number;
    scannedSightingPartCount: number;
  };
  satnogs: {
    schemaVersion: typeof SATNOGS_DB_SNAPSHOT_ARCHIVE_VERSION;
    archiveDigest: string;
    archiveFileSha256: string;
    snapshotSetSha256: string;
    snapshotCount: number;
  };
  policy: {
    agePolicyVersion: typeof SATNOGS_CONTEXTUAL_COHORT_AGE_POLICY_VERSION;
    maximumAgeDaysByOrbitClass: Record<SatelliteOrbitClass, number>;
    epochDistance: 'absolute';
    directionSemantics: 'candidate_phrase_not_sky_position';
    sourceDiversity: 'deterministic_round_robin';
  };
  summary: {
    scannedSightingCount: number;
    completeCoordinateTimeCount: number;
    satelliteCoverageEligibleCount: number;
    directionPhraseEligibleCount: number;
    selectedCandidateCount: number;
    selectedSourceCount: number;
    selectedDirectionPhraseCount: number;
    selectedCompatibleSnapshotCount: number;
  };
  candidates: SatnogsContextualCohortCandidate[];
  candidateSetSha256: string;
  guarantees: {
    automaticAzimuthAssignments: 0;
    automaticElevationAssignments: 0;
    propagatedSatelliteMatches: 0;
    contextualEdgesCreated: 0;
    humanAdjudicationsCreated: 0;
    providerCalls: 0;
    databaseWrites: 0;
    storageWrites: 0;
    publicationMutations: 0;
    deployments: 0;
  };
  cohortDigest: string;
};

type CandidateCore = Omit<SatnogsContextualCohortCandidate, 'candidateDigest'>;
type ScanState = {
  scannedSightingCount: number;
  completeCoordinateTimeCount: number;
  satelliteCoverageEligibleCount: number;
  eligible: CandidateCore[];
};

const DIRECTION =
  /\b(?:north(?:east|west)?|south(?:east|west)?|east|west|ne|nw|se|sw)\b/giu;
const SHA256 = /^[a-f0-9]{64}$/u;
const SEED = /^[a-z0-9][a-z0-9._:/-]{0,239}$/u;
const DAY_MS = 86_400_000;
const invalid = (code: string): never => { throw new Error(code); };
const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const timestamp = (value: unknown, code: string) => {
  if (typeof value !== 'string') invalid(code);
  const parsed = new Date(value as string);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(code);
  return value as string;
};

const normalizeDirection = (value: string): Direction => {
  const aliases: Record<string, Direction> = {
    north: 'north',
    ne: 'northeast',
    northeast: 'northeast',
    east: 'east',
    se: 'southeast',
    southeast: 'southeast',
    south: 'south',
    sw: 'southwest',
    southwest: 'southwest',
    west: 'west',
    nw: 'northwest',
    northwest: 'northwest',
  };
  return aliases[value.toLowerCase()] || invalid('satnogs_contextual_direction_invalid');
};

const verifySatnogsArchive = (value: unknown): SatnogsDbSnapshotArchive => {
  if (!isObject(value)
    || value.recordType !== 'satnogs_db_snapshot_archive'
    || value.schemaVersion !== SATNOGS_DB_SNAPSHOT_ARCHIVE_VERSION
    || !Array.isArray(value.snapshots)
    || typeof value.archiveDigest !== 'string'
    || !SHA256.test(value.archiveDigest)) {
    invalid('satnogs_contextual_archive_invalid');
  }
  const raw = value as Record<string, unknown>;
  const { archiveDigest, ...body } = raw;
  if (relationshipInputSha256(body) !== archiveDigest) {
    invalid('satnogs_contextual_archive_digest_mismatch');
  }
  const archive = value as unknown as SatnogsDbSnapshotArchive;
  const orbitClasses = new Set<SatelliteOrbitClass>(['leo', 'meo', 'geo', 'heo', 'unknown']);
  if (!isObject(archive.summary)
    || archive.summary.snapshotCount !== archive.snapshots.length
    || !archive.snapshots.length
    || archive.snapshots.some((snapshot) => (
      !Number.isSafeInteger(snapshot.noradId)
      || snapshot.noradId < 1
      || snapshot.provider !== 'satnogs_db'
      || !orbitClasses.has(snapshot.orbitClass)
      || timestamp(snapshot.epoch, 'satnogs_contextual_snapshot_epoch_invalid') !== snapshot.epoch
    ))) {
    invalid('satnogs_contextual_archive_snapshot_invalid');
  }
  const snapshotSetSha256 = relationshipInputSha256(archive.snapshots.map((snapshot) => ({
    noradId: snapshot.noradId,
    sourceObjectId: snapshot.sourceObjectId,
    epoch: snapshot.epoch,
    tleLine1: snapshot.tleLine1,
    tleLine2: snapshot.tleLine2,
  })));
  if (archive.snapshotSetSha256 !== snapshotSetSha256) {
    invalid('satnogs_contextual_archive_snapshot_set_mismatch');
  }
  return archive;
};

const snapshotIdentity = (snapshot: SatelliteElementSnapshotInput) => ({
  noradId: snapshot.noradId,
  sourceObjectId: snapshot.sourceObjectId || null,
  epoch: snapshot.epoch,
  orbitClass: snapshot.orbitClass,
});

const compatibleSnapshots = (
  eventTimestamp: string,
  snapshots: readonly SatelliteElementSnapshotInput[],
) => {
  const eventMs = Date.parse(eventTimestamp);
  return snapshots.map((snapshot) => {
    const epochMs = Date.parse(snapshot.epoch);
    const ageDays = Math.abs(eventMs - epochMs) / DAY_MS;
    const maximumAgeDays = SATNOGS_CONTEXTUAL_COHORT_MAX_AGE_DAYS[snapshot.orbitClass];
    return { snapshot, ageDays, maximumAgeDays };
  }).filter(({ ageDays, maximumAgeDays }) => (
    Number.isFinite(ageDays) && ageDays <= maximumAgeDays
  ));
};

const directionPhrases = (node: EvidenceUniverseNode) => {
  const values: SatnogsContextualCohortCandidate['directionPhrases'] = [];
  for (const sourceField of ['title', 'summary'] as const) {
    const sourceText = node[sourceField];
    if (!sourceText) continue;
    for (const match of sourceText.matchAll(DIRECTION)) {
      const text = match[0];
      const start = Buffer.byteLength(sourceText.slice(0, match.index), 'utf8');
      const end = start + Buffer.byteLength(text, 'utf8');
      values.push({
        sourceField,
        sourceText,
        sourceTextSha256: relationshipInputSha256(sourceText),
        span: {
          unit: 'utf8_byte',
          start,
          end,
          text,
          textSha256: relationshipInputSha256(text),
        },
        normalizedDirection: normalizeDirection(text),
        disposition: 'pending_human_review',
      });
    }
  }
  return values;
};

const selectWithSourceDiversity = (
  candidates: CandidateCore[],
  targetCount: number,
) => {
  const bySource = new Map<string, CandidateCore[]>();
  for (const candidate of candidates) {
    const sourceCandidates = bySource.get(candidate.source) || [];
    sourceCandidates.push(candidate);
    bySource.set(candidate.source, sourceCandidates);
  }
  for (const sourceCandidates of bySource.values()) {
    sourceCandidates.sort((left, right) => (
      lexical(left.selectionRank, right.selectionRank) || lexical(left.address, right.address)
    ));
  }
  const sources = [...bySource.keys()].sort((left, right) => (
    lexical(
      relationshipInputSha256({ source: left, rank: bySource.get(left)?.[0]?.selectionRank }),
      relationshipInputSha256({ source: right, rank: bySource.get(right)?.[0]?.selectionRank }),
    ) || lexical(left, right)
  ));
  const selected: CandidateCore[] = [];
  for (let offset = 0; selected.length < targetCount; offset += 1) {
    let added = false;
    for (const source of sources) {
      const candidate = bySource.get(source)?.[offset];
      if (!candidate) continue;
      selected.push(candidate);
      added = true;
      if (selected.length === targetCount) break;
    }
    if (!added) break;
  }
  return selected;
};

export const createSatnogsContextualCohortScan = (params: {
  satnogsArchive: unknown;
  satnogsArchiveBytes: Buffer;
  seed: string;
}) => {
  const archive = verifySatnogsArchive(params.satnogsArchive);
  if (!params.satnogsArchiveBytes.length) invalid('satnogs_contextual_archive_bytes_mismatch');
  try {
    if (relationshipInputSha256(JSON.parse(params.satnogsArchiveBytes.toString('utf8')))
      !== relationshipInputSha256(params.satnogsArchive)) {
      invalid('satnogs_contextual_archive_bytes_mismatch');
    }
  } catch {
    invalid('satnogs_contextual_archive_bytes_mismatch');
  }
  if (!SEED.test(params.seed)) invalid('satnogs_contextual_seed_invalid');
  const state: ScanState = {
    scannedSightingCount: 0,
    completeCoordinateTimeCount: 0,
    satelliteCoverageEligibleCount: 0,
    eligible: [],
  };

  return {
    archive,
    archiveFileSha256: createHash('sha256').update(params.satnogsArchiveBytes).digest('hex'),
    addNodes(nodes: readonly EvidenceUniverseNode[]) {
      for (const node of nodes) {
        if (node.kind !== 'sighting') invalid('satnogs_contextual_non_sighting_scan');
        state.scannedSightingCount += 1;
        if (node.eventTimestamp === null || node.lat === null || node.lon === null) continue;
        state.completeCoordinateTimeCount += 1;
        const compatible = compatibleSnapshots(node.eventTimestamp, archive.snapshots);
        if (!compatible.length) continue;
        state.satelliteCoverageEligibleCount += 1;
        const phrases = directionPhrases(node);
        if (!phrases.length) continue;
        const identities = compatible.map(({ snapshot }) => snapshotIdentity(snapshot))
          .sort((left, right) => (
            left.noradId - right.noradId
            || lexical(left.epoch, right.epoch)
            || lexical(left.sourceObjectId || '', right.sourceObjectId || '')
          ));
        const ages = compatible.map(({ ageDays }) => ageDays);
        const nodeDigest = relationshipInputSha256(node);
        const sourceMaterialSha256 = relationshipInputSha256({
          title: node.title,
          summary: node.summary,
          canonicalUrl: node.canonicalUrl,
        });
        const selectionRank = relationshipInputSha256({
          schemaVersion: SATNOGS_CONTEXTUAL_COHORT_VERSION,
          seed: params.seed,
          address: node.address,
          nodeDigest,
        });
        const coverage = {
          compatibleSnapshotCount: compatible.length,
          compatibleObjectCount: new Set(compatible.map(({ snapshot }) => snapshot.noradId)).size,
          compatibleOrbitClasses: [...new Set(compatible.map(({ snapshot }) => snapshot.orbitClass))]
            .sort(lexical),
          minimumEpochAgeDays: Math.min(...ages),
          maximumEpochAgeDays: Math.max(...ages),
          compatibleSnapshotSetSha256: relationshipInputSha256(identities),
        };
        const candidateId = `satnogs-contextual:${relationshipInputSha256({
          address: node.address,
          nodeDigest,
          compatibleSnapshotSetSha256: coverage.compatibleSnapshotSetSha256,
        })}`;
        state.eligible.push({
          candidateId,
          address: node.address,
          source: node.source,
          sourceRecordId: node.sourceRecordId,
          canonicalUrl: node.canonicalUrl,
          eventTimestamp: node.eventTimestamp,
          lat: node.lat,
          lon: node.lon,
          nodeDigest,
          sourceMaterialSha256,
          directionPhrases: phrases,
          satelliteCoverage: coverage,
          selectionRank,
        });
      }
    },
    state,
  };
};

export const finalizeSatnogsContextualCohort = (params: {
  completion: EvidenceUniverseCompletion;
  scan: ReturnType<typeof createSatnogsContextualCohortScan>;
  seed: string;
  targetCount: number;
  builtAt: string;
  scannedSightingPartCount: number;
}): SatnogsContextualCohort => {
  if (!Number.isSafeInteger(params.targetCount) || params.targetCount < 1 || params.targetCount > 10_000) {
    invalid('satnogs_contextual_target_count_invalid');
  }
  if (!SEED.test(params.seed)) invalid('satnogs_contextual_seed_invalid');
  const builtAt = timestamp(params.builtAt, 'satnogs_contextual_built_at_invalid');
  const sightingParts = params.completion.parts.filter(({ kind }) => kind === 'sighting');
  if (params.scannedSightingPartCount !== sightingParts.length
    || params.scan.state.scannedSightingCount !== params.completion.expected.byKind.sighting) {
    invalid('satnogs_contextual_universe_scan_incomplete');
  }
  const selected = selectWithSourceDiversity(
    params.scan.state.eligible,
    params.targetCount,
  ).map((core) => ({
    ...core,
    candidateDigest: relationshipInputSha256(core),
  }));
  const candidateSetSha256 = relationshipInputSha256(
    selected.map(({ candidateId, candidateDigest }) => `${candidateId}:${candidateDigest}`),
  );
  const body: Omit<SatnogsContextualCohort, 'cohortDigest'> = {
    recordType: 'satnogs_contextual_cohort',
    schemaVersion: SATNOGS_CONTEXTUAL_COHORT_VERSION,
    builtAt,
    seed: params.seed,
    targetCount: params.targetCount,
    binding: {
      corpusVersion: params.completion.corpusVersion,
      snapshotId: params.completion.expected.snapshotId,
      universeArchiveVersion: params.completion.archiveVersion,
      universeSchemaVersion: params.completion.schemaVersion,
      universeLayoutVersion: params.completion.layoutVersion,
      universeArchiveSetSha256: params.completion.archiveSetSha256,
      universeRecordCount: params.completion.expected.total,
      universeSightingCount: params.completion.expected.byKind.sighting,
      universePartCount: params.completion.parts.length,
      scannedSightingPartCount: params.scannedSightingPartCount,
    },
    satnogs: {
      schemaVersion: SATNOGS_DB_SNAPSHOT_ARCHIVE_VERSION,
      archiveDigest: params.scan.archive.archiveDigest,
      archiveFileSha256: params.scan.archiveFileSha256,
      snapshotSetSha256: params.scan.archive.snapshotSetSha256,
      snapshotCount: params.scan.archive.snapshots.length,
    },
    policy: {
      agePolicyVersion: SATNOGS_CONTEXTUAL_COHORT_AGE_POLICY_VERSION,
      maximumAgeDaysByOrbitClass: { ...SATNOGS_CONTEXTUAL_COHORT_MAX_AGE_DAYS },
      epochDistance: 'absolute',
      directionSemantics: 'candidate_phrase_not_sky_position',
      sourceDiversity: 'deterministic_round_robin',
    },
    summary: {
      scannedSightingCount: params.scan.state.scannedSightingCount,
      completeCoordinateTimeCount: params.scan.state.completeCoordinateTimeCount,
      satelliteCoverageEligibleCount: params.scan.state.satelliteCoverageEligibleCount,
      directionPhraseEligibleCount: params.scan.state.eligible.length,
      selectedCandidateCount: selected.length,
      selectedSourceCount: new Set(selected.map(({ source }) => source)).size,
      selectedDirectionPhraseCount: selected.reduce(
        (sum, candidate) => sum + candidate.directionPhrases.length,
        0,
      ),
      selectedCompatibleSnapshotCount: selected.reduce(
        (sum, candidate) => sum + candidate.satelliteCoverage.compatibleSnapshotCount,
        0,
      ),
    },
    candidates: selected,
    candidateSetSha256,
    guarantees: {
      automaticAzimuthAssignments: 0,
      automaticElevationAssignments: 0,
      propagatedSatelliteMatches: 0,
      contextualEdgesCreated: 0,
      humanAdjudicationsCreated: 0,
      providerCalls: 0,
      databaseWrites: 0,
      storageWrites: 0,
      publicationMutations: 0,
      deployments: 0,
    },
  };
  return { ...body, cohortDigest: relationshipInputSha256(body) };
};
