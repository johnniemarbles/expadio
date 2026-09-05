BEGIN;

-- Seed a verified TENANT-scoped email sender for the Dreamware demo tenant so
-- that OTP emails (and any other transactional emails) can be dispatched through
-- the configured Resend provider. The communication delivery worker requires
-- platformFallback='DENY', meaning a tenant-level or org-level verified sender
-- must exist — a PLATFORM-scoped sender is not sufficient.
--
-- noreply@mydreamware.org is the canonical from-address for the Dreamware tenant.
-- The domain must also be verified in the Resend dashboard for delivery to succeed.
--
-- Idempotent: only inserted when no active TENANT email sender exists for this tenant.

INSERT INTO platform.communication_sender_identities (
  scope, tenant_id, organization_id, channel, address, display_name,
  purposes, is_default, is_system_fallback, verification_status, status
)
SELECT
  'TENANT',
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'email',
  'noreply@mydreamware.org',
  'DREAMWARE',
  ARRAY['transactional', 'marketing']::text[],
  true,
  false,
  'VERIFIED',
  'ACTIVE'
WHERE
  -- Skip gracefully in environments where the Dreamware demo tenant has not been seeded
  -- (e.g. CI integration harness) to avoid FK violations.
  EXISTS (
    SELECT 1 FROM platform.tenants
    WHERE id = '00000000-0000-0000-0000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM platform.communication_sender_identities
    WHERE scope = 'TENANT'
      AND tenant_id = '00000000-0000-0000-0000-000000000001'
      AND channel = 'email'
      AND is_default = true
      AND status = 'ACTIVE'
  );

COMMIT;
