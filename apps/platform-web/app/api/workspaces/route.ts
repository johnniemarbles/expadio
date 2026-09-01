import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { WorkspaceSection } from '../../../lib/contracts';
import type { DeniedResult } from '@expadio/ui/contracts';
import { membershipRepository } from '../../../lib/iam-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISSUER = 'https://clerk.expadio.com';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'UNAUTHENTICATED',
      message: 'User is not authenticated',
    };
    return NextResponse.json(denied, { status: 401 });
  }

  const memberships = await membershipRepository.listActiveMemberships({
    subjectId: userId,
    issuer: ISSUER,
    actorKind: 'user',
  } as any);

  if (memberships.length === 0) {
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'NO_PLATFORM_MEMBERSHIP',
      message: 'No active EXPADIO workspace membership is assigned to this user.',
    };
    return NextResponse.json(denied, { status: 403 });
  }

  const workspaces: WorkspaceSection[] = [
    { id: 'ws_live_platform', label: 'Command Center', short: 'CC', href: '/' },
    { id: 'ws_live_overview', label: 'Business Overview', short: 'BO', href: '/overview' },
    { id: 'ws_live_orgs', label: 'Organizations & CRM', short: 'OR', href: '/organizations' },
    { id: 'ws_live_crm', label: 'CRM', short: 'CR', href: '/crm' },
    { id: 'ws_live_modules', label: 'Tenant Apps & Modules', short: 'TM', href: '/modules' },
    { id: 'ws_live_members', label: 'Tenant Users & Access', short: 'UA', href: '/access/members' },
    { id: 'ws_live_gtm', label: 'AutoGTM', short: 'GT', href: '/gtm' },
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
    { id: 'ws_live_gov_pending', label: 'Pending Review Load', short: 'PL', href: '/governance/pending' },
    { id: 'ws_live_gov_workflows', label: 'In-flight Workflows', short: 'IW', href: '/governance/workflows' },
    { id: 'ws_live_gov_decisions', label: 'Governed Decisions', short: 'GD', href: '/governance/decisions' },
    { id: 'ws_live_gov_analytics', label: 'Decision Analytics', short: 'DA', href: '/governance/analytics' },
    { id: 'ws_live_auth_inspector', label: 'Auth Inspector', short: 'AI', href: '/governance/authorization' },
    { id: 'ws_live_config_manager', label: 'Config Manager', short: 'CM', href: '/configuration' },
    { id: 'ws_live_credentials', label: 'Credentials & Secrets', short: 'CS', href: '/configuration/credentials' },
    { id: 'ws_live_data_pipelines', label: 'Data Pipelines', short: 'DP', href: '/data/pipelines' },
    { id: 'ws_live_context_engine', label: 'Context Engine', short: 'CE', href: '/context-engine' },
  ];

  return NextResponse.json(workspaces);
}
