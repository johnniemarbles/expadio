/**
 * Live AutoGTM engine seam on EXPADIO.
 * Scores and classifies only. Never sends. Never auto-approves.
 */

import {
  classifyReplyText,
  scoreFit,
  scoringMayAutoApprove,
  type FitScoreInput,
  type FitScoreResult,
  type IcpFitTarget,
} from '../../../packages/gtm/src/index.ts';

export { scoringMayAutoApprove };

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim());
}

export function icpFitTargetFromPayload(payload: unknown): IcpFitTarget {
  const row =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  return {
    industries: stringList(row.industries),
    geographies: stringList(row.geographies),
    companySizeHints: stringList(row.companySizeHints),
    titleHints: stringList(row.titleHints),
    seniorityHints: stringList(row.seniorityHints),
    disqualifiers: stringList(row.disqualifiers),
  };
}

export function fitInputFromObservation(params: {
  readonly email: string;
  readonly industry?: string;
  readonly geography?: string;
  readonly companySize?: string;
  readonly title?: string;
  readonly seniority?: string;
}): FitScoreInput {
  const domain = params.email.split('@')[1] ?? '';
  const consumer = /^(gmail|yahoo|hotmail|outlook|icloud)\./i.test(domain);
  return {
    industry: params.industry,
    geography: params.geography,
    companySize: params.companySize,
    title: params.title,
    seniority: params.seniority,
    hasValidatedEmail: params.email.includes('@'),
    hasCommercialDomain: domain !== '' && !consumer,
  };
}

export function scoreProspectObservation(
  input: FitScoreInput,
  icp: IcpFitTarget,
): FitScoreResult {
  if (scoringMayAutoApprove()) {
    throw new Error('fit scoring must not auto-approve');
  }
  return scoreFit(input, icp);
}

export function classifyReplyBody(rawBody: string): {
  proposedClass: ReturnType<typeof classifyReplyText>['proposedClass'];
  confidence: number;
} {
  return classifyReplyText(rawBody);
}
