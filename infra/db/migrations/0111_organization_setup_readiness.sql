BEGIN;

-- Enterprise Organization Setup & Readiness.
-- Setup is deliberately separate from normal ACTIVE organization membership:
-- provisioning/configuration access must not grant full business-runtime access.

ALTER TABLE platform.enterprise_change_requests
  ADD CONSTRAINT enterprise_change_requests_id_tenant_uq
  UNIQUE (enterprise_change_request_id, tenant_id);

CREATE TABLE platform.organization_setup_plans (
  setup_plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  enterprise_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  provisioning_change_request_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  state text NOT NULL DEFAULT 'PROVISIONING' CHECK (state IN (
    'PROVISIONING','CONFIGURING','READY_FOR_ACTIVATION','ACTIVATED','CANCELLED'
  )),
  total_requirements integer NOT NULL DEFAULT 0 CHECK (total_requirements >= 0),
  completed_requirements integer NOT NULL DEFAULT 0 CHECK (completed_requirements >= 0),
  blocking_open_requirements integer NOT NULL DEFAULT 0 CHECK (blocking_open_requirements >= 0),
  completion_percent numeric(5,2) NOT NULL DEFAULT 0
    CHECK (completion_percent >= 0 AND completion_percent <= 100),
  started_by_subject_id text NOT NULL CHECK (btrim(started_by_subject_id) <> ''),
  started_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  activated_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (setup_plan_id, tenant_id),
  UNIQUE (setup_plan_id, tenant_id, enterprise_id),
  UNIQUE (tenant_id, organization_id),
  FOREIGN KEY (organization_id, tenant_id, enterprise_id)
    REFERENCES platform.organizations(organization_id, tenant_id, enterprise_id)
    ON DELETE CASCADE,
  FOREIGN KEY (provisioning_change_request_id, tenant_id)
    REFERENCES platform.enterprise_change_requests(enterprise_change_request_id, tenant_id)
    ON DELETE RESTRICT,
  CHECK (completed_requirements <= total_requirements),
  CHECK (
    (state = 'READY_FOR_ACTIVATION' AND ready_at IS NOT NULL)
    OR state <> 'READY_FOR_ACTIVATION'
  ),
  CHECK (
    (state = 'ACTIVATED' AND activated_at IS NOT NULL)
    OR state <> 'ACTIVATED'
  ),
  CHECK (
    (state = 'CANCELLED' AND cancelled_at IS NOT NULL)
    OR state <> 'CANCELLED'
  )
);

CREATE INDEX organization_setup_plans_enterprise_idx
  ON platform.organization_setup_plans (tenant_id, enterprise_id, state, updated_at DESC);

CREATE TABLE platform.organization_setup_requirements (
  setup_requirement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  setup_plan_id uuid NOT NULL,
  requirement_key text NOT NULL CHECK (btrim(requirement_key) <> ''),
  category text NOT NULL CHECK (category IN (
    'ORGANIZATION','LEGAL','GOVERNANCE','ACCESS','FINANCE','COMPLIANCE',
    'MODULE','VERTICAL','OPERATIONS','DATA','COMMUNICATION','CUSTOM'
  )),
  source_kind text NOT NULL CHECK (source_kind IN (
    'CORE','MODULE','VERTICAL','TENANT','PARENT_POLICY','CUSTOM'
  )),
  source_key text,
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text NOT NULL DEFAULT '',
  blocking boolean NOT NULL DEFAULT true,
  satisfaction_mode text NOT NULL DEFAULT 'MANUAL' CHECK (satisfaction_mode IN (
    'MANUAL','EVIDENCE','AUTOMATED','APPROVAL'
  )),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','IN_PROGRESS','SATISFIED','WAIVED','BLOCKED'
  )),
  owner_subject_id text,
  due_at timestamptz,
  satisfied_by_subject_id text,
  satisfied_at timestamptz,
  waived_by_subject_id text,
  waived_at timestamptz,
  waiver_reason text,
  evidence_refs text[] NOT NULL DEFAULT ARRAY[]::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  sort_order integer NOT NULL DEFAULT 0,
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (setup_requirement_id, tenant_id),
  UNIQUE (setup_requirement_id, tenant_id, setup_plan_id),
  UNIQUE (tenant_id, setup_plan_id, requirement_key),
  FOREIGN KEY (setup_plan_id, tenant_id)
    REFERENCES platform.organization_setup_plans(setup_plan_id, tenant_id)
    ON DELETE CASCADE,
  CHECK (
    (status = 'SATISFIED' AND satisfied_by_subject_id IS NOT NULL AND satisfied_at IS NOT NULL)
    OR status <> 'SATISFIED'
  ),
  CHECK (
    (
      status = 'WAIVED'
      AND waived_by_subject_id IS NOT NULL
      AND waived_at IS NOT NULL
      AND waiver_reason IS NOT NULL
      AND btrim(waiver_reason) <> ''
    )
    OR status <> 'WAIVED'
  )
);

CREATE INDEX organization_setup_requirements_plan_idx
  ON platform.organization_setup_requirements (
    tenant_id, setup_plan_id, blocking DESC, status, sort_order, requirement_key
  );

CREATE TABLE platform.organization_setup_requirement_dependencies (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  setup_plan_id uuid NOT NULL,
  setup_requirement_id uuid NOT NULL,
  depends_on_requirement_id uuid NOT NULL,
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, setup_requirement_id, depends_on_requirement_id),
  FOREIGN KEY (setup_requirement_id, tenant_id, setup_plan_id)
    REFERENCES platform.organization_setup_requirements(
      setup_requirement_id, tenant_id, setup_plan_id
    )
    ON DELETE CASCADE,
  FOREIGN KEY (depends_on_requirement_id, tenant_id, setup_plan_id)
    REFERENCES platform.organization_setup_requirements(
      setup_requirement_id, tenant_id, setup_plan_id
    )
    ON DELETE CASCADE,
  CHECK (setup_requirement_id <> depends_on_requirement_id)
);

CREATE INDEX organization_setup_requirement_dependencies_plan_idx
  ON platform.organization_setup_requirement_dependencies (
    tenant_id, setup_plan_id, setup_requirement_id
  );

CREATE OR REPLACE FUNCTION platform.organization_setup_dependency_would_cycle(
  p_tenant_id uuid,
  p_setup_plan_id uuid,
  p_requirement_id uuid,
  p_depends_on_requirement_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE dependency_chain AS (
    SELECT
      dependency.setup_requirement_id,
      dependency.depends_on_requirement_id,
      ARRAY[
        dependency.setup_requirement_id,
        dependency.depends_on_requirement_id
      ]::uuid[] AS path
    FROM platform.organization_setup_requirement_dependencies dependency
    WHERE dependency.tenant_id = p_tenant_id
      AND dependency.setup_plan_id = p_setup_plan_id
      AND dependency.setup_requirement_id = p_depends_on_requirement_id

    UNION ALL

    SELECT
      dependency.setup_requirement_id,
      dependency.depends_on_requirement_id,
      dependency_chain.path || dependency.depends_on_requirement_id
    FROM dependency_chain
    JOIN platform.organization_setup_requirement_dependencies dependency
      ON dependency.tenant_id = p_tenant_id
     AND dependency.setup_plan_id = p_setup_plan_id
     AND dependency.setup_requirement_id = dependency_chain.depends_on_requirement_id
    WHERE NOT dependency.depends_on_requirement_id = ANY(dependency_chain.path)
  )
  SELECT
    p_requirement_id = p_depends_on_requirement_id
    OR EXISTS (
      SELECT 1
      FROM dependency_chain
      WHERE depends_on_requirement_id = p_requirement_id
    );
$$;

CREATE OR REPLACE FUNCTION platform.reject_organization_setup_dependency_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF platform.organization_setup_dependency_would_cycle(
    NEW.tenant_id,
    NEW.setup_plan_id,
    NEW.setup_requirement_id,
    NEW.depends_on_requirement_id
  ) THEN
    RAISE EXCEPTION 'organization setup dependency cycle rejected'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_setup_dependencies_reject_cycles
BEFORE INSERT OR UPDATE
ON platform.organization_setup_requirement_dependencies
FOR EACH ROW EXECUTE FUNCTION platform.reject_organization_setup_dependency_cycle();

CREATE TABLE platform.organization_setup_participants (
  setup_participant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  setup_plan_id uuid NOT NULL,
  subject_id text NOT NULL CHECK (btrim(subject_id) <> ''),
  issuer text,
  role text NOT NULL CHECK (role IN ('OWNER','CONTRIBUTOR','REVIEWER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (setup_plan_id, tenant_id)
    REFERENCES platform.organization_setup_plans(setup_plan_id, tenant_id)
    ON DELETE CASCADE,
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE UNIQUE INDEX organization_setup_participants_active_uq
  ON platform.organization_setup_participants (
    tenant_id, setup_plan_id, subject_id, COALESCE(issuer, '')
  )
  WHERE status = 'ACTIVE';

CREATE INDEX organization_setup_participants_subject_idx
  ON platform.organization_setup_participants (
    subject_id, issuer, status, valid_from, valid_until
  );

CREATE TABLE platform.organization_setup_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  setup_plan_id uuid NOT NULL,
  setup_requirement_id uuid,
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  from_state text,
  to_state text,
  actor_subject_id text NOT NULL CHECK (btrim(actor_subject_id) <> ''),
  reason text,
  evidence_refs text[] NOT NULL DEFAULT ARRAY[]::text[],
  correlation_id text NOT NULL CHECK (btrim(correlation_id) <> ''),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (setup_plan_id, tenant_id)
    REFERENCES platform.organization_setup_plans(setup_plan_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (setup_requirement_id, tenant_id, setup_plan_id)
    REFERENCES platform.organization_setup_requirements(
      setup_requirement_id, tenant_id, setup_plan_id
    )
    ON DELETE RESTRICT
);

CREATE INDEX organization_setup_events_plan_idx
  ON platform.organization_setup_events (
    tenant_id, setup_plan_id, occurred_at DESC, event_id DESC
  );

CREATE OR REPLACE FUNCTION platform.reject_organization_setup_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'organization setup events are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER organization_setup_events_append_only_update
BEFORE UPDATE ON platform.organization_setup_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_organization_setup_event_mutation();

CREATE TRIGGER organization_setup_events_append_only_delete
BEFORE DELETE ON platform.organization_setup_events
FOR EACH ROW EXECUTE FUNCTION platform.reject_organization_setup_event_mutation();

CREATE OR REPLACE FUNCTION platform.refresh_organization_setup_readiness(
  p_tenant_id uuid,
  p_setup_plan_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  requirement_total integer;
  requirement_completed integer;
  blocking_open integer;
  percent_complete numeric(5,2);
  plan_state text;
  organization_id_value uuid;
BEGIN
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE requirement.status IN ('SATISFIED','WAIVED'))::integer,
    count(*) FILTER (
      WHERE requirement.blocking
        AND requirement.status NOT IN ('SATISFIED','WAIVED')
    )::integer
  INTO requirement_total, requirement_completed, blocking_open
  FROM platform.organization_setup_requirements requirement
  WHERE requirement.tenant_id = p_tenant_id
    AND requirement.setup_plan_id = p_setup_plan_id;

  percent_complete := CASE
    WHEN requirement_total = 0 THEN 0
    ELSE round((requirement_completed::numeric * 100) / requirement_total, 2)
  END;

  SELECT plan.state, plan.organization_id
    INTO plan_state, organization_id_value
    FROM platform.organization_setup_plans plan
   WHERE plan.tenant_id = p_tenant_id
     AND plan.setup_plan_id = p_setup_plan_id
   FOR UPDATE;

  IF plan_state IS NULL OR plan_state IN ('ACTIVATED','CANCELLED') THEN
    RETURN;
  END IF;

  UPDATE platform.organization_setup_plans plan
     SET total_requirements = requirement_total,
         completed_requirements = requirement_completed,
         blocking_open_requirements = blocking_open,
         completion_percent = percent_complete,
         state = CASE
           WHEN requirement_total > 0 AND blocking_open = 0
             THEN 'READY_FOR_ACTIVATION'
           ELSE 'CONFIGURING'
         END,
         ready_at = CASE
           WHEN requirement_total > 0 AND blocking_open = 0
             THEN COALESCE(plan.ready_at, now())
           ELSE NULL
         END,
         updated_at = now()
   WHERE plan.tenant_id = p_tenant_id
     AND plan.setup_plan_id = p_setup_plan_id;

  UPDATE platform.organizations organization
     SET status = CASE
           WHEN requirement_total > 0 AND blocking_open = 0
             THEN 'READY_FOR_ACTIVATION'
           ELSE 'CONFIGURING'
         END,
         updated_at = now()
   WHERE organization.tenant_id = p_tenant_id
     AND organization.organization_id = organization_id_value
     AND organization.status IN ('PROVISIONING','CONFIGURING','READY_FOR_ACTIVATION');
END;
$$;

CREATE OR REPLACE FUNCTION platform.enforce_organization_setup_plan_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NEW;
  END IF;

  IF OLD.state IN ('ACTIVATED','CANCELLED') THEN
    RAISE EXCEPTION 'closed organization setup plan cannot transition'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state = 'READY_FOR_ACTIVATION'
     AND (NEW.total_requirements <= 0 OR NEW.blocking_open_requirements <> 0) THEN
    RAISE EXCEPTION 'setup plan readiness requires zero blocking gaps'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state = 'ACTIVATED'
     AND (
       OLD.state <> 'READY_FOR_ACTIVATION'
       OR NEW.total_requirements <= 0
       OR NEW.blocking_open_requirements <> 0
     ) THEN
    RAISE EXCEPTION 'setup plan activation requires ready state'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_setup_plans_enforce_transition
BEFORE UPDATE OF state
ON platform.organization_setup_plans
FOR EACH ROW EXECUTE FUNCTION platform.enforce_organization_setup_plan_transition();

CREATE OR REPLACE FUNCTION platform.enforce_organization_setup_activation_gate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  setup_state text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('PROVISIONING','CONFIGURING','READY_FOR_ACTIVATION')
     AND NEW.status = 'ACTIVE' THEN
    SELECT plan.state
      INTO setup_state
      FROM platform.organization_setup_plans plan
     WHERE plan.tenant_id = NEW.tenant_id
       AND plan.organization_id = NEW.organization_id
     LIMIT 1;

    IF setup_state IS DISTINCT FROM 'ACTIVATED' THEN
      RAISE EXCEPTION 'organization activation requires activated setup plan'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD.status IN ('PROVISIONING','CONFIGURING')
     AND NEW.status = 'READY_FOR_ACTIVATION' THEN
    SELECT plan.state
      INTO setup_state
      FROM platform.organization_setup_plans plan
     WHERE plan.tenant_id = NEW.tenant_id
       AND plan.organization_id = NEW.organization_id
     LIMIT 1;

    IF setup_state IS DISTINCT FROM 'READY_FOR_ACTIVATION' THEN
      RAISE EXCEPTION 'organization readiness requires ready setup plan'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_enforce_setup_activation_gate
BEFORE UPDATE OF status
ON platform.organizations
FOR EACH ROW EXECUTE FUNCTION platform.enforce_organization_setup_activation_gate();

CREATE OR REPLACE FUNCTION platform.refresh_organization_setup_readiness_after_requirement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM platform.refresh_organization_setup_readiness(
      OLD.tenant_id, OLD.setup_plan_id
    );
    RETURN OLD;
  END IF;

  PERFORM platform.refresh_organization_setup_readiness(
    NEW.tenant_id, NEW.setup_plan_id
  );
  IF TG_OP = 'UPDATE'
     AND (
       OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
       OR OLD.setup_plan_id IS DISTINCT FROM NEW.setup_plan_id
     ) THEN
    PERFORM platform.refresh_organization_setup_readiness(
      OLD.tenant_id, OLD.setup_plan_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_setup_requirements_refresh_readiness
AFTER INSERT OR UPDATE OF status, blocking OR DELETE
ON platform.organization_setup_requirements
FOR EACH ROW EXECUTE FUNCTION platform.refresh_organization_setup_readiness_after_requirement();

-- Dedicated pre-activation setup lookup. This is intentionally not normal
-- membership: setup participants can configure a provisioning organization but
-- gain no access to unrelated organization/business-runtime APIs.
CREATE OR REPLACE FUNCTION platform.active_organization_setup_access_for_subject(
  p_subject_id text,
  p_issuer text DEFAULT NULL
)
RETURNS TABLE (
  tenant_id uuid,
  enterprise_id uuid,
  organization_id uuid,
  setup_plan_id uuid,
  setup_role text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
BEGIN
  PERFORM set_config('app.subject_id', p_subject_id, true);
  PERFORM set_config('app.issuer', COALESCE(p_issuer, ''), true);

  RETURN QUERY
  SELECT
    plan.tenant_id,
    plan.enterprise_id,
    plan.organization_id,
    plan.setup_plan_id,
    participant.role
  FROM platform.organization_setup_participants participant
  JOIN platform.organization_setup_plans plan
    ON plan.tenant_id = participant.tenant_id
   AND plan.setup_plan_id = participant.setup_plan_id
  WHERE participant.subject_id = p_subject_id
    AND participant.issuer IS NOT DISTINCT FROM p_issuer
    AND participant.status = 'ACTIVE'
    AND participant.valid_from <= now()
    AND (participant.valid_until IS NULL OR participant.valid_until > now())
    AND plan.state IN ('PROVISIONING','CONFIGURING','READY_FOR_ACTIVATION')
  ORDER BY plan.tenant_id, plan.organization_id, participant.role;
END;
$$;

REVOKE ALL ON FUNCTION platform.active_organization_setup_access_for_subject(text, text)
  FROM PUBLIC;

-- FORCE RLS on every tenant-scoped setup table.
ALTER TABLE platform.organization_setup_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_setup_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_setup_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_setup_requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_setup_requirement_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_setup_requirement_dependencies FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_setup_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_setup_participants FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_setup_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.organization_setup_events FORCE ROW LEVEL SECURITY;


-- Subject-scoped bootstrap policies allow a verified identity to discover only
-- setup plans in which it is an active participant, before a normal ACTIVE
-- organization membership exists.
CREATE POLICY organization_setup_participants_subject_bootstrap_select
  ON platform.organization_setup_participants
  FOR SELECT
  USING (
    subject_id = platform.current_subject_id()
    AND issuer IS NOT DISTINCT FROM platform.current_issuer()
    AND status = 'ACTIVE'
    AND valid_from <= now()
    AND (valid_until IS NULL OR valid_until > now())
  );

CREATE POLICY organization_setup_plans_subject_bootstrap_select
  ON platform.organization_setup_plans
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM platform.organization_setup_participants participant
      WHERE participant.tenant_id = organization_setup_plans.tenant_id
        AND participant.setup_plan_id = organization_setup_plans.setup_plan_id
        AND participant.subject_id = platform.current_subject_id()
        AND participant.issuer IS NOT DISTINCT FROM platform.current_issuer()
        AND participant.status = 'ACTIVE'
        AND participant.valid_from <= now()
        AND (participant.valid_until IS NULL OR participant.valid_until > now())
    )
  );

CREATE POLICY organization_setup_plans_tenant_all
  ON platform.organization_setup_plans
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY organization_setup_requirements_tenant_all
  ON platform.organization_setup_requirements
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY organization_setup_requirement_dependencies_tenant_all
  ON platform.organization_setup_requirement_dependencies
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY organization_setup_participants_tenant_all
  ON platform.organization_setup_participants
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY organization_setup_events_tenant_all
  ON platform.organization_setup_events
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
