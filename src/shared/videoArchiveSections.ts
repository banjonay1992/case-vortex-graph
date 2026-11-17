import { getVideoSourceById, listVideoSources } from './videoSourceRegistry';

export type VideoArchiveSection =
  | 'sightings'
  | 'hearings'
  | 'interviews'
  | 'briefings_reports'
  | 'archive_material'
  | 'other_context'
  | 'user_upload';

const ARCHIVE_SOURCE_IDS = listVideoSources()
  .filter((source) => source.source_type === 'public_archive' || source.source_type === 'structured_dataset')
  .map((source) => source.id);

const USER_UPLOAD_SOURCE_IDS = listVideoSources()
  .filter((source) => source.source_type === 'first_party')
  .map((source) => source.id);

const quoteSqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;
const toSqlInList = (values: string[]) => values.map(quoteSqlLiteral).join(', ');
const withAlias = (alias: string | undefined, column: string) => (alias ? `${alias}.${column}` : column);
const buildSqlKeywordMatch = (expression: string, keywords: readonly string[]) =>
  `(${keywords.map((keyword) => `${expression} LIKE ${quoteSqlLiteral(`%${keyword.toLowerCase()}%`)}`).join(' OR ')})`;

const HEARING_KEYWORDS = [
  'hearing',
  'hearings',
  'testimony',
  'committee',
  'subcommittee',
  'congress',
  'congressional',
  'oversight',
] as const;

const INTERVIEW_KEYWORDS = [
  'interview',
  'interviews',
  'conversation',
  'q&a',
  'q & a',
  'debrief',
] as const;

const BRIEFING_REPORT_KEYWORDS = [
  'briefing',
  'briefings',
  'brief',
  'report',
  'reports',
  'statement',
  'statements',
  'release',
  'releases',
  'meeting',
  'telecon',
  'press conference',
  'press briefing',
  'public meeting',
] as const;

const ARCHIVE_KEYWORDS = [
  'archive',
  'archival',
  'motion picture',
  'historical',
  'declassified',
  'dataset',
  'catalog',
] as const;

const LEGACY_SECTION_ALIASES: Record<string, VideoArchiveSection> = {
  official_footage: 'sightings',
  official_context: 'briefings_reports',
  historical_archive: 'archive_material',
  mixed_non_official: 'other_context',
  user_upload: 'user_upload',
};

const buildSignalText = (video: {
  source_id?: unknown;
  title?: unknown;
  description?: unknown;
  channel_title?: unknown;
  categories?: unknown;
  tags?: unknown;
}) => {
  const parts = [
    typeof video.source_id === 'string' ? video.source_id : '',
    typeof video.title === 'string' ? video.title : '',
    typeof video.description === 'string' ? video.description : '',
    typeof video.channel_title === 'string' ? video.channel_title : '',
    Array.isArray(video.categories) ? video.categories.filter((item): item is string => typeof item === 'string').join(' ') : '',
    Array.isArray(video.tags) ? video.tags.filter((item): item is string => typeof item === 'string').join(' ') : '',
  ];

  return parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

const containsKeyword = (signalText: string, keywords: readonly string[]) =>
  keywords.some((keyword) => signalText.includes(keyword));

export const VIDEO_ARCHIVE_SECTION_ORDER: VideoArchiveSection[] = [
  'sightings',
  'hearings',
  'interviews',
  'briefings_reports',
  'archive_material',
  'other_context',
  'user_upload',
];

export const VIDEO_ARCHIVE_SECTION_META: Record<VideoArchiveSection, { label: string; description: string }> = {
  sightings: {
    label: 'Sightings',
    description: 'Visual evidence clips and direct sighting footage.',
  },
  hearings: {
    label: 'Hearings',
    description: 'Congressional, committee, and formal testimony videos.',
  },
  interviews: {
    label: 'Interviews',
    description: 'Recorded interviews, conversations, and Q&A sessions.',
  },
  briefings_reports: {
    label: 'Briefings & Reports',
    description: 'Briefings, statements, meetings, releases, and report videos.',
  },
  archive_material: {
    label: 'Archive Material',
    description: 'Historical reels, archive transfers, and structured dataset media.',
  },
  other_context: {
    label: 'Other Context',
    description: 'Reviewed context videos that do not fit a cleaner shelf yet.',
  },
  user_upload: {
    label: 'User Footage',
    description: 'First-party user-submitted sightings footage.',
  },
};

export const normalizeVideoArchiveSectionFilter = (value: unknown): VideoArchiveSection | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (LEGACY_SECTION_ALIASES[normalized]) return LEGACY_SECTION_ALIASES[normalized];
  return VIDEO_ARCHIVE_SECTION_ORDER.includes(normalized as VideoArchiveSection)
    ? (normalized as VideoArchiveSection)
    : null;
};

export const buildVideoArchiveSectionSql = (alias?: string) => {
  const sourceId = `COALESCE(${withAlias(alias, 'source_id')}, '')`;
  const rightsStatus = `COALESCE(${withAlias(alias, 'rights_status')}, '')`;
  const contentClass = `COALESCE(${withAlias(alias, 'content_class')}, '')`;
  const isSighting = `${withAlias(alias, 'is_sighting_footage')} = TRUE`;
  const signalText = `LOWER(CONCAT_WS(' ',
    COALESCE(${withAlias(alias, 'title')}, ''),
    COALESCE(${withAlias(alias, 'description')}, ''),
    COALESCE(${withAlias(alias, 'channel_title')}, ''),
    COALESCE(${withAlias(alias, 'source_id')}, ''),
    COALESCE(${withAlias(alias, 'categories')}::text, ''),
    COALESCE(${withAlias(alias, 'tags')}::text, '')
  ))`;
  const isHearing = buildSqlKeywordMatch(signalText, HEARING_KEYWORDS);
  const isInterview = buildSqlKeywordMatch(signalText, INTERVIEW_KEYWORDS);
  const isBriefingReport = buildSqlKeywordMatch(signalText, BRIEFING_REPORT_KEYWORDS);
  const isArchiveMaterial = `${sourceId} IN (${toSqlInList(ARCHIVE_SOURCE_IDS)}) OR ${contentClass} = 'mixed_archive' OR ${buildSqlKeywordMatch(signalText, ARCHIVE_KEYWORDS)}`;

  return `
    CASE
      WHEN ${sourceId} IN (${toSqlInList(USER_UPLOAD_SOURCE_IDS)}) OR ${rightsStatus} = 'first_party' THEN 'user_upload'
      WHEN ${isSighting} OR ${contentClass} = 'sighting_footage' THEN 'sightings'
      WHEN ${isHearing} THEN 'hearings'
      WHEN ${isInterview} THEN 'interviews'
      WHEN ${isBriefingReport} THEN 'briefings_reports'
      WHEN ${isArchiveMaterial} THEN 'archive_material'
      ELSE 'other_context'
    END
  `;
};

export const getVideoArchiveSection = (video: {
  source_id?: unknown;
  rights_status?: unknown;
  is_sighting_footage?: unknown;
  content_class?: unknown;
  title?: unknown;
  description?: unknown;
  channel_title?: unknown;
  categories?: unknown;
  tags?: unknown;
}): VideoArchiveSection => {
  const sourceId = typeof video.source_id === 'string' ? video.source_id : '';
  const rightsStatus = typeof video.rights_status === 'string' ? video.rights_status : '';
  const isSighting = video.is_sighting_footage === true;
  const contentClass = typeof video.content_class === 'string' ? video.content_class : '';
  const source = sourceId ? getVideoSourceById(sourceId) : undefined;
  const signalText = buildSignalText(video);

  if (source?.source_type === 'first_party' || rightsStatus === 'first_party') {
    return 'user_upload';
  }

  if (isSighting || contentClass === 'sighting_footage') {
    return 'sightings';
  }

  if (containsKeyword(signalText, HEARING_KEYWORDS)) {
    return 'hearings';
  }

  if (containsKeyword(signalText, INTERVIEW_KEYWORDS)) {
    return 'interviews';
  }

  if (containsKeyword(signalText, BRIEFING_REPORT_KEYWORDS)) {
    return 'briefings_reports';
  }

  if (
    source?.source_type === 'public_archive'
    || source?.source_type === 'structured_dataset'
    || contentClass === 'mixed_archive'
    || containsKeyword(signalText, ARCHIVE_KEYWORDS)
  ) {
    return 'archive_material';
  }

  return 'other_context';
};
