import { createHash } from 'node:crypto';

import type { CaseVortexRepresentedRecord } from '../../src/caseGraph/corpusAccounting';
import {
  caseVortexCorpusAccountingReceiptSha256,
  encodeCaseVortexCorpusAccountingReceipt,
} from '../../src/caseGraph/corpusAccountingIntegration';
import {
  validateCaseGraphV2LineageReceipts,
  type CaseGraphV2LineageReceipts,
} from '../../src/caseGraph/postgresCaseGraphControlPlaneV2';
import { canonicalizeRelationshipInput } from '../../src/caseGraph/relationshipInputSnapshot';
import {
  buildStructurallyBoundPublicationV2Fixture,
} from './publicationV2TestSupport';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const canonicalBody = (value: unknown) => Buffer.from(
  `${canonicalizeRelationshipInput(value)}\n`,
  'utf8',
);

type LineageValidationInput = Parameters<typeof validateCaseGraphV2LineageReceipts>[0];
type PublicationFixture = ReturnType<typeof buildStructurallyBoundPublicationV2Fixture>;

const validationInput = (
  fixture: PublicationFixture,
  override: Partial<LineageValidationInput> = {},
): LineageValidationInput => ({
  completion: fixture.completion,
  completionBody: fixture.completionBody,
  universeCompletionBody: fixture.universeCompletionBody,
  featureCompletionBody: fixture.featureCompletionBody,
  relationshipInputManifestBody: fixture.relationshipInputManifestBody,
  relationshipCompletionBody: canonicalBody(fixture.relationship.completion),
  relationshipRunIndexArchiveBody: fixture.relationship.indexArtifact.archiveBody,
  relationshipRunIndexReceiptBody: fixture.relationship.indexArtifact.receiptBody,
  relationshipRunIndexPointerBody: canonicalBody(fixture.relationship.pointer),
  contextualCompletionBody: fixture.contextualCompletion.artifactBody,
  calibrationSetReceiptBody: fixture.calibration.setReceiptBody,
  pairCalibrationReceiptBody: fixture.calibration.pairReceiptBody,
  contextualCalibrationReceiptBody: fixture.calibration.contextualReceiptBody,
  pairCalibrationArtifactBody: fixture.calibration.pair.artifactBody,
  pairCalibrationTrustPolicyBody: fixture.calibration.pair.trustPolicyBody,
  contextualCalibrationArtifactBody: fixture.calibration.contextual.artifactBody,
  contextualCalibrationTrustPolicyBody: fixture.calibration.contextual.trustPolicyBody,
  manifest: fixture.manifest,
  manifestBody: fixture.manifestBody,
  accountingReceipt: fixture.accountingReceipt,
  accountingReceiptBody: fixture.accountingReceiptBody,
  ...override,
});

const representedRecords = (fixture: PublicationFixture): CaseVortexRepresentedRecord[] => (
  fixture.relationship.records.map((record, index): CaseVortexRepresentedRecord => {
    const separator = record.address.indexOf(':');
    const kind = record.address.slice(0, separator) as CaseVortexRepresentedRecord['kind'];
    const recordId = record.address.slice(separator + 1);
    const digest = (suffix: string) => sha256(`${record.address}:${index}:${suffix}`);
    return {
      status: 'represented',
      kind,
      recordId,
      address: record.address,
      universe: { address: record.address, sha256: digest('universe') },
      relationshipInput: {
        address: record.address,
        sha256: digest('relationship-input'),
        disposition: 'processed',
      },
      graph: { address: record.address, sha256: digest('graph') },
      userInterface: { address: record.address, sha256: digest('ui') },
    };
  }).sort((left, right) => left.address.localeCompare(right.address))
);

export const buildValidatedCaseGraphV2ControlPlaneTestFixture = (): {
  receipts: CaseGraphV2LineageReceipts;
  records: CaseVortexRepresentedRecord[];
} => {
  const fixture = buildStructurallyBoundPublicationV2Fixture();
  const records = representedRecords(fixture);
  const lines = (
    field: 'universe' | 'relationshipInput' | 'graph' | 'userInterface',
  ) => records.map((record) => `${record.address}:${record[field].sha256}\n`).join('');
  const accountingReceipt = {
    ...fixture.accountingReceipt,
    representedAddressSetSha256: sha256(records.map((record) => `${record.address}\n`).join('')),
    universePointerSetSha256: sha256(lines('universe')),
    relationshipInputPointerSetSha256: sha256(lines('relationshipInput')),
    graphPointerSetSha256: sha256(lines('graph')),
    userInterfacePointerSetSha256: sha256(lines('userInterface')),
  };
  const accountingReceiptBody = encodeCaseVortexCorpusAccountingReceipt(accountingReceipt);
  const completion = {
    ...fixture.completion,
    accounting_receipt_sha256: caseVortexCorpusAccountingReceiptSha256(accountingReceiptBody),
  };
  return {
    records,
    receipts: validateCaseGraphV2LineageReceipts(validationInput(fixture, {
      completion,
      completionBody: canonicalBody(completion),
      accountingReceipt,
      accountingReceiptBody,
    })),
  };
};
