import type { DurableArtifactSource } from '@expadio/storage';

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


export class DurableArtifactVoiceInputResolver implements VoiceInputResolver {
  readonly #source: DurableArtifactSource;
  readonly #now: () => Date;

  constructor(
    source: DurableArtifactSource,
    now: () => Date = () => new Date(),
  ) {
    this.#source = source;
    this.#now = now;
  }

  async resolveText(input: {
    readonly tenantId: string;
    readonly reference: string;
    readonly purpose: string;
    readonly requiredResidencyTags: readonly string[];
    readonly requiredComplianceTags: readonly string[];
  }): Promise<ResolvedVoiceTextInput> {
    this.#validateRequest(input);
    const resolved = await this.#source.readText(input);
    if (
      resolved.contentReference.trim() === ''
      || resolved.content.trim() === ''
    ) {
      throw new Error('VOICE_INPUT_TEXT_RESULT_INVALID');
    }
    return {
      content: resolved.content,
      sourceReference: resolved.contentReference,
    };
  }

  async resolveProviderFetchUrl(input: {
    readonly tenantId: string;
    readonly reference: string;
    readonly purpose: string;
    readonly requiredResidencyTags: readonly string[];
    readonly requiredComplianceTags: readonly string[];
  }): Promise<ResolvedVoiceMediaInput> {
    this.#validateRequest(input);
    const resolved = await this.#source.issueProviderFetchUrl(input);

    let url: URL;
    try {
      url = new URL(resolved.providerFetchUrl);
    } catch {
      throw new Error('VOICE_INPUT_PROVIDER_URL_INVALID');
    }
    if (url.protocol !== 'https:' || resolved.contentReference.trim() === '') {
      throw new Error('VOICE_INPUT_PROVIDER_URL_INVALID');
    }

    const expiresAt = Date.parse(resolved.expiresAt);
    const now = this.#now().getTime();
    if (!Number.isFinite(expiresAt) || !Number.isFinite(now) || expiresAt <= now) {
      throw new Error('VOICE_INPUT_PROVIDER_URL_EXPIRED');
    }

    return {
      providerFetchUrl: resolved.providerFetchUrl,
      sourceReference: resolved.contentReference,
    };
  }

  #validateRequest(input: {
    readonly tenantId: string;
    readonly reference: string;
    readonly purpose: string;
  }): void {
    if (
      input.tenantId.trim() === ''
      || input.reference.trim() === ''
      || input.purpose.trim() === ''
    ) {
      throw new Error('VOICE_INPUT_RESOLUTION_REQUEST_INVALID');
    }
  }
}
