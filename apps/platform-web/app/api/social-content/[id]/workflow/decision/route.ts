import { createVerticalDecisionRoute } from '../../../../../../lib/vertical-workflow-route';
import { SOCIAL_CONTENT_WORKFLOW } from '../../../../../../lib/verticals';

/**
 * Record an immutable decision on BRAND_REVIEW — what lets the instance advance
 * to APPROVED. social.content_publish registers no authority deriver, so role +
 * separation of duties gate it (approver must differ from the content author).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { POST } = createVerticalDecisionRoute(SOCIAL_CONTENT_WORKFLOW);
