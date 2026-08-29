import { createVerticalParticipantsRoute } from '../../../../../../lib/vertical-workflow-route';
import { ACCESS_WORKFLOW } from '../../../../../../lib/verticals';

/**
 * Assign a participant to an access-request stage's semantic slot (e.g.
 * "security_reviewer" on SECURITY_REVIEW). Entering a stage is gated until its
 * required slots are filled. Shared assignment; only the request's binding differs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { POST } = createVerticalParticipantsRoute(ACCESS_WORKFLOW);
