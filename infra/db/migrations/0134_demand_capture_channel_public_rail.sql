BEGIN;

-- Demand Capture: channel provenance + the PUBLIC trust rail.
--
-- Sources gain two orthogonal dimensions on top of the existing signed ingress.
--
--   channel      Where a prospect reached us: a web form, an inbound
--                SMS/WhatsApp/email/social message, a bulk import, or manual
--                staff entry. This is provenance metadata ONLY; like
--                capture_layer_id it never contributes to authorization.
--
--   trust_rail   Which ingestion path a source uses:
--                  SIGNED  the sender is authenticated cryptographically —
--                          Ed25519 server ingress (migration 0126) or a
--                          verified provider webhook. Enters the pipeline
--                          directly.
--                  PUBLIC  the client runs in an untrusted browser and holds
--                          no secret. Admitted by a publishable key + origin
--                          allowlist and then the OTP gate (built with the
--                          Rail B endpoint in a later migration). Never signs.
--
-- Organization scope is unchanged: it is still derived from the source row and
-- enforced by the existing organization-isolation RLS. This migration adds no
-- new ingress policy — the PUBLIC ingress path and its RLS land with the
-- Rail B endpoint, so no unauthenticated read surface is opened here.

ALTER TABLE platform.lead_capture_sources
  ADD COLUMN channel text NOT NULL DEFAULT 'WEB'
    CHECK (channel IN ('WEB','EMAIL','SMS','WHATSAPP','SOCIAL','IMPORT','MANUAL','API')),
  ADD COLUMN trust_rail text NOT NULL DEFAULT 'SIGNED'
    CHECK (trust_rail IN ('SIGNED','PUBLIC')),
  ADD COLUMN publishable_key text,
  ADD COLUMN allowed_origins text[] NOT NULL DEFAULT '{}'::text[];

-- Classify existing signed API sources by their surface. Everything else keeps
-- the WEB default and can be reclassified by a governed operator later; channel
-- is descriptive, so a wrong default is a labelling fix, never a scope change.
UPDATE platform.lead_capture_sources SET channel = 'API' WHERE surface = 'API';

-- A publishable key is a PUBLIC identifier (like a browser client id), not a
-- credential: it authorizes nothing on its own and is always paired with an
-- origin allowlist and the OTP gate. The format keeps it recognizable and
-- greppable in logs and page source without implying confidentiality.
ALTER TABLE platform.lead_capture_sources
  ADD CONSTRAINT lead_capture_sources_publishable_key_format CHECK (
    publishable_key IS NULL OR publishable_key ~ '^cpk_[A-Za-z0-9]{32,64}$'
  );

CREATE UNIQUE INDEX lead_capture_sources_publishable_key_uq
  ON platform.lead_capture_sources (publishable_key)
  WHERE publishable_key IS NOT NULL;

-- Origins are bounded and non-empty. The management API normalizes each entry
-- to a bare scheme://host[:port] origin (no path, no trailing slash) before it
-- is stored; this constraint is the backstop, not the parser.
ALTER TABLE platform.lead_capture_sources
  ADD CONSTRAINT lead_capture_sources_allowed_origins_bounded CHECK (
    (array_length(allowed_origins, 1) IS NULL OR array_length(allowed_origins, 1) <= 20)
    AND NOT ('' = ANY(allowed_origins))
  );

-- Rail consistency. A SIGNED source authenticates the sender and carries no
-- browser credentials; a PUBLIC source cannot sign, so it MUST present a
-- publishable key and at least one allowed origin (and must not require a signed
-- ticket it can never produce). NOT VALID leaves pre-existing rows — all of
-- which are signed — untouched, while enforcing the invariant on every write.
ALTER TABLE platform.lead_capture_sources
  ADD CONSTRAINT lead_capture_sources_rail_consistent CHECK (
    (
      trust_rail = 'SIGNED'
      AND require_signed_ticket = true
      AND publishable_key IS NULL
      AND allowed_origins = '{}'::text[]
    )
    OR (
      trust_rail = 'PUBLIC'
      AND require_signed_ticket = false
      AND publishable_key IS NOT NULL
      AND array_length(allowed_origins, 1) >= 1
    )
  ) NOT VALID;

CREATE INDEX lead_capture_sources_channel_rail_idx
  ON platform.lead_capture_sources (tenant_id, organization_id, trust_rail, channel);

COMMENT ON COLUMN platform.lead_capture_sources.channel IS
  'Prospect channel provenance (WEB/EMAIL/SMS/WHATSAPP/SOCIAL/IMPORT/MANUAL/API). Descriptive only; never an authorization input.';
COMMENT ON COLUMN platform.lead_capture_sources.trust_rail IS
  'Ingestion path: SIGNED (Ed25519 server ingress or verified provider webhook) or PUBLIC (publishable key + origin allowlist + OTP gate).';
COMMENT ON COLUMN platform.lead_capture_sources.publishable_key IS
  'Public, non-secret browser client identifier for PUBLIC sources. Authorizes nothing on its own; always paired with an origin allowlist and OTP.';
COMMENT ON COLUMN platform.lead_capture_sources.allowed_origins IS
  'Normalized scheme://host[:port] origins permitted to submit against a PUBLIC source.';

COMMIT;
