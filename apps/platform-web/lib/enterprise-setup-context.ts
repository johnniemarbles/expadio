import { auth } from '@clerk/nextjs/server';
import type { PoolClient } from 'pg';
import { dbPool } from './iam-adapter';

const ISSUER = 'https://clerk.expadio.com';

export interface EnterpriseSetupAccessContext {
  readonly subjectId: string;
  readonly issuer: string;
  readonly tenantId: string;
  readonly enterpriseId: string;
  readonly organizationId: string;
  readonly setupPlanId: string;
  readonly role: 'OWNER' | 'CONTRIBUTOR' | 'REVIEWER';
  readonly organizationName: string;
  readonly organizationKind: string;
  readonly parentOrganizationId: string | null;
  readonly setupState: 'PROVISIONING' | 'CONFIGURING' | 'READY_FOR_ACTIVATION';
  readonly completionPercent: number;
  readonly blockingOpenRequirements: number;
}

export class EnterpriseSetupDenied extends Error {
  readonly status: number;
  readonly reasonKey: string;

  constructor(reasonKey: string, message: string, status = 403) {
    super(message);
    this.name = 'EnterpriseSetupDenied';
    this.reasonKey = reasonKey;
    this.status = status;
  }
}

interface SetupAccessRow {
  readonly tenant_id: string;
  readonly enterprise_id: string;
  readonly organization_id: string;
  readonly setup_plan_id: string;
  readonly role: EnterpriseSetupAccessContext['role'];
  readonly state: EnterpriseSetupAccessContext['setupState'];
  readonly completion_percent: string | number;
  readonly blocking_open_requirements: number;
}

export async function listSetupAccessForCurrentUser(): Promise<
  readonly EnterpriseSetupAccessContext[]
> {
  const { userId } = await auth();
  if (!userId) {
    throw new EnterpriseSetupDenied('UNAUTHENTICATED', 'Sign in to continue.', 401);
  }

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.subject_id', userId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.issuer', ISSUER]);

    const result = await client.query<SetupAccessRow>(
      `SELECT
         plan.tenant_id,
         plan.enterprise_id,
         plan.organization_id,
         plan.setup_plan_id,
         participant.role,
         plan.state,
         plan.completion_percent,
         plan.blocking_open_requirements
       FROM platform.organization_setup_participants participant
       JOIN platform.organization_setup_plans plan
         ON plan.tenant_id = participant.tenant_id
        AND plan.setup_plan_id = participant.setup_plan_id
       WHERE participant.subject_id = $1
         AND participant.issuer IS NOT DISTINCT FROM $2
         AND participant.status = 'ACTIVE'
         AND participant.valid_from <= now()
         AND (participant.valid_until IS NULL OR participant.valid_until > now())
         AND plan.state IN ('PROVISIONING','CONFIGURING','READY_FOR_ACTIVATION')
       ORDER BY plan.tenant_id, plan.organization_id, participant.role`,
      [userId, ISSUER],
    );

    const contexts: EnterpriseSetupAccessContext[] = [];
    for (const row of result.rows) {
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', row.tenant_id]);
      const organization = await client.query<{
        name: string;
        organization_kind: string;
        parent_organization_id: string | null;
      }>(
        `SELECT name, organization_kind, parent_organization_id
           FROM platform.organizations
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
          LIMIT 1`,
        [row.tenant_id, row.organization_id],
      );
      const org = organization.rows[0];
      if (!org) continue;
      contexts.push({
        subjectId: userId,
        issuer: ISSUER,
        tenantId: row.tenant_id,
        enterpriseId: row.enterprise_id,
        organizationId: row.organization_id,
        setupPlanId: row.setup_plan_id,
        role: row.role,
        organizationName: org.name,
        organizationKind: org.organization_kind,
        parentOrganizationId: org.parent_organization_id,
        setupState: row.state,
        completionPercent: Number(row.completion_percent),
        blockingOpenRequirements: Number(row.blocking_open_requirements),
      });
    }
    await client.query('COMMIT');
    return contexts;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function withSetupParticipantTransaction<T>(
  setupPlanId: string,
  work: (
    client: PoolClient,
    context: EnterpriseSetupAccessContext,
  ) => Promise<T>,
): Promise<T> {
  const { userId } = await auth();
  if (!userId) {
    throw new EnterpriseSetupDenied('UNAUTHENTICATED', 'Sign in to continue.', 401);
  }

  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.subject_id', userId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.issuer', ISSUER]);

    const access = await client.query<SetupAccessRow>(
      `SELECT
         plan.tenant_id,
         plan.enterprise_id,
         plan.organization_id,
         plan.setup_plan_id,
         participant.role,
         plan.state,
         plan.completion_percent,
         plan.blocking_open_requirements
       FROM platform.organization_setup_participants participant
       JOIN platform.organization_setup_plans plan
         ON plan.tenant_id = participant.tenant_id
        AND plan.setup_plan_id = participant.setup_plan_id
       WHERE participant.subject_id = $1
         AND participant.issuer IS NOT DISTINCT FROM $2
         AND participant.status = 'ACTIVE'
         AND participant.valid_from <= now()
         AND (participant.valid_until IS NULL OR participant.valid_until > now())
         AND plan.setup_plan_id = $3::uuid
         AND plan.state IN ('PROVISIONING','CONFIGURING','READY_FOR_ACTIVATION')
       LIMIT 1`,
      [userId, ISSUER, setupPlanId],
    );
    const row = access.rows[0];
    if (!row) {
      throw new EnterpriseSetupDenied(
        'ENTERPRISE_SETUP_ACCESS_DENIED',
        'You do not have active setup access to this organization.',
        403,
      );
    }

    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', row.tenant_id]);
    await client.query('SELECT set_config($1, $2, true)', [
      'app.organization_id',
      row.organization_id,
    ]);

    const organization = await client.query<{
      name: string;
      organization_kind: string;
      parent_organization_id: string | null;
    }>(
      `SELECT name, organization_kind, parent_organization_id
         FROM platform.organizations
        WHERE tenant_id = $1::uuid
          AND organization_id = $2::uuid
        LIMIT 1`,
      [row.tenant_id, row.organization_id],
    );
    const org = organization.rows[0];
    if (!org) {
      throw new EnterpriseSetupDenied(
        'ENTERPRISE_SETUP_ORGANIZATION_NOT_FOUND',
        'The organization assigned to this setup plan is unavailable.',
        404,
      );
    }

    const context: EnterpriseSetupAccessContext = {
      subjectId: userId,
      issuer: ISSUER,
      tenantId: row.tenant_id,
      enterpriseId: row.enterprise_id,
      organizationId: row.organization_id,
      setupPlanId: row.setup_plan_id,
      role: row.role,
      organizationName: org.name,
      organizationKind: org.organization_kind,
      parentOrganizationId: org.parent_organization_id,
      setupState: row.state,
      completionPercent: Number(row.completion_percent),
      blockingOpenRequirements: Number(row.blocking_open_requirements),
    };

    const result = await work(client, context);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

export function enterpriseSetupErrorResponse(error: unknown): {
  readonly body: { denied: true; reasonKey: string; message: string };
  readonly status: number;
} {
  if (error instanceof EnterpriseSetupDenied) {
    return {
      body: {
        denied: true,
        reasonKey: error.reasonKey,
        message: error.message,
      },
      status: error.status,
    };
  }
  const code =
    typeof error === 'object'
    && error !== null
    && 'message' in error
    && typeof (error as { message?: unknown }).message === 'string'
      ? String((error as { message: string }).message)
      : 'ENTERPRISE_SETUP_REQUEST_FAILED';
  const knownConflict = new Set([
    'ORGANIZATION_SETUP_IDEMPOTENCY_CONFLICT',
    'ORGANIZATION_SETUP_REQUIREMENT_CONFLICT',
    'ORGANIZATION_SETUP_REQUIREMENT_TRANSITION_INVALID',
    'ORGANIZATION_SETUP_DEPENDENCIES_INCOMPLETE',
    'ORGANIZATION_SETUP_WAIVER_REASON_REQUIRED',
    'ORGANIZATION_SETUP_CHANGE_REASON_REQUIRED',
    'ORGANIZATION_SETUP_NOT_READY_FOR_ACTIVATION',
    'ORGANIZATION_SETUP_READINESS_INVARIANT_FAILED',
    'ORGANIZATION_SETUP_ORGANIZATION_NOT_READY',
    'ORGANIZATION_SETUP_AUTOMATED_REQUIREMENT',
    'ORGANIZATION_SETUP_EVIDENCE_REQUIRED',
    'ORGANIZATION_SETUP_VERIFIED_LEGAL_ENTITY_REQUIRED',
    'ORGANIZATION_SETUP_PRIMARY_ADMIN_REQUIRED',
    'ORGANIZATION_SETUP_ACCESS_HANDOFF_CONFLICT',
  ]);
  return {
    body: {
      denied: true,
      reasonKey: code,
      message: knownConflict.has(code)
        ? 'The setup request conflicts with the current governed readiness state.'
        : 'The organization setup request could not be completed.',
    },
    status: knownConflict.has(code) ? 409 : 500,
  };
}
