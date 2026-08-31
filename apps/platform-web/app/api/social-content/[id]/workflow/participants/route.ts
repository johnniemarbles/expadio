import { createVerticalParticipantsRoute } from '../../../../../../lib/vertical-workflow-route';
import { SOCIAL_CONTENT_WORKFLOW } from '../../../../../../lib/verticals';

/**
 * Assign a participant to a stage slot (e.g. brand_approver on BRAND_REVIEW).
 * Entering/leaving gated stages requires required slots filled.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { POST } = createVerticalParticipantsRoute(SOCIAL_CONTENT_WORKFLOW);
