BEGIN;

-- Industry Packs — bind a tenant to a vertical.
--
-- The universal business engine is industry-neutral; an Industry Pack reskins
-- it for a vertical (DENTEX, etc.) by supplying presentation terminology. This
-- records which pack a workspace has chosen. NULL = the neutral engine.
--
-- Display-only: the pack changes labels, never canonical concept keys,
-- authorization, or persisted identities. The column lives on the tenants row,
-- which is already tenant-isolated by the tenants_isolation RLS policy, so
-- reads and writes are automatically scoped to the caller's own tenant.

ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS vertical_key text;

COMMIT;
