import { notFound } from 'next/navigation';
import { loadLearningCourseVersion } from '@expadio/postgres-runtime/learning';
import { listMyAvailableAssessments } from '@expadio/postgres-runtime/learning-assessment';
import { listMyLearningEnrollments } from '@expadio/postgres-runtime/learning-enrollment';
import { CompleteLessonButton } from '../../../../components/ResumeLessonButton';
import { LearnerAssessmentRunner } from '../../../../components/LearnerAssessmentRunner';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import styles from '../../workspace.module.css';

export const dynamic = 'force-dynamic';

function blocks(content: Readonly<Record<string, unknown>>): readonly Record<string, unknown>[] {
  return content.schemaVersion === 1 && Array.isArray(content.blocks)
    ? content.blocks as readonly Record<string, unknown>[]
    : [];
}

function renderContent(content: Readonly<Record<string, unknown>>) {
  const items = blocks(content);
  if (items.length === 0) {
    const legacy = content.text;
    return typeof legacy === 'string'
      ? <div className={styles.lessonContent}>{legacy}</div>
      : <div className={styles.lessonContent}>No learner content is available for this lesson.</div>;
  }
  return <div className={styles.lessonContent}>{items.map((block) => {
    const id = String(block.id);
    const type = String(block.type);
    const data = block.data && typeof block.data === 'object' ? block.data as Record<string, unknown> : {};
    const text = String(data.text ?? '');
    if (type === 'HEADING') return <h3 id={`lesson-block-${id}`} key={id}>{text}</h3>;
    if (type === 'CALLOUT') return <aside id={`lesson-block-${id}`} key={id}>{text}</aside>;
    if (type === 'RICH_TEXT') return <p id={`lesson-block-${id}`} key={id}>{text}</p>;
    if (type === 'CODE') return <pre id={`lesson-block-${id}`} key={id}><code>{String(data.code ?? '')}</code></pre>;
    if (type === 'DISCUSSION_PROMPT') return <section id={`lesson-block-${id}`} key={id}><strong>Discuss</strong><p>{String(data.prompt ?? '')}</p></section>;
    return <section id={`lesson-block-${id}`} key={id}><strong>{String(data.title ?? type)}</strong><p>Protected {type.toLowerCase()} content.</p></section>;
  })}</div>;
}

export default async function LearnerCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const context = await resolveBrandContext();
  const { id } = await params;
  const value = await withBrandTransaction(context, async (client) => {
    const home = await listMyLearningEnrollments(client, {
      tenantId: context.tenantId,
      subjectId: context.subjectId,
      subjectIssuer: context.issuer,
    });
    const enrollment = home.enrollments.find((entry) => entry.enrollmentId === id);
    if (!enrollment) return null;

    const [course, assessments] = await Promise.all([
      loadLearningCourseVersion(client, {
        tenantId: context.tenantId,
        courseId: enrollment.courseId,
        version: enrollment.courseVersion,
      }),
      listMyAvailableAssessments(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer,
      }),
    ]);

    return {
      enrollment,
      course,
      assessments: assessments.filter((assessment) => assessment.enrollmentId === enrollment.enrollmentId),
    };
  });
  if (!value) notFound();

  const progress = new Map(value.enrollment.lessons.map((lesson) => [lesson.lessonId, lesson]));
  const requiredLessons = value.enrollment.lessons.filter((lesson) => lesson.required);
  const requiredCompleted = requiredLessons.filter((lesson) => lesson.progressStatus === 'COMPLETED').length;

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>My learning · Course</p>
          <h1>{value.course.title}</h1>
          <p>{value.course.summary} · version {value.course.version}</p>
        </div>
        <span className={styles.pill}>{value.enrollment.completionPercent}% complete</span>
      </section>

      <section className={styles.grid}>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Required lessons</div>
          <div className={styles.metricValue}>{requiredCompleted}/{requiredLessons.length}</div>
          <div className={styles.metricDetail}>Required content completed</div>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Assessments</div>
          <div className={styles.metricValue}>{value.assessments.filter((assessment) => assessment.passed).length}/{value.assessments.length}</div>
          <div className={styles.metricDetail}>Published course assessments passed</div>
        </article>
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Course status</div>
          <div className={styles.metricValue}>{value.enrollment.status}</div>
          <div className={styles.metricDetail}>{value.enrollment.dueAt ? `Due ${new Date(value.enrollment.dueAt).toLocaleDateString()}` : 'No due date'}</div>
        </article>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Course content</h2></div>
        <div className={styles.panelBody}>
          <div className={styles.courseModules}>
            {value.course.modules.map((module) => (
              <article className={styles.moduleCard} key={module.courseModuleId}>
                <h3>{module.position}. {module.title}</h3>
                {module.lessons.map((lesson) => {
                  const state = progress.get(lesson.lessonId);
                  const complete = state?.progressStatus === 'COMPLETED';
                  const unlocked = state?.unlocked !== false;
                  const lessonBlocks = blocks(lesson.content);
                  const resumeBlock = lessonBlocks.find((block) => block.id === state?.resumeBlockId) ?? lessonBlocks[0];
                  return (
                    <div className={styles.learnerLesson} key={lesson.lessonId}>
                      <div className={styles.lessonHeader}>
                        <div>
                          <strong>{lesson.title}</strong>
                          <div className={styles.muted}>{lesson.activityType}{lesson.required ? ' · Required' : ' · Optional'}</div>
                        </div>
                        <span className={complete ? styles.done : styles.pending}>{complete ? 'Completed' : unlocked ? 'Available' : 'Locked'}</span>
                      </div>
                      {unlocked ? renderContent(lesson.content) : <div className={styles.lessonContent}>Complete the earlier required lesson to unlock this content.</div>}
                      {unlocked && !complete && resumeBlock ? <ResumeLessonButton enrollmentId={value.enrollment.enrollmentId} lessonId={lesson.lessonId} blockId={String(resumeBlock.id)} position={Number(resumeBlock.position)} label={state?.resumeBlockId ? 'Continue lesson' : 'Start lesson'} /> : null}
                      {unlocked && !complete && (value.enrollment.status === 'ASSIGNED' || value.enrollment.status === 'IN_PROGRESS') ? (
                        <CompleteLessonButton enrollmentId={value.enrollment.enrollmentId} lessonId={lesson.lessonId} />
                      ) : null}
                    </div>
                  );
                })}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>Assessments</h2>
          <span>{value.assessments.length}</span>
        </div>
        <div className={styles.panelBody}>
          <LearnerAssessmentRunner assessments={value.assessments} />
        </div>
      </section>
    </>
  );
}
