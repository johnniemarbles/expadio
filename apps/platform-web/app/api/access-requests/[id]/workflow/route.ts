import { createVerticalWorkflowRoute } from '../../../../../lib/vertical-workflow-route';

/**
 * Bind an access request to the Decision Fabric — the same generic runtime that
 * governs cases, vendors and expenses, on a fourth subject type. Its status
 * flips to GRANTED once it reaches the final stage. Orchestration is shared
 * (createVerticalWorkflowRoute); only the request's binding differs.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET, POST, PATCH } = createVerticalWorkflowRoute({
  table: 'platform.access_requests',
  idColumn: 'access_request_id',
  subjectType: 'access.request',
  subjectNoun: 'access request',
  blueprintLabel: 'access.request',
  statusForStage: (stageKey) => (stageKey === 'GRANTED' ? 'GRANTED' : 'SUBMITTED'),
});
