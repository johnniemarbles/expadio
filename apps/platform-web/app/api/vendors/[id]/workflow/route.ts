import { createVerticalWorkflowRoute } from '../../../../../lib/vertical-workflow-route';
import { VENDOR_WORKFLOW } from '../../../../../lib/verticals';

/**
 * Bind a vendor to the Decision Fabric — the same generic runtime that governs
 * CRM cases, on a non-CRM subject. Orchestration and the vendor's binding are
 * shared; this route is the binding applied to the workflow factory.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET, POST, PATCH } = createVerticalWorkflowRoute(VENDOR_WORKFLOW);
