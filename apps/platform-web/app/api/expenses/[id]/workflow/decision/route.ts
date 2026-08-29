import { createVerticalDecisionRoute } from '../../../../../../lib/vertical-workflow-route';
import { EXPENSE_WORKFLOW } from '../../../../../../lib/verticals';

/**
 * Record an immutable decision against an expense's current workflow stage. The
 * expense's approval authority is derived from its own amount, enforced inside
 * recordCaseDecision. Shared capture; only the expense's binding differs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { POST } = createVerticalDecisionRoute(EXPENSE_WORKFLOW);
