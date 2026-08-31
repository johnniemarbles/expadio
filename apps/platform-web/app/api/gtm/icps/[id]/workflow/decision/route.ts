import { createVerticalDecisionRoute } from '../../../../../../../lib/vertical-workflow-route';
import { GTM_ICP_WORKFLOW } from '../../../../../../../lib/verticals';

/** Record APPROVE/REJECT on an ICP. Author cannot be the reviewer (SoD). */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { POST } = createVerticalDecisionRoute(GTM_ICP_WORKFLOW);
