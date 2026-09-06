import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  createLearningCourse,
  publishLearningCourseVersion,
} from '@expadio/postgres-runtime/learning';
import { hasLearningAdmin, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

type WizardLesson = {
  id?: unknown;
  title?: unknown;
  contentType?: unknown;
  durationMinutes?: unknown;
  contentUrl?: unknown;
  bodyText?: unknown;
};

type WizardModule = {
  id?: unknown;
  title?: unknown;
  lessons?: unknown;
};

const ACTIVITY_TYPES: Readonly<Record<string, string>> = {
  article: 'TEXT',
  video: 'VIDEO',
  document: 'DOCUMENT',
  quiz: 'QUIZ',
  interactive: 'INTERACTIVE',
  link: 'EXTERNAL',
};

const ENROLLMENT_MODES: Readonly<Record<string, string>> = {
  open: 'OPEN',
  assigned: 'ASSIGNED_ONLY',
  approval: 'APPROVAL_REQUIRED',
};

function stableKey(value: unknown, fallback: string): string {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    : '';
  return normalized || fallback;
}

function languageTag(value: unknown): string {
  if (typeof value !== 'string') return 'en';
  const known: Readonly<Record<string, string>> = {
    English: 'en',
    Spanish: 'es',
    French: 'fr',
    German: 'de',
    Japanese: 'ja',
  };
  return known[value] ?? value;
}

function enrollmentMode(value: unknown): string {
  return typeof value === 'string' ? ENROLLMENT_MODES[value] ?? 'ASSIGNED_ONLY' : 'ASSIGNED_ONLY';
}

function contentFor(lesson: WizardLesson): Readonly<Record<string, unknown>> {
  const bodyText = typeof lesson.bodyText === 'string' ? lesson.bodyText.trim() : '';
  const contentUrl = typeof lesson.contentUrl === 'string' ? lesson.contentUrl.trim() : '';
  const type = typeof lesson.contentType === 'string' ? lesson.contentType : 'article';
  if (type === 'article') return { text: bodyText };
  if (type === 'video') return { url: contentUrl, caption: bodyText };
  if (type === 'document') return { url: contentUrl, description: bodyText };
  if (type === 'link') return { url: contentUrl, description: bodyText };
  return bodyText === '' ? {} : { instructions: bodyText };
}

function nativeModules(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((rawModule, moduleIndex) => {
    const module = (rawModule ?? {}) as WizardModule;
    const lessons = Array.isArray(module.lessons) ? module.lessons : [];
    return {
      moduleKey: stableKey(module.id, `module-${moduleIndex + 1}`),
      title: typeof module.title === 'string' ? module.title : `Module ${moduleIndex + 1}`,
      position: moduleIndex + 1,
      lessons: lessons.map((rawLesson, lessonIndex) => {
        const lesson = (rawLesson ?? {}) as WizardLesson;
        const contentType = typeof lesson.contentType === 'string' ? lesson.contentType : 'article';
        return {
          lessonKey: stableKey(lesson.id, `lesson-${lessonIndex + 1}`),
          title: typeof lesson.title === 'string' ? lesson.title : `Lesson ${lessonIndex + 1}`,
          activityType: ACTIVITY_TYPES[contentType] ?? 'TEXT',
          position: lessonIndex + 1,
          required: true,
          estimatedMinutes: Number.isInteger(lesson.durationMinutes) ? Number(lesson.durationMinutes) : null,
          content: contentFor(lesson),
        };
      }),
    };
  });
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json() as Record<string, unknown>;
    const result = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const category = typeof body.category === 'string' ? body.category.trim() : '';
      const level = typeof body.level === 'string' ? body.level.trim() : '';
      const courseKey = body.courseKey ?? `${stableKey(title, 'course')}-${randomUUID().slice(0, 8)}`;
      const created = await createLearningCourse(client, {
        tenantId: context.tenantId,
        actorSubjectId: context.subjectId,
        correlationId: randomUUID(),
        courseKey,
        draft: {
          title,
          summary: [category, level].filter(Boolean).join(' · '),
          description,
          language: languageTag(body.language),
          visibility: body.visibility === 'PUBLISHED' ? 'PUBLIC' : body.visibility === 'ASSIGNED_ONLY' ? 'PRIVATE' : 'TENANT',
          enrollmentMode: enrollmentMode(body.enrollmentMode),
          certificateEnabled: body.certificateEnabled === true,
          passingScore: body.certificateEnabled === true ? body.passingScore : null,
          estimatedMinutes: body.estimatedDuration,
          learningObjectives: description === '' ? [] : [description],
          modules: nativeModules(body.modules),
        },
      });
      if (body.publish !== true) return { ...created, published: false };
      const published = await publishLearningCourseVersion(client, {
        tenantId: context.tenantId,
        courseId: created.courseId,
        version: created.version.version,
        actorSubjectId: context.subjectId,
        correlationId: randomUUID(),
      });
      return { ...created, version: published.version, published: true };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
