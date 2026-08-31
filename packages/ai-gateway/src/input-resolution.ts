import type { DurableArtifactSource } from '@expadio/storage';

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


export class DurableArtifactAiInputResolver implements AiInputResolver {
  readonly #source: DurableArtifactSource;

  constructor(source: DurableArtifactSource) {
    this.#source = source;
  }

  async resolveText(input: {
    readonly tenantId: string;
    readonly reference: string;
    readonly purpose: string;
    readonly requiredResidencyTags: readonly string[];
    readonly requiredComplianceTags: readonly string[];
  }): Promise<ResolvedAiTextInput> {
    if (
      input.tenantId.trim() === ''
      || input.reference.trim() === ''
      || input.purpose.trim() === ''
    ) {
      throw new Error('AI_INPUT_RESOLUTION_REQUEST_INVALID');
    }

    const resolved = await this.#source.readText(input);
    if (
      resolved.contentReference.trim() === ''
      || resolved.content.trim() === ''
    ) {
      throw new Error('AI_INPUT_RESOLUTION_RESULT_INVALID');
    }

    return {
      content: resolved.content,
      sourceReference: resolved.contentReference,
    };
  }
}
