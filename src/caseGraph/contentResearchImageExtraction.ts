import {
  makeCaseGraphContentChunk,
  makeCaseGraphContentExtractionContract,
  makeCaseGraphContentExtractionReceipt,
  verifyCaseGraphContentAsset,
  verifyCaseGraphContentLimitsProfile,
  type CaseGraphContentAsset,
  type CaseGraphContentChunk,
  type CaseGraphContentExtractionContract,
  type CaseGraphContentExtractionReceipt,
  type CaseGraphContentExtractor,
  type CaseGraphContentLimitsProfile,
} from './contentResearchArchive';

export const CASE_GRAPH_IMAGE_EXTRACTION_POLICY = Object.freeze({
  version: 'case-graph-image-extraction-v1',
  maximumMetadataFields: 64,
  publicMetadataFields: [
    'Make', 'Model', 'LensModel', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength',
    'Orientation', 'Software', 'DateTimeOriginal',
  ],
  excludedSensitiveFieldFamilies: ['gps', 'serial_number', 'owner_name', 'freeform_comment'],
} as const);

export type CaseGraphImageMetadataField = {
  field: string;
  text: string;
  language?: string;
};

export type CaseGraphImageOcrRegion = {
  text: string;
  language: string;
  confidence: number;
  boundingBox: [number, number, number, number] | null;
  regionLabel?: string | null;
  warnings?: string[];
};

export type CaseGraphImageExtractionBundle = {
  contract: CaseGraphContentExtractionContract;
  receipt: CaseGraphContentExtractionReceipt;
  chunks: CaseGraphContentChunk[];
};

const splitByUtf8Bytes = (text: string, maximumBytes: number) => {
  const output: string[] = [];
  let current = '';
  for (const character of text) {
    if (current && Buffer.byteLength(current + character, 'utf8') > maximumBytes) {
      output.push(current);
      current = '';
    }
    if (Buffer.byteLength(character, 'utf8') > maximumBytes) {
      throw new Error('case_graph_image_character_exceeds_chunk_limit');
    }
    current += character;
  }
  if (current) output.push(current);
  return output;
};

const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const compareRegions = (left: CaseGraphImageOcrRegion, right: CaseGraphImageOcrRegion) => {
  const a = left.boundingBox || [2, 2, 2, 2];
  const b = right.boundingBox || [2, 2, 2, 2];
  return a[1] - b[1] || a[0] - b[0] || compareText(left.text, right.text);
};

const receiptFor = (
  asset: CaseGraphContentAsset,
  contract: CaseGraphContentExtractionContract,
  chunks: CaseGraphContentChunk[],
  warnings: string[],
) => {
  const totalPixels = asset.imageWidth! * asset.imageHeight!;
  return makeCaseGraphContentExtractionReceipt({
    asset,
    contract,
    chunks,
    coverage: { coverageType: 'image', totalPixels, processedPixels: totalPixels },
    warnings,
  });
};

export const extractCaseGraphImageContent = (params: {
  asset: CaseGraphContentAsset;
  limitsProfile: CaseGraphContentLimitsProfile;
  metadataExtractor: CaseGraphContentExtractor & { extractorType: 'metadata' };
  ocrExtractor: CaseGraphContentExtractor & { extractorType: 'ocr' };
  metadataFields: CaseGraphImageMetadataField[];
  ocrRegions: CaseGraphImageOcrRegion[];
}): CaseGraphImageExtractionBundle[] => {
  const asset = verifyCaseGraphContentAsset(params.asset);
  const limitsProfile = verifyCaseGraphContentLimitsProfile(params.limitsProfile);
  if (asset.mediaKind !== 'image' || asset.terminalStatus !== 'extracted'
    || asset.imageWidth === null || asset.imageHeight === null) {
    throw new Error('case_graph_image_asset_not_extractable');
  }
  if (!Array.isArray(params.metadataFields) || !Array.isArray(params.ocrRegions)
    || params.metadataFields.length > CASE_GRAPH_IMAGE_EXTRACTION_POLICY.maximumMetadataFields) {
    throw new Error('case_graph_image_extraction_input_invalid');
  }
  const fields = [...params.metadataFields]
    .filter((value) => value.text.trim())
    .sort((left, right) => compareText(left.field, right.field));
  if (new Set(fields.map(({ field }) => field)).size !== fields.length) {
    throw new Error('case_graph_image_metadata_field_duplicate');
  }
  const regions = [...params.ocrRegions].filter((value) => value.text.trim()).sort(compareRegions);
  let totalTextBytes = 0;
  let totalChunks = 0;
  const countText = (text: string) => {
    totalTextBytes += Buffer.byteLength(text, 'utf8');
    totalChunks += splitByUtf8Bytes(text, limitsProfile.maxChunkTextBytes).length;
    if (totalTextBytes > limitsProfile.maxTotalTextBytesPerAsset) {
      throw new Error('case_graph_content_total_text_limit_exceeded');
    }
    if (totalChunks > limitsProfile.maxChunksPerAsset) {
      throw new Error('case_graph_content_chunk_count_invalid');
    }
  };
  fields.forEach(({ text }) => countText(text));
  regions.forEach(({ text }) => countText(text));
  const bundles: CaseGraphImageExtractionBundle[] = [];
  if (fields.length) {
    const contract = makeCaseGraphContentExtractionContract({
      asset, limitsProfile, extractor: params.metadataExtractor,
    });
    const chunks: CaseGraphContentChunk[] = [];
    for (const field of fields) {
      for (const text of splitByUtf8Bytes(field.text, limitsProfile.maxChunkTextBytes)) {
        chunks.push(makeCaseGraphContentChunk({
          asset, contract, textOrigin: 'exif', ordinal: chunks.length,
          locator: { locatorType: 'exif_field', field: field.field },
          text, language: field.language || 'und', confidence: null,
        }));
      }
    }
    bundles.push({
      contract,
      chunks,
      receipt: receiptFor(asset, contract, chunks, [
        'Only explicitly approved public metadata fields are indexed; sensitive EXIF families are excluded',
      ]),
    });
  }
  if (regions.length) {
    const contract = makeCaseGraphContentExtractionContract({
      asset, limitsProfile, extractor: params.ocrExtractor,
    });
    const chunks: CaseGraphContentChunk[] = [];
    for (const region of regions) {
      for (const text of splitByUtf8Bytes(region.text, limitsProfile.maxChunkTextBytes)) {
        chunks.push(makeCaseGraphContentChunk({
          asset, contract, textOrigin: 'frame_ocr', ordinal: chunks.length,
          locator: {
            locatorType: 'image_region',
            regionLabel: region.regionLabel || null,
            boundingBox: region.boundingBox,
          },
          text, language: region.language, confidence: region.confidence,
          warnings: region.warnings,
        }));
      }
    }
    bundles.push({ contract, chunks, receipt: receiptFor(asset, contract, chunks, []) });
  }
  if (!bundles.length) throw new Error('case_graph_image_has_no_searchable_content');
  return bundles;
};
