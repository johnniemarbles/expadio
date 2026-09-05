import assert from 'node:assert/strict';
import test from 'node:test';
import type { AiGateway, AiInvocationIntent, AiProposal } from '@expadio/ai-gateway';
import { runEditorialDebate, EditorialCommitteeError } from '../src/committees/editorial-committee.ts';

function proposalFor(intent: AiInvocationIntent, text: string): AiProposal {
  return {
    invocationId: intent.invocationId,
    tenantId: intent.tenantId,
    status: 'OBSERVATION',
    outputReference: `provider-output://${intent.invocationId}`,
    outputContent: { mediaType: 'text/plain', value: text },
    provenance: {
      connectorKey: 'fake-connector',
      providerKey: 'fake-provider',
      modelKey: 'fake-model',
      promptConfigurationKey: intent.promptConfiguration.key,
      promptConfigurationVersion: intent.promptConfiguration.version,
      sourceReferences: [intent.inputReference],
      processedAt: intent.requestedAt,
    },
  };
}

function scriptedGateway(responses: {
  hunter: string;
  copywriterByRound: readonly string[];
  criticByRound: readonly string[];
}): AiGateway {
  let copywriterCalls = 0;
  let criticCalls = 0;
  return {
    async invoke(intent: AiInvocationIntent): Promise<AiProposal> {
      if (intent.purpose === 'editorial.trend_hunter') {
        return proposalFor(intent, responses.hunter);
      }
      if (intent.purpose === 'editorial.copywriter') {
        const text = responses.copywriterByRound[copywriterCalls] ?? responses.copywriterByRound.at(-1) ?? '';
        copywriterCalls += 1;
        return proposalFor(intent, text);
      }
      if (intent.purpose === 'editorial.critic') {
        const text = responses.criticByRound[criticCalls] ?? responses.criticByRound.at(-1) ?? '';
        criticCalls += 1;
        return proposalFor(intent, text);
      }
      throw new Error(`unexpected purpose: ${intent.purpose}`);
    },
  };
}

const brief = {
  verticalTheme: 'Salon Franchise Expansion',
  brandVoiceGuideline: 'Authoritative, data-driven, direct',
  compliancePack: 'FTC Franchise Rules',
};

test('runEditorialDebate seals the draft once the critic reaches the consensus threshold', async () => {
  const gateway = scriptedGateway({
    hunter: JSON.stringify({ angle: 'Franchise unit economics', hook: 'The math nobody shows you' }),
    copywriterByRound: ['Draft round 1'],
    criticByRound: [JSON.stringify({ score: 9.4, critique: 'Strong, publication ready.', compliancePass: true })],
  });

  const result = await runEditorialDebate(
    { tenantId: 'tenant-1', brief, correlationId: () => 'corr-1' },
    { aiGateway: gateway },
  );

  assert.equal(result.topic, 'Franchise unit economics');
  assert.equal(result.hook, 'The math nobody shows you');
  assert.equal(result.fullCopy, 'Draft round 1');
  assert.equal(result.consensusScore, 9.4);
  assert.equal(result.compliancePass, true);
  assert.equal(result.debateRoundsCount, 1);
  assert.equal(result.reviewTranscript.length, 3);
  assert.equal(result.reviewTranscript[0]?.role, 'TREND_HUNTER');
  assert.equal(result.reviewTranscript[1]?.role, 'COPYWRITER');
  assert.equal(result.reviewTranscript[2]?.role, 'CRITIC');
});

test('runEditorialDebate iterates up to maxRounds when consensus is never reached', async () => {
  const gateway = scriptedGateway({
    hunter: JSON.stringify({ angle: 'Angle', hook: 'Hook' }),
    copywriterByRound: ['Draft 1', 'Draft 2', 'Draft 3'],
    criticByRound: [
      JSON.stringify({ score: 5, critique: 'Weak hook.', compliancePass: true }),
      JSON.stringify({ score: 6, critique: 'Still jargon-heavy.', compliancePass: true }),
      JSON.stringify({ score: 7, critique: 'Better, not there yet.', compliancePass: true }),
    ],
  });

  const result = await runEditorialDebate(
    { tenantId: 'tenant-1', brief, correlationId: () => 'corr-2' },
    { aiGateway: gateway, maxRounds: 3, consensusThreshold: 9.0 },
  );

  assert.equal(result.debateRoundsCount, 3);
  assert.equal(result.consensusScore, 7);
  assert.equal(result.fullCopy, 'Draft 3');
  // trend hunter turn + 3 rounds * (copywriter + critic) = 7 transcript entries
  assert.equal(result.reviewTranscript.length, 7);
});

test('runEditorialDebate does not seal a high score if compliance fails', async () => {
  const gateway = scriptedGateway({
    hunter: JSON.stringify({ angle: 'Angle', hook: 'Hook' }),
    copywriterByRound: ['Draft 1', 'Draft 2'],
    criticByRound: [
      JSON.stringify({ score: 9.5, critique: 'Great copy but makes an FPR violation.', compliancePass: false }),
      JSON.stringify({ score: 9.5, critique: 'Fixed.', compliancePass: true }),
    ],
  });

  const result = await runEditorialDebate(
    { tenantId: 'tenant-1', brief, correlationId: () => 'corr-3' },
    { aiGateway: gateway, maxRounds: 3 },
  );

  assert.equal(result.debateRoundsCount, 2);
  assert.equal(result.compliancePass, true);
  assert.equal(result.fullCopy, 'Draft 2');
});

test('runEditorialDebate throws a typed error when the Trend Hunter output is not valid JSON', async () => {
  const gateway = scriptedGateway({
    hunter: 'not json at all',
    copywriterByRound: [],
    criticByRound: [],
  });

  await assert.rejects(
    () => runEditorialDebate({ tenantId: 'tenant-1', brief, correlationId: () => 'corr-4' }, { aiGateway: gateway }),
    (err: unknown) => err instanceof EditorialCommitteeError && err.code === 'EDITORIAL_HUNTER_OUTPUT_INVALID',
  );
});

test('runEditorialDebate throws a typed error when the Critic output is missing required fields', async () => {
  const gateway = scriptedGateway({
    hunter: JSON.stringify({ angle: 'Angle', hook: 'Hook' }),
    copywriterByRound: ['Draft 1'],
    criticByRound: [JSON.stringify({ score: 9.5 })],
  });

  await assert.rejects(
    () => runEditorialDebate({ tenantId: 'tenant-1', brief, correlationId: () => 'corr-5' }, { aiGateway: gateway }),
    (err: unknown) => err instanceof EditorialCommitteeError && err.code === 'EDITORIAL_CRITIC_OUTPUT_INVALID',
  );
});

test('runEditorialDebate sends the actual crafted prompt as inputReference to the gateway', async () => {
  const seenPrompts: string[] = [];
  const gateway: AiGateway = {
    async invoke(intent: AiInvocationIntent): Promise<AiProposal> {
      seenPrompts.push(intent.inputReference);
      if (intent.purpose === 'editorial.trend_hunter') {
        return proposalFor(intent, JSON.stringify({ angle: 'Angle', hook: 'Hook' }));
      }
      if (intent.purpose === 'editorial.copywriter') {
        return proposalFor(intent, 'Draft');
      }
      return proposalFor(intent, JSON.stringify({ score: 9.5, critique: 'Good.', compliancePass: true }));
    },
  };

  await runEditorialDebate({ tenantId: 'tenant-1', brief, correlationId: () => 'corr-6' }, { aiGateway: gateway });

  assert.equal(seenPrompts.length, 3);
  assert.ok(seenPrompts[0]?.includes(brief.verticalTheme));
  assert.ok(seenPrompts[1]?.includes(brief.brandVoiceGuideline));
  assert.ok(seenPrompts[2]?.includes(brief.compliancePack));
});
