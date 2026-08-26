BEGIN;

CREATE OR REPLACE FUNCTION platform.valid_agent_capability_text_array(
  values_to_check text[],
  require_nonempty boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT values_to_check IS NOT NULL
    AND (NOT require_nonempty OR cardinality(values_to_check) > 0)
    AND array_position(values_to_check, NULL) IS NULL
    AND NOT EXISTS (
      SELECT 1
        FROM unnest(values_to_check) AS value
       WHERE btrim(value) = '' OR value <> btrim(value)
          OR value ~ E'[\\r\\n\\t]'
    )
    AND cardinality(values_to_check) = (
      SELECT count(DISTINCT value)
        FROM unnest(values_to_check) AS value
    );
$$;

CREATE OR REPLACE FUNCTION platform.valid_agent_capability_schema(
  schema_value jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_typeof(schema_value) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(schema_value)) = 2
    AND btrim(schema_value ->> 'schemaReference') <> ''
    AND schema_value ->> 'schemaReference' = btrim(schema_value ->> 'schemaReference')
    AND schema_value ->> 'schemaDigest' ~ '^sha256:[0-9a-f]{64}$';
$$;

CREATE OR REPLACE FUNCTION platform.valid_agent_capability_skill_references(
  references_value jsonb,
  capability_kind text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_typeof(references_value) = 'array'
    AND (
      (capability_kind = 'SKILL' AND jsonb_array_length(references_value) = 0)
      OR (
        capability_kind = 'WORKER'
        AND jsonb_array_length(references_value) > 0
        AND NOT EXISTS (
          SELECT 1
            FROM jsonb_array_elements(references_value) AS reference
           WHERE jsonb_typeof(reference) <> 'object'
              OR (SELECT count(*) FROM jsonb_object_keys(reference)) <> 2
              OR btrim(reference ->> 'key') = ''
              OR reference ->> 'key' <> btrim(reference ->> 'key')
              OR reference ->> 'key' ~ E'[\\r\\n\\t]'
              OR jsonb_typeof(reference -> 'version') <> 'number'
              OR (reference ->> 'version') !~ '^[1-9][0-9]*$'
        )
        AND jsonb_array_length(references_value) = (
          SELECT count(DISTINCT (
            reference ->> 'key',
            reference ->> 'version'
          ))
            FROM jsonb_array_elements(references_value) AS reference
        )
      )
    );
$$;

CREATE TABLE platform.agent_capability_manifests (
  manifest_id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('SKILL', 'WORKER')),
  capability_key text NOT NULL CHECK (
    btrim(capability_key) <> ''
    AND capability_key = btrim(capability_key)
    AND capability_key !~ E'[\\r\\n\\t]'
  ),
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL CHECK (state IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
  scope_kind text NOT NULL CHECK (scope_kind IN ('PLATFORM', 'VERTICAL', 'TENANT')),
  scope_key text,
  tenant_id uuid REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  owner_subject_id text NOT NULL CHECK (btrim(owner_subject_id) <> ''),
  instruction_reference text NOT NULL CHECK (btrim(instruction_reference) <> ''),
  instruction_digest text NOT NULL CHECK (
    instruction_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  input_schema jsonb NOT NULL CHECK (
    platform.valid_agent_capability_schema(input_schema)
  ),
  output_schema jsonb NOT NULL CHECK (
    platform.valid_agent_capability_schema(output_schema)
  ),
  required_permission_keys text[] NOT NULL CHECK (
    platform.valid_agent_capability_text_array(required_permission_keys, true)
  ),
  allowed_tool_keys text[] NOT NULL CHECK (
    platform.valid_agent_capability_text_array(allowed_tool_keys, false)
  ),
  negative_constraint_keys text[] NOT NULL CHECK (
    platform.valid_agent_capability_text_array(negative_constraint_keys, true)
  ),
  budget_policy_reference text NOT NULL CHECK (
    btrim(budget_policy_reference) <> ''
  ),
  max_steps integer NOT NULL CHECK (max_steps > 0),
  max_cost_minor_units integer NOT NULL CHECK (max_cost_minor_units >= 0),
  timeout_seconds integer NOT NULL CHECK (timeout_seconds > 0),
  stop_condition_keys text[] NOT NULL CHECK (
    platform.valid_agent_capability_text_array(stop_condition_keys, true)
  ),
  escalation_policy_reference text NOT NULL CHECK (
    btrim(escalation_policy_reference) <> ''
  ),
  skill_references jsonb NOT NULL CHECK (
    platform.valid_agent_capability_skill_references(skill_references, kind)
  ),
  verified_at timestamptz,
  effective_from timestamptz NOT NULL,
  evidence_refs text[] NOT NULL CHECK (
    platform.valid_agent_capability_text_array(evidence_refs, true)
  ),
  CHECK (
    (scope_kind = 'PLATFORM' AND scope_key IS NULL AND tenant_id IS NULL)
    OR (
      scope_kind = 'VERTICAL'
      AND btrim(scope_key) <> ''
      AND tenant_id IS NULL
    )
    OR (
      scope_kind = 'TENANT'
      AND tenant_id IS NOT NULL
      AND scope_key = tenant_id::text
    )
  ),
  CHECK (state = 'DRAFT' OR verified_at IS NOT NULL)
);

CREATE UNIQUE INDEX agent_capability_manifest_identity_idx
  ON platform.agent_capability_manifests (
    scope_kind,
    COALESCE(scope_key, ''),
    kind,
    capability_key,
    version
  );

CREATE INDEX agent_capability_manifest_resolution_idx
  ON platform.agent_capability_manifests (
    kind,
    capability_key,
    state,
    effective_from DESC,
    version DESC
  );

CREATE OR REPLACE FUNCTION platform.guard_agent_capability_manifest_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Agent capability manifest history is immutable';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['state', 'verified_at'])
     <> (to_jsonb(OLD) - ARRAY['state', 'verified_at']) THEN
    RAISE EXCEPTION 'Agent capability manifest content is immutable';
  END IF;

  IF OLD.state = 'DRAFT'
     AND NEW.state = 'PUBLISHED'
     AND NEW.verified_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.state = 'PUBLISHED'
     AND NEW.state = 'RETIRED'
     AND NEW.verified_at = OLD.verified_at THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid agent capability manifest lifecycle transition';
END;
$$;

CREATE TRIGGER agent_capability_manifests_lifecycle
BEFORE UPDATE OR DELETE ON platform.agent_capability_manifests
FOR EACH ROW EXECUTE FUNCTION platform.guard_agent_capability_manifest_lifecycle();

ALTER TABLE platform.agent_capability_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.agent_capability_manifests FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_capability_manifests_select
  ON platform.agent_capability_manifests
  FOR SELECT
  USING (
    scope_kind IN ('PLATFORM', 'VERTICAL')
    OR tenant_id = platform.current_tenant_id()
  );

CREATE POLICY agent_capability_manifests_insert
  ON platform.agent_capability_manifests
  FOR INSERT
  WITH CHECK (
    scope_kind = 'TENANT'
    AND tenant_id = platform.current_tenant_id()
  );

CREATE POLICY agent_capability_manifests_update
  ON platform.agent_capability_manifests
  FOR UPDATE
  USING (
    scope_kind = 'TENANT'
    AND tenant_id = platform.current_tenant_id()
  )
  WITH CHECK (
    scope_kind = 'TENANT'
    AND tenant_id = platform.current_tenant_id()
  );

COMMIT;
