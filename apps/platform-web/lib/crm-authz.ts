/**
 * CRM-facing view of the governed-write authorization primitive. CRM writes
 * require a governing role exactly as any other governed work does, so this is
 * the governance primitive under a name that reads naturally at the CRM call
 * sites. The generic governance endpoints and the shared vertical factory use
 * `hasGovernanceWriteRole` from `governance-authz` directly.
 */
export { hasGovernanceWriteRole as hasCrmWriteRole, resolveGoverningRole } from './governance-authz';
