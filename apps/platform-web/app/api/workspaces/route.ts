import { NextResponse } from 'next/server';
import type { WorkspaceSection } from '../../../lib/contracts';
import { deniedResponse, resolveRequestContext } from '../../../lib/request-context';

export async function GET(request: Request) {
  try {
    const contextState = await resolveRequestContext(request);

    const workspaces: WorkspaceSection[] = [
      { id: 'ws_live_platform', label: `Platform Operations (${contextState.subjectId.slice(-4)})`, short: 'PL', href: '/' },
      { id: 'ws_live_orgs', label: 'Organizations & CRM', short: 'OR', href: '/organizations' },
      { id: 'ws_live_brain', label: 'Knowledge Brain', short: 'KB', href: '/brain' },
      { id: 'ws_live_communications', label: 'Communications', short: 'CO', href: '/communications' },
      { id: 'ws_live_governance', label: 'Governance Center', short: 'GC', href: '/governance' },
      { id: 'ws_live_agents', label: 'Agent Runs', short: 'AR', href: '/agents' },
      { id: 'ws_live_agent_bindings', label: 'Agent Bindings', short: 'AB', href: '/agents/bindings' },
      { id: 'ws_live_usage', label: 'Usage Metering', short: 'UM', href: '/usage' },
      { id: 'ws_live_workflows', label: 'Workflow Console', short: 'WC', href: '/workflows' },
      { id: 'ws_live_workflow_blueprints', label: 'Workflow Blueprints', short: 'WB', href: '/workflows/blueprints' },
      { id: 'ws_live_auth_inspector', label: 'Auth Inspector', short: 'AI', href: '/governance/authorization' },
      { id: 'ws_live_config_manager', label: 'Config Manager', short: 'CM', href: '/configuration' },
      { id: 'ws_live_credentials', label: 'Credentials & Secrets', short: 'CS', href: '/configuration/credentials' },
      { id: 'ws_live_data_pipelines', label: 'Data Pipelines', short: 'DP', href: '/data/pipelines' },
      { id: 'ws_live_context_engine', label: 'Context Engine', short: 'CE', href: '/context-engine' }
    ];
    return NextResponse.json(workspaces);
  } catch (error) {
    console.error("Workspace API Error:", error);
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
