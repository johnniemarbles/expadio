export const DEMAND_CAPTURE_STAGES = [
  'NEW_ENQUIRY',
  'CONTACT_ATTEMPTED',
  'CONTACTED',
  'QUALIFICATION',
  'QUALIFIED',
  'DISCOVERY_SCHEDULED',
  'DISCOVERY_COMPLETED',
  'OPPORTUNITY_EVALUATION',
  'APPLICATION_INVITED',
  'APPLICATION_STARTED',
  'APPLICATION_SUBMITTED',
  'DUE_DILIGENCE',
  'APPROVAL',
  'AGREEMENT',
  'ACTIVATION',
  'WON',
  'LOST',
  'DISQUALIFIED',
  'NURTURE',
] as const;

export type DemandCaptureStage = (typeof DEMAND_CAPTURE_STAGES)[number];

export const DEMAND_CAPTURE_STATUSES = [
  'ACTIVE',
  'WAITING_ON_LEAD',
  'WAITING_INTERNAL',
  'ON_HOLD',
  'STALLED',
  'DISQUALIFIED',
  'CONVERTED',
  'LOST',
  'ARCHIVED',
] as const;

export type DemandCaptureStatus = (typeof DEMAND_CAPTURE_STATUSES)[number];

export const TERMINAL_STAGES = new Set<string>(['WON', 'LOST', 'DISQUALIFIED']);

const STAGE_ORDER: Record<string, number> = {
  NEW_ENQUIRY: 0,
  CONTACT_ATTEMPTED: 1,
  CONTACTED: 2,
  QUALIFICATION: 3,
  QUALIFIED: 4,
  DISCOVERY_SCHEDULED: 5,
  DISCOVERY_COMPLETED: 6,
  OPPORTUNITY_EVALUATION: 7,
  APPLICATION_INVITED: 8,
  APPLICATION_STARTED: 9,
  APPLICATION_SUBMITTED: 10,
  DUE_DILIGENCE: 11,
  APPROVAL: 12,
  AGREEMENT: 13,
  ACTIVATION: 14,
  WON: 15,
  LOST: 16,
  DISQUALIFIED: 17,
  NURTURE: 18,
};

export function getStageIndex(stage: string): number {
  return STAGE_ORDER[stage] ?? -1;
}

export function isTerminalStage(stage: string): boolean {
  return TERMINAL_STAGES.has(stage);
}

export function isNurtureStage(stage: string): boolean {
  return stage === 'NURTURE';
}

export function isReopenStage(currentStage: string, targetStage: string): boolean {
  return isTerminalStage(currentStage) && !isTerminalStage(targetStage);
}

export function isReverseStage(currentStage: string, targetStage: string): boolean {
  const currIdx = getStageIndex(currentStage);
  const targetIdx = getStageIndex(targetStage);
  if (currIdx === -1 || targetIdx === -1) return false;
  if (isTerminalStage(currentStage) || isTerminalStage(targetStage)) return false;
  if (isNurtureStage(currentStage) || isNurtureStage(targetStage)) return false;
  return targetIdx < currIdx;
}

export function isSkipStage(currentStage: string, targetStage: string): boolean {
  const currIdx = getStageIndex(currentStage);
  const targetIdx = getStageIndex(targetStage);
  if (currIdx === -1 || targetIdx === -1) return false;
  if (isTerminalStage(currentStage) || isTerminalStage(targetStage)) return false;
  if (isNurtureStage(currentStage) || isNurtureStage(targetStage)) return false;
  return targetIdx > currIdx + 1;
}

export function requiresStageReason(currentStage: string, targetStage: string): boolean {
  if (currentStage === targetStage) return false;
  return (
    isSkipStage(currentStage, targetStage) ||
    isReverseStage(currentStage, targetStage) ||
    isNurtureStage(targetStage) ||
    isReopenStage(currentStage, targetStage)
  );
}

export function requiresCloseReason(targetStage: string): boolean {
  return isTerminalStage(targetStage);
}

export function requiresStatusReason(currentStatus: string, targetStatus: string): boolean {
  return currentStatus !== targetStatus;
}

export type TransitionRequirements = {
  needStageReason: boolean;
  stageReasonPlaceholder: string;
  needCloseReason: boolean;
  closeReasonPlaceholder: string;
  needStatusReason: boolean;
  statusReasonPlaceholder: string;
};

export function getTransitionRequirements(
  currentStage: string,
  targetStage: string,
  currentStatus: string,
  targetStatus: string,
): TransitionRequirements {
  const needStageReason = requiresStageReason(currentStage, targetStage);
  const needCloseReason = requiresCloseReason(targetStage);
  const needStatusReason = requiresStatusReason(currentStatus, targetStatus);

  let stageReasonPlaceholder = 'Reason for stage transition';
  if (isSkipStage(currentStage, targetStage)) {
    stageReasonPlaceholder = 'Reason for skipping pipeline stages…';
  } else if (isReverseStage(currentStage, targetStage)) {
    stageReasonPlaceholder = 'Reason for moving backward in pipeline…';
  } else if (isNurtureStage(targetStage)) {
    stageReasonPlaceholder = 'Reason for placing lead into nurture…';
  } else if (isReopenStage(currentStage, targetStage)) {
    stageReasonPlaceholder = 'Reason for reopening closed lead…';
  }

  const closeReasonPlaceholder = 'Close reason code (e.g. COMPETITOR, UNRESPONSIVE, PRICE, CONVERTED)…';
  const statusReasonPlaceholder = 'Reason for operational status change…';

  return {
    needStageReason,
    stageReasonPlaceholder,
    needCloseReason,
    closeReasonPlaceholder,
    needStatusReason,
    statusReasonPlaceholder,
  };
}
