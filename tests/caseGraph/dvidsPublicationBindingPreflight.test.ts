import { describe, expect, it } from 'vitest';

import {
  assertFreshDvidsPublicationBinding,
  buildDvidsPublicationBindingPreflight,
  verifyDvidsPublicationBindingPreflight,
} from '../../src/caseGraph/dvidsPublicationBindingPreflight';
import {
  dvidsReviewedIntegrationFixture,
} from './dvidsReviewedClaimIntegrationFixtures';

describe('DVIDS publication binding preflight', () => {
  it('binds one exact inactive never-activated verified-v2 candidate', () => {
    const fixture = dvidsReviewedIntegrationFixture();
    expect(fixture.publicationPreflight).toMatchObject({
      ready: true,
      database: {
        publicationCount: 1,
        activePublicationCount: 0,
        verifiedV2PublicationCount: 1,
        exactEligibleCandidateCount: 1,
      },
      candidate: fixture.publicationBinding,
      blockers: [],
      guarantees: {
        databaseWrites: 0,
        publicationMutations: 0,
        deployments: 0,
      },
    });
    expect(verifyDvidsPublicationBindingPreflight({
      value: fixture.publicationPreflight,
      publisherAssignment: fixture.publisherAssignment,
      frameOcrAssignment: fixture.frameAssignment,
    })).toEqual(fixture.publicationPreflight);
    expect(assertFreshDvidsPublicationBinding({
      preflight: fixture.publicationPreflight,
      publisherAssignment: fixture.publisherAssignment,
      frameOcrAssignment: fixture.frameAssignment,
      usedAt: '2026-07-27T22:30:00.000Z',
    })).toEqual(fixture.publicationBinding);
  });

  it('records an exact zero-row candidate blocker without inventing identity', () => {
    const fixture = dvidsReviewedIntegrationFixture();
    expect(fixture.missingPublicationPreflight).toMatchObject({
      ready: false,
      database: {
        publicationCount: 0,
        activePublicationCount: 0,
        exactEligibleCandidateCount: 0,
      },
      inventory: [],
      candidate: null,
      blockers: ['database_candidate_missing'],
    });
    expect(() => assertFreshDvidsPublicationBinding({
      preflight: fixture.missingPublicationPreflight,
      publisherAssignment: fixture.publisherAssignment,
      frameOcrAssignment: fixture.frameAssignment,
      usedAt: '2026-07-27T22:30:00.000Z',
    })).toThrow('dvids_publication_binding_candidate_unavailable');
  });

  it('fails closed on active state, duplicates, tampering and stale evidence', () => {
    const fixture = dvidsReviewedIntegrationFixture();
    const active = buildDvidsPublicationBindingPreflight({
      publisherAssignment: fixture.publisherAssignment,
      frameOcrAssignment: fixture.frameAssignment,
      observation: {
        serverVersionNum: 170_006,
        transactionReadOnly: true,
        observedAt: '2026-07-27T22:25:00.000Z',
        publications: [{
          ...fixture.publicationPreflight.inventory[0],
          active: true,
          activatedAt: '2026-07-27T22:24:00.000Z',
        }],
      },
    });
    expect(active.blockers).toEqual([
      'database_active_publication_present',
      'database_candidate_missing',
    ]);
    expect(() => buildDvidsPublicationBindingPreflight({
      publisherAssignment: fixture.publisherAssignment,
      frameOcrAssignment: fixture.frameAssignment,
      observation: {
        serverVersionNum: 170_006,
        transactionReadOnly: true,
        observedAt: '2026-07-27T22:25:00.000Z',
        publications: [
          fixture.publicationPreflight.inventory[0],
          fixture.publicationPreflight.inventory[0],
        ],
      },
    })).toThrow('dvids_publication_binding_inventory_duplicate');
    expect(() => buildDvidsPublicationBindingPreflight({
      publisherAssignment: fixture.publisherAssignment,
      frameOcrAssignment: fixture.frameAssignment,
      observation: {
        serverVersionNum: 170_006,
        transactionReadOnly: true,
        observedAt: '2026-07-27T22:25:00.000Z',
        publications: [{
          ...fixture.publicationPreflight.inventory[0],
          receiptGraphArtifactSetSha256: 'e'.repeat(64),
        }],
      },
    })).toThrow(
      'dvids_publication_binding_inventory_verification_mismatch',
    );
    expect(() => verifyDvidsPublicationBindingPreflight({
      value: {
        ...fixture.publicationPreflight,
        candidate: {
          ...fixture.publicationBinding,
          manifestSha256: 'f'.repeat(64),
        },
      },
      publisherAssignment: fixture.publisherAssignment,
      frameOcrAssignment: fixture.frameAssignment,
    })).toThrow('dvids_publication_binding_preflight_integrity_failed');
    expect(() => assertFreshDvidsPublicationBinding({
      preflight: fixture.publicationPreflight,
      publisherAssignment: fixture.publisherAssignment,
      frameOcrAssignment: fixture.frameAssignment,
      usedAt: '2026-07-28T00:30:00.000Z',
    })).toThrow('dvids_publication_binding_preflight_stale');
  });
});
