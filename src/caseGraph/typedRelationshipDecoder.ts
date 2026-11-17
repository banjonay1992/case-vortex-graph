import {
  RELATIONSHIP_INPUT_CANONICAL_VERSION,
  assertRelationshipInputBinding,
  canonicalizeRelationshipInput,
  relationshipInputSha256,
  validateRelationshipInputAddress,
  validateRelationshipInputBinding,
  type RelationshipInputUniverseBinding,
} from './relationshipInputSnapshot';
import {
  TYPED_RELATIONSHIP_CLAIM_DISCIPLINE,
  TYPED_RELATIONSHIP_EDGE_TYPES,
  TYPED_RELATIONSHIP_MODEL,
  TYPED_RELATIONSHIP_PAIR_EDGE_TYPES,
  TYPED_RELATIONSHIP_POLICY_SHA256,
  TYPED_RELATIONSHIP_POLICY_VERSION,
  TYPED_RELATIONSHIP_SCHEMA_VERSION,
  type TypedRelationshipDependency,
  type TypedRelationshipEdge,
  type TypedRelationshipEdgeType,
  type TypedRelationshipEndpoint,
  type TypedRelationshipPairEvaluation,
  type TypedRelationshipReceipt,
} from './typedRelationshipModel';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const invalid = (code: string): never => { throw new Error(code); };
const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);
const requireExactKeys = (value: Record<string, unknown>, expected: readonly string[], code: string) => {
  const actual = Object.keys(value).sort(lexical);
  const sortedExpected = [...expected].sort(lexical);
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) invalid(code);
};
const parseJsonObject = (input: unknown, code: string): Record<string, any> => {
  let value: unknown = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try { value = JSON.parse(String(input)); } catch { invalid(`${code}_json_invalid`); }
  }
  if (!isPlainObject(value)) invalid(`${code}_invalid`);
  return value as Record<string, any>;
};
const modelIdentityMatches = (value: unknown) => (
  isPlainObject(value) && canonicalizeRelationshipInput(value) === canonicalizeRelationshipInput(TYPED_RELATIONSHIP_MODEL)
);
const receiptWithoutId = (receipt: Omit<TypedRelationshipReceipt, 'receiptId'>) => receipt;
const edgeWithoutId = (edge: Omit<TypedRelationshipEdge, 'edgeId'>) => edge;
const pairEvaluationWithoutDigest = (evaluation: Omit<TypedRelationshipPairEvaluation, 'evaluationDigest'>) => evaluation;

export const decodeTypedRelationshipEdge = (
  input: unknown,
  expectedBinding?: RelationshipInputUniverseBinding,
): TypedRelationshipEdge => {
  const value = parseJsonObject(input, 'typed_relationship_edge');
  requireExactKeys(value, ['recordType', 'schemaVersion', 'canonicalVersion', 'edgeId', 'binding', 'edgeType', 'endpoints', 'strength', 'receipt'], 'typed_relationship_edge_invalid');
  if (value.recordType !== 'typed_relationship_edge' || value.schemaVersion !== TYPED_RELATIONSHIP_SCHEMA_VERSION
    || value.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION || !TYPED_RELATIONSHIP_EDGE_TYPES.includes(value.edgeType as TypedRelationshipEdgeType)
    || typeof value.edgeId !== 'string' || !/^typed-edge:[a-f0-9]{64}$/.test(value.edgeId) || !Number.isSafeInteger(value.strength)
    || Number(value.strength) < 0 || Number(value.strength) > 100 || !Array.isArray(value.endpoints) || value.endpoints.length !== 2 || !isPlainObject(value.receipt)) invalid('typed_relationship_edge_invalid');
  const binding = validateRelationshipInputBinding(value.binding);
  if (expectedBinding) assertRelationshipInputBinding(binding, expectedBinding);
  const endpoints = (value.endpoints as unknown[]).map((endpoint: unknown) => {
    if (!isPlainObject(endpoint)) return invalid('typed_relationship_edge_endpoint_invalid');
    requireExactKeys(endpoint, ['kind', 'id'], 'typed_relationship_edge_endpoint_invalid');
    if (endpoint.kind === 'evidence') return { kind: 'evidence' as const, id: validateRelationshipInputAddress(endpoint.id) };
    if (endpoint.kind !== 'context' || typeof endpoint.id !== 'string' || !endpoint.id.length || endpoint.id.trim() !== endpoint.id || endpoint.id.length > 512) invalid('typed_relationship_edge_endpoint_invalid');
    return { kind: 'context' as const, id: endpoint.id };
  }) as [TypedRelationshipEndpoint, TypedRelationshipEndpoint];
  const receiptValue = value.receipt;
  requireExactKeys(receiptValue, ['recordType', 'schemaVersion', 'canonicalVersion', 'receiptId', 'edgeType', 'inputRecordDigests', 'rarityIndexDigest', 'policyVersion', 'policySha256', 'model', 'reasons', 'checks', 'factEvidence', 'rarity', 'missingness', 'uncertainty', 'dependency', 'contextualEvaluation', 'claimDiscipline', 'plainEnglish'], 'typed_relationship_receipt_invalid');
  if (receiptValue.recordType !== 'typed_relationship_receipt' || receiptValue.schemaVersion !== TYPED_RELATIONSHIP_SCHEMA_VERSION
    || receiptValue.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION || receiptValue.edgeType !== value.edgeType
    || receiptValue.policyVersion !== TYPED_RELATIONSHIP_POLICY_VERSION || receiptValue.policySha256 !== TYPED_RELATIONSHIP_POLICY_SHA256
    || !modelIdentityMatches(receiptValue.model) || typeof receiptValue.receiptId !== 'string' || !/^typed-receipt:[a-f0-9]{64}$/.test(receiptValue.receiptId)
    || !Array.isArray(receiptValue.inputRecordDigests) || !receiptValue.inputRecordDigests.length || (receiptValue.inputRecordDigests as unknown[]).some((digest: unknown) => typeof digest !== 'string' || !SHA256_PATTERN.test(digest))
    || (receiptValue.rarityIndexDigest !== null && (typeof receiptValue.rarityIndexDigest !== 'string' || !SHA256_PATTERN.test(receiptValue.rarityIndexDigest)))
    || !Array.isArray(receiptValue.reasons) || !receiptValue.reasons.length || !Array.isArray(receiptValue.checks) || !Array.isArray(receiptValue.factEvidence)
    || !Array.isArray(receiptValue.rarity) || !Array.isArray(receiptValue.missingness) || !isPlainObject(receiptValue.uncertainty)
    || !isPlainObject(receiptValue.dependency) || typeof receiptValue.plainEnglish !== 'string' || !receiptValue.plainEnglish.length
    || canonicalizeRelationshipInput(receiptValue.claimDiscipline) !== canonicalizeRelationshipInput(TYPED_RELATIONSHIP_CLAIM_DISCIPLINE)) invalid('typed_relationship_receipt_invalid');
  if (value.edgeType === 'contextual_explanation_candidate') {
    if (endpoints[0].kind !== 'evidence' || endpoints[1].kind !== 'context' || !isPlainObject(receiptValue.contextualEvaluation)) invalid('typed_relationship_context_edge_invalid');
  } else if (endpoints.some((endpoint) => endpoint.kind !== 'evidence') || receiptValue.contextualEvaluation !== null) invalid('typed_relationship_pair_edge_invalid');
  const receipt = receiptValue as unknown as TypedRelationshipReceipt;
  const { receiptId: _receiptId, ...withoutReceiptId } = receipt;
  if (receipt.receiptId !== `typed-receipt:${relationshipInputSha256(receiptWithoutId(withoutReceiptId))}`) invalid('typed_relationship_receipt_digest_mismatch');
  const edge = { ...value, binding, endpoints, receipt } as unknown as TypedRelationshipEdge;
  const { edgeId: _edgeId, ...withoutEdgeId } = edge;
  if (edge.edgeId !== `typed-edge:${relationshipInputSha256(edgeWithoutId(withoutEdgeId))}`) invalid('typed_relationship_edge_digest_mismatch');
  return edge;
};

export const decodeTypedRelationshipPairEvaluation = (
  input: unknown,
  expectedBinding?: RelationshipInputUniverseBinding,
): TypedRelationshipPairEvaluation => {
  const value = parseJsonObject(input, 'typed_relationship_pair_evaluation');
  requireExactKeys(value, ['recordType', 'schemaVersion', 'canonicalVersion', 'binding', 'addresses', 'inputRecordDigests', 'rarityIndexDigest', 'policyVersion', 'policySha256', 'model', 'dependency', 'edges', 'rejections', 'evaluationDigest'], 'typed_relationship_pair_evaluation_invalid');
  if (value.recordType !== 'typed_relationship_pair_evaluation' || value.schemaVersion !== TYPED_RELATIONSHIP_SCHEMA_VERSION
    || value.canonicalVersion !== RELATIONSHIP_INPUT_CANONICAL_VERSION || value.policyVersion !== TYPED_RELATIONSHIP_POLICY_VERSION
    || value.policySha256 !== TYPED_RELATIONSHIP_POLICY_SHA256 || !modelIdentityMatches(value.model) || !Array.isArray(value.addresses)
    || value.addresses.length !== 2 || !Array.isArray(value.inputRecordDigests) || value.inputRecordDigests.length !== 2
    || value.inputRecordDigests.some((digest) => typeof digest !== 'string' || !SHA256_PATTERN.test(digest)) || typeof value.rarityIndexDigest !== 'string'
    || !SHA256_PATTERN.test(value.rarityIndexDigest) || !isPlainObject(value.dependency) || !['independent', 'dependent', 'unknown'].includes(String(value.dependency.classification))
    || !Array.isArray(value.dependency.reasons) || !Array.isArray(value.edges) || !Array.isArray(value.rejections) || typeof value.evaluationDigest !== 'string'
    || !SHA256_PATTERN.test(value.evaluationDigest)) invalid('typed_relationship_pair_evaluation_invalid');
  const binding = validateRelationshipInputBinding(value.binding);
  if (expectedBinding) assertRelationshipInputBinding(binding, expectedBinding);
  const addresses = (value.addresses as unknown[]).map((item: unknown) => validateRelationshipInputAddress(item)).sort(lexical) as [string, string];
  if (addresses[0] === addresses[1] || canonicalizeRelationshipInput(value.addresses) !== canonicalizeRelationshipInput(addresses)) invalid('typed_relationship_pair_addresses_invalid');
  const edges = (value.edges as unknown[]).map((edge: unknown) => decodeTypedRelationshipEdge(edge, binding));
  const emittedTypes = new Set<string>();
  const sortedDigests = [...(value.inputRecordDigests as string[])].sort(lexical);
  for (const edge of edges) {
    if (!TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.includes(edge.edgeType as typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number]) || emittedTypes.has(edge.edgeType)
      || canonicalizeRelationshipInput(edge.endpoints.map((endpoint) => endpoint.id)) !== canonicalizeRelationshipInput(addresses)
      || canonicalizeRelationshipInput(edge.receipt.inputRecordDigests) !== canonicalizeRelationshipInput(sortedDigests)
      || edge.receipt.rarityIndexDigest !== value.rarityIndexDigest || canonicalizeRelationshipInput(edge.receipt.dependency) !== canonicalizeRelationshipInput(value.dependency)) invalid('typed_relationship_pair_edge_binding_invalid');
    emittedTypes.add(edge.edgeType);
  }
  const sortedEdges = [...edges].sort((left, right) => lexical(left.edgeType, right.edgeType) || lexical(left.edgeId, right.edgeId));
  if (canonicalizeRelationshipInput(edges) !== canonicalizeRelationshipInput(sortedEdges)) invalid('typed_relationship_pair_edge_order_invalid');
  const rejections = (value.rejections as unknown[]).map((rejection: unknown) => {
    if (!isPlainObject(rejection)) return invalid('typed_relationship_pair_rejection_invalid');
    requireExactKeys(rejection, ['edgeType', 'reasonCodes'], 'typed_relationship_pair_rejection_invalid');
    if (!TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.includes(rejection.edgeType as typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number]) || emittedTypes.has(String(rejection.edgeType))
      || !Array.isArray(rejection.reasonCodes) || !rejection.reasonCodes.length || rejection.reasonCodes.some((reason) => typeof reason !== 'string' || !reason.length)) invalid('typed_relationship_pair_rejection_invalid');
    const reasonCodes = [...(rejection.reasonCodes as string[])].sort(lexical) as string[];
    if (new Set(reasonCodes).size !== reasonCodes.length || canonicalizeRelationshipInput(rejection.reasonCodes) !== canonicalizeRelationshipInput(reasonCodes)) invalid('typed_relationship_pair_rejection_invalid');
    return { edgeType: rejection.edgeType as typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number], reasonCodes };
  }).sort((left: { edgeType: typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number] }, right: { edgeType: typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number] }) => TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.indexOf(left.edgeType) - TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.indexOf(right.edgeType));
  const expectedRejectedTypes = TYPED_RELATIONSHIP_PAIR_EDGE_TYPES.filter((edgeType) => !emittedTypes.has(edgeType));
  if (new Set(rejections.map((item: { edgeType: typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number] }) => item.edgeType)).size !== rejections.length || canonicalizeRelationshipInput(rejections.map((item: { edgeType: typeof TYPED_RELATIONSHIP_PAIR_EDGE_TYPES[number] }) => item.edgeType)) !== canonicalizeRelationshipInput(expectedRejectedTypes)
    || canonicalizeRelationshipInput(value.rejections) !== canonicalizeRelationshipInput(rejections)) invalid('typed_relationship_pair_rejection_set_invalid');
  const evaluation = { ...value, binding, addresses, inputRecordDigests: value.inputRecordDigests as [string, string], model: TYPED_RELATIONSHIP_MODEL, dependency: value.dependency as TypedRelationshipDependency, edges, rejections } as unknown as TypedRelationshipPairEvaluation;
  const { evaluationDigest: _evaluationDigest, ...withoutDigest } = evaluation;
  if (evaluation.evaluationDigest !== relationshipInputSha256(pairEvaluationWithoutDigest(withoutDigest))) invalid('typed_relationship_pair_evaluation_digest_mismatch');
  return evaluation;
};
