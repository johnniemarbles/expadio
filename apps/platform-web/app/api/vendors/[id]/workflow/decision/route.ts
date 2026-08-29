import { createVerticalDecisionRoute } from '../../../../../../lib/vertical-workflow-route';
import { VENDOR_WORKFLOW } from '../../../../../../lib/verticals';

/**
 * Record an immutable decision against a vendor's current workflow stage — what
 * lets the decision-required APPROVAL stage advance to ACTIVE. vendor.onboarding
 * registers no authority deriver, so role + separation of duties gate it.
 * Shared capture; only the vendor's binding differs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { POST } = createVerticalDecisionRoute(VENDOR_WORKFLOW);
