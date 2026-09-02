import { notFound } from 'next/navigation';
import { listLearningCourses, loadLearningCourseVersion } from '@expadio/postgres-runtime/learning';
import {
  listLearningPublishedQuestions,
  listLearningQuestionBanks,
} from '@expadio/postgres-runtime/learning-assessment';
import { listLearningPrograms } from '@expadio/postgres-runtime/learning-program-certification';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { LearningSectionAdminPanel } from '../../../../components/LearningSectionAdminPanel';
import {
  hasLearningAdmin,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../lib/brand-context';
import { loadLearningReport, loadLearningSection } from '../../../../lib/learning-data';
import styles from '../../workspace.module.css';

const META: Record<string, { title: string; description: string }> = {
  learners: { title: 'Learners', description: 'People, audiences, enrollment load and progress.' },
  assessments: { title: 'Assessments', description: 'Versioned assessment definitions and publication state.' },
  programs: { title: 'Programs & credentials', description: 'Structured programs, certifications and durable credentials.' },
  skills: { title: 'Skills', description: 'Competency frameworks, evidence rules and learner achievements.' },
  assignments: { title: 'Assignments', description: 'Governed assignment rules and automated learning allocation.' },
  reports: { title: 'Reports', description: 'Operational learning data without a second analytics truth store.' },
};

const MANAGED = new Set(['assessments', 'programs', 'skills', 'assignments']);

function table(rows: readonly Record<string, unknown>[]) {
  if (rows.length === 0) return <div className={styles.empty}>No records yet.</div>;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 8);
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.key ?? index)}>{columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? '—' : String(row[column])}</td>)}</tr>)}</tbody></table></div>;
}

export default async function LearningSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const meta = META[section];
  if (!meta) notFound();
  const context = await resolveBrandContext();
  const data = await withBrandTransaction(context, async (client) => {
    const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'learning' });
    if (module?.availability !== 'ACTIVE') {
      return {
        module,
        admin: false,
        rows: [] as readonly Record<string, unknown>[],
        courseTargets: [] as readonly { id: string; label: string }[],
        programTargets: [] as readonly { id: string; label: string }[],
        assessmentCourseTargets: [] as readonly { id: string; label: string }[],
        questionBanks: [] as readonly { id: string; label: string }[],
        publishedQuestions: [] as readonly { id: string; label: string; type: string }[],
      };
    }

    const [rows, admin] = await Promise.all([
      section === 'reports'
        ? loadLearningReport(client, context.tenantId)
        : loadLearningSection(client, context.tenantId, section),
      hasLearningAdmin(client, context.subjectId),
    ]);

    if (!admin || !MANAGED.has(section)) {
      return {
        module,
        admin,
        rows,
        courseTargets: [] as readonly { id: string; label: string }[],
        programTargets: [] as readonly { id: string; label: string }[],
        assessmentCourseTargets: [] as readonly { id: string; label: string }[],
        questionBanks: [] as readonly { id: string; label: string }[],
        publishedQuestions: [] as readonly { id: string; label: string; type: string }[],
      };
    }

    const [courses, programs, questionBanks, publishedQuestions] = await Promise.all([
      listLearningCourses(client, context.tenantId),
      listLearningPrograms(client, context.tenantId),
      section === 'assessments' ? listLearningQuestionBanks(client, context.tenantId) : Promise.resolve([]),
      section === 'assessments' ? listLearningPublishedQuestions(client, context.tenantId) : Promise.resolve([]),
    ]);

    const publishedCourses = courses.filter(
      (course) => course.status === 'ACTIVE' && course.currentPublishedVersion !== null,
    );
    const assessmentVersions = section === 'assessments'
      ? await Promise.all(publishedCourses.map((course) =>
          loadLearningCourseVersion(client, {
            tenantId: context.tenantId,
            courseId: course.courseId,
            version: course.currentPublishedVersion!,
          }),
        ))
      : [];

    return {
      module,
      admin,
      rows,
      courseTargets: publishedCourses.map((course) => ({
          id: course.courseId,
          label: course.publishedTitle ?? course.draftTitle ?? course.courseKey,
        })),
      programTargets: programs
        .filter((program) => program.status === 'ACTIVE' && program.currentPublishedVersion !== null)
        .map((program) => ({
          id: program.programId,
          label: program.publishedTitle ?? program.programKey,
        })),
      assessmentCourseTargets: assessmentVersions.map((version) => ({
        id: version.courseVersionId,
        label: `${version.title} · v${version.version}`,
      })),
      questionBanks: questionBanks.map((bank) => ({
        id: bank.questionBankId,
        label: bank.name,
      })),
      publishedQuestions: publishedQuestions.map((question) => ({
        id: question.questionVersionId,
        label: `${question.bankName} · ${question.prompt}`,
        type: question.type,
      })),
    };
  });

  return (
    <>
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Learning</p>
          <h1>{meta.title}</h1>
          <p>{meta.description}</p>
        </div>
      </section>
      {data.module?.availability !== 'ACTIVE' ? (
        <div className={styles.notice}>Activate Learning before using this surface.</div>
      ) : (
        <>
          {data.admin && MANAGED.has(section) ? (
            <section className={styles.panel}>
              <div className={styles.panelHead}><h2>Administration</h2><span className={styles.pill}>Tenant governed</span></div>
              <div className={styles.panelBody}>
                <LearningSectionAdminPanel
                  section={section as 'assessments' | 'programs' | 'skills' | 'assignments'}
                  courseTargets={data.courseTargets}
                  programTargets={data.programTargets}
                  assessmentCourseTargets={data.assessmentCourseTargets}
                  questionBanks={data.questionBanks}
                  publishedQuestions={data.publishedQuestions}
                />
              </div>
            </section>
          ) : null}
          <section className={styles.panel}>
            <div className={styles.panelHead}><h2>{meta.title}</h2></div>
            {table(data.rows)}
          </section>
        </>
      )}
    </>
  );
}
