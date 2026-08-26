export type WiringStatus = 'fixture' | 'partial' | 'live';

export interface DataSource {
  kind: WiringStatus;
  label: string;
  capturedAt: string;
}

export interface DeniedResult {
  denied: true;
  reasonKey: string;
  message: string;
  correlationId?: string;
}

export type AdapterResult<T> = T | DeniedResult;

export function isDenied<T>(result: AdapterResult<T>): result is DeniedResult {
  return (result as DeniedResult).denied === true;
}

export type HealthTone = 'positive' | 'attention' | 'neutral';
