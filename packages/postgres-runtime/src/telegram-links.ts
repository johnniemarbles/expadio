import type { TelegramChatResolver, TelegramLinkResolver } from '@expadio/agent-runtime';
import type { PostgresClient } from './index.ts';

export async function linkTelegramUser(
  client: PostgresClient,
  input: { readonly telegramUserId: number; readonly tenantId: string; readonly subjectId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO platform.telegram_user_links (telegram_user_id, tenant_id, subject_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_user_id)
     DO UPDATE SET tenant_id = EXCLUDED.tenant_id, subject_id = EXCLUDED.subject_id`,
    [input.telegramUserId, input.tenantId, input.subjectId],
  );
}

export async function getTelegramUserLink(
  client: PostgresClient,
  input: { readonly tenantId: string; readonly subjectId: string },
): Promise<{ telegramUserId: number } | null> {
  const result = await client.query<{ telegram_user_id: string | number }>(
    `SELECT telegram_user_id FROM platform.telegram_user_links WHERE tenant_id = $1 AND subject_id = $2`,
    [input.tenantId, input.subjectId],
  );
  const row = result.rows[0];
  return row ? { telegramUserId: Number(row.telegram_user_id) } : null;
}

export async function unlinkTelegramUser(
  client: PostgresClient,
  input: { readonly tenantId: string; readonly subjectId: string },
): Promise<void> {
  await client.query(
    `DELETE FROM platform.telegram_user_links WHERE tenant_id = $1 AND subject_id = $2`,
    [input.tenantId, input.subjectId],
  );
}

/** Resolves which (tenant, subject) a Telegram account is linked to. Used by
 * the webhook to identify who tapped an inline button, with no tenant
 * context available yet -- see platform.telegram_user_links (0173) for why
 * this lookup deliberately has no RLS to work around. */
export class PostgresTelegramLinkResolver implements TelegramLinkResolver {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async resolveSubject(telegramUserId: number): Promise<{ tenantId: string; subjectId: string } | null> {
    const result = await this.#client.query<{ tenant_id: string; subject_id: string }>(
      `SELECT tenant_id, subject_id FROM platform.telegram_user_links WHERE telegram_user_id = $1`,
      [telegramUserId],
    );
    const row = result.rows[0];
    return row ? { tenantId: row.tenant_id, subjectId: row.subject_id } : null;
  }
}

/** Resolves the Telegram chat id (== the linked user's telegram_user_id for
 * a private chat) to deliver an approval card to a known (tenant, subject). */
export class PostgresTelegramChatResolver implements TelegramChatResolver {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async resolveChatId(tenantId: string, subjectId: string): Promise<string | null> {
    const result = await this.#client.query<{ telegram_user_id: string | number }>(
      `SELECT telegram_user_id FROM platform.telegram_user_links WHERE tenant_id = $1 AND subject_id = $2`,
      [tenantId, subjectId],
    );
    const row = result.rows[0];
    return row ? String(row.telegram_user_id) : null;
  }
}
