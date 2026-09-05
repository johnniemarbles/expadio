export interface TelegramChatResolver {
  resolveChatId(tenantId: string, subjectId: string): Promise<string | null>;
}

export interface TelegramApprovalNotifierOptions {
  readonly botToken: string;
  readonly chatResolver: TelegramChatResolver;
  readonly fetchImpl?: typeof fetch;
}

export class TelegramNotificationError extends Error {
  readonly code: 'TELEGRAM_CHAT_NOT_LINKED' | 'TELEGRAM_API_ERROR';

  constructor(code: 'TELEGRAM_CHAT_NOT_LINKED' | 'TELEGRAM_API_ERROR', message: string) {
    super(message);
    this.name = 'TelegramNotificationError';
    this.code = code;
  }
}

/**
 * Delivers a staged approval to its target approver's linked Telegram chat,
 * with inline Approve/Reject buttons. The callback_data format
 * ("approve"|"reject" + approvalId + missionId) matches what
 * telegram-webhook-handler.ts parses on the way back in -- change one and
 * you must change the other.
 */
export class TelegramApprovalNotifier {
  readonly #botToken: string;
  readonly #chatResolver: TelegramChatResolver;
  readonly #fetch: typeof fetch;

  constructor(options: TelegramApprovalNotifierOptions) {
    this.#botToken = options.botToken;
    this.#chatResolver = options.chatResolver;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async sendApprovalCard(input: {
    readonly tenantId: string;
    readonly approverSubjectId: string;
    readonly approvalId: string;
    readonly missionId: string;
    readonly title: string;
    readonly description: string;
  }): Promise<number> {
    const chatId = await this.#chatResolver.resolveChatId(input.tenantId, input.approverSubjectId);
    if (!chatId) {
      throw new TelegramNotificationError(
        'TELEGRAM_CHAT_NOT_LINKED',
        `No linked Telegram account for subject ${input.approverSubjectId} in tenant ${input.tenantId}.`,
      );
    }

    const response = await this.#fetch(`https://api.telegram.org/bot${this.#botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${input.title}\n\n${input.description}`,
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve', callback_data: `approve:${input.approvalId}:${input.missionId}` },
            { text: '❌ Reject', callback_data: `reject:${input.approvalId}:${input.missionId}` },
          ]],
        },
      }),
    });

    if (!response.ok) {
      throw new TelegramNotificationError(
        'TELEGRAM_API_ERROR',
        `Telegram sendMessage failed with status ${response.status}.`,
      );
    }

    const body = (await response.json()) as { result: { message_id: number } };
    return body.result.message_id;
  }
}
