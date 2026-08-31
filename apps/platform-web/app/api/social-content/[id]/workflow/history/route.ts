import { createVerticalHistoryRoute } from '../../../../../../lib/vertical-workflow-route';
import { SOCIAL_CONTENT_WORKFLOW } from '../../../../../../lib/verticals';

/** Governed trace: append-only transitions + immutable decisions. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET } = createVerticalHistoryRoute(SOCIAL_CONTENT_WORKFLOW);
