import { createVerticalWorkflowRoute } from '../../../../../lib/vertical-workflow-route';

/**
 * Bind a vendor to the Decision Fabric — the same generic runtime that governs
 * CRM cases, on a non-CRM subject. Its status flips to ACTIVE once onboarding
 * reaches the final stage. Orchestration is shared (createVerticalWorkflowRoute);
 * only the vendor's binding differs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET, POST, PATCH } = createVerticalWorkflowRoute({
  table: 'platform.vendors',
  idColumn: 'vendor_id',
  subjectType: 'vendor',
  subjectNoun: 'vendor',
  blueprintLabel: 'vendor.onboarding',
  statusForStage: (stageKey) => (stageKey === 'ACTIVE' ? 'ACTIVE' : 'PENDING'),
});
