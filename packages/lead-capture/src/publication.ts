/**
 * Publication — ADR-017 Invariant 4.
 *
 * Publication is DISTINCT from:
 *   - Capture Configuration  (the governed behavioral key set)
 *   - Capture Source         (the attribution anchor; one source per publication, never shared)
 *
 * A Capture Configuration may produce many Publications. Each Publication
 * is one independently attributable channel. Each Publication owns exactly
 * one Capture Source. A Capture Source may not be shared across Publications.
 *
 * Hosted-form URL shape:  apply.<brand>.com/opportunity
 *   The slug is brand-configured and interest-type-neutral.
 *   The interest type is selected inside the form (or via ?type= query param).
 *   There is no franchise-specific or distributor-specific path segment.
 */

import type { PublicationMode, RegistryInterestType, RegistryOpportunityType } from './interest-type-registry.ts';

// ── Publication lifecycle ─────────────────────────────────────────────────────

export type PublicationStatus =
  | 'DRAFT'
  | 'ACTIVE'
  | 'PAUSED'
  | 'ARCHIVED';

// ── Hosted-form configuration ─────────────────────────────────────────────────

/** Configuration for a HOSTED_FORM publication channel. */
export interface HostedFormConfig {
  /**
   * The brand-owned path slug appended after the brand domain.
   * Must be a valid URL path segment starting with '/'.
   * Example: '/opportunity', '/join', '/apply'
   * Must NOT contain interest-type names ('/franchise', '/distributor', etc).
   */
  readonly publicationSlug: string;
  /**
   * The brand's custom domain for hosted forms.
   * Example: 'apply.acmecorp.com'
   * No scheme prefix; the platform always serves over HTTPS.
   */
  readonly brandDomain: string;
  /**
   * Optional redirect URL after successful submission.
   * When absent, the platform shows the default thank-you screen.
   */
  readonly postSubmitRedirectUrl: string | null;
  /** Whether to pre-fill known fields when the visitor is identified (cookie/link). */
  readonly enablePreFill: boolean;
}

// ── Capture Source ────────────────────────────────────────────────────────────

/**
 * A Capture Source is the attribution anchor for a Publication.
 * One source, one publication — always. Sources are never reused across Publications.
 *
 * ADR-017 Invariant 4: the source_id is assigned at Publication creation and
 * never transferred to another Publication.
 */
export interface CaptureSource {
  readonly captureSourceId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly publicationId: string;
  /** Human-readable channel label (e.g. "Website /opportunity", "Google Ads Canada"). */
  readonly label: string;
  readonly createdAt: string;
}

// ── Publication aggregate ─────────────────────────────────────────────────────

export interface LeadPublication {
  readonly publicationId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  /** The Capture Configuration this publication was derived from. */
  readonly captureConfigId: string;

  readonly interestType: RegistryInterestType;
  readonly opportunityType: RegistryOpportunityType | null;

  /** The behavioral key set — copied from the Effective Configuration at publish time. */
  readonly schemaKey: string;
  readonly qualificationProfileKey: string;
  readonly workflowBlueprintKey: string;
  readonly evidenceProfileKey: string;
  readonly defaultRoutingProfileKey: string;

  readonly publicationMode: PublicationMode;

  /** Populated when publicationMode is HOSTED_FORM. Null for other modes. */
  readonly hostedFormConfig: HostedFormConfig | null;

  /** The Capture Source owned by this publication. One-to-one, never shared. */
  readonly captureSource: CaptureSource;

  readonly status: PublicationStatus;
  readonly createdAt: string;
  readonly activatedAt: string | null;
  readonly archivedAt: string | null;
}

// ── Build options ─────────────────────────────────────────────────────────────

export interface BuildPublicationOptions {
  readonly publicationId: string;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly captureConfigId: string;
  readonly interestType: RegistryInterestType;
  readonly opportunityType: RegistryOpportunityType | null;
  readonly schemaKey: string;
  readonly qualificationProfileKey: string;
  readonly workflowBlueprintKey: string;
  readonly evidenceProfileKey: string;
  readonly defaultRoutingProfileKey: string;
  readonly publicationMode: PublicationMode;
  readonly hostedFormConfig: HostedFormConfig | null;
  readonly captureSourceId: string;
  readonly captureSourceLabel: string;
  readonly createdAt: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export class PublicationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PublicationError';
    this.code = code;
  }
}

// ── Slug validation ───────────────────────────────────────────────────────────

const SLUG_RE = /^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

/**
 * Interest-type path segments that are not permitted in a publication slug.
 * The slug must be interest-type-neutral (ADR-017 § Invariant 4).
 */
const DISALLOWED_SLUG_SEGMENTS = new Set([
  'franchise', 'franchisee', 'master-franchise', 'master-franchisee',
  'distributor', 'distribution', 'affiliate', 'licensee', 'license', 'agent',
]);

function validatePublicationSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new PublicationError(
      'INVALID_SLUG',
      `publication slug must match /^/[a-z0-9-]+(/[a-z0-9-]+)*$/, got: ${slug}`,
    );
  }
  const segments = slug.slice(1).split('/');
  for (const seg of segments) {
    if (DISALLOWED_SLUG_SEGMENTS.has(seg)) {
      throw new PublicationError(
        'INTEREST_TYPE_SLUG',
        `publication slug must be interest-type-neutral; "${seg}" names a specific interest type. ` +
        `Use a neutral slug such as "/opportunity", "/join", or "/apply".`,
      );
    }
  }
}

function validateBrandDomain(domain: string): void {
  if (!domain || domain.trim() === '') {
    throw new PublicationError('INVALID_BRAND_DOMAIN', 'brandDomain must not be blank');
  }
  if (domain.startsWith('http://') || domain.startsWith('https://')) {
    throw new PublicationError(
      'INVALID_BRAND_DOMAIN',
      'brandDomain must not include a scheme prefix — the platform always serves HTTPS',
    );
  }
}

function validateRequired(value: string, field: string): void {
  if (!value || value.trim() === '') {
    throw new PublicationError('MISSING_FIELD', `${field} must not be blank`);
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Constructs a validated LeadPublication.
 *
 * ADR-017 Invariant 4 enforcement:
 *   - A HOSTED_FORM publication MUST have hostedFormConfig.
 *   - Non-HOSTED_FORM publications MUST have null hostedFormConfig.
 *   - The publication slug MUST be interest-type-neutral (no '/franchise', etc).
 *   - captureSourceId and captureSourceLabel are required — the source
 *     is created atomically with the publication and never transferred.
 */
export function buildPublication(options: BuildPublicationOptions): LeadPublication {
  validateRequired(options.publicationId, 'publicationId');
  validateRequired(options.tenantId, 'tenantId');
  validateRequired(options.organizationId, 'organizationId');
  validateRequired(options.captureConfigId, 'captureConfigId');
  validateRequired(options.schemaKey, 'schemaKey');
  validateRequired(options.qualificationProfileKey, 'qualificationProfileKey');
  validateRequired(options.workflowBlueprintKey, 'workflowBlueprintKey');
  validateRequired(options.evidenceProfileKey, 'evidenceProfileKey');
  validateRequired(options.defaultRoutingProfileKey, 'defaultRoutingProfileKey');
  validateRequired(options.captureSourceId, 'captureSourceId');
  validateRequired(options.captureSourceLabel, 'captureSourceLabel');

  if (options.publicationMode === 'HOSTED_FORM') {
    if (options.hostedFormConfig === null) {
      throw new PublicationError(
        'MISSING_HOSTED_FORM_CONFIG',
        'hostedFormConfig is required when publicationMode is HOSTED_FORM',
      );
    }
    validatePublicationSlug(options.hostedFormConfig.publicationSlug);
    validateBrandDomain(options.hostedFormConfig.brandDomain);
  } else {
    if (options.hostedFormConfig !== null) {
      throw new PublicationError(
        'UNEXPECTED_HOSTED_FORM_CONFIG',
        `hostedFormConfig must be null for publicationMode ${options.publicationMode}`,
      );
    }
  }

  const captureSource: CaptureSource = {
    captureSourceId: options.captureSourceId,
    tenantId: options.tenantId,
    organizationId: options.organizationId,
    publicationId: options.publicationId,
    label: options.captureSourceLabel,
    createdAt: options.createdAt,
  };

  return {
    publicationId: options.publicationId,
    tenantId: options.tenantId,
    organizationId: options.organizationId,
    captureConfigId: options.captureConfigId,
    interestType: options.interestType,
    opportunityType: options.opportunityType,
    schemaKey: options.schemaKey,
    qualificationProfileKey: options.qualificationProfileKey,
    workflowBlueprintKey: options.workflowBlueprintKey,
    evidenceProfileKey: options.evidenceProfileKey,
    defaultRoutingProfileKey: options.defaultRoutingProfileKey,
    publicationMode: options.publicationMode,
    hostedFormConfig: options.hostedFormConfig,
    captureSource,
    status: 'DRAFT',
    createdAt: options.createdAt,
    activatedAt: null,
    archivedAt: null,
  };
}

// ── Computed helpers ──────────────────────────────────────────────────────────

/** The full public URL for a HOSTED_FORM publication. Throws if not a hosted form. */
export function resolveHostedFormUrl(publication: LeadPublication): string {
  if (publication.publicationMode !== 'HOSTED_FORM' || publication.hostedFormConfig === null) {
    throw new PublicationError(
      'NOT_HOSTED_FORM',
      `publication ${publication.publicationId} is not a HOSTED_FORM publication`,
    );
  }
  const { brandDomain, publicationSlug } = publication.hostedFormConfig;
  return `https://${brandDomain}${publicationSlug}`;
}

/** Whether a Publication has a live Capture Source ready to receive submissions. */
export function isPublicationLive(publication: LeadPublication): boolean {
  return publication.status === 'ACTIVE';
}
