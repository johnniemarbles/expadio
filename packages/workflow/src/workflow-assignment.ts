export type WorkflowParticipantType =
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

export interface WorkflowParticipantReference {
  readonly type: WorkflowParticipantType;
  /** Opaque identifier in the owning directory/configuration system. */
  readonly key: string;
}

export interface WorkflowAssignmentContext {
  readonly tenantId: string;
  readonly instanceId: string;
  readonly workTypeKey: string;
  readonly stageKey: string;
  readonly participantKey: string;
}

export type WorkflowAssignmentResolution =
  | {
      readonly status: 'RESOLVED';
      readonly target: WorkflowParticipantReference;
      readonly strategy: string;
      readonly evidenceRefs: readonly string[];
      readonly trace: readonly string[];
    }
  | {
      readonly status: 'UNRESOLVED';
      readonly code: string;
      readonly trace: readonly string[];
    };

/**
 * Resolves a semantic blueprint participant key (for example `reviewer`) into
 * an assignable target. Implementations may use role/persona/team/queue,
 * territory, relationship, skills, availability or load without coupling those
 * data models into the universal workflow package.
 */
export interface WorkflowAssignmentResolver {
  resolve(context: WorkflowAssignmentContext): Promise<WorkflowAssignmentResolution>;
}
