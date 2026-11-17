import type {
  SightingVisibilityDecisionInput,
  SightingVisibilityExclusionReason,
  SourceGovernanceSnapshot,
  SourceGovernanceVisibilityReason,
} from './dataQualityTypes';

export const PUBLISHABLE_SIGHTING_POLICY_MODE = 'publishable_public_v3_user_consent';
export const GOVERNED_PUBLIC_CONTENT_MODES = ['full_ingest', 'all'] as const;

export const hasGovernedPublicContentMode = (allowedContentModes?: string[] | null) => {
  if (!allowedContentModes || allowedContentModes.length === 0) return true;
  return allowedContentModes.some((mode) =>
    GOVERNED_PUBLIC_CONTENT_MODES.includes(
      String(mode).trim().toLowerCase() as (typeof GOVERNED_PUBLIC_CONTENT_MODES)[number],
    ),
  );
};

export const evaluateSourceGovernanceVisibility = ({
  present,
  legal_status,
  allowed_content_modes,
}: SourceGovernanceSnapshot): SourceGovernanceVisibilityReason => {
  if (!present) return 'source_governance_missing';
  if (String(legal_status || '').trim().toLowerCase() !== 'approved') return 'source_governance_not_approved';
  if (!hasGovernedPublicContentMode(allowed_content_modes)) return 'source_governance_non_public_mode';
  return null;
};

export const evaluateSightingVisibilityDecision = ({
  sourceGovernance,
  userPublicationAllowed = true,
  registryBlocked = false,
  duplicateNonPrimary = false,
  futureDated = false,
  invalidGeoPair = false,
}: SightingVisibilityDecisionInput): SightingVisibilityExclusionReason | null => {
  const governanceReason = evaluateSourceGovernanceVisibility(sourceGovernance);
  if (governanceReason) return governanceReason;
  if (!userPublicationAllowed) return 'user_publication_not_consented';
  if (registryBlocked) return 'registry_blocklist';
  if (duplicateNonPrimary) return 'duplicate_cluster_non_primary';
  if (futureDated) return 'future_dated';
  if (invalidGeoPair) return 'invalid_geo_pair';
  return null;
};
