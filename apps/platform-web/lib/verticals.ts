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

export const GTM_ICP_WORKFLOW: VerticalWorkflowConfig = {
  table: 'platform.gtm_icps',
  idColumn: 'icp_id',
  subjectType: 'gtm.icp.publish',
  subjectNoun: 'ICP',
  blueprintLabel: 'gtm.icp.publish',
  statusForStage: (stageKey) => (stageKey === 'PUBLISHED' ? 'published' : 'proposal'),
};

export const GTM_SEQUENCE_WORKFLOW: VerticalWorkflowConfig = {
  table: 'platform.gtm_sequences',
  idColumn: 'sequence_id',
  subjectType: 'gtm.sequence.publish',
  subjectNoun: 'sequence',
  blueprintLabel: 'gtm.sequence.publish',
  statusForStage: (stageKey) => (stageKey === 'APPROVED' ? 'approved' : 'draft'),
};

export const GTM_CAMPAIGN_WORKFLOW: VerticalWorkflowConfig = {
  table: 'platform.gtm_campaigns',
  idColumn: 'campaign_id',
  subjectType: 'gtm.campaign.launch',
  subjectNoun: 'campaign',
  blueprintLabel: 'gtm.campaign.launch',
  statusForStage: (stageKey) => (stageKey === 'RUNNING' ? 'running' : 'draft'),
};

export const GTM_MEETING_WORKFLOW: VerticalWorkflowConfig = {
  table: 'platform.gtm_meeting_requests',
  idColumn: 'meeting_request_id',
  subjectType: 'gtm.meeting_request',
  subjectNoun: 'meeting request',
  blueprintLabel: 'gtm.meeting_request',
  statusForStage: (stageKey) => (stageKey === 'ACCEPTED' ? 'accepted' : 'requested'),
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
  'gtm.icp.publish': { table: GTM_ICP_WORKFLOW.table, idColumn: GTM_ICP_WORKFLOW.idColumn },
  'gtm.sequence.publish': { table: GTM_SEQUENCE_WORKFLOW.table, idColumn: GTM_SEQUENCE_WORKFLOW.idColumn },
  'gtm.campaign.launch': { table: GTM_CAMPAIGN_WORKFLOW.table, idColumn: GTM_CAMPAIGN_WORKFLOW.idColumn },
  'gtm.meeting_request': { table: GTM_MEETING_WORKFLOW.table, idColumn: GTM_MEETING_WORKFLOW.idColumn },
};
