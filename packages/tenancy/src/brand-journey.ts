import { platformSafeRef, type PlatformSafeRef } from './audience-boundary.ts';

export const BRAND_JOURNEY_STEPS = ['CASE', 'SCHEDULE', 'CREATE_TASK', 'COMMUNICATE', 'DELIVERY'] as const;
export type BrandJourneyStep = (typeof BRAND_JOURNEY_STEPS)[number];

export const JOURNEY_OBSERVATION_STATES = [
  'not-observed',
  'queued',
  'sent',
  'delivered',
  'failed',
  'uncertain',
] as const;
export type JourneyObservationState = (typeof JOURNEY_OBSERVATION_STATES)[number];

export type FrozenExecutorClass = 'SCHEDULE' | 'CREATE_TASK' | 'COMMUNICATE';

export const CS104_CORRELATION = 'CS-104';
export const BRAND_JOURNEY_ROUTE = '/api/brand/journey' as const;
export const BRAND_FALLBACK_JOURNEY_ROUTE = '/brand/api/journey' as const;
export const PLATFORM_JOURNEY_CORRELATION_ROUTE = '/api/journey-correlation' as const;

export type BrandJourneyStepObservation = {
  readonly step: BrandJourneyStep;
  readonly state: JourneyObservationState;
  readonly executor: FrozenExecutorClass | null;
  readonly source: 'frozen-executor' | 'none';
};

export type BrandJourneyObservation = {
  readonly correlation: string;
  readonly caseId: string | null;
  readonly steps: readonly BrandJourneyStepObservation[];
  readonly mutationsEnabled: false;
  readonly autoSend: false;
};

export type JourneyExecutorFact = {
  readonly correlation: string;
  readonly executor: FrozenExecutorClass;
  readonly state: Exclude<JourneyObservationState, 'not-observed'>;
};

const STEP_EXECUTOR: Record<BrandJourneyStep, FrozenExecutorClass | null> = {
  CASE: null,
  SCHEDULE: 'SCHEDULE',
  CREATE_TASK: 'CREATE_TASK',
  COMMUNICATE: 'COMMUNICATE',
  DELIVERY: 'COMMUNICATE',
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function parseJourneyCorrelation(value: string | null | undefined): string {
  const raw = (value ?? CS104_CORRELATION).trim();
  if (!/^CS-\d{3,}$/.test(raw)) {
    throw new Error('INVALID_JOURNEY_CORRELATION');
  }
  return raw;
}

/** Honest empty observation. Scheduling or a completed task is not delivery. */
export function emptyBrandJourneyObservation(
  correlation: string,
  caseId: string | null = null,
): BrandJourneyObservation {
  return {
    correlation: parseJourneyCorrelation(correlation),
    caseId,
    mutationsEnabled: false,
    autoSend: false,
    steps: BRAND_JOURNEY_STEPS.map((step) => ({
      step,
      state: 'not-observed',
      executor: STEP_EXECUTOR[step],
      source: STEP_EXECUTOR[step] ? 'frozen-executor' : 'none',
    })),
  };
}

export function assertJourneyIsObservationOnly(observation: BrandJourneyObservation): void {
  if (observation.mutationsEnabled !== false || observation.autoSend !== false) {
    throw new Error('BRAND_JOURNEY_MUTATION_FORBIDDEN');
  }
}

export function refuseBrandJourneyWrite(method: string): void {
  if (WRITE_METHODS.has(method.toUpperCase())) {
    throw new Error('BRAND_JOURNEY_MUTATION_FORBIDDEN');
  }
}

function applyFact(
  step: BrandJourneyStepObservation,
  facts: ReadonlyMap<FrozenExecutorClass, JourneyObservationState>,
): BrandJourneyStepObservation {
  if (step.step === 'CASE' || step.executor === null) return step;
  if (step.step === 'DELIVERY') {
    const comm = facts.get('COMMUNICATE');
    if (comm === 'sent' || comm === 'delivered' || comm === 'failed' || comm === 'uncertain') {
      return { ...step, state: comm };
    }
    return step;
  }
  const next = facts.get(step.executor);
  return next ? { ...step, state: next } : step;
}

/**
 * Fold read-only frozen-executor facts onto the CS-104 plan.
 * SCHEDULE / CREATE_TASK may never claim sent or delivered.
 */
export function observeBrandJourneyFromFacts(
  correlation: string,
  caseId: string | null,
  facts: readonly JourneyExecutorFact[],
): BrandJourneyObservation {
  const parsed = parseJourneyCorrelation(correlation);
  const byExecutor = new Map<FrozenExecutorClass, JourneyObservationState>();
  for (const fact of facts) {
    if (fact.correlation !== parsed) continue;
    if (
      (fact.executor === 'SCHEDULE' || fact.executor === 'CREATE_TASK') &&
      (fact.state === 'sent' || fact.state === 'delivered')
    ) {
      throw new Error('JOURNEY_DELIVERY_NOT_INFERRED');
    }
    byExecutor.set(fact.executor, fact.state);
  }
  const observation: BrandJourneyObservation = {
    ...emptyBrandJourneyObservation(parsed, caseId),
    steps: emptyBrandJourneyObservation(parsed, caseId).steps.map((step) => applyFact(step, byExecutor)),
  };
  assertJourneyIsObservationOnly(observation);
  return observation;
}

/** Platform may keep the correlation. It may not keep the customer record. */
export function platformViewOfJourney(observation: BrandJourneyObservation): PlatformSafeRef {
  assertJourneyIsObservationOnly(observation);
  return platformSafeRef({
    tenant: 'UNRESOLVED',
    brand: 'UNRESOLVED',
    correlation: observation.correlation,
    ...(observation.caseId ? { caseId: observation.caseId } : {}),
  });
}
