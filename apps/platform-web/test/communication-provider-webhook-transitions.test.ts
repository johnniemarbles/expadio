import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveCommunicationProviderWebhookTransition,
  type CommunicationDeliveryLifecycleState,
  type CommunicationProviderWebhookOutcome,
} from '../lib/communication-provider-webhook';

interface Case {
  readonly current: CommunicationDeliveryLifecycleState;
  readonly outcome: Exclude<CommunicationProviderWebhookOutcome, 'UNMATCHED'>;
  readonly next: CommunicationDeliveryLifecycleState;
  readonly applied: boolean;
  readonly reasonCode: string;
}

test('provider webhook transition matrix applies only allowed lifecycle moves', () => {
  const cases: readonly Case[] = [
    {
      current: 'ACCEPTED',
      outcome: 'SENT',
      next: 'SENT',
      applied: true,
      reasonCode: 'PROVIDER_WEBHOOK_SENT',
    },
    {
      current: 'SENT',
      outcome: 'DELIVERED',
      next: 'DELIVERED',
      applied: true,
      reasonCode: 'PROVIDER_WEBHOOK_DELIVERED',
    },
    {
      current: 'DELIVERED',
      outcome: 'SENT',
      next: 'DELIVERED',
      applied: false,
      reasonCode: 'PROVIDER_WEBHOOK_STATE_TRANSITION_IGNORED',
    },
    {
      current: 'DELIVERED',
      outcome: 'DELIVERED',
      next: 'DELIVERED',
      applied: false,
      reasonCode: 'PROVIDER_WEBHOOK_STATE_ALREADY_APPLIED',
    },
    {
      current: 'DELIVERED',
      outcome: 'BOUNCED',
      next: 'BOUNCED',
      applied: true,
      reasonCode: 'PROVIDER_WEBHOOK_BOUNCED',
    },
    {
      current: 'BOUNCED',
      outcome: 'DELIVERED',
      next: 'BOUNCED',
      applied: false,
      reasonCode: 'PROVIDER_WEBHOOK_STATE_TRANSITION_IGNORED',
    },
    {
      current: 'BOUNCED',
      outcome: 'COMPLAINED',
      next: 'COMPLAINED',
      applied: true,
      reasonCode: 'PROVIDER_WEBHOOK_COMPLAINED',
    },
    {
      current: 'COMPLAINED',
      outcome: 'DELIVERED',
      next: 'COMPLAINED',
      applied: false,
      reasonCode: 'PROVIDER_WEBHOOK_STATE_TRANSITION_IGNORED',
    },
    {
      current: 'FAILED',
      outcome: 'DELIVERED',
      next: 'DELIVERED',
      applied: true,
      reasonCode: 'PROVIDER_WEBHOOK_DELIVERED',
    },
    {
      current: 'FAILED',
      outcome: 'SENT',
      next: 'FAILED',
      applied: false,
      reasonCode: 'PROVIDER_WEBHOOK_STATE_TRANSITION_IGNORED',
    },
    {
      current: 'CANCELLED',
      outcome: 'DELIVERED',
      next: 'CANCELLED',
      applied: false,
      reasonCode: 'PROVIDER_WEBHOOK_STATE_TRANSITION_IGNORED',
    },
    {
      current: 'SENT',
      outcome: 'IGNORED',
      next: 'SENT',
      applied: false,
      reasonCode: 'PROVIDER_WEBHOOK_IGNORED',
    },
  ];

  for (const item of cases) {
    assert.deepEqual(resolveCommunicationProviderWebhookTransition(item.current, item.outcome), {
      previousState: item.current,
      outcome: item.outcome,
      nextState: item.next,
      applied: item.applied,
      reasonCode: item.reasonCode,
    });
  }
});
