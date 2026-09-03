import { NextResponse } from 'next/server';
import type { WorkspaceSection } from '../../../lib/contracts';
import { deniedResponse, resolveRequestContext, withTenantTransaction } from '../../../lib/request-context';
import { hasPlatformAdministrationRole } from '../../../lib/governance-authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const platformAuthorized = await withTenantTransaction(
      context,
      (client) => hasPlatformAdministrationRole(client, context.subjectId),
    );
    if (!platformAuthorized) {
      return NextResponse.json(
        { denied: true, reasonKey: 'PLATFORM_ACCESS_REQUIRED', message: 'Open the Brand workspace for tenant operations.' },
        { status: 403 },
      );
    }

    const workspaces: WorkspaceSection[] = [
      { id: 'platform_command', label: 'Command Center', short: 'CC', href: '/', group: 'Workspace', priority: 'primary' },
      { id: 'platform_fleet', label: 'Fleet Overview', short: 'FO', href: '/overview', group: 'Workspace', priority: 'primary' },
      { id: 'platform_orgs', label: 'Organizations', short: 'OR', href: '/organizations', group: 'Workspace', priority: 'primary' },

      { id: 'platform_comms', label: 'Provider Infrastructure', short: 'PI', href: '/communications', group: 'Infrastructure', priority: 'primary' },
      { id: 'platform_brain', label: 'AI & Brain Governance', short: 'AI', href: '/brain', group: 'Infrastructure', priority: 'primary' },
      { id: 'platform_agents', label: 'Agent Operations', short: 'AO', href: '/agents', group: 'Infrastructure', priority: 'primary' },
      { id: 'platform_usage', label: 'Usage & Metering', short: 'UM', href: '/usage', group: 'Infrastructure', priority: 'secondary' },
      { id: 'platform_data', label: 'Data Pipelines', short: 'DP', href: '/data/pipelines', group: 'Infrastructure', priority: 'secondary' },
      { id: 'platform_context', label: 'Context Engine', short: 'CE', href: '/context-engine', group: 'Infrastructure', priority: 'secondary' },

      { id: 'platform_governance', label: 'Governance Center', short: 'GC', href: '/governance', group: 'Governance', priority: 'primary' },
      { id: 'platform_authority', label: 'Platform Authority', short: 'PA', href: '/authority', group: 'Governance', priority: 'secondary' },
      { id: 'platform_workflows', label: 'Workflow Infrastructure', short: 'WI', href: '/workflows', group: 'Governance', priority: 'primary' },
      { id: 'platform_audit', label: 'Audit', short: 'AU', href: '/audit', group: 'Governance', priority: 'secondary' },

      { id: 'platform_modules', label: 'Apps & Entitlements', short: 'AE', href: '/modules', group: 'Administration', priority: 'primary' },
      { id: 'platform_access', label: 'Tenant Access', short: 'TA', href: '/access/members', group: 'Administration', priority: 'primary' },
      { id: 'platform_access_requests', label: 'Access Requests', short: 'AR', href: '/access-requests', group: 'Administration', priority: 'secondary' },
      { id: 'platform_config', label: 'Platform Configuration', short: 'PC', href: '/configuration', group: 'Administration', priority: 'primary' },
      { id: 'platform_appearance', label: 'Theme Governance', short: 'TG', href: '/appearance', group: 'Administration', priority: 'secondary' },
      { id: 'platform_theme_sandbox', label: 'Theme Sandbox', short: 'TS', href: '/theme-sandbox', group: 'Administration', priority: 'secondary' },
    ];

    return NextResponse.json(workspaces, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
