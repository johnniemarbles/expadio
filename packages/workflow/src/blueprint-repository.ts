import type {
  WorkflowBlueprintDefinition,
  WorkflowBlueprintIdentity,
} from './index.ts';

export type WorkflowBlueprintScope =
  | { readonly type: 'PLATFORM' }
  | { readonly type: 'TENANT'; readonly tenantId: string };

export interface WorkflowBlueprintRepository {
  create(definition: WorkflowBlueprintDefinition): Promise<WorkflowBlueprintDefinition>;

  findByIdentity(input: {
    readonly scope: WorkflowBlueprintScope;
    readonly identity: WorkflowBlueprintIdentity;
  }): Promise<WorkflowBlueprintDefinition | null>;

  listVersions(input: {
    readonly scope: WorkflowBlueprintScope;
    readonly blueprintKey: string;
  }): Promise<readonly WorkflowBlueprintDefinition[]>;

  /**
   * Returns ACTIVE candidates for one work type within exactly one scope.
   * Resolver precedence and ambiguity handling remain outside persistence.
   */
  listActiveForWorkType(input: {
    readonly scope: WorkflowBlueprintScope;
    readonly workTypeKey: string;
  }): Promise<readonly WorkflowBlueprintDefinition[]>;
}
