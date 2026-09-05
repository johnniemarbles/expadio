import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TelegramApprovalNotifier,
  TelegramNotificationError,
  type TelegramChatResolver,
} from '../src/notifications/telegram-approval-notifier.ts';

const linkedResolver: TelegramChatResolver = {
  async resolveChatId(tenantId, subjectId) {
    return tenantId === 'tenant-1' && subjectId === 'sub-approver' ? '12345' : null;
  },
};

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

test('sendApprovalCard posts to the Telegram sendMessage API with matching callback_data', async () => {
  let capturedUrl = '';
  let capturedBody: Record<string, unknown> = {};
  const trackingFetch: typeof fetch = (async (url: string, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ result: { message_id: 777 } }), { status: 200 });
  }) as unknown as typeof fetch;

  const notifier = new TelegramApprovalNotifier({
    botToken: 'test-token',
    chatResolver: linkedResolver,
    fetchImpl: trackingFetch,
  });

  const messageId = await notifier.sendApprovalCard({
    tenantId: 'tenant-1',
    approverSubjectId: 'sub-approver',
    approvalId: 'approval-1',
    missionId: 'mission-1',
    title: 'Publish campaign',
    description: 'Thread hook: ...',
  });

  assert.equal(messageId, 777);
  assert.match(capturedUrl, /^https:\/\/api\.telegram\.org\/bottest-token\/sendMessage$/);
  assert.equal(capturedBody.chat_id, '12345');
  const buttons = (capturedBody.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> })
    .inline_keyboard[0];
  assert.equal(buttons?.[0]?.callback_data, 'approve:approval-1:mission-1');
  assert.equal(buttons?.[1]?.callback_data, 'reject:approval-1:mission-1');
});

test('throws TELEGRAM_CHAT_NOT_LINKED without calling the Telegram API when unlinked', async () => {
  let fetchCalled = false;
  const trackingFetch: typeof fetch = (async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;

  const notifier = new TelegramApprovalNotifier({
    botToken: 'test-token',
    chatResolver: { async resolveChatId() { return null; } },
    fetchImpl: trackingFetch,
  });

  await assert.rejects(
    () =>
      notifier.sendApprovalCard({
        tenantId: 'tenant-1',
        approverSubjectId: 'sub-unlinked',
        approvalId: 'approval-1',
        missionId: 'mission-1',
        title: 'x',
        description: 'y',
      }),
    (err: unknown) => err instanceof TelegramNotificationError && err.code === 'TELEGRAM_CHAT_NOT_LINKED',
  );
  assert.equal(fetchCalled, false);
});

test('throws TELEGRAM_API_ERROR when Telegram responds with a non-2xx status', async () => {
  const notifier = new TelegramApprovalNotifier({
    botToken: 'test-token',
    chatResolver: linkedResolver,
    fetchImpl: fakeFetch(400, { ok: false, description: 'Bad Request' }),
  });

  await assert.rejects(
    () =>
      notifier.sendApprovalCard({
        tenantId: 'tenant-1',
        approverSubjectId: 'sub-approver',
        approvalId: 'approval-1',
        missionId: 'mission-1',
        title: 'x',
        description: 'y',
      }),
    (err: unknown) => err instanceof TelegramNotificationError && err.code === 'TELEGRAM_API_ERROR',
  );
});
