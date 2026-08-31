export interface ResolvedVoiceTextInput {
  readonly content: string;
  readonly sourceReference: string;
}

export interface ResolvedVoiceMediaInput {
  readonly providerFetchUrl: string;
  readonly sourceReference: string;
}

export interface VoiceInputResolver {
  resolveText(input: {
    readonly tenantId: string;
    readonly reference: string;
    readonly purpose: string;
    readonly requiredResidencyTags: readonly string[];
    readonly requiredComplianceTags: readonly string[];
  }): Promise<ResolvedVoiceTextInput>;

  resolveProviderFetchUrl(input: {
    readonly tenantId: string;
    readonly reference: string;
    readonly purpose: string;
    readonly requiredResidencyTags: readonly string[];
    readonly requiredComplianceTags: readonly string[];
  }): Promise<ResolvedVoiceMediaInput>;
}
