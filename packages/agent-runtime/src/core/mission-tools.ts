import { randomUUID } from 'node:crypto';
import type { 
  AgentToolAuthorizationPort, 
  AgentToolAdapter,
  AgentToolAuthorizationQuery,
  AgentToolAdapterInput
} from '../index';

export type CoarseToolGroup = 'GitHub' | 'FS' | 'DB' | 'Audit' | 'Comms';

export const TOOL_GROUP_MAPPING: Record<string, CoarseToolGroup | 'EXEMPT'> = {
  'cbos.context.observe': 'EXEMPT',
  'content.editorial.debate': 'EXEMPT',
  'revenue.lead.osint': 'DB',
  'revenue.outreach.draft_sequence': 'Comms',
  'voice.callback.prepare': 'Comms',
};

export function createMissionAuthorizationPort(
  tenantId: string,
  checkGrant?: (tenantId: string, toolGroup: CoarseToolGroup) => Promise<boolean>
): AgentToolAuthorizationPort {
  return {
    async authorize(query: AgentToolAuthorizationQuery) {
      const decisionId = randomUUID();
      if (query.tenantId !== tenantId) {
        return { decisionId, allowed: false, reasonKey: 'TENANT_MISMATCH' };
      }
      
      // Enforce that state-changing or external dispatch actions require explicit policy/fabric review.
      if (query.effect === 'PROPOSE') {
        return { decisionId, allowed: false, reasonKey: 'PROPOSE_REQUIRES_POLICY' };
      }

      const group = TOOL_GROUP_MAPPING[query.toolKey];
      
      if (group === 'EXEMPT') {
        return { decisionId, allowed: true, reasonKey: 'SYSTEM_INTERNAL_EXEMPT' };
      }

      if (group) {
        if (!checkGrant) {
          return { decisionId, allowed: false, reasonKey: 'AUTHORIZATION_CONFIGURATION_ERROR' };
        }
        const granted = await checkGrant(tenantId, group);
        if (!granted) {
          return { decisionId, allowed: false, reasonKey: 'TOOL_GROUP_NOT_GRANTED' };
        }
      }

      return { decisionId, allowed: true, reasonKey: 'TENANT_SCOPED_OBSERVE_ALLOWED' };
    },
  };
}

export function createStubTool(toolKey: string): AgentToolAdapter {
  return {
    toolKey,
    effect: 'OBSERVE',
    async invoke(input: AgentToolAdapterInput) {
      return {
        executionId: input.executionId,
        tenantId: input.tenantId,
        toolKey,
        kind: 'OBSERVATION',
        outputReference: `artifact:stub:${toolKey}:${input.tenantId}:${input.executionId}`,
        sourceReferences: [],
        producedAt: new Date().toISOString(),
      };
    },
  };
}

import { createLeadOsintTool } from '../committees/lead-osint-tool.ts';

export function getRegisteredMissionTools(): AgentToolAdapter[] {
  const contextObserveTool: AgentToolAdapter = {
    toolKey: 'cbos.context.observe',
    effect: 'OBSERVE',
    async invoke(input: AgentToolAdapterInput) {
      return {
        executionId: input.executionId,
        tenantId: input.tenantId,
        toolKey: 'cbos.context.observe',
        kind: 'OBSERVATION',
        outputReference: `artifact:cbos:context:${input.tenantId}:${input.executionId}`,
        sourceReferences: [input.contextBundleReference ?? ''],
        producedAt: new Date().toISOString(),
      };
    },
  };

  // Phase C: Wire real adapters using placeholder/stub ports
  const leadOsintTool = createLeadOsintTool({
    osintPort: { async research() { return { companySize: 'Unknown', techStack: [] }; } },
    targetResolver: { async resolveTarget(ref) { return ref || 'example.com'; } },
    artifactStore: { async save() {} }
  });

  return [
    contextObserveTool,
    createStubTool('content.editorial.debate'),
    leadOsintTool,
    createStubTool('revenue.outreach.draft_sequence'),
    createStubTool('voice.callback.prepare'),
  ];
}
