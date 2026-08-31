import { createVerticalWorkflowRoute } from '../../../../../../lib/vertical-workflow-route';
import { GTM_SEQUENCE_WORKFLOW } from '../../../../../../lib/verticals';

/** Bind a sequence draft to the Decision Fabric. Copy cannot ship without COPY_REVIEW. */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const { GET, POST, PATCH } = createVerticalWorkflowRoute(GTM_SEQUENCE_WORKFLOW);
