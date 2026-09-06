import { randomUUID } from 'node:crypto';
import type { 
  AgentToolAuthorizationPort, 
  AgentToolAdapter,
  AgentToolAuthorizationQuery,
  AgentToolAdapterInput
} from '../index';

export function createMissionAuthorizationPort(tenantId: string): AgentToolAuthorizationPort {
  return {
    async authorize(query: AgentToolAuthorizationQuery) {
      const decisionId = randomUUID();
      if (query.tenantId !== tenantId) {
        return { decisionId, allowed: false, reasonKey: 'TENANT_MISMATCH' };
      }
      if (query.effect === 'PROPOSE') {
        return { decisionId, allowed: false, reasonKey: 'PROPOSE_REQUIRES_POLICY' };
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

  return [
    contextObserveTool,
    createStubTool('content.editorial.debate'),
    createStubTool('revenue.lead.osint'),
    createStubTool('revenue.outreach.draft_sequence'),
    createStubTool('voice.callback.prepare'),
  ];
}
