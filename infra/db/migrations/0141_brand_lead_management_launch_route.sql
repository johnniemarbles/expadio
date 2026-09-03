BEGIN;

-- Backfill the top-level launch route for environments where migration 0124
-- already ran before the Brand self-activation flow was introduced.
UPDATE platform.product_modules
   SET manifest = jsonb_set(COALESCE(manifest, '{}'::jsonb), '{route}', '"/leads"'::jsonb, true),
       updated_at = now()
 WHERE module_key = 'lead-management'
   AND COALESCE(manifest->>'route', '') <> '/leads';

COMMIT;
