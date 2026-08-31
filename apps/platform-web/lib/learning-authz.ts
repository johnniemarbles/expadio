/**
 * LMS-01 authoring is an administrative tenant surface.
 * Learner-facing read permissions are intentionally separate and arrive with
 * enrollment/progress. For now, reuse the governed tenant-admin primitive.
 */
export {
  hasGovernanceWriteRole as hasLearningAuthoringRole,
  resolveGoverningRole as resolveLearningAuthoringRole,
} from './governance-authz';
