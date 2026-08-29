import { createVerticalHistoryRoute } from '../../../../../../lib/vertical-workflow-route';
import { ACCESS_WORKFLOW } from '../../../../../../lib/verticals';

/**
 * The governed trace for an access request's workflow — its append-only
 * transitions and immutable decisions in one timeline. Shared read; only the
 * request's binding differs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET } = createVerticalHistoryRoute(ACCESS_WORKFLOW);
