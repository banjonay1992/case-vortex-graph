export type QualitySeverity = 'warning' | 'error';

export type DataQualityRuleCode =
  | 'invalid_date_past'
  | 'invalid_date_future'
  | 'historical_date_pre_1800'
  | 'invalid_geo_out_of_range'
  | 'invalid_geo_partial_pair';

export type SightingQualityIssue = {
  rule_code: DataQualityRuleCode;
  severity: QualitySeverity;
  reason: string;
  raw_value: Record<string, unknown>;
  proposed_value: Record<string, unknown>;
};

export type SightingQualityAssessment = {
  event_timestamp: string | null;
  lat: number | null;
  lon: number | null;
  issues: SightingQualityIssue[];
};

export type DataQualityQuarantineUpsertRow = {
  entity_type: 'sighting' | 'document' | 'photo';
  entity_id: string | null;
  source: string | null;
  source_record_id: string | null;
  rule_code: DataQualityRuleCode | string;
  severity: QualitySeverity;
  reason: string;
  raw_value?: Record<string, unknown> | null;
  proposed_value?: Record<string, unknown> | null;
};

export type SightingRecordLayer =
  | 'raw_ingested'
  | 'canonical_normalized'
  | 'publishable_public'
  | 'mappable_public'
  | 'derived_correlation';

export type SightingVisibilityExclusionReason =
  | 'source_governance_missing'
  | 'source_governance_not_approved'
  | 'source_governance_non_public_mode'
  | 'source_governance_unapproved'
  | 'user_publication_not_consented'
  | 'registry_blocklist'
  | 'duplicate_cluster_non_primary'
  | 'future_dated'
  | 'invalid_geo_pair';

export type SourceGovernanceVisibilityReason =
  | 'source_governance_missing'
  | 'source_governance_not_approved'
  | 'source_governance_non_public_mode'
  | null;

export type SourceGovernanceSnapshot = {
  present: boolean;
  legal_status?: string | null;
  allowed_content_modes?: string[] | null;
};

export type SightingVisibilityDecisionInput = {
  sourceGovernance: SourceGovernanceSnapshot;
  userPublicationAllowed?: boolean;
  registryBlocked?: boolean;
  duplicateNonPrimary?: boolean;
  futureDated?: boolean;
  invalidGeoPair?: boolean;
};
