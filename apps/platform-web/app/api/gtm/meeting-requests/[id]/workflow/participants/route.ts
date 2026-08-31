import { createVerticalParticipantsRoute } from '../../../../../../../lib/vertical-workflow-route';
import { GTM_MEETING_WORKFLOW } from '../../../../../../../lib/verticals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { POST } = createVerticalParticipantsRoute(GTM_MEETING_WORKFLOW);
