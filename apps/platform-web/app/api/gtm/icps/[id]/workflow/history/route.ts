import { createVerticalHistoryRoute } from '../../../../../../../lib/vertical-workflow-route';
import { GTM_ICP_WORKFLOW } from '../../../../../../../lib/verticals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET } = createVerticalHistoryRoute(GTM_ICP_WORKFLOW);
