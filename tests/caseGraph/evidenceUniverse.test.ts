import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_UNIVERSE_LAYOUT_VERSION,
  EVIDENCE_UNIVERSE_SCHEMA_VERSION,
  EVIDENCE_UNIVERSE_TIMELINE_V2,
  EVIDENCE_UNIVERSE_UNDATED_BELT_V2,
  accountEvidenceUniverseNodes,
  evidenceUniverseAddress,
  evidenceUniversePosition,
  projectEvidenceUniverseNode,
  projectSightingEvidenceUniverseNode,
  type EvidenceUniverseRawRecord,
} from '../../src/caseGraph/evidenceUniverse';

const raw = (overrides: Partial<EvidenceUniverseRawRecord> = {}): EvidenceUniverseRawRecord => ({
  kind: 'document', recordId: 'ABC-123', source: 'NARA', sourceRecordId: 'RG-1', title: 'Memo', summary: 'A public memo',
  canonicalUrl: 'https://example.test/memo', previewUrl: null, eventTimestamp: '1967-10-04T00:00:00Z',
  lat: 51.5, lon: -0.12, location: 'London', countryCode: 'gb', linkedSightingId: null,
  updatedAt: '2026-07-17T18:00:00Z', public: true, ...overrides,
});

describe('evidence universe model', () => {
  it('gives every public item a stable kind-qualified address and position', () => {
    const node = projectEvidenceUniverseNode(raw());
    expect(node.address).toBe('document:abc-123');
    expect(node.schemaVersion).toBe(EVIDENCE_UNIVERSE_SCHEMA_VERSION);
    expect(node.layoutVersion).toBe(EVIDENCE_UNIVERSE_LAYOUT_VERSION);
    expect(node.countryCode).toBe('GB');
    expect(node.position).toEqual(evidenceUniversePosition(raw()));
    expect(node.position.every(Number.isFinite)).toBe(true);
  });

  it('uses the complete event instant instead of collapsing a year onto one plane', () => {
    const january = evidenceUniversePosition(raw({ eventTimestamp: '1967-01-01T00:00:00.000Z' }));
    const julyMorning = evidenceUniversePosition(raw({ eventTimestamp: '1967-07-01T06:00:00.000Z' }));
    const julyEvening = evidenceUniversePosition(raw({ eventTimestamp: '1967-07-01T18:00:00.000Z' }));
    expect(julyMorning[0]).toBeGreaterThan(january[0]);
    expect(julyEvening[0]).toBeGreaterThan(julyMorning[0]);
    expect(julyMorning.slice(1)).toEqual(julyEvening.slice(1));

    const precise = projectEvidenceUniverseNode(raw({ eventTimestamp: '1967-07-01T18:00:00.123456Z' }));
    expect(precise.eventTimestamp).toBe('1967-07-01T18:00:00.123456Z');
  });

  it('keeps dated outliers ordered rather than clamping them onto a timeline edge', () => {
    const first = evidenceUniversePosition(raw({ eventTimestamp: '1889-01-01T00:00:00Z' }));
    const second = evidenceUniversePosition(raw({ eventTimestamp: '1890-01-01T00:00:00Z' }));
    expect(first[0]).toBeLessThan(second[0]);
    expect(second[0]).toBeLessThan(EVIDENCE_UNIVERSE_TIMELINE_V2.minimumX);
  });

  it('uses available latitude and longitude for Y/Z while micro-jitter separates coincident records', () => {
    const southWest = evidenceUniversePosition(raw({ recordId: 'geo', lat: -70, lon: -150 }));
    const northEast = evidenceUniversePosition(raw({ recordId: 'geo', lat: 70, lon: 150 }));
    expect(northEast[1]).toBeGreaterThan(southWest[1]);
    expect(northEast[2]).toBeGreaterThan(southWest[2]);

    const coincidentA = evidenceUniversePosition(raw({ recordId: 'coincident-a' }));
    const coincidentB = evidenceUniversePosition(raw({ recordId: 'coincident-b' }));
    expect(coincidentA[0]).toBe(coincidentB[0]);
    expect(coincidentA.slice(1)).not.toEqual(coincidentB.slice(1));
  });

  it('places undated records deterministically in a separate outer belt', () => {
    const record = raw({ recordId: 'undated', eventTimestamp: null, lat: null, lon: null });
    const position = evidenceUniversePosition(record);
    const radius = Math.hypot(position[1], position[2]);
    expect(position).toEqual(evidenceUniversePosition(record));
    expect(Math.abs(position[0])).toBeLessThanOrEqual(EVIDENCE_UNIVERSE_UNDATED_BELT_V2.maximumAbsX);
    expect(radius).toBeGreaterThanOrEqual(EVIDENCE_UNIVERSE_UNDATED_BELT_V2.minimumRadius);
    expect(radius).toBeLessThanOrEqual(EVIDENCE_UNIVERSE_UNDATED_BELT_V2.maximumRadius);
    expect(evidenceUniversePosition({ ...record, eventTimestamp: 'not-a-date' })).toEqual(position);

    for (let index = 0; index < 128; index += 1) {
      const beltPoint = evidenceUniversePosition(raw({
        recordId: `undated-${index}`,
        eventTimestamp: null,
        lat: index % 2 ? -90 : 90,
        lon: index % 3 ? -180 : 180,
      }));
      const beltRadius = Math.hypot(beltPoint[1], beltPoint[2]);
      expect(beltRadius).toBeGreaterThanOrEqual(EVIDENCE_UNIVERSE_UNDATED_BELT_V2.minimumRadius);
      expect(beltRadius).toBeLessThanOrEqual(EVIDENCE_UNIVERSE_UNDATED_BELT_V2.maximumRadius);
    }

    const datedBoundary = evidenceUniversePosition(raw({ lat: 90, lon: 180 }));
    expect(Math.hypot(datedBoundary[1], datedBoundary[2]))
      .toBeLessThan(EVIDENCE_UNIVERSE_UNDATED_BELT_V2.minimumRadius);
  });

  it('retains linked-sighting evidence without fabricating a parent orbit', () => {
    const attached = projectEvidenceUniverseNode(raw({ kind: 'photo', linkedSightingId: 'case-1' }));
    const unattached = projectEvidenceUniverseNode(raw({ kind: 'photo', linkedSightingId: null }));
    expect(attached.linkedSightingId).toBe('case-1');
    expect(attached.position).toEqual(unattached.position);
  });

  it('keeps the same source id distinct across sightings, documents, photos and videos', () => {
    expect(new Set(['sighting', 'document', 'photo', 'video'].map((kind) => evidenceUniverseAddress(kind as any, 'same-id'))).size).toBe(4);
  });

  it('fails closed for private records and invalid addresses', () => {
    expect(() => projectEvidenceUniverseNode(raw({ public: false }))).toThrow('evidence_universe_record_not_public');
    expect(() => evidenceUniverseAddress('document', 'bad:id')).toThrow('evidence_universe_record_id_invalid');
  });

  it('accounts for every individual node and genuine media attachments', () => {
    const nodes = [
      projectEvidenceUniverseNode(raw({ kind: 'sighting', recordId: 'case-1', linkedSightingId: null })),
      projectEvidenceUniverseNode(raw({ kind: 'photo', recordId: 'photo-1', linkedSightingId: 'case-1', eventTimestamp: null, lat: null, lon: null })),
    ];
    expect(accountEvidenceUniverseNodes(nodes)).toEqual({
      total: 2,
      byKind: { sighting: 1, document: 0, photo: 1, video: 0 },
      attachedMedia: 1,
      unresolvedTime: 1,
      unresolvedLocation: 1,
    });
    expect(() => accountEvidenceUniverseNodes([...nodes, nodes[0]])).toThrow('evidence_universe_duplicate_address');
    expect(() => accountEvidenceUniverseNodes([{
      ...nodes[0],
      schemaVersion: 'evidence-universe-v1',
    } as any])).toThrow('evidence_universe_node_layout_invalid');
  });

  it('projects a governed sighting row into the same universe contract', () => {
    const node = projectSightingEvidenceUniverseNode({
      cursor: { updated_at: '2026-07-17T18:00:00Z', case_id: '11111111-1111-4111-8111-111111111111' },
      sighting: { source: 'AARO', source_record_id: 'case-4', event_timestamp: '2024-02-02', lat: 35, lon: -110,
        location: 'Arizona', country_code: 'us', shape_normalized: 'orb', summary: 'Observed light' },
    });
    expect(node).toMatchObject({
      address: 'sighting:11111111-1111-4111-8111-111111111111', kind: 'sighting', source: 'AARO',
      sourceRecordId: 'case-4', title: 'orb', linkedSightingId: null,
    });
  });
});
