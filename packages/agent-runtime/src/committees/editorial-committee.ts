import type { AiGateway, AiInvocationIntent } from '@expadio/ai-gateway';

export interface EditorialCommitteeBrief {
  readonly verticalTheme: string;
  readonly brandVoiceGuideline: string;
  readonly compliancePack: string;
}

export interface EditorialDebateTurn {
  readonly role: 'TREND_HUNTER' | 'COPYWRITER' | 'CRITIC';
  readonly message: string;
  readonly score?: number;
}

export interface EditorialDebateResult {
  readonly topic: string;
  readonly hook: string;
  readonly fullCopy: string;
  readonly consensusScore: number;
  readonly compliancePass: boolean;
  readonly debateRoundsCount: number;
  readonly reviewTranscript: readonly EditorialDebateTurn[];
}

export interface EditorialCommitteeOptions {
  readonly aiGateway: AiGateway;
  readonly maxRounds?: number;
  readonly consensusThreshold?: number;
  readonly promptConfigurationKey?: string;
  readonly promptConfigurationVersion?: number;
  readonly now?: () => string;
}

export class EditorialCommitteeError extends Error {
  readonly code: 'EDITORIAL_HUNTER_OUTPUT_INVALID' | 'EDITORIAL_CRITIC_OUTPUT_INVALID';

  constructor(code: 'EDITORIAL_HUNTER_OUTPUT_INVALID' | 'EDITORIAL_CRITIC_OUTPUT_INVALID', message: string) {
    super(message);
    this.name = 'EditorialCommitteeError';
    this.code = code;
  }
}

/**
 * Runs the Trend Hunter / Copywriter / Critic multi-agent debate loop over the
 * governed AiGateway. Every LLM call goes through AiGateway.invoke(), which
 * enforces connector routing, residency/compliance requirements, and a cost
 * ceiling before any provider is called (see @expadio/ai-gateway RoutedAiGateway).
 *
 * This tool has no side effects outside the process: it drafts and critiques
 * copy but never publishes anything. Publishing is a separate, approval-gated
 * action (see governance/hierarchical-decision-bridge.ts).
 */
export async function runEditorialDebate(
  input: {
    readonly tenantId: string;
    readonly brief: EditorialCommitteeBrief;
    readonly correlationId: () => string;
  },
  options: EditorialCommitteeOptions,
): Promise<EditorialDebateResult> {
  const maxRounds = options.maxRounds ?? 3;
  const threshold = options.consensusThreshold ?? 9.0;
  const promptKey = options.promptConfigurationKey ?? 'agent-runtime.editorial-committee';
  const promptVersion = options.promptConfigurationVersion ?? 1;
  const now = options.now ?? (() => new Date().toISOString());

  const invoke = async (purpose: string, prompt: string): Promise<string> => {
    // Both shipped adapters (gemini-adapter.ts, openai-adapter.ts) send
    // intent.inputReference verbatim as the model prompt text, despite the
    // field's name — confirmed by reading both adapters rather than assumed.
    const invocationId = input.correlationId();
    const intent: AiInvocationIntent = {
      invocationId,
      tenantId: input.tenantId,
      operation: 'GENERATE',
      purpose,
      inputReference: prompt,
      promptConfiguration: { key: promptKey, version: promptVersion },
      governance: {
        requiredResidencyTags: [],
        requiredComplianceTags: ['content-governance'],
      },
      idempotencyKey: `${invocationId}:${purpose}`,
      requestedAt: now(),
    };
    const proposal = await options.aiGateway.invoke(intent);
    return proposal.outputContent?.value ?? '';
  };

  const hunterRaw = await invoke(
    'editorial.trend_hunter',
    hunterPrompt(input.brief.verticalTheme),
  );
  const hunter = parseHunterOutput(hunterRaw);

  const transcript: EditorialDebateTurn[] = [
    {
      role: 'TREND_HUNTER',
      message: `Identified angle "${hunter.angle}" with proposed hook "${hunter.hook}"`,
    },
  ];

  let draft = '';
  let consensusScore = 0;
  let compliancePass = false;
  let round = 1;

  // The loop's only exit conditions are the explicit break below (score AND
  // compliance both satisfied) and the round cap — score alone must never end
  // the loop, since a high score with a failed compliance check must still
  // get another revision pass.
  while (round <= maxRounds) {
    const priorCritique = transcript.at(-1)?.message ?? 'None, this is turn 1';
    draft = await invoke(
      'editorial.copywriter',
      writerPrompt(input.brief, hunter, priorCritique),
    );
    transcript.push({ role: 'COPYWRITER', message: draft });

    const criticRaw = await invoke(
      'editorial.critic',
      criticPrompt(input.brief, draft),
    );
    const critic = parseCriticOutput(criticRaw);
    consensusScore = critic.score;
    compliancePass = critic.compliancePass;
    transcript.push({ role: 'CRITIC', message: critic.critique, score: critic.score });

    if (consensusScore >= threshold && compliancePass) break;
    round += 1;
  }

  return {
    topic: hunter.angle,
    hook: hunter.hook,
    fullCopy: draft,
    consensusScore,
    compliancePass,
    debateRoundsCount: Math.min(round, maxRounds),
    reviewTranscript: transcript,
  };
}

interface HunterOutput {
  readonly angle: string;
  readonly hook: string;
}

interface CriticOutput {
  readonly score: number;
  readonly critique: string;
  readonly compliancePass: boolean;
}

function parseHunterOutput(raw: string): HunterOutput {
  try {
    const parsed = JSON.parse(raw) as Partial<HunterOutput>;
    if (typeof parsed.angle !== 'string' || typeof parsed.hook !== 'string') {
      throw new Error('missing angle/hook');
    }
    return { angle: parsed.angle, hook: parsed.hook };
  } catch (err) {
    throw new EditorialCommitteeError(
      'EDITORIAL_HUNTER_OUTPUT_INVALID',
      `Trend Hunter output was not valid JSON with {angle, hook}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function parseCriticOutput(raw: string): CriticOutput {
  try {
    const parsed = JSON.parse(raw) as Partial<CriticOutput>;
    if (
      typeof parsed.score !== 'number'
      || !Number.isFinite(parsed.score)
      || typeof parsed.critique !== 'string'
      || typeof parsed.compliancePass !== 'boolean'
    ) {
      throw new Error('missing score/critique/compliancePass');
    }
    return { score: parsed.score, critique: parsed.critique, compliancePass: parsed.compliancePass };
  } catch (err) {
    throw new EditorialCommitteeError(
      'EDITORIAL_CRITIC_OUTPUT_INVALID',
      `Critic output was not valid JSON with {score, critique, compliancePass}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function hunterPrompt(verticalTheme: string): string {
  return [
    'You are the Trend Hunter Agent for EXPADIO.',
    `Industry vertical: ${verticalTheme}.`,
    'Identify a high-engagement, non-cliche hook about current commercial expansion developments.',
    'Output strict JSON: {"angle": string, "hook": string}',
  ].join('\n');
}

function writerPrompt(brief: EditorialCommitteeBrief, hunter: HunterOutput, priorCritique: string): string {
  return [
    'You are the Persona Copywriter Agent for EXPADIO.',
    `Brand voice: ${brief.brandVoiceGuideline}.`,
    `Trend angle: ${hunter.angle}. Target hook: ${hunter.hook}.`,
    `Previous critique: ${priorCritique}`,
    'Draft an authoritative 4-part thought-leadership post explaining operational scaling.',
    "Avoid corporate jargon (e.g. 'synergy', 'game-changer'). Provide concrete numbers and steps.",
  ].join('\n');
}

function criticPrompt(brief: EditorialCommitteeBrief, draft: string): string {
  return [
    'You are the Adversarial Compliance and Style Critic for EXPADIO.',
    `Statutory compliance rules: ${brief.compliancePack}.`,
    `Brand guidelines: ${brief.brandVoiceGuideline}.`,
    `Active draft under review:\n"${draft}"`,
    'Check for unrealistic financial performance representations, cringe or passive corporate tone.',
    'Score the draft 1-10 (10 = publication ready).',
    'Output strict JSON: {"score": number, "critique": string, "compliancePass": boolean}',
  ].join('\n');
}
