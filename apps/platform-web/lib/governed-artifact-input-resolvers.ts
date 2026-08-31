import type { AiInputResolver } from '@expadio/ai-gateway';
import type { VoiceInputResolver } from '@expadio/voice-gateway';
import type { DurableArtifactSource } from '@expadio/storage';

export function governedArtifactAiInputResolver(
  source: DurableArtifactSource,
): AiInputResolver {
  return {
    async resolveText(input) {
      const resolved = await source.readText({
        tenantId: input.tenantId,
        reference: input.reference,
        purpose: input.purpose,
        requiredResidencyTags: input.requiredResidencyTags,
        requiredComplianceTags: input.requiredComplianceTags,
      });
      return {
        content: resolved.content,
        sourceReference: resolved.contentReference,
      };
    },
  };
}

export function governedArtifactVoiceInputResolver(
  source: DurableArtifactSource,
): VoiceInputResolver {
  return {
    async resolveText(input) {
      const resolved = await source.readText({
        tenantId: input.tenantId,
        reference: input.reference,
        purpose: input.purpose,
        requiredResidencyTags: input.requiredResidencyTags,
        requiredComplianceTags: input.requiredComplianceTags,
      });
      return {
        content: resolved.content,
        sourceReference: resolved.contentReference,
      };
    },

    async resolveProviderFetchUrl(input) {
      const resolved = await source.issueProviderFetchUrl({
        tenantId: input.tenantId,
        reference: input.reference,
        purpose: input.purpose,
        requiredResidencyTags: input.requiredResidencyTags,
        requiredComplianceTags: input.requiredComplianceTags,
      });
      const expiresAt = Date.parse(resolved.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error('VOICE_PROVIDER_FETCH_URL_EXPIRED');
      }
      return {
        providerFetchUrl: resolved.providerFetchUrl,
        sourceReference: resolved.contentReference,
      };
    },
  };
}
