import toolDefinitions from './caseVortexResearchTools.json';

export type CaseVortexResearchToolName = keyof typeof toolDefinitions;

export type CaseVortexResearchToolCapability = {
  name: CaseVortexResearchToolName;
  available: boolean;
};

export type CaseVortexResearchCapabilityReadiness = {
  recordSearch: boolean;
  contentResearch: boolean;
  claimEvidence: boolean;
  externalCorrelation: boolean;
};

type ToolDefinition = [
  CaseVortexResearchToolName,
  keyof Omit<CaseVortexResearchCapabilityReadiness, 'externalCorrelation'> | null,
];

const CASE_VORTEX_RESEARCH_TOOL_DEFINITIONS = Object.entries(toolDefinitions) as ToolDefinition[];
export const CASE_VORTEX_RESEARCH_TOOL_NAMES = Object.freeze(
  CASE_VORTEX_RESEARCH_TOOL_DEFINITIONS.map(([name]) => name),
) as readonly CaseVortexResearchToolName[];

/**
 * The single public/server projection of Luna's strict read-only allowlist.
 * External correlation is reported separately because correlate_context still
 * works against the pinned relationship graph when external snapshots are not
 * verified; in that state it returns an explicit unavailable result.
 */
export const caseVortexResearchToolCapabilities = (
  readiness: CaseVortexResearchCapabilityReadiness,
): CaseVortexResearchToolCapability[] => CASE_VORTEX_RESEARCH_TOOL_DEFINITIONS.map(([name, gate]) => ({
  name,
  available: gate === null ? true : readiness[gate],
}));

const CASE_VORTEX_RESEARCH_TOOL_NAME_SET = new Set<string>(CASE_VORTEX_RESEARCH_TOOL_NAMES);

export const isCaseVortexResearchToolName = (value: string): value is CaseVortexResearchToolName => (
  CASE_VORTEX_RESEARCH_TOOL_NAME_SET.has(value)
);
