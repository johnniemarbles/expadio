import { createVerticalHistoryRoute } from '../../../../../../lib/vertical-workflow-route';
import { VENDOR_WORKFLOW } from '../../../../../../lib/verticals';

/**
 * The governed trace for a vendor's workflow — its append-only transitions and
 * immutable decisions in one timeline. Shared read; only the vendor's binding differs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET } = createVerticalHistoryRoute(VENDOR_WORKFLOW);
