import { createVerticalWorkflowRoute } from '../../../../../lib/vertical-workflow-route';
import { EXPENSE_WORKFLOW } from '../../../../../lib/verticals';

/**
 * Bind an expense report to the Decision Fabric — the same generic runtime, on a
 * monetary subject whose approval authority is derived from its own amount.
 * Orchestration and the expense's binding are shared.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET, POST, PATCH } = createVerticalWorkflowRoute(EXPENSE_WORKFLOW);
