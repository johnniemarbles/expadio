import { createVerticalWorkflowRoute } from '../../../../../lib/vertical-workflow-route';
import { ACCESS_WORKFLOW } from '../../../../../lib/verticals';

/**
 * Bind an access request to the Decision Fabric — the same generic runtime that
 * governs cases, vendors and expenses, on a fourth subject type. Orchestration
 * and the request's binding are shared.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET, POST, PATCH } = createVerticalWorkflowRoute(ACCESS_WORKFLOW);
