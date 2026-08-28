/**
 * @expadio/case — service cases on top of @expadio/party.
 *
 * A Case is a governed unit of work (support ticket, onboarding, claim, review)
 * attached to an account and/or contact. Pure domain: types + validation + the
 * status-transition rule.
 *
 * Decision Fabric seam: a case records the `blueprintKey` that is meant to
 * govern its lifecycle and reserves `workflowInstanceId`. The platform's
 * workflow instance/transition tables are append-only and trigger-governed and
 * are not yet exposed through app routes, so cases run their own honest status
 * lifecycle for now; when the Decision Fabric runtime is wired to routes, a
 * case binds to a real workflow instance without changing this contract.
 */

export const CASE_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const CASE_STATUSES = ['OPEN', 'PENDING', 'RESOLVED', 'CLOSED'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CLOSED_CASE_STATUSES: readonly CaseStatus[] = ['RESOLVED', 'CLOSED'];

export function isClosedCase(status: CaseStatus): boolean {
  return CLOSED_CASE_STATUSES.includes(status);
}

export interface CrmCase {
  readonly caseId: string;
  readonly tenantId: string;
  readonly accountId: string | null;
  readonly contactId: string | null;
  readonly subject: string;
  readonly description: string | null;
  readonly priority: CasePriority;
  readonly status: CaseStatus;
  readonly blueprintKey: string | null;
  readonly workflowInstanceId: string | null;
  readonly stageKey: string | null;
  readonly ownerSubjectId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ValidatedCaseInput {
  readonly subject: string;
  readonly description: string | null;
  readonly priority: CasePriority;
  readonly status: CaseStatus;
  readonly blueprintKey: string | null;
  readonly accountId: string | null;
  readonly contactId: string | null;
}

export class CaseValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = 'CaseValidationError';
    this.field = field;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function optionalStr(value: unknown): string | null {
  const s = str(value);
  return s === '' ? null : s;
}
function optionalUuid(value: unknown, field: string): string | null {
  const s = optionalStr(value);
  if (s !== null && !UUID.test(s)) throw new CaseValidationError(field, `${field} must be a valid identifier.`);
  return s;
}

export function validateCaseInput(body: unknown): ValidatedCaseInput {
  const record = (body ?? {}) as Record<string, unknown>;

  const subject = str(record.subject);
  if (subject === '' || subject.length > 200) {
    throw new CaseValidationError('subject', 'A case subject of 1–200 characters is required.');
  }

  const priorityRaw = str(record.priority).toUpperCase() || 'NORMAL';
  if (!CASE_PRIORITIES.includes(priorityRaw as CasePriority)) {
    throw new CaseValidationError('priority', `Unknown priority. Expected one of: ${CASE_PRIORITIES.join(', ')}.`);
  }

  const statusRaw = str(record.status).toUpperCase() || 'OPEN';
  if (!CASE_STATUSES.includes(statusRaw as CaseStatus)) {
    throw new CaseValidationError('status', `Unknown status. Expected one of: ${CASE_STATUSES.join(', ')}.`);
  }

  const blueprintKey = optionalStr(record.blueprintKey);
  if (blueprintKey !== null && !/^[A-Za-z0-9._-]{1,128}$/.test(blueprintKey)) {
    throw new CaseValidationError('blueprintKey', 'blueprintKey must be 1–128 chars of letters, digits, dot, underscore or hyphen.');
  }

  return {
    subject,
    description: optionalStr(record.description),
    priority: priorityRaw as CasePriority,
    status: statusRaw as CaseStatus,
    blueprintKey,
    accountId: optionalUuid(record.accountId, 'accountId'),
    contactId: optionalUuid(record.contactId, 'contactId'),
  };
}

export function validateCaseStatus(value: unknown): CaseStatus {
  const raw = str(value).toUpperCase();
  if (!CASE_STATUSES.includes(raw as CaseStatus)) {
    throw new CaseValidationError('status', `Unknown status. Expected one of: ${CASE_STATUSES.join(', ')}.`);
  }
  return raw as CaseStatus;
}

export function validateCasePriority(value: unknown): CasePriority {
  const raw = str(value).toUpperCase();
  if (!CASE_PRIORITIES.includes(raw as CasePriority)) {
    throw new CaseValidationError('priority', `Unknown priority. Expected one of: ${CASE_PRIORITIES.join(', ')}.`);
  }
  return raw as CasePriority;
}
