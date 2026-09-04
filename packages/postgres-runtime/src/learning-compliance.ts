import type { PostgresClient } from './index.ts';
import { requireTenantModuleOperational } from './product-module.ts';

export interface LearningComplianceDashboard {
  readonly metrics: {
    readonly activeLearners: number;
    readonly activeEnrollments: number;
    readonly overdueEnrollments: number;
    readonly completedEnrollments: number;
    readonly activePrograms: number;
    readonly credentialsAtRisk: number;
  };
  readonly attention: readonly {
    readonly learnerId: string;
    readonly learnerName: string;
    readonly email: string | null;
    readonly overdueEnrollments: number;
    readonly activeEnrollments: number;
    readonly activePrograms: number;
    readonly credentialsAtRisk: number;
  }[];
  readonly generatedAt: string;
}

interface CountRow {
  readonly active_learners: string | number;
  readonly active_enrollments: string | number;
  readonly overdue_enrollments: string | number;
  readonly completed_enrollments: string | number;
  readonly active_programs: string | number;
  readonly credentials_at_risk: string | number;
}

export async function loadLearningComplianceDashboard(
  client: PostgresClient,
  input: { readonly tenantId: string; readonly limit?: number; readonly now?: Date },
): Promise<LearningComplianceDashboard> {
  await requireTenantModuleOperational(client, { tenantId: input.tenantId, moduleKey: 'learning' });
  const now = input.now ?? new Date();
  const limit = Math.min(250, Math.max(1, input.limit ?? 100));

  const [counts, attention] = await Promise.all([
    client.query<CountRow>(
      `SELECT
        (SELECT count(*) FROM platform.learning_learners
          WHERE tenant_id=$1::uuid AND status='ACTIVE') AS active_learners,
        (SELECT count(*) FROM platform.learning_enrollments
          WHERE tenant_id=$1::uuid AND status IN ('ASSIGNED','IN_PROGRESS')) AS active_enrollments,
        (SELECT count(*) FROM platform.learning_enrollments
          WHERE tenant_id=$1::uuid AND status IN ('ASSIGNED','IN_PROGRESS')
            AND due_at IS NOT NULL AND due_at < $2) AS overdue_enrollments,
        (SELECT count(*) FROM platform.learning_enrollments
          WHERE tenant_id=$1::uuid AND status='COMPLETED') AS completed_enrollments,
        (SELECT count(*) FROM platform.learning_program_enrollments
          WHERE tenant_id=$1::uuid AND status IN ('ASSIGNED','IN_PROGRESS')) AS active_programs,
        (SELECT count(*) FROM platform.learning_credentials
          WHERE tenant_id=$1::uuid AND status <> 'REVOKED'
            AND ((expires_at IS NOT NULL AND expires_at <= $2 + interval '30 days')
              OR (renewal_due_at IS NOT NULL AND renewal_due_at <= $2 + interval '30 days'))) AS credentials_at_risk`,
      [input.tenantId, now],
    ),
    client.query<{
      readonly learner_id: string;
      readonly full_name: string;
      readonly email: string | null;
      readonly overdue_enrollments: string | number;
      readonly active_enrollments: string | number;
      readonly active_programs: string | number;
      readonly credentials_at_risk: string | number;
    }>(
      `SELECT learner.learner_id, learner.full_name, learner.email,
              count(DISTINCT enrollment.enrollment_id) FILTER (
                WHERE enrollment.status IN ('ASSIGNED','IN_PROGRESS')
                  AND enrollment.due_at IS NOT NULL AND enrollment.due_at < $2
              ) AS overdue_enrollments,
              count(DISTINCT enrollment.enrollment_id) FILTER (
                WHERE enrollment.status IN ('ASSIGNED','IN_PROGRESS')
              ) AS active_enrollments,
              count(DISTINCT program.program_enrollment_id) FILTER (
                WHERE program.status IN ('ASSIGNED','IN_PROGRESS')
              ) AS active_programs,
              count(DISTINCT credential.credential_id) FILTER (
                WHERE credential.status <> 'REVOKED'
                  AND ((credential.expires_at IS NOT NULL AND credential.expires_at <= $2 + interval '30 days')
                    OR (credential.renewal_due_at IS NOT NULL AND credential.renewal_due_at <= $2 + interval '30 days'))
              ) AS credentials_at_risk
         FROM platform.learning_learners learner
         LEFT JOIN platform.learning_enrollments enrollment
           ON enrollment.tenant_id=learner.tenant_id AND enrollment.learner_id=learner.learner_id
         LEFT JOIN platform.learning_program_enrollments program
           ON program.tenant_id=learner.tenant_id AND program.learner_id=learner.learner_id
         LEFT JOIN platform.learning_credentials credential
           ON credential.tenant_id=learner.tenant_id AND credential.learner_id=learner.learner_id
        WHERE learner.tenant_id=$1::uuid AND learner.status='ACTIVE'
        GROUP BY learner.learner_id, learner.full_name, learner.email
        HAVING count(DISTINCT enrollment.enrollment_id) FILTER (
                 WHERE enrollment.status IN ('ASSIGNED','IN_PROGRESS')
                   AND enrollment.due_at IS NOT NULL AND enrollment.due_at < $2
               ) > 0
            OR count(DISTINCT credential.credential_id) FILTER (
                 WHERE credential.status <> 'REVOKED'
                   AND ((credential.expires_at IS NOT NULL AND credential.expires_at <= $2 + interval '30 days')
                     OR (credential.renewal_due_at IS NOT NULL AND credential.renewal_due_at <= $2 + interval '30 days'))
               ) > 0
        ORDER BY overdue_enrollments DESC, credentials_at_risk DESC, learner.full_name
        LIMIT $3`,
      [input.tenantId, now, limit],
    ),
  ]);

  const row = counts.rows[0];
  return {
    metrics: {
      activeLearners: Number(row?.active_learners ?? 0),
      activeEnrollments: Number(row?.active_enrollments ?? 0),
      overdueEnrollments: Number(row?.overdue_enrollments ?? 0),
      completedEnrollments: Number(row?.completed_enrollments ?? 0),
      activePrograms: Number(row?.active_programs ?? 0),
      credentialsAtRisk: Number(row?.credentials_at_risk ?? 0),
    },
    attention: attention.rows.map((entry) => ({
      learnerId: entry.learner_id,
      learnerName: entry.full_name,
      email: entry.email,
      overdueEnrollments: Number(entry.overdue_enrollments),
      activeEnrollments: Number(entry.active_enrollments),
      activePrograms: Number(entry.active_programs),
      credentialsAtRisk: Number(entry.credentials_at_risk),
    })),
    generatedAt: now.toISOString(),
  };
}
