BEGIN;

-- Idempotent backfill: ensure the lead-management product module manifest
-- carries the canonical launch route for Brand shell navigation.
-- The original catalogue insert (0124) set this field, but this migration
-- guarantees the value survives any intermediate manifest-only updates.
UPDATE platform.product_modules
   SET manifest    = jsonb_set(manifest, '{route}', '"/leads"'::jsonb, true),
       updated_at  = now()
 WHERE module_key = 'lead-management';

COMMIT;
