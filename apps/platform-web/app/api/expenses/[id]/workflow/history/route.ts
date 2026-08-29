import { createVerticalHistoryRoute } from '../../../../../../lib/vertical-workflow-route';
import { EXPENSE_WORKFLOW } from '../../../../../../lib/verticals';

/**
 * The governed trace for an expense's workflow — its append-only transitions and
 * immutable decisions in one timeline. Shared read; only the expense's binding differs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET } = createVerticalHistoryRoute(EXPENSE_WORKFLOW);
