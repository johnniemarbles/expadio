export type OperationalHealth = 'UNCONFIGURED' | 'STEADY' | 'DEGRADED';

export type LifecycleStatus =
  | 'LOADING'
  | 'EMPTY'
  | 'NOT_ENTITLED'
  | 'DENIED'
  | 'ERROR'
  | 'READY';

export interface DegradedExplanation {
  readonly blastRadius: string;
  readonly rootCause: string;
  readonly remediationLabel: string;
  readonly remediationHref?: string | undefined;
}

export interface LifecycleError {
  readonly code: string;
  readonly message: string;
  readonly retryLabel?: string | undefined;
}

export interface DashboardState {
  readonly health: OperationalHealth;
  readonly lifecycle: LifecycleStatus;
  readonly degraded?: DegradedExplanation | undefined;
  readonly error?: LifecycleError | undefined;
}

export interface DashboardStateInput {
  readonly loading?: boolean | undefined;
  readonly denied?: boolean | undefined;
  readonly notEntitled?: boolean | undefined;
  readonly error?: LifecycleError | undefined;
  readonly empty?: boolean | undefined;
  readonly configured?: boolean | undefined;
  readonly degraded?: DegradedExplanation | undefined;
}

export function resolveDashboardState(input: DashboardStateInput): DashboardState {
  if (input.loading) return { health: 'STEADY', lifecycle: 'LOADING' };
  if (input.notEntitled) return { health: 'UNCONFIGURED', lifecycle: 'NOT_ENTITLED' };
  if (input.denied) return { health: 'UNCONFIGURED', lifecycle: 'DENIED' };
  if (input.error) return { health: 'DEGRADED', lifecycle: 'ERROR', error: input.error };
  if (input.configured === false) return { health: 'UNCONFIGURED', lifecycle: 'READY' };
  if (input.degraded) return { health: 'DEGRADED', lifecycle: 'READY', degraded: input.degraded };
  if (input.empty) return { health: 'STEADY', lifecycle: 'EMPTY' };
  return { health: 'STEADY', lifecycle: 'READY' };
}

export function isOperationallyBlocked(state: DashboardState): boolean {
  return state.lifecycle === 'DENIED'
    || state.lifecycle === 'NOT_ENTITLED'
    || state.lifecycle === 'ERROR';
}
