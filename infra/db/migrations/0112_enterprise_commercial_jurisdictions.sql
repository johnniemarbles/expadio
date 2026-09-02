BEGIN;

-- Enterprise Commercial Network & Jurisdiction Activation.
--
-- This layer models corporate/commercial authority beneath the tenant security
-- boundary. It deliberately does NOT reuse platform.crm_agreements: CRM
-- agreements are customer commitments, whereas these records authorize
-- enterprise organizations to operate, sell, distribute, license or appoint.
--
-- Execution remains composed from the existing Decision Fabric, Workflow Rights
-- and Workflow Activation fabrics. Approval never implies rights, and rights
-- never imply jurisdiction activation.

CREATE TABLE platform.enterprise_territories (
  territory_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  enterprise_id uuid NOT NULL,
  parent_territory_id uuid,
  territory_key text NOT NULL CHECK (btrim(territory_key) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  territory_kind text NOT NULL CHECK (territory_kind IN (
    'GLOBAL','COUNTRY','SUBDIVISION','LOCALITY','CUSTOM'
  )),
  country_code text CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  subdivision_code text,
  locality_name text,
  external_geography_ref text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (territory_id, tenant_id),
  UNIQUE (territory_id, tenant_id, enterprise_id),
  FOREIGN KEY (enterprise_id, tenant_id)
    REFERENCES platform.enterprise_profiles(enterprise_id, tenant_id)
    ON DELETE CASCADE,
  FOREIGN KEY (parent_territory_id, tenant_id, enterprise_id)
    REFERENCES platform.enterprise_territories(territory_id, tenant_id, enterprise_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (parent_territory_id IS NULL OR parent_territory_id <> territory_id),
  CHECK (
    (territory_kind = 'GLOBAL'
      AND country_code IS NULL
      AND subdivision_code IS NULL
      AND locality_name IS NULL)
    OR
    (territory_kind = 'COUNTRY'
      AND country_code IS NOT NULL
      AND subdivision_code IS NULL
      AND locality_name IS NULL)
    OR
    (territory_kind = 'SUBDIVISION'
      AND country_code IS NOT NULL
      AND subdivision_code IS NOT NULL
      AND btrim(subdivision_code) <> ''
      AND locality_name IS NULL)
    OR
    (territory_kind = 'LOCALITY'
      AND country_code IS NOT NULL
      AND locality_name IS NOT NULL
      AND btrim(locality_name) <> '')
    OR
    territory_kind = 'CUSTOM'
  )
);

CREATE UNIQUE INDEX enterprise_territories_key_uq
  ON platform.enterprise_territories (tenant_id, enterprise_id, lower(territory_key));

CREATE UNIQUE INDEX enterprise_territories_country_uq
  ON platform.enterprise_territories (tenant_id, enterprise_id, country_code)
  WHERE territory_kind = 'COUNTRY' AND status = 'ACTIVE';

CREATE UNIQUE INDEX enterprise_territories_subdivision_uq
  ON platform.enterprise_territories (
    tenant_id, enterprise_id, country_code, lower(subdivision_code)
  )
  WHERE territory_kind = 'SUBDIVISION' AND status = 'ACTIVE';

CREATE OR REPLACE FUNCTION platform.enterprise_territory_parent_would_cycle(
  p_tenant_id uuid,
  p_territory_id uuid,
  p_parent_territory_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE ancestors AS (
    SELECT territory.parent_territory_id
      FROM platform.enterprise_territories territory
     WHERE territory.tenant_id = p_tenant_id
       AND territory.territory_id = p_parent_territory_id
    UNION ALL
    SELECT parent.parent_territory_id
      FROM platform.enterprise_territories parent
      JOIN ancestors current
        ON parent.territory_id = current.parent_territory_id
       AND parent.tenant_id = p_tenant_id
     WHERE current.parent_territory_id IS NOT NULL
  )
  SELECT p_parent_territory_id = p_territory_id
      OR EXISTS (
        SELECT 1
          FROM ancestors
         WHERE parent_territory_id = p_territory_id
      )
$$;

CREATE OR REPLACE FUNCTION platform.reject_enterprise_territory_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.parent_territory_id IS NOT NULL
     AND platform.enterprise_territory_parent_would_cycle(
       NEW.tenant_id,
       NEW.territory_id,
       NEW.parent_territory_id
     )
  THEN
    RAISE EXCEPTION 'enterprise territory hierarchy cycle rejected';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enterprise_territories_reject_cycle
BEFORE INSERT OR UPDATE OF parent_territory_id
ON platform.enterprise_territories
FOR EACH ROW EXECUTE FUNCTION platform.reject_enterprise_territory_cycle();


CREATE TABLE platform.enterprise_commercial_agreements (
  enterprise_commercial_agreement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  enterprise_id uuid NOT NULL,
  agreement_number text,
  title text NOT NULL CHECK (btrim(title) <> ''),
  agreement_kind text NOT NULL CHECK (agreement_kind IN (
    'FRANCHISE','MASTER_FRANCHISE','DISTRIBUTION','WHOLESALE','RETAIL',
    'AFFILIATE','BROKER','LICENSE','AGENCY','MANAGEMENT','SERVICE',
    'JOINT_VENTURE','OTHER'
  )),
  grantor_legal_entity_id uuid NOT NULL,
  grantee_legal_entity_id uuid NOT NULL,
  sponsoring_organization_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT','UNDER_REVIEW','APPROVED','ACTIVE',
    'SUSPENDED','EXPIRED','TERMINATED'
  )),
  effective_from timestamptz,
  effective_until timestamptz,
  governing_law_country_code text CHECK (
    governing_law_country_code IS NULL
    OR governing_law_country_code ~ '^[A-Z]{2}$'
  ),
  governing_law_subdivision_code text,
  execution_evidence_refs text[] NOT NULL DEFAULT '{}',
  source_change_request_id uuid,
  workflow_instance_id uuid,
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  approved_by_subject_id text,
  approved_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enterprise_commercial_agreement_id, tenant_id),
  UNIQUE (enterprise_commercial_agreement_id, tenant_id, enterprise_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (enterprise_id, tenant_id)
    REFERENCES platform.enterprise_profiles(enterprise_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (grantor_legal_entity_id, tenant_id, enterprise_id)
    REFERENCES platform.legal_entities(legal_entity_id, tenant_id, enterprise_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (grantee_legal_entity_id, tenant_id, enterprise_id)
    REFERENCES platform.legal_entities(legal_entity_id, tenant_id, enterprise_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (sponsoring_organization_id, tenant_id, enterprise_id)
    REFERENCES platform.organizations(organization_id, tenant_id, enterprise_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (source_change_request_id, tenant_id)
    REFERENCES platform.enterprise_change_requests(
      enterprise_change_request_id, tenant_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workflow_instance_id, tenant_id)
    REFERENCES platform.workflow_instances(instance_id, tenant_id)
    ON DELETE RESTRICT,
  CHECK (grantor_legal_entity_id <> grantee_legal_entity_id),
  CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from),
  CHECK (
    (state IN ('APPROVED','ACTIVE','SUSPENDED','EXPIRED','TERMINATED')
      AND approved_at IS NOT NULL
      AND approved_by_subject_id IS NOT NULL
      AND btrim(approved_by_subject_id) <> '')
    OR state NOT IN ('APPROVED','ACTIVE','SUSPENDED','EXPIRED','TERMINATED')
  ),
  CHECK (
    (state = 'ACTIVE'
      AND activated_at IS NOT NULL
      AND effective_from IS NOT NULL
      AND cardinality(execution_evidence_refs) > 0)
    OR state <> 'ACTIVE'
  )
);

CREATE UNIQUE INDEX enterprise_commercial_agreements_number_uq
  ON platform.enterprise_commercial_agreements (
    tenant_id, enterprise_id, lower(agreement_number)
  )
  WHERE agreement_number IS NOT NULL;

CREATE INDEX enterprise_commercial_agreements_party_idx
  ON platform.enterprise_commercial_agreements (
    tenant_id, enterprise_id, grantor_legal_entity_id, grantee_legal_entity_id, state
  );


CREATE TABLE platform.enterprise_appointments (
  enterprise_appointment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  enterprise_id uuid NOT NULL,
  enterprise_commercial_agreement_id uuid NOT NULL,
  grantor_organization_id uuid NOT NULL,
  beneficiary_organization_id uuid NOT NULL,
  beneficiary_legal_entity_id uuid NOT NULL,
  appointment_kind text NOT NULL CHECK (appointment_kind IN (
    'MASTER_FRANCHISEE','FRANCHISEE','DISTRIBUTOR','WHOLESALER','RETAILER',
    'AFFILIATE','BROKER','LICENSEE','OPERATOR','AGENT',
    'MANAGEMENT_PROVIDER','SERVICE_PROVIDER','JV_PARTNER','OTHER'
  )),
  rights_profile_key text NOT NULL CHECK (btrim(rights_profile_key) <> ''),
  rights_profile_version integer NOT NULL DEFAULT 1 CHECK (rights_profile_version > 0),
  requested_right_types text[] NOT NULL CHECK (cardinality(requested_right_types) > 0),
  exclusivity_key text,
  delegation_requested boolean NOT NULL DEFAULT false,
  sub_appointment_requested boolean NOT NULL DEFAULT false,
  channel_keys text[] NOT NULL DEFAULT '{}',
  product_keys text[] NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN (
    'DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED',
    'RIGHTS_PENDING','ACTIVE','SUSPENDED','REVOKED','EXPIRED'
  )),
  source_change_request_id uuid,
  workflow_instance_id uuid,
  workflow_rights_grant_id uuid,
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  effective_from timestamptz,
  effective_until timestamptz,
  requested_by_subject_id text NOT NULL CHECK (btrim(requested_by_subject_id) <> ''),
  approved_by_subject_id text,
  approved_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enterprise_appointment_id, tenant_id),
  UNIQUE (enterprise_appointment_id, tenant_id, enterprise_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (enterprise_id, tenant_id)
    REFERENCES platform.enterprise_profiles(enterprise_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (enterprise_commercial_agreement_id, tenant_id, enterprise_id)
    REFERENCES platform.enterprise_commercial_agreements(
      enterprise_commercial_agreement_id, tenant_id, enterprise_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (grantor_organization_id, tenant_id, enterprise_id)
    REFERENCES platform.organizations(organization_id, tenant_id, enterprise_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (beneficiary_organization_id, tenant_id, enterprise_id)
    REFERENCES platform.organizations(organization_id, tenant_id, enterprise_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (beneficiary_legal_entity_id, tenant_id, enterprise_id)
    REFERENCES platform.legal_entities(legal_entity_id, tenant_id, enterprise_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (source_change_request_id, tenant_id)
    REFERENCES platform.enterprise_change_requests(
      enterprise_change_request_id, tenant_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workflow_instance_id, tenant_id)
    REFERENCES platform.workflow_instances(instance_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workflow_rights_grant_id, tenant_id)
    REFERENCES platform.workflow_rights_grants(grant_id, tenant_id)
    ON DELETE RESTRICT,
  CHECK (grantor_organization_id <> beneficiary_organization_id),
  CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from),
  CHECK (
    (state IN ('APPROVED','RIGHTS_PENDING','ACTIVE','SUSPENDED','REVOKED','EXPIRED')
      AND approved_at IS NOT NULL
      AND approved_by_subject_id IS NOT NULL
      AND btrim(approved_by_subject_id) <> '')
    OR state NOT IN ('APPROVED','RIGHTS_PENDING','ACTIVE','SUSPENDED','REVOKED','EXPIRED')
  ),
  CHECK (
    (state = 'ACTIVE'
      AND workflow_rights_grant_id IS NOT NULL
      AND workflow_instance_id IS NOT NULL
      AND effective_from IS NOT NULL
      AND activated_at IS NOT NULL)
    OR state <> 'ACTIVE'
  )
);

CREATE INDEX enterprise_appointments_beneficiary_idx
  ON platform.enterprise_appointments (
    tenant_id, enterprise_id, beneficiary_organization_id, state
  );

CREATE INDEX enterprise_appointments_review_idx
  ON platform.enterprise_appointments (
    tenant_id, enterprise_id, grantor_organization_id, state, created_at
  );


CREATE TABLE platform.enterprise_appointment_territories (
  enterprise_appointment_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  enterprise_id uuid NOT NULL,
  territory_id uuid NOT NULL,
  exclusive boolean NOT NULL DEFAULT false,
  created_by_subject_id text NOT NULL CHECK (btrim(created_by_subject_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (enterprise_appointment_id, territory_id),
  FOREIGN KEY (enterprise_appointment_id, tenant_id, enterprise_id)
    REFERENCES platform.enterprise_appointments(
      enterprise_appointment_id, tenant_id, enterprise_id
    )
    ON DELETE CASCADE,
  FOREIGN KEY (territory_id, tenant_id, enterprise_id)
    REFERENCES platform.enterprise_territories(
      territory_id, tenant_id, enterprise_id
    )
    ON DELETE RESTRICT
);

CREATE INDEX enterprise_appointment_territories_scope_idx
  ON platform.enterprise_appointment_territories (
    tenant_id, enterprise_id, territory_id, exclusive
  );


CREATE TABLE platform.enterprise_jurisdiction_activations (
  enterprise_jurisdiction_activation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  enterprise_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  enterprise_appointment_id uuid NOT NULL,
  territory_id uuid NOT NULL,
  source_change_request_id uuid,
  workflow_activation_id uuid,
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  state text NOT NULL DEFAULT 'PLANNING' CHECK (state IN (
    'PLANNING','ACTIVATION_REVIEW','APPROVED','ACTIVE','SUSPENDED','REVOKED'
  )),
  requested_by_subject_id text NOT NULL CHECK (btrim(requested_by_subject_id) <> ''),
  approved_by_subject_id text,
  approved_at timestamptz,
  activated_by_subject_id text,
  activated_at timestamptz,
  evidence_refs text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enterprise_jurisdiction_activation_id, tenant_id),
  UNIQUE (enterprise_jurisdiction_activation_id, tenant_id, enterprise_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (enterprise_id, tenant_id)
    REFERENCES platform.enterprise_profiles(enterprise_id, tenant_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, tenant_id, enterprise_id)
    REFERENCES platform.organizations(organization_id, tenant_id, enterprise_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (enterprise_appointment_id, tenant_id, enterprise_id)
    REFERENCES platform.enterprise_appointments(
      enterprise_appointment_id, tenant_id, enterprise_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (territory_id, tenant_id, enterprise_id)
    REFERENCES platform.enterprise_territories(
      territory_id, tenant_id, enterprise_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (source_change_request_id, tenant_id)
    REFERENCES platform.enterprise_change_requests(
      enterprise_change_request_id, tenant_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workflow_activation_id, tenant_id)
    REFERENCES platform.workflow_activations(activation_id, tenant_id)
    ON DELETE RESTRICT,
  CHECK (
    (state IN ('APPROVED','ACTIVE','SUSPENDED','REVOKED')
      AND approved_at IS NOT NULL
      AND approved_by_subject_id IS NOT NULL
      AND btrim(approved_by_subject_id) <> '')
    OR state NOT IN ('APPROVED','ACTIVE','SUSPENDED','REVOKED')
  ),
  CHECK (
    (state = 'ACTIVE'
      AND workflow_activation_id IS NOT NULL
      AND activated_at IS NOT NULL
      AND activated_by_subject_id IS NOT NULL
      AND btrim(activated_by_subject_id) <> ''
      AND cardinality(evidence_refs) > 0)
    OR state <> 'ACTIVE'
  )
);

CREATE UNIQUE INDEX enterprise_jurisdiction_active_org_territory_uq
  ON platform.enterprise_jurisdiction_activations (
    tenant_id, organization_id, territory_id
  )
  WHERE state = 'ACTIVE';

CREATE INDEX enterprise_jurisdiction_activation_review_idx
  ON platform.enterprise_jurisdiction_activations (
    tenant_id, enterprise_id, state, created_at
  );


-- Commercial agreement activation is evidence-backed and requires both legal
-- counterparties to be verified. Approval alone remains insufficient.
CREATE OR REPLACE FUNCTION platform.enforce_enterprise_commercial_agreement_activation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  verified_party_count integer;
BEGIN
  IF NEW.state = 'ACTIVE'
     AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM 'ACTIVE')
  THEN
    SELECT count(*)
      INTO verified_party_count
      FROM platform.legal_entities legal_entity
     WHERE legal_entity.tenant_id = NEW.tenant_id
       AND legal_entity.enterprise_id = NEW.enterprise_id
       AND legal_entity.legal_entity_id IN (
         NEW.grantor_legal_entity_id,
         NEW.grantee_legal_entity_id
       )
       AND legal_entity.status = 'VERIFIED';

    IF verified_party_count <> 2 THEN
      RAISE EXCEPTION 'commercial agreement activation requires verified legal counterparties';
    END IF;

    IF cardinality(NEW.execution_evidence_refs) = 0 THEN
      RAISE EXCEPTION 'commercial agreement activation requires execution evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enterprise_commercial_agreements_activation_gate
BEFORE INSERT OR UPDATE OF state
ON platform.enterprise_commercial_agreements
FOR EACH ROW EXECUTE FUNCTION platform.enforce_enterprise_commercial_agreement_activation();


-- An appointment becomes ACTIVE only after the existing Workflow Rights fabric
-- has committed an ACTIVE grant for the same workflow, beneficiary, agreement,
-- right types and every appointed territory.
CREATE OR REPLACE FUNCTION platform.enforce_enterprise_appointment_rights_gate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  grant_record platform.workflow_rights_grants%ROWTYPE;
  agreement_state text;
  missing_territory_count integer;
  exclusive_conflict_count integer;
BEGIN
  IF NEW.state <> 'ACTIVE'
     OR (TG_OP = 'UPDATE' AND OLD.state IS NOT DISTINCT FROM 'ACTIVE')
  THEN
    RETURN NEW;
  END IF;

  SELECT agreement.state
    INTO agreement_state
    FROM platform.enterprise_commercial_agreements agreement
   WHERE agreement.tenant_id = NEW.tenant_id
     AND agreement.enterprise_commercial_agreement_id =
       NEW.enterprise_commercial_agreement_id;

  IF agreement_state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'appointment activation requires active commercial agreement';
  END IF;

  IF NEW.workflow_rights_grant_id IS NULL THEN
    RAISE EXCEPTION 'appointment activation requires workflow rights grant';
  END IF;

  SELECT grant_row.*
    INTO grant_record
    FROM platform.workflow_rights_grants grant_row
   WHERE grant_row.tenant_id = NEW.tenant_id
     AND grant_row.grant_id = NEW.workflow_rights_grant_id;

  IF NOT FOUND
     OR grant_record.state <> 'ACTIVE'
     OR grant_record.instance_id IS DISTINCT FROM NEW.workflow_instance_id
     OR grant_record.beneficiary_organization_id IS DISTINCT FROM
       NEW.beneficiary_organization_id
     OR grant_record.source_agreement_id IS DISTINCT FROM
       NEW.enterprise_commercial_agreement_id::text
     OR NOT grant_record.right_types @> NEW.requested_right_types
     OR grant_record.effective_from > now()
     OR (
       grant_record.effective_until IS NOT NULL
       AND grant_record.effective_until <= now()
     )
  THEN
    RAISE EXCEPTION 'appointment activation requires matching effective workflow rights';
  END IF;

  SELECT count(*)
    INTO missing_territory_count
    FROM platform.enterprise_appointment_territories territory_scope
   WHERE territory_scope.tenant_id = NEW.tenant_id
     AND territory_scope.enterprise_appointment_id = NEW.enterprise_appointment_id
     AND NOT (
       COALESCE(grant_record.scope -> 'territoryIds', '[]'::jsonb)
       ? territory_scope.territory_id::text
     );

  IF missing_territory_count <> 0 THEN
    RAISE EXCEPTION 'workflow rights grant does not cover every appointment territory';
  END IF;

  SELECT count(*)
    INTO exclusive_conflict_count
    FROM platform.enterprise_appointment_territories requested_scope
    JOIN platform.enterprise_appointment_territories existing_scope
      ON existing_scope.tenant_id = requested_scope.tenant_id
     AND existing_scope.enterprise_id = requested_scope.enterprise_id
     AND existing_scope.territory_id = requested_scope.territory_id
     AND existing_scope.enterprise_appointment_id <> requested_scope.enterprise_appointment_id
    JOIN platform.enterprise_appointments existing_appointment
      ON existing_appointment.tenant_id = existing_scope.tenant_id
     AND existing_appointment.enterprise_appointment_id =
       existing_scope.enterprise_appointment_id
     AND existing_appointment.state = 'ACTIVE'
   WHERE requested_scope.tenant_id = NEW.tenant_id
     AND requested_scope.enterprise_appointment_id = NEW.enterprise_appointment_id
     AND (requested_scope.exclusive OR existing_scope.exclusive)
     AND existing_appointment.requested_right_types &&
       NEW.requested_right_types;

  IF exclusive_conflict_count <> 0 THEN
    RAISE EXCEPTION 'appointment territory rights conflict with active exclusive appointment';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enterprise_appointments_rights_gate
BEFORE INSERT OR UPDATE OF state
ON platform.enterprise_appointments
FOR EACH ROW EXECUTE FUNCTION platform.enforce_enterprise_appointment_rights_gate();


-- Jurisdiction ACTIVE is a third explicit gate: approved appointment rights must
-- cover the territory, the generic Workflow Activation must source that exact
-- rights grant, and an append-only VERIFIED activation verification must exist.
CREATE OR REPLACE FUNCTION platform.enforce_enterprise_jurisdiction_activation_gate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  appointment_record platform.enterprise_appointments%ROWTYPE;
  activation_record platform.workflow_activations%ROWTYPE;
  verified_activation_count integer;
  territory_link_count integer;
BEGIN
  IF NEW.state <> 'ACTIVE'
     OR (TG_OP = 'UPDATE' AND OLD.state IS NOT DISTINCT FROM 'ACTIVE')
  THEN
    RETURN NEW;
  END IF;

  SELECT appointment.*
    INTO appointment_record
    FROM platform.enterprise_appointments appointment
   WHERE appointment.tenant_id = NEW.tenant_id
     AND appointment.enterprise_appointment_id = NEW.enterprise_appointment_id;

  IF NOT FOUND
     OR appointment_record.state <> 'ACTIVE'
     OR appointment_record.beneficiary_organization_id IS DISTINCT FROM
       NEW.organization_id
     OR appointment_record.workflow_rights_grant_id IS NULL
  THEN
    RAISE EXCEPTION 'jurisdiction activation requires active matching appointment';
  END IF;

  SELECT count(*)
    INTO territory_link_count
    FROM platform.enterprise_appointment_territories appointment_territory
   WHERE appointment_territory.tenant_id = NEW.tenant_id
     AND appointment_territory.enterprise_appointment_id =
       NEW.enterprise_appointment_id
     AND appointment_territory.territory_id = NEW.territory_id;

  IF territory_link_count <> 1 THEN
    RAISE EXCEPTION 'jurisdiction territory is not covered by appointment';
  END IF;

  IF NEW.workflow_activation_id IS NULL THEN
    RAISE EXCEPTION 'jurisdiction activation requires workflow activation';
  END IF;

  SELECT activation.*
    INTO activation_record
    FROM platform.workflow_activations activation
   WHERE activation.tenant_id = NEW.tenant_id
     AND activation.activation_id = NEW.workflow_activation_id;

  IF NOT FOUND
     OR activation_record.instance_id IS DISTINCT FROM
       appointment_record.workflow_instance_id
     OR NOT (
       appointment_record.workflow_rights_grant_id =
       ANY(activation_record.source_rights_grant_ids)
     )
  THEN
    RAISE EXCEPTION 'jurisdiction activation requires matching workflow activation';
  END IF;

  SELECT count(*)
    INTO verified_activation_count
    FROM platform.workflow_activation_verifications verification
   WHERE verification.tenant_id = NEW.tenant_id
     AND verification.activation_id = NEW.workflow_activation_id
     AND verification.instance_id = appointment_record.workflow_instance_id
     AND verification.state = 'VERIFIED';

  IF verified_activation_count = 0 THEN
    RAISE EXCEPTION 'jurisdiction activation requires verified activation evidence';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enterprise_jurisdiction_activations_active_gate
BEFORE INSERT OR UPDATE OF state
ON platform.enterprise_jurisdiction_activations
FOR EACH ROW EXECUTE FUNCTION platform.enforce_enterprise_jurisdiction_activation_gate();


-- Platform default Decision Fabric lifecycle for commercial appointments.
INSERT INTO platform.workflow_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key, source, state,
  allows_stage_addition, allows_stage_reorder, allows_stage_deactivation,
  minimum_required_stage_keys, stages, published_by_subject_id, published_at
)
SELECT
  NULL,
  'enterprise.commercial-appointment',
  1,
  'Enterprise commercial appointment',
  'enterprise.commercial-appointment',
  'PLATFORM',
  'ACTIVE',
  false,
  false,
  false,
  '{}'::text[],
  $json$[
    {
      "stageKey": "SUBMITTED", "label": "Submitted", "sequence": 0, "kind": "APPLICATION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "COMMERCIAL_REVIEW", "label": "Commercial review", "sequence": 1, "kind": "DECISION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": true, "decisionOutcomes": ["APPROVE", "REJECT"],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "RIGHTS", "label": "Rights issuance", "sequence": 2, "kind": "RIGHTS",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "RETURN"
    },
    {
      "stageKey": "ACTIVE", "label": "Active", "sequence": 3, "kind": "ACTIVATION",
      "isMandatory": true, "canBeDeactivated": false, "isParallel": false,
      "requiredParticipantKeys": [], "decisionRequired": false, "decisionOutcomes": [],
      "entryConditions": [], "exitConditions": [], "blockingRequirementKeys": [],
      "autoAdvance": false, "onReject": "TERMINATE"
    }
  ]$json$::jsonb,
  NULL,
  now()
WHERE NOT EXISTS (
  SELECT 1
    FROM platform.workflow_blueprints
   WHERE tenant_id IS NULL
     AND blueprint_key = 'enterprise.commercial-appointment'
     AND version = 1
);


-- Narrow platform profiles: the enterprise composition layer maps appointment
-- kind to one of these and still validates the exact requested right set.
INSERT INTO platform.workflow_rights_profiles (
  tenant_id, profile_key, version, label, right_types, maximum_scope,
  permits_exclusivity, permits_delegation, permits_sub_appointment,
  default_duration, renewal_model, created_by_subject_id
)
VALUES
  (
    NULL, 'enterprise.operator', 1, 'Enterprise operator',
    ARRAY['OPERATE','SELL','RETAIL','SERVICE','MANAGE'],
    NULL, true, false, false, NULL, 'EXPLICIT_RENEWAL', NULL
  ),
  (
    NULL, 'enterprise.channel-partner', 1, 'Enterprise channel partner',
    ARRAY['SELL','DISTRIBUTE','WHOLESALE','RETAIL','REFER','BROKER'],
    NULL, true, false, false, NULL, 'EXPLICIT_RENEWAL', NULL
  ),
  (
    NULL, 'enterprise.licensee', 1, 'Enterprise licensee',
    ARRAY['LICENSE','OPERATE'],
    NULL, true, false, false, NULL, 'EXPLICIT_RENEWAL', NULL
  ),
  (
    NULL, 'enterprise.master-operator', 1, 'Enterprise master operator',
    ARRAY['OPERATE','SELL','DISTRIBUTE','WHOLESALE','RETAIL','SUB_APPOINT'],
    NULL, true, true, true, NULL, 'EXPLICIT_RENEWAL', NULL
  ),
  (
    NULL, 'enterprise.service-provider', 1, 'Enterprise service provider',
    ARRAY['SERVICE','MANAGE'],
    NULL, false, false, false, NULL, 'EXPLICIT_RENEWAL', NULL
  ),
  (
    NULL, 'enterprise.jv-partner', 1, 'Enterprise joint-venture partner',
    ARRAY['OPERATE','MANAGE','SERVICE'],
    NULL, false, false, false, NULL, 'EXPLICIT_RENEWAL', NULL
  )
ON CONFLICT DO NOTHING;


INSERT INTO platform.workflow_activation_blueprints (
  tenant_id, blueprint_key, version, label, work_type_key,
  provisioning_model, steps, created_by_subject_id
)
SELECT
  NULL,
  'enterprise.jurisdiction-activation',
  1,
  'Enterprise jurisdiction activation',
  'enterprise.commercial-appointment',
  'NO_PROVISIONING',
  $json$[
    {
      "stepKey": "verify-agreement",
      "label": "Verify commercial agreement",
      "sequence": 0,
      "requiredBeforeActive": true,
      "actionKey": "enterprise.verify-agreement"
    },
    {
      "stepKey": "verify-rights",
      "label": "Verify territory rights",
      "sequence": 1,
      "requiredBeforeActive": true,
      "actionKey": "enterprise.verify-rights"
    },
    {
      "stepKey": "verify-compliance",
      "label": "Verify jurisdiction compliance",
      "sequence": 2,
      "requiredBeforeActive": true,
      "actionKey": "enterprise.verify-compliance"
    },
    {
      "stepKey": "verify-operational-readiness",
      "label": "Verify operational readiness",
      "sequence": 3,
      "requiredBeforeActive": true,
      "actionKey": "enterprise.verify-operational-readiness"
    }
  ]$json$::jsonb,
  NULL
WHERE NOT EXISTS (
  SELECT 1
    FROM platform.workflow_activation_blueprints
   WHERE tenant_id IS NULL
     AND blueprint_key = 'enterprise.jurisdiction-activation'
     AND version = 1
);


-- Forced tenant isolation for every new enterprise-commercial table.
ALTER TABLE platform.enterprise_territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.enterprise_territories FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.enterprise_commercial_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.enterprise_commercial_agreements FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.enterprise_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.enterprise_appointments FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.enterprise_appointment_territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.enterprise_appointment_territories FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.enterprise_jurisdiction_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.enterprise_jurisdiction_activations FORCE ROW LEVEL SECURITY;

CREATE POLICY enterprise_territories_tenant_all
  ON platform.enterprise_territories
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY enterprise_commercial_agreements_tenant_all
  ON platform.enterprise_commercial_agreements
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY enterprise_appointments_tenant_all
  ON platform.enterprise_appointments
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY enterprise_appointment_territories_tenant_all
  ON platform.enterprise_appointment_territories
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

CREATE POLICY enterprise_jurisdiction_activations_tenant_all
  ON platform.enterprise_jurisdiction_activations
  FOR ALL
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
