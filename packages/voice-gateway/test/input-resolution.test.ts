import assert from 'node:assert/strict';
import test from 'node:test';
import { DurableArtifactVoiceInputResolver } from '../src/input-resolution.ts';

const request = {
  tenantId: 'tenant-1',
  reference: 'artifact://voice/recording-1',
  purpose: 'transcription',
  requiredResidencyTags: ['US'],
  requiredComplianceTags: ['HIPAA'],
};

test('DurableArtifactVoiceInputResolver resolves text through the governed artifact source', async () => {
  const resolver = new DurableArtifactVoiceInputResolver({
    readText: async () => ({
      content: 'synthesis text',
      contentReference: 'storage://tenant-1/text/1',
    }),
    issueProviderFetchUrl: async () => assert.fail('not used'),
  });

  const result = await resolver.resolveText(request);
  assert.deepEqual(result, {
    content: 'synthesis text',
    sourceReference: 'storage://tenant-1/text/1',
  });
});

test('DurableArtifactVoiceInputResolver accepts only live HTTPS provider fetch URLs', async () => {
  const resolver = new DurableArtifactVoiceInputResolver(
    {
      readText: async () => assert.fail('not used'),
      issueProviderFetchUrl: async () => ({
        providerFetchUrl: 'https://signed.example.test/audio.wav?token=abc',
        contentReference: 'storage://tenant-1/voice/recording-1',
        expiresAt: '2026-08-31T03:10:00.000Z',
      }),
    },
    () => new Date('2026-08-31T03:00:00.000Z'),
  );

  const result = await resolver.resolveProviderFetchUrl(request);
  assert.equal(result.providerFetchUrl, 'https://signed.example.test/audio.wav?token=abc');
  assert.equal(result.sourceReference, 'storage://tenant-1/voice/recording-1');
});

test('DurableArtifactVoiceInputResolver rejects non-HTTPS provider fetch URLs', async () => {
  const resolver = new DurableArtifactVoiceInputResolver(
    {
      readText: async () => assert.fail('not used'),
      issueProviderFetchUrl: async () => ({
        providerFetchUrl: 'http://internal.example.test/audio.wav',
        contentReference: 'storage://tenant-1/voice/recording-1',
        expiresAt: '2026-08-31T03:10:00.000Z',
      }),
    },
    () => new Date('2026-08-31T03:00:00.000Z'),
  );

  await assert.rejects(
    resolver.resolveProviderFetchUrl(request),
    /VOICE_INPUT_PROVIDER_URL_INVALID/,
  );
});

test('DurableArtifactVoiceInputResolver rejects expired provider fetch URLs', async () => {
  const resolver = new DurableArtifactVoiceInputResolver(
    {
      readText: async () => assert.fail('not used'),
      issueProviderFetchUrl: async () => ({
        providerFetchUrl: 'https://signed.example.test/audio.wav',
        contentReference: 'storage://tenant-1/voice/recording-1',
        expiresAt: '2026-08-31T02:59:59.000Z',
      }),
    },
    () => new Date('2026-08-31T03:00:00.000Z'),
  );

  await assert.rejects(
    resolver.resolveProviderFetchUrl(request),
    /VOICE_INPUT_PROVIDER_URL_EXPIRED/,
  );
});
