BEGIN;

-- Gate 5 — hierarchy-safe lead analytics.
--
-- Views aggregate through organization_closure so a parent org can roll up
-- metrics across its entire descendant subtree without per-row org-id filters
-- that would miss child orgs. RLS is enforced on the base tables; the views
-- are SECURITY INVOKER so the caller's session grants apply.
--
-- All views are named with a _rollup suffix and carry tenant_id + org_id so
-- callers can filter to the subtree they are authorized to see.

CREATE VIEW platform.lead_capture_funnel_rollup
  WITH (security_invoker = true) AS
SELECT
  oc.ancestor_organization_id AS organization_id,
  lcl.tenant_id,
  count(*)                                                               AS total_leads,
  count(*) FILTER (WHERE lcl.verification_state = 'VERIFIED')           AS verified_leads,
  count(*) FILTER (WHERE lcl.verification_state = 'UNVERIFIED')         AS unverified_leads,
  count(*) FILTER (WHERE lcl.verification_state = 'NOT_REQUIRED')       AS auto_verified_leads,
  count(DISTINCT lcl.contact_id) FILTER (WHERE lcl.contact_id IS NOT NULL) AS unique_contacts
FROM platform.lead_capture_leads lcl
JOIN platform.organization_closure oc
  ON oc.descendant_organization_id = lcl.organization_id
 AND oc.tenant_id     = lcl.tenant_id
GROUP BY oc.ancestor_organization_id, lcl.tenant_id;

CREATE VIEW platform.lead_task_queue_rollup
  WITH (security_invoker = true) AS
SELECT
  oc.ancestor_organization_id AS organization_id,
  lt.tenant_id,
  lt.priority,
  lt.status,
  count(*)                                                               AS task_count,
  count(*) FILTER (WHERE lt.due_at < now() AND lt.status = 'OPEN')     AS overdue_count,
  count(*) FILTER (WHERE lt.escalated_at IS NOT NULL AND lt.status = 'OPEN') AS escalated_count
FROM platform.lead_tasks lt
JOIN platform.organization_closure oc
  ON oc.descendant_organization_id = lt.organization_id
 AND oc.tenant_id     = lt.tenant_id
GROUP BY oc.ancestor_organization_id, lt.tenant_id, lt.priority, lt.status;

CREATE VIEW platform.lead_activity_volume_rollup
  WITH (security_invoker = true) AS
SELECT
  oc.ancestor_organization_id AS organization_id,
  la.tenant_id,
  la.activity_type,
  date_trunc('day', la.occurred_at) AS day,
  count(*) AS event_count
FROM platform.lead_activities la
JOIN platform.organization_closure oc
  ON oc.descendant_organization_id = la.organization_id
 AND oc.tenant_id     = la.tenant_id
GROUP BY oc.ancestor_organization_id, la.tenant_id, la.activity_type, date_trunc('day', la.occurred_at);

-- Attribution source breakdown — how leads entered by channel.
CREATE VIEW platform.lead_attribution_source_rollup
  WITH (security_invoker = true) AS
SELECT
  oc.ancestor_organization_id AS organization_id,
  lcl.tenant_id,
  lcs.channel,
  lcs.surface,
  count(lcl.capture_lead_id) AS lead_count,
  count(lcl.capture_lead_id) FILTER (WHERE lcl.verification_state = 'VERIFIED') AS verified_count
FROM platform.lead_capture_leads lcl
JOIN platform.lead_capture_sources lcs
  ON lcs.source_id   = lcl.source_id
 AND lcs.tenant_id   = lcl.tenant_id
JOIN platform.organization_closure oc
  ON oc.descendant_organization_id = lcl.organization_id
 AND oc.tenant_id     = lcl.tenant_id
GROUP BY oc.ancestor_organization_id, lcl.tenant_id, lcs.channel, lcs.surface;

COMMIT;
