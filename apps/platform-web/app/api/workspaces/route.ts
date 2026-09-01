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
    { id: 'ws_live_platform', label: 'Command Center', short: 'CC', href: '/', group: 'Workspace', priority: 'primary' },
    { id: 'ws_live_overview', label: 'Business Overview', short: 'BO', href: '/overview', group: 'Workspace', priority: 'primary' },
    { id: 'ws_live_orgs', label: 'Organizations', short: 'OR', href: '/organizations', group: 'Workspace', priority: 'primary' },
    { id: 'ws_live_crm', label: 'CRM', short: 'CR', href: '/crm', group: 'Workspace', priority: 'primary' },

    { id: 'ws_live_gtm', label: 'AutoGTM', short: 'GT', href: '/gtm', group: 'Growth', priority: 'primary' },
    { id: 'ws_live_communications', label: 'Communications', short: 'CO', href: '/communications', group: 'Growth', priority: 'primary' },
    { id: 'ws_live_brain', label: 'Knowledge Brain', short: 'KB', href: '/brain', group: 'Growth', priority: 'primary' },

    { id: 'ws_live_governance', label: 'Governance Center', short: 'GC', href: '/governance', group: 'Decision Fabric', priority: 'primary' },
    { id: 'ws_live_gov_queue', label: 'My Review Queue', short: 'RQ', href: '/governance/queue', group: 'Decision Fabric', priority: 'secondary' },
    { id: 'ws_live_workflows', label: 'Workflow Console', short: 'WC', href: '/workflows', group: 'Decision Fabric', priority: 'primary' },
    { id: 'ws_live_workflow_blueprints', label: 'Workflow Blueprints', short: 'WB', href: '/workflows/blueprints', group: 'Decision Fabric', priority: 'secondary' },
    { id: 'ws_live_vendors', label: 'Vendor Onboarding', short: 'VO', href: '/vendors', group: 'Decision Fabric', priority: 'primary' },
    { id: 'ws_live_expenses', label: 'Expense Reimbursement', short: 'EX', href: '/expenses', group: 'Decision Fabric', priority: 'secondary' },

    { id: 'ws_live_agents', label: 'Agent Runs', short: 'AG', href: '/agents', group: 'Agent Intelligence', priority: 'primary' },
    { id: 'ws_live_agent_bindings', label: 'Agent Bindings', short: 'AB', href: '/agents/bindings', group: 'Agent Intelligence', priority: 'secondary' },
    { id: 'ws_live_usage', label: 'Usage Metering', short: 'UM', href: '/usage', group: 'Agent Intelligence', priority: 'secondary' },

    { id: 'ws_live_modules', label: 'Tenant Apps & Modules', short: 'TM', href: '/modules', group: 'Administration', priority: 'primary' },
    { id: 'ws_live_members', label: 'Tenant Users & Access', short: 'UA', href: '/access/members', group: 'Administration', priority: 'primary' },
    { id: 'ws_live_access', label: 'Access Requests', short: 'AX', href: '/access-requests', group: 'Administration', priority: 'secondary' },
    { id: 'ws_live_config_manager', label: 'Config Manager', short: 'CM', href: '/configuration', group: 'Administration', priority: 'primary' },
    { id: 'ws_live_appearance', label: 'Appearance', short: 'AP', href: '/appearance', group: 'Administration', priority: 'secondary' },
    { id: 'ws_live_credentials', label: 'Credentials & Secrets', short: 'CS', href: '/configuration/credentials', group: 'Administration', priority: 'secondary' },
    { id: 'ws_live_data_pipelines', label: 'Data Pipelines', short: 'DP', href: '/data/pipelines', group: 'Administration', priority: 'secondary' },
    { id: 'ws_live_context_engine', label: 'Context Engine', short: 'CE', href: '/context-engine', group: 'Administration', priority: 'secondary' },
  ];

  return NextResponse.json(workspaces);
}
