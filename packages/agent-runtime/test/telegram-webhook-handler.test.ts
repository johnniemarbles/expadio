import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleTelegramCallbackQuery,
  type ApprovalResolutionPort,
  type TelegramLinkResolver,
} from '../src/notifications/telegram-webhook-handler.ts';
import { ChiefOfStaffApprovalError } from '../src/chief-of-staff-orchestrator.ts';

const linkedUser: TelegramLinkResolver = {
  async resolveSubject(telegramUserId) {
    return telegramUserId === 12345 ? { tenantId: 'tenant-1', subjectId: 'sub-approver' } : null;
  },
};

test('resolves an approve callback through the approval port', async () => {
  const seen: unknown[] = [];
  const approvalPort: ApprovalResolutionPort = {
    async resolve(input) {
      seen.push(input);
      return 'COMPLETED';
    },
  };

  const result = await handleTelegramCallbackQuery(
    { callbackQueryId: 'cb-1', telegramUserId: 12345, data: 'approve:approval-1:mission-1' },
    { linkResolver: linkedUser, approvalPort },
  );

  assert.deepEqual(result, { outcome: 'RESOLVED', status: 'COMPLETED' });
  assert.deepEqual(seen, [{
    tenantId: 'tenant-1',
    approverSubjectId: 'sub-approver',
    approvalId: 'approval-1',
    missionId: 'mission-1',
    approved: true,
  }]);
});

test('resolves a reject callback with approved: false', async () => {
  const approvalPort: ApprovalResolutionPort = { async resolve() { return 'FAILED'; } };

  const result = await handleTelegramCallbackQuery(
    { callbackQueryId: 'cb-2', telegramUserId: 12345, data: 'reject:approval-1:mission-1' },
    { linkResolver: linkedUser, approvalPort },
  );

  assert.deepEqual(result, { outcome: 'RESOLVED', status: 'FAILED' });
});

test('ignores malformed callback data without calling either port', async () => {
  let linkCalled = false;
  const trackingLinkResolver: TelegramLinkResolver = {
    async resolveSubject() {
      linkCalled = true;
      return null;
    },
  };
  const approvalPort: ApprovalResolutionPort = {
    async resolve() {
      throw new Error('should not be called');
    },
  };

  const result = await handleTelegramCallbackQuery(
    { callbackQueryId: 'cb-3', telegramUserId: 12345, data: 'not-a-valid-payload' },
    { linkResolver: trackingLinkResolver, approvalPort },
  );

  assert.deepEqual(result, { outcome: 'IGNORED_MALFORMED_DATA' });
  assert.equal(linkCalled, false);
});

test('ignores a callback from an unlinked telegram user', async () => {
  const approvalPort: ApprovalResolutionPort = {
    async resolve() {
      throw new Error('should not be called');
    },
  };

  const result = await handleTelegramCallbackQuery(
    { callbackQueryId: 'cb-4', telegramUserId: 99999, data: 'approve:approval-1:mission-1' },
    { linkResolver: linkedUser, approvalPort },
  );

  assert.deepEqual(result, { outcome: 'IGNORED_UNLINKED_USER' });
});

test('reports approval not found when the resolution port returns null', async () => {
  const approvalPort: ApprovalResolutionPort = { async resolve() { return null; } };

  const result = await handleTelegramCallbackQuery(
    { callbackQueryId: 'cb-5', telegramUserId: 12345, data: 'approve:missing:mission-1' },
    { linkResolver: linkedUser, approvalPort },
  );

  assert.deepEqual(result, { outcome: 'IGNORED_APPROVAL_NOT_FOUND' });
});

test('reports self-approval denial as a distinct outcome rather than throwing to the caller', async () => {
  const approvalPort: ApprovalResolutionPort = {
    async resolve() {
      throw new ChiefOfStaffApprovalError('AGENT_SELF_APPROVAL_DENIED', 'cannot approve own proposal');
    },
  };

  const result = await handleTelegramCallbackQuery(
    { callbackQueryId: 'cb-6', telegramUserId: 12345, data: 'approve:approval-1:mission-1' },
    { linkResolver: linkedUser, approvalPort },
  );

  assert.deepEqual(result, { outcome: 'DENIED_SELF_APPROVAL' });
});

test('rethrows unrelated errors from the approval port', async () => {
  const approvalPort: ApprovalResolutionPort = {
    async resolve() {
      throw new Error('DATABASE_UNAVAILABLE');
    },
  };

  await assert.rejects(
    () =>
      handleTelegramCallbackQuery(
        { callbackQueryId: 'cb-7', telegramUserId: 12345, data: 'approve:approval-1:mission-1' },
        { linkResolver: linkedUser, approvalPort },
      ),
    /DATABASE_UNAVAILABLE/,
  );
});
