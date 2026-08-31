import { createVerticalHistoryRoute } from '../../../../../../../lib/vertical-workflow-route';
import { GTM_CAMPAIGN_WORKFLOW } from '../../../../../../../lib/verticals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET } = createVerticalHistoryRoute(GTM_CAMPAIGN_WORKFLOW);
