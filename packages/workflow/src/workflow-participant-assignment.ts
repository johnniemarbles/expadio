export type WorkflowParticipantTargetKind =
  | 'USER'
  | 'ROLE'
  | 'PERSONA'
  | 'TEAM'
  | 'QUEUE'
  | 'ORGANIZATION'
  | 'TERRITORY'
  | 'EXTERNAL_PARTY'
  | 'SYSTEM'
  | 'AI_AGENT';

export interface WorkflowParticipantTarget {
  readonly kind: WorkflowParticipantTargetKind;
  readonly key: string;
}

export type WorkflowParticipantAssignmentStatus =
  | 'ASSIGNED'
  | 'UNASSIGNED'
  | 'INELIGIBLE'
  | 'UNAVAILABLE';

/**
 * Resolution for one semantic participant slot such as `reviewer` or
 * `approver`. The workflow engine does not know how people/teams/agents were
 * selected; assignment strategy belongs behind the provider port.
 */
export interface WorkflowParticipantAssignment {
  readonly participantKey: string;
  readonly status: WorkflowParticipantAssignmentStatus;
  readonly assignmentId?: string;
  readonly target?: WorkflowParticipantTarget;
  readonly code: string;
  readonly evidenceRefs: readonly string[];
}

export interface WorkflowParticipantAssignmentContext {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly workTypeKey: string;
  readonly stageKey: string;
}

export interface WorkflowParticipantAssignmentProvider {
  resolve(input: {
    readonly context: WorkflowParticipantAssignmentContext;
    readonly participantKeys: readonly string[];
  }): Promise<readonly WorkflowParticipantAssignment[]>;
}

/** Fail closed unless the semantic participant slot has an effective assignment. */
export function isWorkflowParticipantAssignmentBlocking(
  assignment: WorkflowParticipantAssignment,
): boolean {
  return assignment.status !== 'ASSIGNED';
}
