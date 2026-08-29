import { createVerticalWorkflowRoute } from '../../../../../lib/vertical-workflow-route';

/**
 * Bind an expense report to the Decision Fabric — the same generic runtime, on a
 * monetary subject whose approval authority is derived from its own amount. Its
 * status flips to PAID once it reaches the final stage. Orchestration is shared
 * (createVerticalWorkflowRoute); only the expense's binding differs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET, POST, PATCH } = createVerticalWorkflowRoute({
  table: 'platform.expense_reports',
  idColumn: 'expense_id',
  subjectType: 'expense.reimbursement',
  subjectNoun: 'expense',
  blueprintLabel: 'expense.reimbursement',
  statusForStage: (stageKey) => (stageKey === 'PAID' ? 'PAID' : 'SUBMITTED'),
});
