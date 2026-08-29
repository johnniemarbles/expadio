import { createVerticalParticipantsRoute } from '../../../../../../lib/vertical-workflow-route';
import { VENDOR_WORKFLOW } from '../../../../../../lib/verticals';

/**
 * Assign a participant to a vendor stage's semantic slot (e.g. "screener" on
 * SCREENING). Entering a stage is gated until its required slots are filled.
 * Shared assignment; only the vendor's binding differs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { POST } = createVerticalParticipantsRoute(VENDOR_WORKFLOW);
