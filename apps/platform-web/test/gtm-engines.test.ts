import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyReplyText,
  extractBrandFromSite,
  proposeOptimization,
  scoreFit,
  scoringMayAutoApprove,
  shouldConvertReplyToLead,
} from '@expadio/gtm';

test('fit scoring is explainable and never auto-approves', () => {
  const result = scoreFit(
    {
      industry: 'software',
      geography: 'US',
      companySize: '51-200',
      title: 'Head of Operations',
      seniority: 'director',
      hasValidatedEmail: true,
      hasCommercialDomain: true,
    },
    {
      industries: ['software'],
      geographies: ['US'],
      companySizeHints: ['51-200'],
      titleHints: ['Head of Operations'],
      seniorityHints: ['director'],
      disqualifiers: ['student'],
    },
  );
  assert.equal(result.version, 'gtm-fit-v1');
  assert.ok(result.total >= 80);
  assert.equal(scoringMayAutoApprove(), false);
});

test('protected attributes fail closed', () => {
  assert.throws(() => scoreFit(
    { extra: { gender: 'x' } },
    { industries: [], geographies: [], companySizeHints: [], titleHints: [], seniorityHints: [], disqualifiers: [] },
  ));
});

test('site extract and reply classification stay local', () => {
  const dossier = extractBrandFromSite({
    sourceUrl: 'https://example.com',
    html: '<title>Acme Workflow</title><meta name="description" content="SaaS operations platform">',
  });
  assert.equal(dossier.name, 'Acme Workflow');
  assert.ok(dossier.industries.includes('software'));
  assert.equal(classifyReplyText('Interested — send the deck').proposedClass, 'interested');
  assert.equal(shouldConvertReplyToLead('meeting_requested'), true);
  assert.equal(shouldConvertReplyToLead('unsubscribe'), false);
});

test('optimize proposals stay unreviewed suggestions', () => {
  const pause = proposeOptimization({ sent: 40, replied: 1, meetings: 0, unsubscribed: 2 });
  assert.equal(pause?.action, 'pause_segment');
  assert.equal(proposeOptimization({ sent: 10, replied: 4, meetings: 2, unsubscribed: 0 }), null);
});
