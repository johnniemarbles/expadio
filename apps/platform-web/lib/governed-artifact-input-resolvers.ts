import {
  DurableArtifactAiInputResolver,
  type AiInputResolver,
} from '@expadio/ai-gateway';
import {
  DurableArtifactVoiceInputResolver,
  type VoiceInputResolver,
} from '@expadio/voice-gateway';
import type { DurableArtifactSource } from '@expadio/storage';

export function governedArtifactAiInputResolver(
  source: DurableArtifactSource,
): AiInputResolver {
  return new DurableArtifactAiInputResolver(source);
}

export function governedArtifactVoiceInputResolver(
  source: DurableArtifactSource,
  now: () => Date = () => new Date(),
): VoiceInputResolver {
  return new DurableArtifactVoiceInputResolver(source, now);
}
