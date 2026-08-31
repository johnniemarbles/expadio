import { createVerticalParticipantsRoute } from '../../../../../../../lib/vertical-workflow-route';
import { GTM_ICP_WORKFLOW } from '../../../../../../../lib/verticals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { POST } = createVerticalParticipantsRoute(GTM_ICP_WORKFLOW);
