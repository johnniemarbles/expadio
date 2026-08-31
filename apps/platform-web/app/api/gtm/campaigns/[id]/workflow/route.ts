import { createVerticalWorkflowRoute } from '../../../../../../lib/vertical-workflow-route';
import { GTM_CAMPAIGN_WORKFLOW } from '../../../../../../lib/verticals';

/** Bind a campaign to the Decision Fabric. Launch requires LAUNCH_REVIEW. Send stays on Communication. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET, POST, PATCH } = createVerticalWorkflowRoute(GTM_CAMPAIGN_WORKFLOW);
