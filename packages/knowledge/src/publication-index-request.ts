import type { BusinessConfigurationPublication } from '@expadio/business-config';
import type {
  KnowledgeIndexRequest,
  VersionedKnowledgeConfigurationReference,
} from './ingestion.ts';

export interface CorrectionPublicationIndexInput {
  readonly ingestionIdPrefix: string;
  readonly collectionReference: string;
  readonly metadataReferencePrefix: string;
  readonly embeddingConfiguration: VersionedKnowledgeConfigurationReference;
  readonly accessPolicy: VersionedKnowledgeConfigurationReference;
  readonly retentionPolicy: VersionedKnowledgeConfigurationReference;
  readonly retentionExpiresAt: string | null;
  readonly requestedAt: string;
  readonly correlationId: string;
}

export class CorrectionPublicationIndexError extends Error {
  readonly code:
    | 'CORRECTION_PUBLICATION_SCOPE_INVALID'
    | 'CORRECTION_PUBLICATION_INPUT_INVALID'
    | 'CORRECTION_PUBLICATION_PAYLOAD_INVALID';

  constructor(code: CorrectionPublicationIndexError['code'], message: string) {
    super(message);
    this.name = 'CorrectionPublicationIndexError';
    this.code = code;
  }
}

export function prepareCorrectionPublicationIndexRequests(
  publication: BusinessConfigurationPublication,
  input: CorrectionPublicationIndexInput,
): readonly KnowledgeIndexRequest[] {
  if (publication.scope.kind !== 'TENANT') {
    throw new CorrectionPublicationIndexError(
      'CORRECTION_PUBLICATION_SCOPE_INVALID',
      'Company Brain correction indexing requires tenant-scoped publication.',
    );
  }
  if (
    !stable(input.ingestionIdPrefix)
    || !stable(input.collectionReference)
    || !stable(input.metadataReferencePrefix)
    || !stable(input.correlationId)
    || !instant(input.requestedAt)
    || publication.objects.length === 0
  ) {
    throw new CorrectionPublicationIndexError(
      'CORRECTION_PUBLICATION_INPUT_INVALID',
      'Index preparation requires stable references, time, correlation, and published objects.',
    );
  }

  return publication.objects.map((object): KnowledgeIndexRequest => {
    const correction = correctionPayload(object.payload);
    const identity = `${object.kind}:${object.key}@${object.version}`;
    const digest = correction.proposedCorrectionDigest.slice('sha256:'.length);
    return {
      ingestionId: `${input.ingestionIdPrefix}:${identity}`,
      tenantId: publication.scope.tenantId,
      requestedBySubjectId: publication.publishedBySubjectId,
      purpose: 'Index an approved Company Brain correction.',
      collectionReference: input.collectionReference,
      documentReference: `business-config://${object.kind}/${object.key}`,
      documentVersion: object.version,
      sourceReference: correction.proposedCorrectionReference,
      sourceDigest: digest,
      metadataReference: `${input.metadataReferencePrefix}/${identity}`,
      chunks: [{
        ordinal: 0,
        chunkReference: `configuration://${identity}`,
        contentReference: correction.proposedCorrectionReference,
        contentDigest: digest,
      }],
      embeddingConfiguration: input.embeddingConfiguration,
      accessPolicy: input.accessPolicy,
      retentionPolicy: input.retentionPolicy,
      retentionExpiresAt: input.retentionExpiresAt,
      requestedAt: input.requestedAt,
      correlationId: input.correlationId,
      evidenceRefs: [
        ...new Set([
          ...publication.evidenceRefs,
          `business-config-publication://${publication.changesetId}@${publication.revision}`,
          correction.correctionProposalReference,
        ]),
      ],
    };
  });
}

function correctionPayload(payload: Readonly<Record<string, unknown>>): {
  readonly correctionProposalReference: string;
  readonly proposedCorrectionReference: string;
  readonly proposedCorrectionDigest: string;
} {
  const correctionProposalReference = payload.correctionProposalReference;
  const proposedCorrectionReference = payload.proposedCorrectionReference;
  const proposedCorrectionDigest = payload.proposedCorrectionDigest;
  if (
    typeof correctionProposalReference !== 'string'
    || !stable(correctionProposalReference)
    || typeof proposedCorrectionReference !== 'string'
    || !stable(proposedCorrectionReference)
    || typeof proposedCorrectionDigest !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(proposedCorrectionDigest)
  ) {
    throw new CorrectionPublicationIndexError(
      'CORRECTION_PUBLICATION_PAYLOAD_INVALID',
      'Published correction objects require proposal, content reference, and SHA-256 digest provenance.',
    );
  }
  return {
    correctionProposalReference,
    proposedCorrectionReference,
    proposedCorrectionDigest,
  };
}

function stable(value: string): boolean {
  return value.trim() !== '' && value === value.trim() && !/[\r\n\t]/u.test(value);
}

function instant(value: string): boolean {
  return stable(value) && Number.isFinite(Date.parse(value));
}
