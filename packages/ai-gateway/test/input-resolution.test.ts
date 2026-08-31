import assert from 'node:assert/strict';
import test from 'node:test';
import { DurableArtifactAiInputResolver } from '../src/input-resolution.ts';

test('DurableArtifactAiInputResolver resolves text through the governed artifact source', async () => {
  const resolver = new DurableArtifactAiInputResolver({
    readText: async (input) => {
      assert.equal(input.tenantId, 'tenant-1');
      assert.equal(input.reference, 'artifact://notes/123');
      return {
        content: 'resolved clinical note',
        contentReference: 'storage://tenant-1/notes/123',
      };
    },
    issueProviderFetchUrl: async () => assert.fail('not used'),
  });

  const result = await resolver.resolveText({
    tenantId: 'tenant-1',
    reference: 'artifact://notes/123',
    purpose: 'clinical extraction',
    requiredResidencyTags: ['US'],
    requiredComplianceTags: ['HIPAA'],
  });

  assert.deepEqual(result, {
    content: 'resolved clinical note',
    sourceReference: 'storage://tenant-1/notes/123',
  });
});

test('DurableArtifactAiInputResolver rejects blank resolved content', async () => {
  const resolver = new DurableArtifactAiInputResolver({
    readText: async () => ({
      content: '   ',
      contentReference: 'storage://tenant-1/notes/123',
    }),
    issueProviderFetchUrl: async () => assert.fail('not used'),
  });

  await assert.rejects(
    resolver.resolveText({
      tenantId: 'tenant-1',
      reference: 'artifact://notes/123',
      purpose: 'clinical extraction',
      requiredResidencyTags: ['US'],
      requiredComplianceTags: ['HIPAA'],
    }),
    /AI_INPUT_RESOLUTION_RESULT_INVALID/,
  );
});
