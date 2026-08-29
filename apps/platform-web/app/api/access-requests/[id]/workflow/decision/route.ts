import { createVerticalDecisionRoute } from '../../../../../../lib/vertical-workflow-route';
import { ACCESS_WORKFLOW } from '../../../../../../lib/verticals';

/**
 * Record an immutable decision against an access request's current stage — what
 * lets SECURITY_REVIEW advance to GRANTED. access.request registers no authority
 * deriver, so role + separation of duties gate it (the reviewer must differ from
 * the requester). Shared capture; only the request's binding differs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { POST } = createVerticalDecisionRoute(ACCESS_WORKFLOW);
