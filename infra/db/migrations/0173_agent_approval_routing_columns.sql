-- 0173_agent_approval_routing_columns.sql
-- Records which entity node's governance authority a staged approval was
-- routed to, and under which publishing policy, so the connecting piece
-- between a committee's output and the Decision Fabric (staging it as a
-- real approval) has somewhere to record routeApprovalTarget()'s decision.
--
-- Deferred in migration 0172's PR until there was a real caller to populate
-- these columns -- adding them earlier, unused, would have been exactly the
-- speculative-field problem flagged when this feature was first scoped.
-- packages/postgres-runtime/src/committee-approval-staging.ts is that caller.

BEGIN;

ALTER TABLE platform.agent_approval_requests
  ADD COLUMN IF NOT EXISTS target_approver_node_id uuid REFERENCES platform.entity_nodes(node_id),
  ADD COLUMN IF NOT EXISTS policy_applied platform.content_publishing_policy;

COMMIT;
