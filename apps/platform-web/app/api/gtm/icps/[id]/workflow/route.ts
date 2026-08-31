import { createVerticalWorkflowRoute } from '../../../../../../lib/vertical-workflow-route';
import { GTM_ICP_WORKFLOW } from '../../../../../../lib/verticals';

/** Bind an ICP proposal to the Decision Fabric. Publish requires GOVERNANCE_REVIEW. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET, POST, PATCH } = createVerticalWorkflowRoute(GTM_ICP_WORKFLOW);
