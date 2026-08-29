import { createVerticalParticipantsRoute } from '../../../../../../lib/vertical-workflow-route';
import { EXPENSE_WORKFLOW } from '../../../../../../lib/verticals';

/**
 * Assign a participant to an expense stage's semantic slot (e.g. "manager" on
 * MANAGER_REVIEW). Entering a stage is gated until its required slots are filled.
 * Shared assignment; only the expense's binding differs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { POST } = createVerticalParticipantsRoute(EXPENSE_WORKFLOW);
