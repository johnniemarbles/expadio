import type { PoolClient } from 'pg';
import {
  loadLearningTenantContext,
  loadTenantProductModule,
  type TenantProductModuleSummary,
} from '@expadio/postgres-runtime/product-module';
import {
  listLearningCourses,
  loadLearningCourseVersion,
  type LearningCourseSummary,
  type LearningCourseVersion,
} from '@expadio/postgres-runtime/learning';

export interface LearningDashboard {
  readonly module: TenantProductModuleSummary | null;
  readonly academyName: string | null;
  readonly metrics: readonly { readonly label: string; readonly value: number; readonly detail: string }[];
  readonly recentCourses: readonly LearningCourseSummary[];
}

async function count(client: PoolClient, sql: string, tenantId: string): Promise<number> {
  const result = await client.query<{ value: number }>(sql, [tenantId]);
  return Number(result.rows[0]?.value ?? 0);
}

export async function loadLearningDashboard(client: PoolClient, tenantId: string): Promise<LearningDashboard> {
  const module = await loadTenantProductModule(client, { tenantId, moduleKey: 'learning' });
  if (module?.availability !== 'ACTIVE') return { module, academyName: null, metrics: [], recentCourses: [] };

  const context = await loadLearningTenantContext(client, tenantId);
  const [courses, learners, active, completed, overdue, programs, credentials] = await Promise.all([
    listLearningCourses(client, tenantId),
    count(client, "SELECT count(*)::int AS value FROM platform.learning_learners WHERE tenant_id=$1::uuid AND status='ACTIVE'", tenantId),
    count(client, "SELECT count(*)::int AS value FROM platform.learning_enrollments WHERE tenant_id=$1::uuid AND status IN ('ASSIGNED','IN_PROGRESS')", tenantId),
    count(client, "SELECT count(*)::int AS value FROM platform.learning_enrollments WHERE tenant_id=$1::uuid AND status='COMPLETED'", tenantId),
    count(client, "SELECT count(*)::int AS value FROM platform.learning_enrollments WHERE tenant_id=$1::uuid AND status IN ('ASSIGNED','IN_PROGRESS') AND due_at<now()", tenantId),
    count(client, "SELECT count(*)::int AS value FROM platform.learning_programs WHERE tenant_id=$1::uuid AND status='ACTIVE'", tenantId),
    count(client, "SELECT count(*)::int AS value FROM platform.learning_credentials WHERE tenant_id=$1::uuid AND status='ACTIVE'", tenantId),
  ]);

  return {
    module,
    academyName: context.settings.academyName,
    metrics: [
      { label: 'Courses', value: courses.length, detail: 'Draft and published catalog' },
      { label: 'Active learners', value: learners, detail: 'Learners able to progress' },
      { label: 'In learning', value: active, detail: 'Assigned or in progress' },
      { label: 'Completed', value: completed, detail: 'Completed enrollments' },
      { label: 'Overdue', value: overdue, detail: 'Past due and incomplete' },
      { label: 'Programs', value: programs, detail: 'Active learning programs' },
      { label: 'Credentials', value: credentials, detail: 'Active issued credentials' },
    ],
    recentCourses: courses.slice(0, 6),
  };
}

export async function loadCourseDetail(
  client: PoolClient,
  tenantId: string,
  courseId: string,
): Promise<{ readonly summary: LearningCourseSummary; readonly version: LearningCourseVersion } | null> {
  const courses = await listLearningCourses(client, tenantId);
  const summary = courses.find((entry) => entry.courseId === courseId);
  if (!summary) return null;
  const versionNumber = summary.draftVersion ?? summary.currentPublishedVersion;
  if (versionNumber === null) return null;
  const version = await loadLearningCourseVersion(client, { tenantId, courseId, version: versionNumber });
  return { summary, version };
}

export async function loadLearningSection(
  client: PoolClient,
  tenantId: string,
  section: string,
): Promise<readonly Record<string, unknown>[]> {
  switch (section) {
    case 'learners':
      return (await client.query(
        `SELECT l.learner_id AS id, l.full_name AS name, l.email,
                l.audience_type AS audience, l.status,
                count(e.enrollment_id)::int AS enrollments,
                COALESCE(round(avg(e.completion_percent),1),0) AS progress
           FROM platform.learning_learners l
           LEFT JOIN platform.learning_enrollments e
             ON e.tenant_id=l.tenant_id AND e.learner_id=l.learner_id
          WHERE l.tenant_id=$1::uuid
          GROUP BY l.learner_id
          ORDER BY l.full_name LIMIT 100`, [tenantId])).rows;
    case 'assessments':
      return (await client.query(
        `SELECT a.assessment_id AS id, a.assessment_key AS key,
                COALESCE(p.title,d.title,a.assessment_key) AS name,
                a.status, p.version AS published_version, d.version AS draft_version
           FROM platform.learning_assessments a
           LEFT JOIN platform.learning_assessment_versions p
             ON p.assessment_id=a.assessment_id AND p.state='PUBLISHED'
           LEFT JOIN LATERAL (
             SELECT version,title FROM platform.learning_assessment_versions v
              WHERE v.assessment_id=a.assessment_id AND v.state='DRAFT'
              ORDER BY version DESC LIMIT 1
           ) d ON true
          WHERE a.tenant_id=$1::uuid ORDER BY a.updated_at DESC LIMIT 100`, [tenantId])).rows;
    case 'programs':
      return (await client.query(
        `SELECT p.program_id AS id, p.program_key AS key,
                COALESCE(v.title,p.program_key) AS name,
                p.status, v.version, v.state
           FROM platform.learning_programs p
           LEFT JOIN LATERAL (
             SELECT version,title,state FROM platform.learning_program_versions pv
              WHERE pv.program_id=p.program_id
              ORDER BY CASE WHEN state='PUBLISHED' THEN 0 ELSE 1 END,version DESC LIMIT 1
           ) v ON true
          WHERE p.tenant_id=$1::uuid ORDER BY p.updated_at DESC LIMIT 100`, [tenantId])).rows;
    case 'skills':
      return (await client.query(
        `SELECT f.competency_framework_id AS id, f.framework_key AS key,
                COALESCE(v.title,f.framework_key) AS name,
                f.status, v.version, v.state
           FROM platform.learning_competency_frameworks f
           LEFT JOIN LATERAL (
             SELECT version,title,state FROM platform.learning_competency_framework_versions fv
              WHERE fv.competency_framework_id=f.competency_framework_id
              ORDER BY CASE WHEN state='PUBLISHED' THEN 0 ELSE 1 END,version DESC LIMIT 1
           ) v ON true
          WHERE f.tenant_id=$1::uuid ORDER BY f.updated_at DESC LIMIT 100`, [tenantId])).rows;
    case 'assignments':
      return (await client.query(
        `SELECT r.assignment_rule_id AS id, r.rule_key AS key,
                COALESCE(v.name,r.rule_key) AS name,
                r.status, v.version, v.state, v.target_type
           FROM platform.learning_assignment_rules r
           LEFT JOIN LATERAL (
             SELECT version,name,state,target_type FROM platform.learning_assignment_rule_versions rv
              WHERE rv.assignment_rule_id=r.assignment_rule_id
              ORDER BY CASE WHEN state='PUBLISHED' THEN 0 ELSE 1 END,version DESC LIMIT 1
           ) v ON true
          WHERE r.tenant_id=$1::uuid ORDER BY r.updated_at DESC LIMIT 100`, [tenantId])).rows;
    default:
      return [];
  }
}

export async function loadLearningReport(client: PoolClient, tenantId: string): Promise<readonly Record<string, unknown>[]> {
  return (await client.query(
    `SELECT status, count(*)::int AS enrollments,
            COALESCE(round(avg(completion_percent),1),0) AS avg_completion
       FROM platform.learning_enrollments
      WHERE tenant_id=$1::uuid
      GROUP BY status ORDER BY status`, [tenantId])).rows;
}

export async function loadLearnerHome(
  client: PoolClient,
  input: { readonly tenantId: string; readonly subjectId: string; readonly issuer: string },
): Promise<{
  readonly learner: null | { readonly id: string; readonly name: string; readonly email: string | null };
  readonly enrollments: readonly Record<string, unknown>[];
}> {
  const learnerResult = await client.query<{ learner_id: string; full_name: string; email: string | null }>(
    `SELECT learner_id,full_name,email FROM platform.learning_learners
      WHERE tenant_id=$1::uuid AND subject_id=$2
        AND COALESCE(subject_issuer,'')=COALESCE($3,'')
        AND status='ACTIVE' LIMIT 1`,
    [input.tenantId, input.subjectId, input.issuer],
  );
  const learner = learnerResult.rows[0];
  if (!learner) return { learner: null, enrollments: [] };

  const enrollments = await client.query(
    `SELECT e.enrollment_id AS id,e.status,e.completion_percent AS progress,
            e.due_at,e.last_activity_at,v.title AS course,c.course_key
       FROM platform.learning_enrollments e
       JOIN platform.learning_course_versions v
         ON v.course_version_id=e.course_version_id AND v.tenant_id=e.tenant_id
       JOIN platform.learning_courses c
         ON c.course_id=e.course_id AND c.tenant_id=e.tenant_id
      WHERE e.tenant_id=$1::uuid AND e.learner_id=$2::uuid
      ORDER BY CASE e.status WHEN 'IN_PROGRESS' THEN 0 WHEN 'ASSIGNED' THEN 1 ELSE 2 END,
               e.due_at NULLS LAST,e.assigned_at DESC`,
    [input.tenantId, learner.learner_id],
  );
  return {
    learner: { id: learner.learner_id, name: learner.full_name, email: learner.email },
    enrollments: enrollments.rows,
  };
}
