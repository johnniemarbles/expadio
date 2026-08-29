import type { VerticalWorkflowConfig } from './vertical-workflow-route';

/**
 * Per-vertical Decision Fabric bindings, defined once and shared by all four of a
 * vertical's governed routes (workflow, decision, history, participants). A new
 * vertical is one entry here plus four thin route files.
 */

export const VENDOR_WORKFLOW: VerticalWorkflowConfig = {
  table: 'platform.vendors',
  idColumn: 'vendor_id',
  subjectType: 'vendor',
  subjectNoun: 'vendor',
  blueprintLabel: 'vendor.onboarding',
  statusForStage: (stageKey) => (stageKey === 'ACTIVE' ? 'ACTIVE' : 'PENDING'),
};

export const EXPENSE_WORKFLOW: VerticalWorkflowConfig = {
  table: 'platform.expense_reports',
  idColumn: 'expense_id',
  subjectType: 'expense.reimbursement',
  subjectNoun: 'expense',
  blueprintLabel: 'expense.reimbursement',
  statusForStage: (stageKey) => (stageKey === 'PAID' ? 'PAID' : 'SUBMITTED'),
};

export const ACCESS_WORKFLOW: VerticalWorkflowConfig = {
  table: 'platform.access_requests',
  idColumn: 'access_request_id',
  subjectType: 'access.request',
  subjectNoun: 'access request',
  blueprintLabel: 'access.request',
  statusForStage: (stageKey) => (stageKey === 'GRANTED' ? 'GRANTED' : 'SUBMITTED'),
};

/**
 * Every governed subject's table + id column, keyed by work type — the generic
 * subject→instance resolution the cross-vertical action endpoint needs. Includes
 * crm.case (whose routes predate the factory) so every review-queue item, of any
 * vertical, is resolvable to its workflow instance.
 */
export const SUBJECT_TABLES: Record<string, { readonly table: string; readonly idColumn: string }> = {
  'crm.case': { table: 'platform.crm_cases', idColumn: 'case_id' },
  'vendor.onboarding': { table: VENDOR_WORKFLOW.table, idColumn: VENDOR_WORKFLOW.idColumn },
  'expense.reimbursement': { table: EXPENSE_WORKFLOW.table, idColumn: EXPENSE_WORKFLOW.idColumn },
  'access.request': { table: ACCESS_WORKFLOW.table, idColumn: ACCESS_WORKFLOW.idColumn },
};
