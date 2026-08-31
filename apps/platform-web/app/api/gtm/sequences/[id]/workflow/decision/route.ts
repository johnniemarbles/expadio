import { createVerticalDecisionRoute } from '../../../../../../../lib/vertical-workflow-route';
import { GTM_SEQUENCE_WORKFLOW } from '../../../../../../../lib/verticals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { POST } = createVerticalDecisionRoute(GTM_SEQUENCE_WORKFLOW);
