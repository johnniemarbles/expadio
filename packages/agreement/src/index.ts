/**
 * @expadio/agreement — the money layer of the universal business engine.
 *
 * An Agreement is a commitment with a customer Account: a contract,
 * subscription, or order. It closes the funnel that @expadio/lead opens — a won
 * lead becomes a customer, and a customer signs an agreement. Pure domain:
 * types + validation + the status-transition rule. Industry Packs relabel the
 * statuses ("Contract", "Policy", "Order"); the engine stays neutral.
 */

export const AGREEMENT_STATUSES = ['DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

/** Terminal statuses: the agreement is done, whether it ran its course or not. */
export const CLOSED_STATUSES: readonly AgreementStatus[] = ['EXPIRED', 'CANCELLED'];

export function isClosedStatus(status: AgreementStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

export interface CrmAgreement {
  readonly agreementId: string;
  readonly tenantId: string;
  readonly accountId: string;
  readonly sourceLeadId: string | null;
  readonly title: string;
  readonly status: AgreementStatus;
  readonly valueMinorUnits: number | null;
  readonly currency: string;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly ownerSubjectId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ValidatedAgreementInput {
  readonly accountId: string;
  readonly sourceLeadId: string | null;
  readonly title: string;
  readonly status: AgreementStatus;
  readonly valueMinorUnits: number | null;
  readonly currency: string;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
}

export class AgreementValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'AgreementValidationError';
    this.field = field;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function optionalStr(value: unknown): string | null {
  const s = str(value);
  return s === '' ? null : s;
}
function requiredUuid(value: unknown, field: string): string {
  const s = optionalStr(value);
  if (s === null || !UUID.test(s)) throw new AgreementValidationError(field, `A valid ${field} is required.`);
  return s;
}
function optionalUuid(value: unknown, field: string): string | null {
  const s = optionalStr(value);
  if (s !== null && !UUID.test(s)) throw new AgreementValidationError(field, `${field} must be a valid identifier.`);
  return s;
}
function optionalDate(value: unknown, field: string): string | null {
  const s = optionalStr(value);
  if (s === null) return null;
  // Accept a full ISO timestamp too, but store the calendar date.
  const day = s.length >= 10 ? s.slice(0, 10) : s;
  if (!ISO_DATE.test(day) || Number.isNaN(Date.parse(day))) {
    throw new AgreementValidationError(field, `${field} must be a date such as 2026-01-31, or blank.`);
  }
  return day;
}

export function validateAgreementInput(body: unknown): ValidatedAgreementInput {
  const record = (body ?? {}) as Record<string, unknown>;

  const accountId = requiredUuid(record.accountId, 'accountId');
  const sourceLeadId = optionalUuid(record.sourceLeadId, 'sourceLeadId');

  const title = str(record.title);
  if (title === '' || title.length > 200) {
    throw new AgreementValidationError('title', 'An agreement title of 1–200 characters is required.');
  }

  const statusRaw = str(record.status).toUpperCase() || 'DRAFT';
  if (!AGREEMENT_STATUSES.includes(statusRaw as AgreementStatus)) {
    throw new AgreementValidationError('status', `Unknown status. Expected one of: ${AGREEMENT_STATUSES.join(', ')}.`);
  }

  let valueMinorUnits: number | null = null;
  if (record.valueMinorUnits !== undefined && record.valueMinorUnits !== null && record.valueMinorUnits !== '') {
    const n = typeof record.valueMinorUnits === 'number' ? record.valueMinorUnits : Number(record.valueMinorUnits);
    if (!Number.isInteger(n) || n < 0) {
      throw new AgreementValidationError('valueMinorUnits', 'Value must be a whole number of minor units (e.g. cents), or blank.');
    }
    valueMinorUnits = n;
  }

  const currency = str(record.currency).toUpperCase() || 'USD';
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AgreementValidationError('currency', 'Currency must be a 3-letter ISO code such as USD.');
  }

  const startsOn = optionalDate(record.startsOn, 'startsOn');
  const endsOn = optionalDate(record.endsOn, 'endsOn');
  if (startsOn !== null && endsOn !== null && endsOn < startsOn) {
    throw new AgreementValidationError('endsOn', 'The end date cannot be before the start date.');
  }

  return { accountId, sourceLeadId, title, status: statusRaw as AgreementStatus, valueMinorUnits, currency, startsOn, endsOn };
}

export function validateAgreementStatus(value: unknown): AgreementStatus {
  const statusRaw = str(value).toUpperCase();
  if (!AGREEMENT_STATUSES.includes(statusRaw as AgreementStatus)) {
    throw new AgreementValidationError('status', `Unknown status. Expected one of: ${AGREEMENT_STATUSES.join(', ')}.`);
  }
  return statusRaw as AgreementStatus;
}
