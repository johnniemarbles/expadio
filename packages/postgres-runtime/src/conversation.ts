import {
  conversationContextKey,
  type AppendConversationMessageInput,
  type AppendedConversationMessage,
  type CommunicationChannel,
  type ConversationContextRef,
  type ConversationHandoffInput,
  type ConversationOwnerType,
  type ConversationRepository,
  type ConversationSnapshot,
  type ConversationStatus,
  type CreateConversationInput,
} from '@expadio/communication';
import type { PostgresClient } from './index.ts';

interface ConversationRow {
  readonly conversation_id: string;
  readonly tenant_id: string;
  readonly organization_id: string | null;
  readonly subject_id: string | null;
  readonly channel: CommunicationChannel | null;
  readonly status: ConversationStatus;
  readonly owner_type: ConversationOwnerType;
  readonly owner_id: string | null;
}

interface ConversationContextRow {
  readonly context_kind: string;
  readonly context_id: string;
}

interface AppendedMessageRow {
  readonly message_id: string;
  readonly occurred_at: Date | string;
}

/**
 * SQL adapter for conversations. The client must already be inside a request
 * transaction with the verified EXPADIO tenant context bound to PostgreSQL.
 */
export class PostgresConversationRepository implements ConversationRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async create(input: CreateConversationInput): Promise<ConversationSnapshot> {
    const ownership = input.ownership ?? { ownerType: 'SYSTEM' as const };
    const result = await this.#client.query<ConversationRow>(
      `INSERT INTO platform.communication_conversations (
         tenant_id, organization_id, subject_id, channel, owner_type, owner_id
       ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
       RETURNING conversation_id, tenant_id, organization_id, subject_id,
                 channel, status, owner_type, owner_id`,
      [
        input.tenantId,
        input.organizationId ?? null,
        input.subjectId ?? null,
        input.channel ?? null,
        ownership.ownerType,
        ownership.ownerId ?? null,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('CONVERSATION_CREATE_FAILED');

    const context = uniqueContext(input.context ?? []);
    for (const reference of context) {
      await this.#client.query(
        `INSERT INTO platform.communication_conversation_context (
           conversation_id, tenant_id, context_kind, context_id
         ) VALUES ($1::uuid, $2::uuid, $3, $4)`,
        [row.conversation_id, row.tenant_id, reference.kind, reference.id],
      );
    }

    return mapConversation(row, context);
  }

  async load(tenantId: string, conversationId: string): Promise<ConversationSnapshot | null> {
    const result = await this.#client.query<ConversationRow>(
      `SELECT conversation_id, tenant_id, organization_id, subject_id,
              channel, status, owner_type, owner_id
         FROM platform.communication_conversations
        WHERE tenant_id = $1::uuid AND conversation_id = $2::uuid`,
      [tenantId, conversationId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;

    const contextResult = await this.#client.query<ConversationContextRow>(
      `SELECT context_kind, context_id
         FROM platform.communication_conversation_context
        WHERE tenant_id = $1::uuid AND conversation_id = $2::uuid
        ORDER BY context_kind, context_id`,
      [tenantId, conversationId],
    );

    return mapConversation(
      row,
      contextResult.rows.map((contextRow) => ({
        kind: contextRow.context_kind,
        id: contextRow.context_id,
      })),
    );
  }

  async appendMessage(input: AppendConversationMessageInput): Promise<AppendedConversationMessage> {
    const result = await this.#client.query<AppendedMessageRow>(
      `INSERT INTO platform.communication_conversation_messages (
         conversation_id, tenant_id, channel, direction, sender_type, sender_id,
         communication_message_id, provider_message_id, body, payload, occurred_at
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
         COALESCE($11::timestamptz, now())
       )
       RETURNING message_id, occurred_at`,
      [
        input.conversationId,
        input.tenantId,
        input.channel,
        input.direction,
        input.senderType,
        input.senderId ?? null,
        input.communicationMessageId ?? null,
        input.providerMessageId ?? null,
        input.body ?? null,
        input.payload === undefined ? null : JSON.stringify(input.payload),
        input.occurredAt ?? null,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('CONVERSATION_MESSAGE_APPEND_FAILED');
    return {
      messageId: row.message_id,
      occurredAt: toIsoString(row.occurred_at),
    };
  }

  async handoff(input: ConversationHandoffInput): Promise<ConversationSnapshot> {
    const update = await this.#client.query(
      `UPDATE platform.communication_conversations
          SET owner_type = $3,
              owner_id = $4,
              updated_at = now()
        WHERE tenant_id = $1::uuid AND conversation_id = $2::uuid`,
      [
        input.tenantId,
        input.conversationId,
        input.ownership.ownerType,
        input.ownership.ownerId ?? null,
      ],
    );
    if (update.rowCount !== 1) throw new Error('CONVERSATION_NOT_FOUND');

    const conversation = await this.load(input.tenantId, input.conversationId);
    if (conversation === null) throw new Error('CONVERSATION_NOT_FOUND');
    return conversation;
  }
}

function mapConversation(
  row: ConversationRow,
  context: readonly ConversationContextRef[],
): ConversationSnapshot {
  return {
    conversationId: row.conversation_id,
    tenantId: row.tenant_id,
    ...(row.organization_id !== null ? { organizationId: row.organization_id } : {}),
    ...(row.subject_id !== null ? { subjectId: row.subject_id } : {}),
    ...(row.channel !== null ? { channel: row.channel } : {}),
    status: row.status,
    ownership: {
      ownerType: row.owner_type,
      ...(row.owner_id !== null ? { ownerId: row.owner_id } : {}),
    },
    context: [...context],
  };
}

function uniqueContext(context: readonly ConversationContextRef[]): readonly ConversationContextRef[] {
  const references = new Map<string, ConversationContextRef>();
  for (const reference of context) {
    const key = conversationContextKey(reference);
    references.set(key, { kind: reference.kind.trim(), id: reference.id.trim() });
  }
  return [...references.values()];
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
