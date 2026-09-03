import { notFound } from 'next/navigation';
import { CourseBlockEditor } from '../../../../../components/CourseBlockEditor';
import { CourseAssetEditor } from '../../../../../components/CourseAssetEditor';
import { CourseActions } from '../../../../../components/CourseActions';
import { hasLearningAdmin, resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';
import { loadCourseDetail } from '../../../../../lib/learning-data';
import styles from '../../../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await resolveBrandContext();
  const { id } = await params;
  const value = await withBrandTransaction(context, async (client) => ({
    course: await loadCourseDetail(client, context.tenantId, id),
    admin: await hasLearningAdmin(client, context.subjectId),
  }));
  if (!value.course) notFound();
  const { summary, version } = value.course;

  return (
    <>
      <section className={styles.pageHead}>
        <div><p className={styles.eyebrow}>Learning · Course</p><h1>{version.title}</h1><p>{version.summary || summary.courseKey} · version {version.version} · {version.state}</p></div>
        <CourseActions courseId={summary.courseId} version={version.version} canPublish={value.admin && (version.state === 'DRAFT' || version.state === 'IN_REVIEW')} />
      </section>
      <section className={styles.grid}>
        <article className={styles.metric}><div className={styles.metricLabel}>Version</div><div className={styles.metricValue}>{version.version}</div><div className={styles.metricDetail}>{version.state}</div></article>
        <article className={styles.metric}><div className={styles.metricLabel}>Modules</div><div className={styles.metricValue}>{version.modules.length}</div><div className={styles.metricDetail}>Structured learning blocks</div></article>
        <article className={styles.metric}><div className={styles.metricLabel}>Lessons</div><div className={styles.metricValue}>{version.modules.reduce((sum, module) => sum + module.lessons.length, 0)}</div><div className={styles.metricDetail}>Activities in this version</div></article>
        <article className={styles.metric}><div className={styles.metricLabel}>Visibility</div><div className={styles.metricValue} style={{ fontSize: 18 }}>{version.visibility}</div><div className={styles.metricDetail}>{version.language}</div></article>
      </section>
      {value.admin ? <section className={styles.panel}><div className={styles.panelHead}><div><h2>Lesson block editor</h2><p>Compose validated, ordered lesson content with autosaved drafts.</p></div></div><div className={styles.panelBody}><CourseBlockEditor courseId={summary.courseId} version={version} /></div></section> : null}
      {value.admin ? <section className={styles.panel}><div className={styles.panelHead}><div><h2>Lesson assets</h2><p>Upload, scan, preview and attach an approved asset to this draft.</p></div></div><div className={styles.panelBody}><CourseAssetEditor courseId={summary.courseId} version={version} /></div></section> : null}
      <section className={styles.panel}><div className={styles.panelHead}><h2>Learning objectives</h2></div><div className={styles.panelBody}>{version.learningObjectives.length === 0 ? 'No objectives.' : <ul>{version.learningObjectives.map((objective) => <li key={objective}>{objective}</li>)}</ul>}</div></section>
      <section className={styles.panel}><div className={styles.panelHead}><h2>Course structure</h2></div><div className={styles.panelBody}><div className={styles.courseModules}>{version.modules.map((module) => <article key={module.courseModuleId} className={styles.moduleCard}><strong>{module.position}. {module.title}</strong>{module.lessons.map((lesson) => <div key={lesson.lessonId} className={styles.lesson}><div><strong>{lesson.title}</strong> · {lesson.activityType}</div><div className={styles.muted}>{lesson.estimatedMinutes ? `${lesson.estimatedMinutes} min` : 'Flexible duration'}{lesson.required ? ' · Required' : ' · Optional'}</div></div>)}</article>)}</div></div></section>
    </>
  );
}
