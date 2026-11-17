export type VideoSourceTrustTier = 'tier_a_official' | 'tier_b_structured' | 'tier_c_unverified';
export type VideoStoragePolicy = 'reference_only' | 'archivable';
export type VideoPlaybackPolicy = 'platform_embed' | 'self_hosted';
export type VideoRightsStatus =
  | 'platform_terms'
  | 'public_domain'
  | 'creative_commons'
  | 'licensed'
  | 'first_party'
  | 'review_required';
export type VideoContentClass = 'sighting_footage' | 'mixed_archive' | 'non_sighting' | 'unknown';

export type VideoSourceDefinition = {
  id: string;
  name: string;
  trust_tier: VideoSourceTrustTier;
  source_type: 'platform_index' | 'government_portal' | 'public_archive' | 'structured_dataset' | 'first_party';
  source_url: string;
  default_video_ingest_enabled: boolean;
  storage_policy: VideoStoragePolicy;
  playback_policy: VideoPlaybackPolicy;
  rights_status: VideoRightsStatus;
  license: string;
  chain_of_custody: 'platform_embed' | 'official_portal' | 'public_archive' | 'structured_archive' | 'first_party';
  notes?: string;
};

const VIDEO_SOURCE_REGISTRY: VideoSourceDefinition[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    trust_tier: 'tier_b_structured',
    source_type: 'platform_index',
    source_url: 'https://www.youtube.com/',
    default_video_ingest_enabled: false,
    storage_policy: 'reference_only',
    playback_policy: 'platform_embed',
    rights_status: 'platform_terms',
    license: 'Platform terms apply; store metadata only unless separate written rights exist.',
    chain_of_custody: 'platform_embed',
    notes: 'Retired for this dataset. Existing YouTube rows should be purged and new ingestion is disabled.',
  },
  {
    id: 'dvids-uap-related',
    name: 'DVIDS UAP-related media',
    trust_tier: 'tier_a_official',
    source_type: 'government_portal',
    source_url: 'https://www.dvidshub.net/',
    default_video_ingest_enabled: true,
    storage_policy: 'archivable',
    playback_policy: 'self_hosted',
    rights_status: 'public_domain',
    license: 'DoD/Federal media is public domain unless item-level copyright indicates otherwise.',
    chain_of_custody: 'official_portal',
    notes: 'Preferred official self-hosted video source when item rights remain clear.',
  },
  {
    id: 'nara-uap-archives',
    name: 'NARA UAP moving images',
    trust_tier: 'tier_a_official',
    source_type: 'government_portal',
    source_url: 'https://www.archives.gov/research/catalog/catalog-bulk-downloads/uap-bulk-download',
    default_video_ingest_enabled: true,
    storage_policy: 'archivable',
    playback_policy: 'self_hosted',
    rights_status: 'public_domain',
    license: 'US federal records; verify per-record usage terms.',
    chain_of_custody: 'official_portal',
    notes: 'Metadata-first catalog ingest, followed by R2 backfill for downloadable UAP moving-image holdings.',
  },
  {
    id: 'congress-uap-hearings',
    name: 'U.S. Congress UAP hearings',
    trust_tier: 'tier_a_official',
    source_type: 'government_portal',
    source_url: 'https://www.congress.gov/',
    default_video_ingest_enabled: true,
    storage_policy: 'reference_only',
    playback_policy: 'platform_embed',
    rights_status: 'review_required',
    license: 'Official congressional hearing pages and video records are public to view, but reuse and redistribution rules vary by chamber and embedded host.',
    chain_of_custody: 'official_portal',
    notes: 'Metadata-first source for hearings, testimony, and official UAP context records.',
  },
  {
    id: 'nasa-uap-office',
    name: 'NASA UAP office media',
    trust_tier: 'tier_a_official',
    source_type: 'government_portal',
    source_url: 'https://science.nasa.gov/uap/',
    default_video_ingest_enabled: true,
    storage_policy: 'reference_only',
    playback_policy: 'platform_embed',
    rights_status: 'review_required',
    license: 'NASA media is broadly reusable when NASA-produced, but linked distribution platforms and third-party elements still require item-level review.',
    chain_of_custody: 'official_portal',
    notes: 'Metadata-first source for NASA UAP meetings, telecons, and public briefings.',
  },
  {
    id: 'defense-uap-videos',
    name: 'Defense.gov AARO UAP videos',
    trust_tier: 'tier_a_official',
    source_type: 'government_portal',
    source_url: 'https://www.defense.gov/Multimedia/Videos/',
    default_video_ingest_enabled: true,
    storage_policy: 'archivable',
    playback_policy: 'self_hosted',
    rights_status: 'public_domain',
    license: 'Official DoD public affairs video pages are public release material; verify item-level restrictions before reuse.',
    chain_of_custody: 'official_portal',
    notes: 'Official AARO case footage pages published through Defense.gov multimedia/video pages.',
  },
  {
    id: 'defense-uap-context',
    name: 'Defense.gov UAP releases',
    trust_tier: 'tier_a_official',
    source_type: 'government_portal',
    source_url: 'https://www.defense.gov/News/Releases/',
    default_video_ingest_enabled: true,
    storage_policy: 'reference_only',
    playback_policy: 'platform_embed',
    rights_status: 'review_required',
    license: 'Official Defense Department release pages are public context records; verify item-level media rights before reuse.',
    chain_of_custody: 'official_portal',
    notes: 'Official DoD UAP releases and reporting announcements used as archive context records.',
  },
  {
    id: 'dow-uap-release',
    name: 'Department of War UFO release',
    trust_tier: 'tier_a_official',
    source_type: 'government_portal',
    source_url: 'https://www.war.gov/UFO/',
    default_video_ingest_enabled: true,
    storage_policy: 'archivable',
    playback_policy: 'self_hosted',
    rights_status: 'public_domain',
    license: 'Official Department of War / AARO public release material with DVIDS-hosted public video files; verify item-level restrictions before reuse.',
    chain_of_custody: 'official_portal',
    notes: 'May 2026 Department of War UFO release videos and related official case media.',
  },
  {
    id: 'geipan-case-videos',
    name: 'GEIPAN case evidence videos',
    trust_tier: 'tier_a_official',
    source_type: 'government_portal',
    source_url: 'https://www.geipan.fr/fr/recherche/cas',
    default_video_ingest_enabled: true,
    storage_policy: 'reference_only',
    playback_policy: 'platform_embed',
    rights_status: 'review_required',
    license: 'Official GEIPAN case pages may host witness-submitted video evidence; keep ingestion metadata-first and review rights per attachment before any storage or redistribution.',
    chain_of_custody: 'official_portal',
    notes: 'Review-first official case evidence lane for downloadable MP4 witness attachments on GEIPAN case pages.',
  },
  {
    id: 'brazil-arquivo-nacional-ovni',
    name: 'Brazil Arquivo Nacional OVNI archive',
    trust_tier: 'tier_a_official',
    source_type: 'government_portal',
    source_url: 'https://www.gov.br/arquivonacional/pt-br/canais_atendimento/imprensa/noticias/conheca-o-fundo-sobre-ovnis-do-arquivo-nacional',
    default_video_ingest_enabled: true,
    storage_policy: 'reference_only',
    playback_policy: 'platform_embed',
    rights_status: 'review_required',
    license: 'Arquivo Nacional OVNI holdings are official and described as public-domain federal records, but stable public record/media URLs are inconsistent; treat ingestion as metadata-first until item-level links are reviewable.',
    chain_of_custody: 'official_portal',
    notes: 'Metadata-first official archive lane for Brazil OVNI holdings. Promote direct media only from reviewed stable record URLs.',
  },
  {
    id: 'internet-archive-uap',
    name: 'Internet Archive UAP footage',
    trust_tier: 'tier_b_structured',
    source_type: 'public_archive',
    source_url: 'https://archive.org/',
    default_video_ingest_enabled: false,
    storage_policy: 'archivable',
    playback_policy: 'self_hosted',
    rights_status: 'review_required',
    license: 'Item-level rights vary; ingest only when the metadata shows permissive reuse or public-domain status.',
    chain_of_custody: 'public_archive',
    notes: 'Good archivable source when item rights are explicit and permissive.',
  },
  {
    id: 'aapb-ufo-programs',
    name: 'AAPB UFO and alien programs',
    trust_tier: 'tier_b_structured',
    source_type: 'public_archive',
    source_url: 'https://americanarchive.org/',
    default_video_ingest_enabled: true,
    storage_policy: 'reference_only',
    playback_policy: 'platform_embed',
    rights_status: 'review_required',
    license: 'American Archive of Public Broadcasting records have item-level access and reuse constraints; ingest metadata and platform playback only until each item is reviewed.',
    chain_of_custody: 'public_archive',
    notes: 'Review-first public-broadcast archive lane for UFO, alien, and anomalous-phenomena programs.',
  },
  {
    id: 'project-blue-book-archive',
    name: 'Project Blue Book Archive videos',
    trust_tier: 'tier_b_structured',
    source_type: 'public_archive',
    source_url: 'https://theprojectbluebookarchive.org/archive/',
    default_video_ingest_enabled: true,
    storage_policy: 'archivable',
    playback_policy: 'self_hosted',
    rights_status: 'review_required',
    license: 'Private archive mirror of declassified Project Blue Book media; treat every file as review-required until provenance and reuse posture are confirmed.',
    chain_of_custody: 'public_archive',
    notes: 'Review-first historical archive lane for motion picture films and legacy video folders.',
  },
  {
    id: 'hf-uap-videos',
    name: 'HF UAP Videos',
    trust_tier: 'tier_b_structured',
    source_type: 'structured_dataset',
    source_url: 'https://huggingface.co/datasets/logicbear/uap',
    default_video_ingest_enabled: false,
    storage_policy: 'archivable',
    playback_policy: 'self_hosted',
    rights_status: 'review_required',
    license: 'Dataset-card and file-level rights vary; verify before storing publicly.',
    chain_of_custody: 'structured_archive',
    notes: 'Potential high-yield archive source once rights and provenance are verified.',
  },
  {
    id: 'reddit-reviewed-sighting-leads',
    name: 'Reddit reviewed sighting leads',
    trust_tier: 'tier_c_unverified',
    source_type: 'platform_index',
    source_url: 'https://www.reddit.com/',
    default_video_ingest_enabled: false,
    storage_policy: 'archivable',
    playback_policy: 'self_hosted',
    rights_status: 'review_required',
    license: 'Platform terms and witness rights must be reviewed before public use; internal staging only by default.',
    chain_of_custody: 'platform_embed',
    notes: 'Use only for reviewed staging uploads while tracing witness originals or permissions.',
  },
  {
    id: 'footage-user-upload',
    name: 'User-submitted sightings footage',
    trust_tier: 'tier_b_structured',
    source_type: 'first_party',
    source_url: 'https://uapfileslive.com/',
    default_video_ingest_enabled: true,
    storage_policy: 'archivable',
    playback_policy: 'self_hosted',
    rights_status: 'first_party',
    license: 'Uploader grants storage and display rights under product terms.',
    chain_of_custody: 'first_party',
    notes: 'Best long-term source for a rights-clean sightings archive.',
  },
];

const registryMap = new Map(VIDEO_SOURCE_REGISTRY.map((source) => [source.id, source]));

export const getVideoSourceById = (sourceId: string): VideoSourceDefinition | undefined => {
  return registryMap.get(sourceId);
};

export const listVideoSources = (): VideoSourceDefinition[] => {
  return [...VIDEO_SOURCE_REGISTRY];
};

export const isVideoSourceIngestAllowed = (sourceId: string): boolean => {
  const source = getVideoSourceById(sourceId);
  return Boolean(source?.default_video_ingest_enabled);
};

export const assertVideoSourceIngestAllowed = (sourceId: string): VideoSourceDefinition => {
  const source = getVideoSourceById(sourceId);
  if (!source) {
    throw new Error(`Video source "${sourceId}" is not in the registry (blocked by allowlist).`);
  }
  if (!source.default_video_ingest_enabled) {
    throw new Error(`Video source "${sourceId}" is disabled by ingestion policy.`);
  }
  return source;
};
