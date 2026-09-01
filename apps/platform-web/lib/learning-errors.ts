import { LearningAssessmentValidationError, LearningAssignmentValidationError, LearningAutomationValidationError, LearningCompetencyValidationError, LearningProgramValidationError, LearningValidationError } from '@expadio/learning';

export interface LearningApiError {
  readonly status: number;
  readonly body: {
    readonly denied?: true;
    readonly reasonKey: string;
    readonly message: string;
    readonly field?: string;
  };
}

export function learningApiError(error: unknown): LearningApiError | null {
  if (
    error instanceof LearningValidationError
    || error instanceof LearningAssessmentValidationError
    || error instanceof LearningProgramValidationError
    || error instanceof LearningCompetencyValidationError
    || error instanceof LearningAssignmentValidationError
    || error instanceof LearningAutomationValidationError
  ) {
    return {
      status: 400,
      body: {
        reasonKey: error.code,
        message: error.message,
        field: error.field,
      },
    };
  }

  if (!(error instanceof Error)) return null;

  const validationErrors = new Set([
    'LEARNING_LEARNER_INVALID',
    'LEARNING_LEARNER_IDENTITY_REQUIRED',
    'LEARNING_SUBJECT_ID_REQUIRED',
    'LEARNING_SUBJECT_ID_TOO_LONG',
    'LEARNING_CONTACT_ID_INVALID',
    'LEARNING_EXTERNAL_REF_REQUIRED',
    'LEARNING_EXTERNAL_REF_TOO_LONG',
    'LEARNING_FULL_NAME_REQUIRED',
    'LEARNING_FULL_NAME_TOO_LONG',
    'LEARNING_EMAIL_INVALID',
    'LEARNING_EMAIL_TOO_LONG',
    'LEARNING_AUDIENCE_TYPE_INVALID',
    'LEARNING_METADATA_INVALID',
    'LEARNING_ENROLLMENT_INVALID',
    'LEARNING_ASSIGNMENT_KEY_REQUIRED',
    'LEARNING_ASSIGNMENT_KEY_TOO_LONG',
    'LEARNING_ASSIGNMENT_KEY_INVALID',
    'LEARNING_LEARNER_ID_INVALID',
    'LEARNING_COURSE_ID_INVALID',
    'LEARNING_ENROLLMENT_SOURCE_INVALID',
    'LEARNING_SOURCE_REF_TOO_LONG',
    'LEARNING_DUE_AT_INVALID',
    'LEARNING_PROGRAM_KEY_REQUIRED',
    'LEARNING_PROGRAM_KEY_INVALID',
    'LEARNING_PROGRAM_ID_INVALID',
    'LEARNING_PROGRAM_ENROLLMENT_ID_INVALID',
    'LEARNING_CERTIFICATION_KEY_REQUIRED',
    'LEARNING_CERTIFICATION_KEY_INVALID',
    'LEARNING_CERTIFICATION_ID_INVALID',
    'LEARNING_CREDENTIAL_ID_INVALID',
    'LEARNING_PROGRAM_ASSIGNMENT_KEY_INVALID',
    'LEARNING_PROGRAM_SOURCE_TYPE_INVALID',
    'LEARNING_CREDENTIAL_REVOCATION_REASON_INVALID',
    'LEARNING_COMPETENCY_FRAMEWORK_KEY_REQUIRED',
    'LEARNING_COMPETENCY_FRAMEWORK_KEY_INVALID',
    'LEARNING_COMPETENCY_FRAMEWORK_ID_INVALID',
    'LEARNING_LEARNER_ID_INVALID',
    'LEARNING_ASSIGNMENT_RULE_KEY_REQUIRED',
    'LEARNING_ASSIGNMENT_RULE_KEY_INVALID',
    'LEARNING_ASSIGNMENT_RULE_ID_INVALID',
    'LEARNING_TRIGGER_EVENT_ID_INVALID',
    'LEARNING_AUTOMATION_RULE_REVISION_INVALID',
    'LEARNING_AI_REQUEST_TYPE_INVALID',
    'LEARNING_AI_PROMPT_REQUIRED',
    'LEARNING_AI_PROMPT_TOO_LONG',
    'LEARNING_AI_IDEMPOTENCY_KEY_INVALID',
    'LEARNING_AI_SETTINGS_INVALID',
  ]);
  if (validationErrors.has(error.message)) {
    return {
      status: 400,
      body: {
        reasonKey: error.message,
        message: 'The Learning request is invalid.',
      },
    };
  }

  switch (error.message) {
    case 'MODULE_LOCKED_BY_PLAN':
      return {
        status: 403,
        body: {
          denied: true,
          reasonKey: 'MODULE_LOCKED_BY_PLAN',
          message: 'Learning is not available under the current tenant entitlement.',
        },
      };
    case 'LEARNING_AI_FEATURES_DISABLED':
      return {
        status: 403,
        body: {
          denied: true,
          reasonKey: error.message,
          message: 'Learning AI features are disabled for this tenant.',
        },
      };
    case 'LEARNING_AI_ARTIFACT_STORAGE_UNAVAILABLE':
    case 'LEARNING_AI_ARTIFACT_READER_IDENTITY_DISABLED':
      return {
        status: 503,
        body: {
          denied: true,
          reasonKey: error.message,
          message: 'Learning AI result storage is temporarily unavailable.',
        },
      };
    case 'LEARNING_AI_LEARNER_ACCESS_DENIED':
    case 'LEARNING_AI_REQUEST_ACCESS_DENIED':
      return {
        status: 403,
        body: {
          denied: true,
          reasonKey: error.message,
          message: 'You do not have access to this Learning AI request.',
        },
      };
    case 'MODULE_NOT_ACTIVE':
      return {
        status: 404,
        body: {
          denied: true,
          reasonKey: 'MODULE_NOT_ACTIVE',
          message: 'Learning has not been activated for this tenant.',
        },
      };
    case 'LEARNING_COURSE_KEY_EXISTS':
      return {
        status: 409,
        body: {
          reasonKey: 'LEARNING_COURSE_KEY_EXISTS',
          message: 'A course with this key already exists.',
        },
      };
    case 'LEARNING_COURSE_NOT_FOUND':
    case 'LEARNING_COURSE_VERSION_NOT_FOUND':
      return {
        status: 404,
        body: {
          reasonKey: error.message,
          message: 'The requested course or version was not found.',
        },
      };
    case 'LEARNING_COURSE_VERSION_IMMUTABLE':
      return {
        status: 409,
        body: {
          reasonKey: error.message,
          message: 'Published or review course content cannot be edited. Create or return to a draft version.',
        },
      };
    case 'LEARNING_COURSE_DRAFT_ALREADY_EXISTS':
      return {
        status: 409,
        body: {
          reasonKey: error.message,
          message: 'This course already has an editable draft or review version.',
        },
      };
    case 'LEARNING_COURSE_HAS_NO_PUBLISHED_VERSION':
      return {
        status: 409,
        body: {
          reasonKey: error.message,
          message: 'Publish the initial course version before creating a new version.',
        },
      };
    case 'LEARNING_COURSE_VERSION_NOT_PUBLISHABLE':
    case 'LEARNING_COURSE_ARCHIVED':
      return {
        status: 409,
        body: {
          reasonKey: error.message,
          message: 'The course version cannot be published from its current state.',
        },
      };
    case 'LEARNING_LEARNER_NOT_FOUND':
    case 'LEARNING_LEARNER_CONTACT_NOT_FOUND':
    case 'LEARNING_ENROLLMENT_NOT_FOUND':
    case 'LEARNING_LESSON_NOT_IN_ENROLLMENT':
    case 'LEARNING_QUESTION_BANK_NOT_FOUND':
    case 'LEARNING_QUESTION_NOT_FOUND':
    case 'LEARNING_QUESTION_VERSION_NOT_FOUND':
    case 'LEARNING_ASSESSMENT_NOT_FOUND':
    case 'LEARNING_ASSESSMENT_VERSION_NOT_FOUND':
    case 'LEARNING_ASSESSMENT_ATTEMPT_NOT_FOUND':
    case 'LEARNING_PROGRAM_NOT_FOUND':
    case 'LEARNING_PROGRAM_VERSION_NOT_FOUND':
    case 'LEARNING_PROGRAM_ENROLLMENT_NOT_FOUND':
    case 'LEARNING_CERTIFICATION_NOT_FOUND':
    case 'LEARNING_CERTIFICATION_VERSION_NOT_FOUND':
    case 'LEARNING_CREDENTIAL_NOT_FOUND':
    case 'LEARNING_COMPETENCY_FRAMEWORK_NOT_FOUND':
    case 'LEARNING_COMPETENCY_FRAMEWORK_VERSION_NOT_FOUND':
    case 'LEARNING_ASSIGNMENT_RULE_NOT_FOUND':
    case 'LEARNING_ASSIGNMENT_RULE_VERSION_NOT_FOUND':
    case 'LEARNING_ASSIGNMENT_RULE_COURSE_NOT_FOUND':
    case 'LEARNING_ASSIGNMENT_RULE_PROGRAM_NOT_FOUND':
    case 'LEARNING_AUTOMATION_RULE_NOT_FOUND':
    case 'LEARNING_AI_COURSE_NOT_FOUND':
    case 'LEARNING_AI_REQUEST_NOT_FOUND':
    case 'LEARNING_AI_JOB_NOT_FOUND':
    case 'LEARNING_AI_OUTPUT_PROVENANCE_NOT_FOUND':
    case 'LEARNING_SETTINGS_NOT_FOUND':
      return {
        status: 404,
        body: {
          reasonKey: error.message,
          message: 'The requested Learning resource was not found.',
        },
      };
    case 'LEARNING_LEARNER_IDENTITY_EXISTS':
    case 'LEARNING_SUBJECT_MEMBERSHIP_NOT_FOUND':
    case 'LEARNING_SUBJECT_ISSUER_AMBIGUOUS':
    case 'LEARNING_LEARNER_NOT_ACTIVE':
    case 'LEARNING_ASSIGNMENT_KEY_CONFLICT':
    case 'LEARNING_COURSE_NOT_PUBLISHED':
    case 'LEARNING_ENROLLMENT_NOT_PROGRESSABLE':
    case 'LEARNING_QUESTION_BANK_KEY_EXISTS':
    case 'LEARNING_QUESTION_KEY_EXISTS':
    case 'LEARNING_QUESTION_VERSION_NOT_PUBLISHABLE':
    case 'LEARNING_ASSESSMENT_KEY_EXISTS':
    case 'LEARNING_ASSESSMENT_VERSION_NOT_PUBLISHABLE':
    case 'LEARNING_ASSESSMENT_ITEMS_REQUIRED':
    case 'LEARNING_ASSESSMENT_QUESTION_NOT_FOUND':
    case 'LEARNING_ASSESSMENT_QUESTION_NOT_PUBLISHED':
    case 'LEARNING_ASSESSMENT_COURSE_VERSION_NOT_AVAILABLE':
    case 'LEARNING_ASSESSMENT_ATTEMPT_KEY_CONFLICT':
    case 'LEARNING_ASSESSMENT_ATTEMPT_LIMIT_REACHED':
    case 'LEARNING_ASSESSMENT_NOT_ASSIGNED':
    case 'LEARNING_ASSESSMENT_ENROLLMENT_MISMATCH':
    case 'LEARNING_ASSESSMENT_ATTEMPT_NOT_SUBMITTABLE':
    case 'LEARNING_ASSESSMENT_ATTEMPT_EXPIRED':
    case 'LEARNING_ASSESSMENT_ITEMS_MISSING':
    case 'LEARNING_PROGRAM_KEY_EXISTS':
    case 'LEARNING_PROGRAM_VERSION_NOT_PUBLISHABLE':
    case 'LEARNING_PROGRAM_COURSE_VERSION_NOT_FOUND':
    case 'LEARNING_PROGRAM_COURSE_VERSION_NOT_PUBLISHED':
    case 'LEARNING_PROGRAM_ASSESSMENT_VERSION_NOT_FOUND':
    case 'LEARNING_PROGRAM_ASSESSMENT_VERSION_NOT_PUBLISHED':
    case 'LEARNING_PROGRAM_ASSIGNMENT_KEY_CONFLICT':
    case 'LEARNING_PROGRAM_NOT_PUBLISHED':
    case 'LEARNING_PROGRAM_ENROLLMENT_CANCELLED':
    case 'LEARNING_PROGRAM_REQUIRED_ITEMS_MISSING':
    case 'LEARNING_CERTIFICATION_KEY_EXISTS':
    case 'LEARNING_CERTIFICATION_PROGRAM_VERSION_NOT_PUBLISHED':
    case 'LEARNING_CERTIFICATION_VERSION_NOT_PUBLISHABLE':
    case 'LEARNING_CREDENTIAL_REVOCATION_REASON_INVALID':
    case 'LEARNING_COMPETENCY_FRAMEWORK_KEY_EXISTS':
    case 'LEARNING_COMPETENCY_FRAMEWORK_VERSION_NOT_PUBLISHABLE':
    case 'LEARNING_COMPETENCY_COURSE_VERSION_NOT_PUBLISHED':
    case 'LEARNING_COMPETENCY_ASSESSMENT_VERSION_NOT_PUBLISHED':
    case 'LEARNING_COMPETENCY_PROGRAM_VERSION_NOT_PUBLISHED':
    case 'LEARNING_COMPETENCY_CERTIFICATION_VERSION_NOT_PUBLISHED':
    case 'LEARNING_ASSIGNMENT_RULE_KEY_EXISTS':
    case 'LEARNING_ASSIGNMENT_RULE_VERSION_NOT_PUBLISHABLE':
    case 'LEARNING_ASSIGNMENT_RULE_TARGET_NOT_PUBLISHED':
    case 'LEARNING_AUTOMATION_RULE_KEY_EXISTS':
    case 'LEARNING_AUTOMATION_RULE_REVISION_CONFLICT':
    case 'LEARNING_AI_IDEMPOTENCY_CONFLICT':
    case 'LEARNING_AI_REQUEST_LINK_MISSING':
      return {
        status: 409,
        body: {
          reasonKey: error.message,
          message: 'The Learning request conflicts with the current resource state.',
        },
      };
    default:
      return null;
  }
}


const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireLearningUuid(value: string, field: string): string {
  const normalized = value.trim();
  if (!UUID.test(normalized)) {
    throw new LearningValidationError(field, 'INVALID_IDENTIFIER', `${field} must be a valid identifier.`);
  }
  return normalized;
}

export function requireLearningVersion(value: string): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version <= 0) {
    throw new LearningValidationError('version', 'INVALID_VERSION', 'version must be a positive integer.');
  }
  return version;
}
