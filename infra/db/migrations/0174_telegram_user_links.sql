-- 0173_telegram_user_links.sql
-- Links a Telegram account to an EXPADIO (tenant, subject) pair, so the
-- Telegram approval channel can (a) resolve an approver's identity from an
-- inbound callback_query, and (b) resolve an approver's chat id to deliver
-- an approval card to.
--
-- Deliberately has no row-level security. A webhook resolving an inbound
-- callback_query has no tenant context yet -- establishing one is exactly
-- what this table is for, the same reason platform.tenants itself (0002)
-- carries no RLS. Every other table this feature touches (agent_approval_requests,
-- agent_tasks) remains fully RLS-protected; this table only ever stores an
-- identity mapping, never approval content.

BEGIN;

CREATE TABLE platform.telegram_user_links (
  telegram_user_id bigint PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(tenant_id) ON DELETE CASCADE,
  subject_id text NOT NULL CHECK (btrim(subject_id) <> ''),
  linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subject_id)
);

CREATE INDEX telegram_user_links_tenant_subject_idx
  ON platform.telegram_user_links (tenant_id, subject_id);

-- Row level security: the Telegram webhook callback handler runs under a
-- privileged database role that bypasses RLS (same as platform.tenants itself),
-- so enabling the standard tenant isolation policy does not affect webhook
-- identity resolution. Unprivileged tenant sessions are correctly scoped.
ALTER TABLE platform.telegram_user_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.telegram_user_links FORCE ROW LEVEL SECURITY;
CREATE POLICY telegram_user_links_tenant_isolation ON platform.telegram_user_links
  USING (tenant_id = platform.current_tenant_id())
  WITH CHECK (tenant_id = platform.current_tenant_id());

COMMIT;
