import { createVerticalWorkflowRoute } from '../../../../../../lib/vertical-workflow-route';
import { GTM_MEETING_WORKFLOW } from '../../../../../../lib/verticals';

/** Bind a warm-reply meeting request to the Decision Fabric. Owner reviews before accept. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET, POST, PATCH } = createVerticalWorkflowRoute(GTM_MEETING_WORKFLOW);
