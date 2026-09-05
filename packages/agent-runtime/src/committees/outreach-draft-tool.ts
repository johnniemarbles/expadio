import { randomUUID } from 'node:crypto';
import type { AiGateway, AiInvocationIntent } from '@expadio/ai-gateway';
import type { AgentToolAdapter, AgentToolAdapterInput, AgentToolObservation } from '../index.ts';
import type { LeadDossier } from './lead-osint-tool.ts';

export interface OutreachTouch {
  readonly subject: string;
  readonly body: string;
  readonly sendAfterDays: number;
}

export interface OutreachSequenceResult {
  readonly leadName: string;
  readonly touches: readonly OutreachTouch[];
  readonly citedDossierKey: string;
}

export interface OutreachBrief {
  readonly leadName: string;
  readonly dossierKey: string;
  readonly brandVoiceGuideline: string;
  readonly caseStudyReferences: readonly string[];
}

export interface OutreachBriefResolver {
  resolveBrief(inputReference: string, tenantId: string): Promise<OutreachBrief>;
}

/** Reads back a dossier previously produced by the lead-osint tool. */
export interface LeadDossierReader {
  getDossier(tenantId: string, key: string): Promise<LeadDossier | null>;
}

export interface OutreachArtifactStore {
  save(input: { readonly tenantId: string; readonly key: string; readonly value: OutreachSequenceResult }): Promise<void>;
}

export interface OutreachDraftToolOptions {
  readonly aiGateway: AiGateway;
  readonly briefResolver: OutreachBriefResolver;
  readonly dossierReader: LeadDossierReader;
  readonly artifactStore: OutreachArtifactStore;
  readonly promptConfigurationKey?: string;
  readonly promptConfigurationVersion?: number;
  readonly now?: () => string;
}

export class OutreachDraftError extends Error {
  readonly code: 'OUTREACH_DOSSIER_NOT_FOUND';
  constructor(code: 'OUTREACH_DOSSIER_NOT_FOUND', message: string) {
    super(message);
    this.name = 'OutreachDraftError';
    this.code = code;
  }
}

export const OUTREACH_DRAFT_TOOL_KEY = 'revenue.outreach.draft_sequence';

const TOUCH_SCHEDULE_DAYS = [0, 3, 7] as const;

/**
 * Email Outreach Specialist: drafts a hyper-personalized 3-touch sequence
 * citing the lead's dossier (produced by the lead-osint tool). OBSERVE
 * effect: this tool only drafts text -- it never sends anything. Actually
 * dispatching a drafted touch is a separate, side-effecting action that goes
 * through this codebase's existing governed communication pipeline
 * (@expadio/communication's dispatch/consent infrastructure), not a new
 * bespoke "send" tool.
 */
export function createOutreachDraftTool(options: OutreachDraftToolOptions): AgentToolAdapter {
  const promptKey = options.promptConfigurationKey ?? 'agent-runtime.outreach-committee';
  const promptVersion = options.promptConfigurationVersion ?? 1;
  const now = options.now ?? (() => new Date().toISOString());

  return {
    toolKey: OUTREACH_DRAFT_TOOL_KEY,
    effect: 'OBSERVE',
    async invoke(input: AgentToolAdapterInput): Promise<AgentToolObservation> {
      const brief = await options.briefResolver.resolveBrief(input.inputReference, input.tenantId);
      const dossier = await options.dossierReader.getDossier(input.tenantId, brief.dossierKey);
      if (!dossier) {
        throw new OutreachDraftError(
          'OUTREACH_DOSSIER_NOT_FOUND',
          `No dossier found at key "${brief.dossierKey}" for tenant ${input.tenantId}.`,
        );
      }

      const touches: OutreachTouch[] = [];
      for (const sendAfterDays of TOUCH_SCHEDULE_DAYS) {
        const invocationId = randomUUID();
        const intent: AiInvocationIntent = {
          invocationId,
          tenantId: input.tenantId,
          operation: 'GENERATE',
          purpose: `revenue.outreach.touch.${touches.length + 1}`,
          inputReference: touchPrompt(brief, dossier, touches),
          promptConfiguration: { key: promptKey, version: promptVersion },
          governance: {
            requiredResidencyTags: [],
            requiredComplianceTags: ['outreach-governance'],
          },
          idempotencyKey: `${invocationId}:touch-${touches.length + 1}`,
          requestedAt: now(),
        };
        const proposal = await options.aiGateway.invoke(intent);
        const rendered = parseTouchOutput(proposal.outputContent?.value ?? '');
        touches.push({ ...rendered, sendAfterDays });
      }

      const result: OutreachSequenceResult = {
        leadName: brief.leadName,
        touches,
        citedDossierKey: brief.dossierKey,
      };

      const artifactKey = `outreach-sequence:${input.executionId}`;
      await options.artifactStore.save({ tenantId: input.tenantId, key: artifactKey, value: result });

      return {
        executionId: input.executionId,
        tenantId: input.tenantId,
        toolKey: OUTREACH_DRAFT_TOOL_KEY,
        kind: 'OBSERVATION',
        outputReference: `memory://${artifactKey}`,
        sourceReferences: [input.contextBundleReference],
        producedAt: new Date().toISOString(),
      };
    },
  };
}

interface TouchOutput {
  readonly subject: string;
  readonly body: string;
}

function parseTouchOutput(raw: string): TouchOutput {
  try {
    const parsed = JSON.parse(raw) as Partial<TouchOutput>;
    if (typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
      throw new Error('missing subject/body');
    }
    return { subject: parsed.subject, body: parsed.body };
  } catch (err) {
    throw new Error(
      `OUTREACH_TOUCH_OUTPUT_INVALID: expected JSON {subject, body}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function touchPrompt(brief: OutreachBrief, dossier: LeadDossier, priorTouches: readonly OutreachTouch[]): string {
  const touchNumber = priorTouches.length + 1;
  return [
    'You are the Email Outreach Specialist Agent for EXPADIO.',
    `Lead: ${brief.leadName}.`,
    `Dossier: ${JSON.stringify(dossier)}.`,
    `Brand voice: ${brief.brandVoiceGuideline}.`,
    `Relevant case studies: ${brief.caseStudyReferences.join(', ') || 'none provided'}.`,
    `This is touch ${touchNumber} of a 3-touch sequence.`,
    priorTouches.length > 0
      ? `Prior touch subject lines: ${priorTouches.map((t) => t.subject).join(' | ')}. Do not repeat the same angle.`
      : 'This is the first touch.',
    'Cite a specific, recent detail from the dossier -- never a generic opener.',
    'Output strict JSON: {"subject": string, "body": string}',
  ].join('\n');
}
