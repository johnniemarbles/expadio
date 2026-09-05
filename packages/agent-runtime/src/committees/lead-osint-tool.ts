import type { AgentToolAdapter, AgentToolAdapterInput, AgentToolObservation } from '../index.ts';

export interface LeadDossier {
  readonly companySize?: string;
  readonly fundingStage?: string;
  readonly techStack?: readonly string[];
  readonly recentNews?: readonly string[];
  readonly painPoints?: readonly string[];
  readonly estimatedBudget?: string;
  readonly expansionTimeline?: string;
  readonly jurisdiction?: string;
}

/**
 * Performs the actual research. Implementations must only call already
 * governed, read-only external data sources reached through this codebase's
 * existing HTTP egress/connector layer -- this tool must never scrape or
 * crawl third-party sites directly.
 */
export interface LeadOsintPort {
  research(companyDomainOrName: string): Promise<LeadDossier>;
}

/** Resolves the input.inputReference on a lead-research task into the
 * company domain/name to research. Mirrors EditorialBriefResolver's shape. */
export interface LeadTargetResolver {
  resolveTarget(inputReference: string, tenantId: string): Promise<string>;
}

/** Persists the dossier somewhere a later step (e.g. the outreach drafting
 * tool) can read it back by the returned observation's outputReference. */
export interface LeadArtifactStore {
  save(input: { readonly tenantId: string; readonly key: string; readonly value: LeadDossier }): Promise<void>;
}

export interface LeadOsintToolOptions {
  readonly osintPort: LeadOsintPort;
  readonly targetResolver: LeadTargetResolver;
  readonly artifactStore: LeadArtifactStore;
}

export const LEAD_OSINT_TOOL_KEY = 'revenue.lead.osint';

/**
 * Deep Lead OSINT & Data Research, compiled directly into a CRM-ready
 * dossier. OBSERVE effect: this tool only reads external, already-governed
 * data sources and produces a structured artifact -- it never mutates a CRM
 * record or sends anything, so it needs no prior approval to run.
 */
export function createLeadOsintTool(options: LeadOsintToolOptions): AgentToolAdapter {
  return {
    toolKey: LEAD_OSINT_TOOL_KEY,
    effect: 'OBSERVE',
    async invoke(input: AgentToolAdapterInput): Promise<AgentToolObservation> {
      const target = await options.targetResolver.resolveTarget(input.inputReference, input.tenantId);
      const dossier = await options.osintPort.research(target);

      const artifactKey = `lead-dossier:${input.executionId}`;
      await options.artifactStore.save({ tenantId: input.tenantId, key: artifactKey, value: dossier });

      return {
        executionId: input.executionId,
        tenantId: input.tenantId,
        toolKey: LEAD_OSINT_TOOL_KEY,
        kind: 'OBSERVATION',
        outputReference: `memory://${artifactKey}`,
        sourceReferences: [input.contextBundleReference],
        producedAt: new Date().toISOString(),
      };
    },
  };
}
