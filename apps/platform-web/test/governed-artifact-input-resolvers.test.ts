import assert from 'node:assert/strict';
import test from 'node:test';
import type { DurableArtifactSource } from '@expadio/storage';
import {
  governedArtifactAiInputResolver,
  governedArtifactVoiceInputResolver,
} from '../lib/governed-artifact-input-resolvers';

test('governedArtifactAiInputResolver propagates tenant and governance requirements', async () => {
  let captured: any = null;
  const source: DurableArtifactSource = {
    async readText(input) {
      captured = input;
      return {
        content: 'resolved note',
        contentReference: 'artifact://clinical-note/123',
      };
    },
    async issueProviderFetchUrl() {
      assert.fail('AI text resolution must not issue media URLs');
    },
  };

  const resolver = governedArtifactAiInputResolver(source);
  const result = await resolver.resolveText({
    tenantId: 'tenant-1',
    reference: 'ref://clinical-note/123',
    purpose: 'clinical extraction',
    requiredResidencyTags: ['US'],
    requiredComplianceTags: ['HIPAA'],
  });

  assert.equal(result.content, 'resolved note');
  assert.equal(result.sourceReference, 'artifact://clinical-note/123');
  assert.deepEqual(captured, {
    tenantId: 'tenant-1',
    reference: 'ref://clinical-note/123',
    purpose: 'clinical extraction',
    requiredResidencyTags: ['US'],
    requiredComplianceTags: ['HIPAA'],
  });
});

test('governedArtifactVoiceInputResolver emits only an unexpired provider URL', async () => {
  const source: DurableArtifactSource = {
    async readText() {
      return {
        content: 'hello',
        contentReference: 'artifact://voice-text/1',
      };
    },
    async issueProviderFetchUrl(input) {
      return {
        providerFetchUrl: 'https://signed.example.test/audio.wav',
        contentReference: input.reference,
        expiresAt: '2026-08-31T03:05:00.000Z',
      };
    },
  };

  const resolver = governedArtifactVoiceInputResolver(
    source,
    () => new Date('2026-08-31T03:00:00.000Z'),
  );
  const result = await resolver.resolveProviderFetchUrl({
    tenantId: 'tenant-1',
    reference: 'artifact://voice-audio/1',
    purpose: 'transcription',
    requiredResidencyTags: ['US'],
    requiredComplianceTags: ['HIPAA'],
  });

  assert.equal(result.providerFetchUrl, 'https://signed.example.test/audio.wav');
  assert.equal(result.sourceReference, 'artifact://voice-audio/1');
});

test('governedArtifactVoiceInputResolver rejects expired provider URLs', async () => {
  const source: DurableArtifactSource = {
    async readText() {
      return {
        content: 'hello',
        contentReference: 'artifact://voice-text/1',
      };
    },
    async issueProviderFetchUrl(input) {
      return {
        providerFetchUrl: 'https://signed.example.test/audio.wav',
        contentReference: input.reference,
        expiresAt: '2026-08-31T02:59:59.000Z',
      };
    },
  };

  const resolver = governedArtifactVoiceInputResolver(
    source,
    () => new Date('2026-08-31T03:00:00.000Z'),
  );

  await assert.rejects(
    resolver.resolveProviderFetchUrl({
      tenantId: 'tenant-1',
      reference: 'artifact://voice-audio/1',
      purpose: 'transcription',
      requiredResidencyTags: ['US'],
      requiredComplianceTags: ['HIPAA'],
    }),
    /VOICE_PROVIDER_FETCH_URL_EXPIRED/,
  );
});
