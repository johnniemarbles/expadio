export interface ResolvedAiTextInput {
  readonly content: string;
  readonly sourceReference: string;
}

export interface AiInputResolver {
  resolveText(input: {
    readonly tenantId: string;
    readonly reference: string;
    readonly purpose: string;
    readonly requiredResidencyTags: readonly string[];
    readonly requiredComplianceTags: readonly string[];
  }): Promise<ResolvedAiTextInput>;
}
