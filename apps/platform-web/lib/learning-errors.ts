import { LearningValidationError } from '@expadio/learning';

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
  if (error instanceof LearningValidationError) {
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
    default:
      return null;
  }
}
