import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { WorkspaceSection } from '../../../lib/contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../lib/iam-adapter';

export async function GET(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'UNAUTHENTICATED',
      message: 'User is not authenticated'
    };
    return NextResponse.json(denied, { status: 401 });
  }

  const resolve = () => authenticateAndResolveContext(
    { identityVerifier, membershipRepository },
    {
      credential: userId,
      tenantId: '00000000-0000-0000-0000-000000000001',
      organizationId: '00000000-0000-0000-0000-000000000002'
    }
  );

  try {
    let effectiveContext;
    try {
      effectiveContext = await resolve();
    } catch (error) {
      // Auto-provision user if they aren't in the database yet
      console.log(`Auto-provisioning user ${userId} in database...`);
      const client = await dbPool.connect();
      try {
        const res = await client.query('SELECT membership_id FROM platform.memberships WHERE subject_id = $1', [userId]);
        if (res.rowCount === 0) {
          await client.query(
            `INSERT INTO platform.memberships (tenant_id, organization_id, subject_id, actor_kind, status, issuer, workspace_scope_mode, operating_unit_scope_mode)
             VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', $1, 'user', 'ACTIVE', 'https://clerk.expadio.com', 'ALL', 'ALL')`,
            [userId]
          );
        } else {
          await client.query("UPDATE platform.memberships SET issuer = 'https://clerk.expadio.com' WHERE subject_id = $1", [userId]);
        }
      } finally {
        client.release();
      }
      effectiveContext = await resolve();
    }

    const workspaces: WorkspaceSection[] = [
      { id: 'ws_live_platform', label: `Platform Operations (${effectiveContext.subjectId.slice(-4)})`, short: 'PL', href: '/' },
      { id: 'ws_live_orgs', label: 'Organizations & CRM', short: 'OR', href: '/organizations' },
      { id: 'ws_live_crm', label: 'CRM', short: 'CR', href: '/crm' },
      { id: 'ws_live_brain', label: 'Knowledge Brain', short: 'KB', href: '/brain' },
      { id: 'ws_live_communications', label: 'Communications', short: 'CO', href: '/communications' },
      { id: 'ws_live_governance', label: 'Governance Center', short: 'GC', href: '/governance' },
      { id: 'ws_live_agents', label: 'Agent Runs', short: 'AR', href: '/agents' },
      { id: 'ws_live_agent_bindings', label: 'Agent Bindings', short: 'AB', href: '/agents/bindings' },
      { id: 'ws_live_usage', label: 'Usage Metering', short: 'UM', href: '/usage' },
      { id: 'ws_live_workflows', label: 'Workflow Console', short: 'WC', href: '/workflows' },
      { id: 'ws_live_workflow_blueprints', label: 'Workflow Blueprints', short: 'WB', href: '/workflows/blueprints' },
      { id: 'ws_live_vendors', label: 'Vendor Onboarding', short: 'VO', href: '/vendors' },
      { id: 'ws_live_expenses', label: 'Expense Reimbursement', short: 'EX', href: '/expenses' },
      { id: 'ws_live_authority', label: 'Approval Authority', short: 'AA', href: '/authority' },
      { id: 'ws_live_access', label: 'Access Requests', short: 'AR', href: '/access-requests' },
      { id: 'ws_live_gov_queue', label: 'My Review Queue', short: 'RQ', href: '/governance/queue' },
      { id: 'ws_live_gov_workflows', label: 'In-flight Workflows', short: 'IW', href: '/governance/workflows' },
      { id: 'ws_live_gov_decisions', label: 'Governed Decisions', short: 'GD', href: '/governance/decisions' },
      { id: 'ws_live_auth_inspector', label: 'Auth Inspector', short: 'AI', href: '/governance/authorization' },
      { id: 'ws_live_config_manager', label: 'Config Manager', short: 'CM', href: '/configuration' },
      { id: 'ws_live_credentials', label: 'Credentials & Secrets', short: 'CS', href: '/configuration/credentials' },
      { id: 'ws_live_data_pipelines', label: 'Data Pipelines', short: 'DP', href: '/data/pipelines' },
      { id: 'ws_live_context_engine', label: 'Context Engine', short: 'CE', href: '/context-engine' }
    ];
    return NextResponse.json(workspaces);
  } catch (error) {
    console.error("IAM Resolution Error:", error);
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'UNAUTHORIZED_OR_UNMAPPED',
      message: 'Could not resolve internal EXPADIO identity for this user.'
    };
    return NextResponse.json(denied, { status: 403 });
  }
}
