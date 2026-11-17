import {
  buildContextualSourceGovernanceDecisionPacket,
  type ContextualSourceGovernanceDecisionPacket,
  type ContextualSourceGovernanceEntryInput,
} from './contextualSourceGovernanceDecision';
import type { CaseGraphExternalCorrelationCategory } from './externalCorrelation';
import { relationshipInputSha256 } from './relationshipInputSnapshot';

export const CONTEXTUAL_SOURCE_RESEARCH_CATALOGUE_VERSION =
  'contextual-source-research-catalogue-2026-07-27-v5' as const;

export type ContextualSourceRegistryRow = {
  canonical_source: unknown;
  legal_status: unknown;
  allowed_content_modes: unknown;
};

type ResearchFinding = Omit<
  ContextualSourceGovernanceEntryInput,
  'registry' | 'evidence'
> & {
  evidence: Array<Omit<
    ContextualSourceGovernanceEntryInput['evidence'][number],
    'evidenceSha256'
  >>;
};

const OBSERVED_AT = '2026-07-24T22:32:48.000Z';
const ALTERNATIVE_OBSERVED_AT = '2026-07-27T16:40:00.000Z';

const finding = (
  category: CaseGraphExternalCorrelationCategory,
  canonicalSource: string,
  providerId: string,
  evidenceUrl: string,
  summary: string,
  overrides: Partial<ResearchFinding> = {},
): ResearchFinding => ({
  category,
  canonicalSource,
  providerId,
  requiredContentMode: 'derived_only',
  rights: {
    commercialUse: 'unclear',
    automatedAccess: 'unclear',
    archivalUse: 'unclear',
    redistribution: 'unclear',
    accessConstraint: 'unclear',
    attributionRequired: null,
  },
  evidence: [{
    evidenceId: `${providerId}-official-source-review-2026-07-23`,
    evidenceUrl,
    observedAt: OBSERVED_AT,
    summary,
  }],
  limitations: [
    'This is a conservative source-research finding, not legal approval.',
    'A current explicit legal-registry decision is required before provider access.',
  ],
  ...overrides,
});

export const CONTEXTUAL_SOURCE_RESEARCH_FINDINGS: readonly ResearchFinding[] = [
  finding(
    'aircraft',
    'OPENSKY',
    'opensky',
    'https://opensky-network.org/about/terms-of-use',
    'The official terms require prior written licensing for operational API use in a live product, service or automated system.',
    {
      rights: {
        commercialUse: 'unclear',
        automatedAccess: 'allowed',
        archivalUse: 'unclear',
        redistribution: 'unclear',
        accessConstraint: 'written_license',
        attributionRequired: true,
      },
      limitations: [
        'The current registry row is review/metadata-only and does not supply the required written operational licence.',
        'No aircraft query may run from this finding alone.',
      ],
    },
  ),
  finding(
    'aircraft',
    'ADSB_LOL',
    'adsb-lol',
    'https://api.adsb.lol/',
    'The official ADSB.lol API documentation makes the API and publicly released data available under ODbL and permits free API use, including production use after contacting the operator for service-stability coordination.',
    {
      rights: {
        commercialUse: 'allowed',
        automatedAccess: 'allowed',
        archivalUse: 'allowed',
        redistribution: 'allowed',
        accessConstraint: 'none',
        attributionRequired: true,
      },
      limitations: [
        'ODbL attribution, database notice and share-alike obligations must be preserved for any public adapted database.',
        'Production users are asked to contact the operator because the free service has no contractual availability guarantee.',
        'Receiver coverage, outages and retention gaps must remain explicit; a checked-no-match result cannot rule out an aircraft.',
        'An exact derived-only legal-registry approval remains required before provider access.',
      ],
    },
  ),
  finding(
    'satellite',
    'CELESTRAK',
    'celestrak',
    'https://celestrak.org/usage-policy.php',
    'The official usage policy permits machine access subject to caching, update-frequency limits and immediate stop on non-200 responses, but does not establish the complete archive and redistribution rights required here.',
    {
      rights: {
        commercialUse: 'unclear',
        automatedAccess: 'allowed',
        archivalUse: 'unclear',
        redistribution: 'unclear',
        accessConstraint: 'unclear',
        attributionRequired: null,
      },
      limitations: [
        'Any future adapter must cache each update and obey the published per-dataset refresh interval.',
        'Any future adapter must stop immediately on a non-200 response rather than retrying aggressively.',
        'Six-digit catalogue numbers require current CSV or JSON formats rather than legacy TLE-only handling.',
        'The usage policy does not expressly settle the commercial archive and redistribution rights required by Case Vortex.',
      ],
    },
  ),
  finding(
    'satellite',
    'SATNOGS_DB_API',
    'satnogs-db',
    'https://docs.satnogs.org/projects/satnogs-db/en/latest/api.html',
    'The official SatNOGS DB API documentation states that API access is open and all API data are distributed under CC BY-SA, providing an explicit no-fee machine-access and redistribution basis.',
    {
      rights: {
        commercialUse: 'allowed',
        automatedAccess: 'allowed',
        archivalUse: 'allowed',
        redistribution: 'allowed',
        accessConstraint: 'none',
        attributionRequired: true,
      },
      evidence: [{
        evidenceId: 'satnogs-db-api-license-review-2026-07-27',
        evidenceUrl: 'https://docs.satnogs.org/projects/satnogs-db/en/latest/api.html',
        observedAt: ALTERNATIVE_OBSERVED_AT,
        summary: 'The official SatNOGS DB API documentation says API access is open to anyone and all API data are freely distributed under CC BY-SA.',
      }],
      limitations: [
        'Preserve SatNOGS attribution, the CC BY-SA licence notice and share-alike obligations for any distributed adapted database.',
        'Archive exact API responses and retrieval times because orbital elements can change and stale elements materially increase positional uncertainty.',
        'Treat derived satellite passes as contextual candidates only; a checked-no-match result cannot rule out a satellite.',
        'Store and publish derived comparisons only through the public research interface.',
        'An exact derived-only legal-registry approval remains required before API access.',
      ],
    },
  ),
  finding(
    'balloon',
    'SONDEHUB_ARCHIVE',
    'sondehub-archive',
    'https://github.com/projecthorus/sondehub-infrastructure/wiki',
    'The project documentation identifies the historical radiosonde infrastructure, but the reviewed material does not yet establish the complete commercial archive and redistribution rights required by Case Vortex.',
  ),
  finding(
    'astronomy',
    'JPL_HORIZONS',
    'jpl-horizons',
    'https://ssd-api.jpl.nasa.gov/doc/horizons.html',
    'The official Horizons API supports machine-generated observer ephemerides, including time and topocentric geometry, but product-specific archival and redistribution rights remain to be bound to the registry.',
    {
      rights: {
        commercialUse: 'unclear',
        automatedAccess: 'allowed',
        archivalUse: 'unclear',
        redistribution: 'unclear',
        accessConstraint: 'unclear',
        attributionRequired: null,
      },
      evidence: [
        {
          evidenceId: 'jpl-horizons-official-api-review-2026-07-23',
          evidenceUrl: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html',
          observedAt: OBSERVED_AT,
          summary: 'The official Horizons API supports machine-generated observer ephemerides, including time and topocentric geometry.',
        },
        {
          evidenceId: 'jpl-horizons-nasa-science-data-license-review-2026-07-23',
          evidenceUrl: 'https://science.data.nasa.gov/about/license',
          observedAt: OBSERVED_AT,
          summary: 'NASA science-data guidance distinguishes explicitly licensed or NASA-led mission data from other data whose source-specific usage rights still need validation.',
        },
      ],
      limitations: [
        'Machine-readable API access does not by itself approve commercial archival or redistribution.',
        'The general NASA science-data guidance does not establish that this exact Horizons product and required derived-only mode are approved.',
        'A product-specific registry decision remains required before any Horizons provider call.',
      ],
    },
  ),
  finding(
    'astronomy',
    'ASTRONOMY_ENGINE_LOCAL',
    'astronomy-engine-local',
    'https://github.com/cosinekitty/astronomy',
    'Astronomy Engine is an MIT-licensed local calculation library for historical Sun, Moon and planet positions, with documented validation against NOVAS, DE405 and JPL Horizons and no provider call or paid service dependency.',
    {
      rights: {
        commercialUse: 'allowed',
        automatedAccess: 'allowed',
        archivalUse: 'allowed',
        redistribution: 'allowed',
        accessConstraint: 'none',
        attributionRequired: true,
      },
      evidence: [{
        evidenceId: 'astronomy-engine-mit-validation-review-2026-07-27',
        evidenceUrl: 'https://github.com/cosinekitty/astronomy',
        observedAt: ALTERNATIVE_OBSERVED_AT,
        summary: 'The official repository publishes Astronomy Engine under the MIT licence and documents local topocentric calculations validated against NOVAS, DE405 and JPL Horizons within its stated accuracy envelope.',
      }],
      limitations: [
        'Pin the exact package version and retain the MIT copyright and licence notice.',
        'Retain the engine version, input timestamp, observer coordinates and calculation digest with every derived observation.',
        'Disclose the documented approximately one-arcminute accuracy envelope and reject uses outside the supported bodies or time model.',
        'Treat angular proximity as a contextual candidate only, never as an identification or causal conclusion.',
        'An exact derived-only legal-registry approval remains required before production use.',
      ],
    },
  ),
  finding(
    'meteor',
    'NASA_CNEOS_FIREBALL',
    'nasa-cneos-fireball',
    'https://cneos.jpl.nasa.gov/fireballs/',
    'NASA CNEOS publishes fireball event data, but the general NASA science-data policy has not yet been bound to this exact product and content mode in the legal registry.',
    {
      rights: {
        commercialUse: 'unclear',
        automatedAccess: 'allowed',
        archivalUse: 'unclear',
        redistribution: 'unclear',
        accessConstraint: 'unclear',
        attributionRequired: null,
      },
      evidence: [
        {
          evidenceId: 'nasa-cneos-fireball-public-release-review-2026-07-23',
          evidenceUrl: 'https://cneos.jpl.nasa.gov/fireballs/',
          observedAt: OBSERVED_AT,
          summary: 'CNEOS says the fireball data comes from U.S. Government sensors for public release, is not independently verified by CNEOS, can be revised and is not a complete real-time record.',
        },
        {
          evidenceId: 'nasa-cneos-science-data-license-review-2026-07-23',
          evidenceUrl: 'https://science.data.nasa.gov/about/license',
          observedAt: OBSERVED_AT,
          summary: 'NASA science-data guidance requires source-specific rights validation for data outside an explicitly licensed or clearly NASA-led mission dataset.',
        },
      ],
      limitations: [
        'Public release does not by itself establish the commercial archive and redistribution permission required by Case Vortex.',
        'The source is incomplete, non-real-time, revisable and not independently verified by CNEOS.',
        'A checked-no-match result cannot rule out a meteor or fireball.',
        'A product-specific registry decision remains required before any CNEOS provider call.',
      ],
    },
  ),
  finding(
    'military_exercise',
    'DVIDS',
    'dvids-exercise-reference',
    'https://www.dvidshub.net/',
    'DVIDS is an official media and announcement surface, not a proven complete structured military-exercise schedule or coverage source.',
    {
      evidence: [
        {
          evidenceId: 'dvids-exercise-reference-official-source-review-2026-07-24',
          evidenceUrl: 'https://www.dvidshub.net/',
          observedAt: OBSERVED_AT,
          summary: 'DVIDS is an official media and announcement surface, not a proven complete structured military-exercise schedule or coverage source.',
        },
        {
          evidenceId: 'dvids-official-public-use-review-2026-07-24',
          evidenceUrl: 'https://www.dvidshub.net/about/copyright',
          observedAt: OBSERVED_AT,
          summary: 'DVIDS authorizes qualifying government visual information for public and commercial use with non-endorsement, publicity, privacy, trademark and item-level third-party-rights limitations.',
        },
      ],
      limitations: [
        'Absence of a DVIDS item cannot rule out a military exercise.',
        'No structured exercise provider is currently approved or archived.',
        'DVIDS contains some non-government material, so every retained reference still needs item-level rights and provenance checks.',
        'Any display must preserve the required non-endorsement and publicity/privacy limitations.',
      ],
    },
  ),
  finding(
    'launch',
    'ROCKETLAUNCH_LIVE',
    'rocketlaunch-live',
    'https://www.rocketlaunch.live/api',
    'RocketLaunch.Live provides read-only launch data, but full API access is Premium-only and archival, commercial and redistribution rights remain unbound in the legal registry.',
    {
      rights: {
        commercialUse: 'unclear',
        automatedAccess: 'allowed',
        archivalUse: 'unclear',
        redistribution: 'unclear',
        accessConstraint: 'paid_plan',
        attributionRequired: null,
      },
      limitations: [
        'A Premium membership and explicit legal-registry approval are required before full API use.',
        'The provider requests nearby attribution, but the reviewed page does not settle the exact archival, commercial or redistribution rights required by Case Vortex.',
        'Launch times are changeable and provider data must remain a comparison source rather than an identification.',
      ],
    },
  ),
  finding(
    'maritime',
    'AISSTREAM',
    'aisstream',
    'https://aisstream.io/documentation',
    'AISStream documents a live vessel-position stream, but historical retention, commercial archive use and redistribution rights remain unbound.',
    {
      rights: {
        commercialUse: 'unclear',
        automatedAccess: 'allowed',
        archivalUse: 'unclear',
        redistribution: 'unclear',
        accessConstraint: 'unclear',
        attributionRequired: null,
      },
      limitations: [
        'Short-window live positions do not prove historical coverage for an older sighting.',
        'Watch-zone geography is not a vessel-position observation.',
        'The official documentation confirms authenticated WebSocket access but does not establish the retention, commercial archive or redistribution rights required by Case Vortex.',
      ],
    },
  ),
  finding(
    'weather',
    'OPEN_METEO',
    'open-meteo',
    'https://open-meteo.com/en/terms',
    'The official terms restrict the free endpoint to non-commercial use and require a paid subscription for commercial API use; API data requires CC BY 4.0 attribution.',
    {
      rights: {
        commercialUse: 'allowed',
        automatedAccess: 'allowed',
        archivalUse: 'allowed',
        redistribution: 'allowed',
        accessConstraint: 'paid_plan',
        attributionRequired: true,
      },
      limitations: [
        'A paid customer endpoint and explicit legal-registry approval are required for commercial operation.',
        'Every displayed or exported result must retain the required attribution.',
      ],
    },
  ),
  finding(
    'weather',
    'NOAA_NCEI_US_OBSERVATIONS',
    'noaa-ncei-us-observations',
    'https://www.ncei.noaa.gov/cdo-web/webservices/getstarted',
    'NOAA NCEI provides token-authenticated programmatic access to historical weather observations, while NOAA-created digital material is generally public domain unless a source-specific restriction is marked.',
    {
      rights: {
        commercialUse: 'allowed',
        automatedAccess: 'allowed',
        archivalUse: 'allowed',
        redistribution: 'allowed',
        accessConstraint: 'none',
        attributionRequired: true,
      },
      evidence: [
        {
          evidenceId: 'noaa-ncei-cdo-api-review-2026-07-24',
          evidenceUrl: 'https://www.ncei.noaa.gov/cdo-web/webservices/getstarted',
          observedAt: OBSERVED_AT,
          summary: 'The official CDO API documentation supports scripted access with a free token, five requests per second and 10,000 requests per day.',
        },
        {
          evidenceId: 'noaa-public-domain-conditions-review-2026-07-24',
          evidenceUrl: 'https://sos.noaa.gov/copyright/',
          observedAt: OBSERVED_AT,
          summary: 'NOAA states that NOAA-created digital media are generally not copyrighted, requests acknowledgement and warns that third-party material can carry separate restrictions.',
        },
      ],
      limitations: [
        'This candidate is limited to U.S. NOAA-created observation records whose dataset metadata carries no additional restriction.',
        'Third-party and WMO-restricted non-U.S. records are excluded from this candidate and require separate source-specific review.',
        'NOAA acknowledgement and non-endorsement conditions must be retained in displays and exports.',
        'Station distance, observation cadence and missing variables must be disclosed; no record is not proof of clear weather.',
        'The free token limits are five requests per second and 10,000 requests per day, so snapshots must use bounded caching and backoff.',
        'An exact derived-only legal-registry approval remains required before provider access.',
      ],
    },
  ),
] as const;

const legalStatus = (
  value: unknown,
): Exclude<
  ContextualSourceGovernanceEntryInput['registry']['legalStatus'],
  'missing'
> => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!['approved', 'review', 'blocked', 'restricted'].includes(normalized)) {
    throw new Error('contextual_source_research_registry_status_invalid');
  }
  return normalized as Exclude<
    ContextualSourceGovernanceEntryInput['registry']['legalStatus'],
    'missing'
  >;
};

const modes = (value: unknown) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('contextual_source_research_registry_modes_invalid');
  }
  return [...new Set(value.map((item) => item.trim().toLowerCase()).filter(Boolean))].sort();
};

export const buildContextualSourceGovernanceResearchPacket = (params: {
  referenceAt: string;
  registryInspectedAt: string;
  registryRows: ContextualSourceRegistryRow[];
  maximumEvidenceAgeDays?: number;
  evidenceOverrides?: Record<string, ResearchFinding['evidence']>;
}): ContextualSourceGovernanceDecisionPacket => {
  const registry = new Map<string, {
    legalStatus: Exclude<
      ContextualSourceGovernanceEntryInput['registry']['legalStatus'],
      'missing'
    >;
    allowedContentModes: string[];
  }>();
  for (const row of params.registryRows) {
    const canonicalSource = String(row.canonical_source || '').trim().toUpperCase();
    if (!canonicalSource || registry.has(canonicalSource)) {
      throw new Error('contextual_source_research_registry_collision');
    }
    registry.set(canonicalSource, {
      legalStatus: legalStatus(row.legal_status),
      allowedContentModes: modes(row.allowed_content_modes),
    });
  }
  const expectedSources = new Set(CONTEXTUAL_SOURCE_RESEARCH_FINDINGS.map(({ canonicalSource }) => canonicalSource));
  if ([...registry.keys()].some((source) => !expectedSources.has(source))) {
    throw new Error('contextual_source_research_registry_unexpected_source');
  }
  if (Object.keys(params.evidenceOverrides || {}).some((source) => !expectedSources.has(source))) {
    throw new Error('contextual_source_research_evidence_override_unexpected_source');
  }
  return buildContextualSourceGovernanceDecisionPacket({
    referenceAt: params.referenceAt,
    maximumEvidenceAgeDays: params.maximumEvidenceAgeDays ?? 30,
    entries: CONTEXTUAL_SOURCE_RESEARCH_FINDINGS.map((source) => {
      const present = registry.get(source.canonicalSource);
      const selectedEvidence = params.evidenceOverrides?.[source.canonicalSource] || source.evidence;
      const evidence = selectedEvidence.map((item) => ({
        ...item,
        evidenceSha256: relationshipInputSha256({
          catalogueVersion: CONTEXTUAL_SOURCE_RESEARCH_CATALOGUE_VERSION,
          ...item,
        }),
      }));
      return {
        ...source,
        evidence,
        registry: {
          inspectedAt: params.registryInspectedAt,
          legalStatus: present?.legalStatus || 'missing',
          allowedContentModes: present?.allowedContentModes || [],
        },
      };
    }),
  });
};
