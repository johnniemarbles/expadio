import { createVerticalWorkflowRoute } from '../../../../../lib/vertical-workflow-route';
import { SOCIAL_CONTENT_WORKFLOW } from '../../../../../lib/verticals';

/**
 * Bind a social content item to the Decision Fabric — same generic runtime as
 * cases, vendors, expenses, and access requests. Orchestration is shared;
 * only the subject binding differs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET, POST, PATCH } = createVerticalWorkflowRoute(SOCIAL_CONTENT_WORKFLOW);
