-- 0169_agent_approval_sod.sql
-- Separation of Duties for agent approval resolution: records who proposed a
-- staged action and who resolved it, and enforces that a resolved row always
-- names its approver. The proposer/approver-mismatch check itself lives in
-- application code (ChiefOfStaffOrchestrator.resolveApproval), since it needs
-- to run before the row transitions out of PENDING and produce a typed error.

BEGIN;

ALTER TABLE platform.agent_approval_requests
  ADD COLUMN IF NOT EXISTS proposer_subject_id text,
  ADD COLUMN IF NOT EXISTS approver_subject_id text,
  ADD COLUMN IF NOT EXISTS decision_reason text;

-- Backfill from the owning mission's initiating user for existing rows.
UPDATE platform.agent_approval_requests aar
SET proposer_subject_id = am.user_subject_id
FROM platform.agent_missions am
WHERE aar.mission_id = am.mission_id
  AND aar.proposer_subject_id IS NULL;

ALTER TABLE platform.agent_approval_requests
  ALTER COLUMN proposer_subject_id SET NOT NULL;

ALTER TABLE platform.agent_approval_requests
  ADD CONSTRAINT agent_approval_requests_resolution_identity_check
  CHECK (
    (status = 'PENDING' AND approver_subject_id IS NULL)
    OR (status IN ('APPROVED', 'REJECTED') AND approver_subject_id IS NOT NULL)
  );

COMMIT;
