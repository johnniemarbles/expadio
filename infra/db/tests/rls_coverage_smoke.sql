\set ON_ERROR_STOP on

-- Schema-wide RLS coverage invariant.
--
-- The application connects as the database *owner* (role `expadio`), not a
-- superuser. For a table owner, ordinary ENABLE ROW LEVEL SECURITY is not
-- enough — the owner bypasses it — so every tenant-scoped table must also be
-- FORCE ROW LEVEL SECURITY and carry at least one policy. A table that adds a
-- `tenant_id` column but forgets FORCE, or defines no policy, would silently
-- leak rows across tenants in production while every superuser-connected test
-- still passed (a superuser bypasses RLS regardless).
--
-- This guard fails the build the moment such a table appears. It is the
-- schema-wide complement to the behavioural probe in
-- test-integration/rls-isolation.itest.ts, which proves the mechanism itself
-- actually blocks cross-tenant access under a non-superuser role.
DO $$
DECLARE
  gaps text;
BEGIN
  SELECT string_agg(
           format('%s (rls_on=%s, forced=%s, policies=%s)',
                  c.relname, c.relrowsecurity, c.relforcerowsecurity,
                  (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)),
           ', ' ORDER BY c.relname)
    INTO gaps
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'platform'
     AND c.relkind = 'r'
     AND EXISTS (
       SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     )
     AND (
       NOT c.relrowsecurity
       OR NOT c.relforcerowsecurity
       OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
     );

  IF gaps IS NOT NULL THEN
    RAISE EXCEPTION 'tenant-scoped tables missing RLS enable/force/policy: %', gaps;
  END IF;
END;
$$;

-- Sanity floor: the audit must actually be looking at the schema. If the count
-- of covered tenant tables ever drops to zero, the query above is broken (wrong
-- schema, renamed column) and would pass vacuously — catch that too.
DO $$
DECLARE
  covered integer;
BEGIN
  SELECT count(*) INTO covered
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'platform' AND c.relkind = 'r'
     AND c.relrowsecurity AND c.relforcerowsecurity
     AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
     AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);
  IF covered < 40 THEN
    RAISE EXCEPTION 'RLS-coverage audit found only % protected tenant tables; the audit query is likely broken', covered;
  END IF;
END;
$$;
