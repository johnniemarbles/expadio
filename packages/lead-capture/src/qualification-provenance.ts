/**
 * Qualification provenance — ADR-017 Invariant 3.
 *
 * Every qualification fact must carry an evidence_source that records how the
 * criterion response was determined. No write path may omit this field.
 * The database enforces it via NOT NULL (migration 0152); this module enforces
 * it at the TypeScript application boundary.
 *
 * This module is pure: no database, no network.
 */

// ── Evidence source catalog ───────────────────────────────────────────────────

export const QUALIFICATION_EVIDENCE_SOURCES = [
  /** Lead self-reported via a capture form. Lowest verification weight. */
  'SELF_DECLARED',
  /** Computed from behavioral or operational signals by the platform engine. */
  'SYSTEM_DERIVED',
  /** A human operator reviewed and made the assessment. */
  'OPERATOR_ASSESSED',
  /** Verified against documents submitted by the lead. */
  'DOCUMENT_VERIFIED',
  /** Verified via a third-party external source. Highest verification weight. */
  'EXTERNAL_VERIFIED',
] as const;

export type QualificationEvidenceSource = (typeof QUALIFICATION_EVIDENCE_SOURCES)[number];

// ── Qualification responses ───────────────────────────────────────────────────

export const QUALIFICATION_RESPONSES = [
  'NOT_ASSESSED',
  'MEETS',
  'PARTIALLY_MEETS',
  'DOES_NOT_MEET',
  'NOT_APPLICABLE',
] as const;

export type QualificationResponse = (typeof QUALIFICATION_RESPONSES)[number];

// ── Qualification fact ────────────────────────────────────────────────────────

/**
 * An immutable qualification fact for a single criterion on a capture lead.
 * ADR-017 Invariant 3: evidenceSource is always present; facts are append-only
 * and never mutated after recording.
 */
export interface QualificationFact {
  readonly qualificationId: string;
  readonly captureLeadId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly qualificationTemplateId: string;
  readonly templateVersion: number;
  readonly criterionKey: string;
  readonly response: QualificationResponse;
  /** How this criterion response was determined. Never null. ADR-017 Invariant 3. */
  readonly evidenceSource: QualificationEvidenceSource;
  readonly note: string | null;
  readonly assessedBySubjectId: string;
  readonly assessedAt: string;
}

// ── Builder ───────────────────────────────────────────────────────────────────

export interface BuildQualificationFactOptions {
  readonly qualificationId: string;
  readonly captureLeadId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly qualificationTemplateId: string;
  readonly templateVersion: number;
  readonly criterionKey: string;
  readonly response: QualificationResponse;
  /**
   * ADR-017 Invariant 3: required. Omitting or passing null/empty throws
   * MISSING_EVIDENCE_SOURCE. Passing an unrecognised value throws
   * UNKNOWN_EVIDENCE_SOURCE.
   */
  readonly evidenceSource: string | null | undefined;
  readonly note?: string | null;
  readonly assessedBySubjectId: string;
  readonly assessedAt: string;
}

export class QualificationProvenanceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'QualificationProvenanceError';
    this.code = code;
  }
}

function requireNonBlank(value: string | null | undefined, field: string, code: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new QualificationProvenanceError(code, `${field} is required and must not be blank.`);
  }
  return value.trim();
}

function requirePositiveInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new QualificationProvenanceError(
      'INVALID_TEMPLATE_VERSION',
      `${field} must be a positive integer.`,
    );
  }
  return value;
}

/**
 * Build an immutable QualificationFact, enforcing ADR-017 Invariant 3.
 * Throws QualificationProvenanceError if evidenceSource is absent or unrecognised.
 */
export function buildQualificationFact(options: BuildQualificationFactOptions): QualificationFact {
  const qualificationId = requireNonBlank(options.qualificationId, 'qualificationId', 'MISSING_FIELD');
  const captureLeadId = requireNonBlank(options.captureLeadId, 'captureLeadId', 'MISSING_FIELD');
  const tenantId = requireNonBlank(options.tenantId, 'tenantId', 'MISSING_FIELD');
  const organizationId = requireNonBlank(options.organizationId, 'organizationId', 'MISSING_FIELD');
  const qualificationTemplateId = requireNonBlank(
    options.qualificationTemplateId,
    'qualificationTemplateId',
    'MISSING_FIELD',
  );
  const templateVersion = requirePositiveInt(options.templateVersion, 'templateVersion');
  const criterionKey = requireNonBlank(options.criterionKey, 'criterionKey', 'MISSING_FIELD');
  const assessedBySubjectId = requireNonBlank(
    options.assessedBySubjectId,
    'assessedBySubjectId',
    'MISSING_FIELD',
  );
  const assessedAt = requireNonBlank(options.assessedAt, 'assessedAt', 'MISSING_FIELD');

  if (!(QUALIFICATION_RESPONSES as readonly string[]).includes(options.response)) {
    throw new QualificationProvenanceError('UNKNOWN_RESPONSE', `Unknown response: ${options.response}`);
  }

  // ADR-017 Invariant 3: evidenceSource is always required.
  if (options.evidenceSource == null || (typeof options.evidenceSource === 'string' && options.evidenceSource.trim() === '')) {
    throw new QualificationProvenanceError(
      'MISSING_EVIDENCE_SOURCE',
      'evidenceSource is required (ADR-017 Invariant 3). No qualification fact may be recorded without declaring how the response was determined.',
    );
  }
  if (!(QUALIFICATION_EVIDENCE_SOURCES as readonly string[]).includes(options.evidenceSource.trim())) {
    throw new QualificationProvenanceError(
      'UNKNOWN_EVIDENCE_SOURCE',
      `Unknown evidenceSource: "${options.evidenceSource}". Expected one of: ${QUALIFICATION_EVIDENCE_SOURCES.join(', ')}.`,
    );
  }

  return {
    qualificationId,
    captureLeadId,
    tenantId,
    organizationId,
    qualificationTemplateId,
    templateVersion,
    criterionKey,
    response: options.response,
    evidenceSource: options.evidenceSource.trim() as QualificationEvidenceSource,
    note: typeof options.note === 'string' && options.note.trim() !== '' ? options.note.trim() : null,
    assessedBySubjectId,
    assessedAt,
  };
}

// ── Evidence source validation ────────────────────────────────────────────────

/**
 * Validate a raw evidence source value at a system boundary (e.g. API ingress).
 * Returns the typed value or throws UNKNOWN_EVIDENCE_SOURCE.
 */
export function validateEvidenceSource(value: unknown): QualificationEvidenceSource {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new QualificationProvenanceError(
      'MISSING_EVIDENCE_SOURCE',
      'evidenceSource is required.',
    );
  }
  const trimmed = value.trim();
  if (!(QUALIFICATION_EVIDENCE_SOURCES as readonly string[]).includes(trimmed)) {
    throw new QualificationProvenanceError(
      'UNKNOWN_EVIDENCE_SOURCE',
      `Unknown evidenceSource: "${trimmed}". Expected one of: ${QUALIFICATION_EVIDENCE_SOURCES.join(', ')}.`,
    );
  }
  return trimmed as QualificationEvidenceSource;
}
