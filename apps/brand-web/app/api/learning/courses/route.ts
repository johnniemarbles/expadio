import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createLearningCourse } from '@expadio/postgres-runtime/learning';
import { hasLearningAdmin, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json() as Record<string, unknown>;
    const result = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      const title = typeof body.title === 'string' ? body.title : '';
      const objective = typeof body.objective === 'string' ? body.objective : '';
      const lessonTitle = typeof body.lessonTitle === 'string' ? body.lessonTitle : 'Introduction';
      const lessonBody = typeof body.lessonBody === 'string' ? body.lessonBody : '';
      return createLearningCourse(client, {
        tenantId: context.tenantId,
        actorSubjectId: context.subjectId,
        correlationId: randomUUID(),
        courseKey: body.courseKey,
        draft: {
          title,
          summary: typeof body.summary === 'string' ? body.summary : '',
          description: '',
          language: 'en',
          visibility: 'TENANT',
          learningObjectives: [objective],
          modules: [{
            moduleKey: 'module-1',
            title: 'Course content',
            position: 1,
            lessons: [{
              lessonKey: 'lesson-1',
              title: lessonTitle,
              activityType: 'TEXT',
              position: 1,
              required: true,
              content: { text: lessonBody },
            }],
          }],
        },
      });
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
