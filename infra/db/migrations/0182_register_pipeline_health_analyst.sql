-- Register the Pipeline & Lead Health Analyst in the real agent catalog.
-- The flat-file skill manifest is descriptive; runtime activation resolves via platform.agent_definitions.

INSERT INTO platform.agent_definitions (
    department,
    slug,
    persona,
    tools,
    default_on,
    status
)
VALUES (
    'Revenue Operations',
    'pipeline-health-analyst',
    'Pipeline & Lead Health Analyst',
    '["DB"]'::jsonb,
    false,
    'ACTIVE'
)
ON CONFLICT (slug) DO UPDATE
SET department = EXCLUDED.department,
    persona = EXCLUDED.persona,
    tools = EXCLUDED.tools,
    default_on = EXCLUDED.default_on,
    status = EXCLUDED.status,
    updated_at = NOW();
