import { randomUUID } from 'node:crypto';
import type { AiGateway } from '@expadio/ai-gateway';
import type { AgentToolAdapter, AgentToolAdapterInput, AgentToolObservation } from '../index.ts';
import { runEditorialDebate, type EditorialCommitteeBrief, type EditorialDebateResult } from './editorial-committee.ts';

export const EDITORIAL_COMMITTEE_TOOL_KEY = 'content.editorial.debate';

/**
 * Resolves the input.inputReference on an editorial task into the brief the
 * debate loop needs. Never hardcode brief content in the tool itself — the
 * reference always names where the real brief lives (see
 * PostgresTaskActionPayloadBriefResolver in postgres-runtime for the
 * production implementation, which reads it off the originating task).
 */
export interface EditorialBriefResolver {
  resolveBrief(inputReference: string, tenantId: string): Promise<EditorialCommitteeBrief>;
}

/**
 * Persists the full debate result (transcript, draft, score) somewhere a
 * later step can read it back by the returned observation's outputReference.
 * AgentToolObservation itself only carries a reference, never the payload
 * (see the design note on AgentToolObservation in agent-runtime/src/index.ts).
 */
export interface EditorialArtifactStore {
  save(input: { readonly tenantId: string; readonly key: string; readonly value: EditorialDebateResult }): Promise<void>;
}

export interface EditorialCommitteeToolOptions {
  readonly aiGateway: AiGateway;
  readonly briefResolver: EditorialBriefResolver;
  readonly artifactStore: EditorialArtifactStore;
  readonly maxRounds?: number;
  readonly consensusThreshold?: number;
}

/**
 * The Editorial Committee as a governed tool: Trend Hunter / Copywriter /
 * Critic debate a draft to consensus. This is an OBSERVE-effect tool — it
 * drafts and self-critiques but never publishes anything, so it can run as
 * part of a mission without requiring prior human approval. Publishing the
 * resulting draft is a separate, side-effecting action gated by the
 * Hierarchical Decision Bridge (governance/hierarchical-decision-bridge.ts),
 * which stages an approval request directly rather than relying on this
 * tool's own task-level requiresApproval flag.
 */
export function createEditorialCommitteeTool(
  options: EditorialCommitteeToolOptions,
): AgentToolAdapter {
  return {
    toolKey: EDITORIAL_COMMITTEE_TOOL_KEY,
    effect: 'OBSERVE',
    async invoke(input: AgentToolAdapterInput): Promise<AgentToolObservation> {
      const brief = await options.briefResolver.resolveBrief(input.inputReference, input.tenantId);

      const result = await runEditorialDebate(
        { tenantId: input.tenantId, brief, correlationId: () => randomUUID() },
        {
          aiGateway: options.aiGateway,
          ...(options.maxRounds !== undefined ? { maxRounds: options.maxRounds } : {}),
          ...(options.consensusThreshold !== undefined ? { consensusThreshold: options.consensusThreshold } : {}),
        },
      );

      const artifactKey = `editorial-debate:${input.executionId}`;
      await options.artifactStore.save({ tenantId: input.tenantId, key: artifactKey, value: result });

      return {
        executionId: input.executionId,
        tenantId: input.tenantId,
        toolKey: EDITORIAL_COMMITTEE_TOOL_KEY,
        kind: 'OBSERVATION',
        outputReference: `memory://${artifactKey}`,
        sourceReferences: [input.contextBundleReference],
        producedAt: new Date().toISOString(),
      };
    },
  };
}
