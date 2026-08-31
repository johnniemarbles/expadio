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

const STEP_EXECUTOR: Record<BrandJourneyStep, FrozenExecutorClass | null> = {
  CASE: null,
  SCHEDULE: 'SCHEDULE',
  CREATE_TASK: 'CREATE_TASK',
  COMMUNICATE: 'COMMUNICATE',
  DELIVERY: 'COMMUNICATE',
};

/** Honest empty observation. Scheduling or a completed task is not delivery. */
export function emptyBrandJourneyObservation(
  correlation: string,
  caseId: string | null = null,
): BrandJourneyObservation {
  return {
    correlation,
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
