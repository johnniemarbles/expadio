import type {
  CommunicationChannel,
  CommunicationTemplate,
  CommunicationTemplateContentFormat,
  CommunicationTemplateRepository,
  CommunicationTemplateResolution,
  CommunicationTemplateResolutionInput,
  CommunicationTemplateStatus,
} from '@expadio/communication';
import type { PostgresClient } from './index.ts';

interface TemplateRow {
  readonly template_id: string;
  readonly version: number;
  readonly scope: 'PLATFORM' | 'TENANT' | 'ORGANIZATION';
  readonly tenant_id: string | null;
  readonly organization_id: string | null;
  readonly trigger_key: string;
  readonly channel: CommunicationChannel;
  readonly locale: string;
  readonly content_format: CommunicationTemplateContentFormat;
  readonly subject: string | null;
  readonly title: string | null;
  readonly body: string;
  readonly required_variables: readonly string[];
  readonly default_variables: Readonly<Record<string, unknown>>;
  readonly status: CommunicationTemplateStatus;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

/**
 * Read-only SQL adapter for runtime template resolution. The supplied client
 * must already be inside a request transaction with verified tenant context.
 */
export class PostgresCommunicationTemplateRepository
  implements CommunicationTemplateRepository {
  readonly #client: PostgresClient;

  constructor(client: PostgresClient) {
    this.#client = client;
  }

  async resolveActive(
    input: CommunicationTemplateResolutionInput,
  ): Promise<CommunicationTemplateResolution> {
    const locale = (input.locale ?? 'en').trim().toLowerCase();
    const result = await this.#client.query<TemplateRow>(
      `SELECT template_id, version, scope, tenant_id, organization_id,
              trigger_key, channel, locale, content_format, subject, title,
              body, required_variables, default_variables, status,
              created_at, updated_at
         FROM platform.communication_templates
        WHERE status = 'ACTIVE'
          AND trigger_key = $3
          AND channel = $4
          AND lower(locale) = $5
          AND (
            scope = 'PLATFORM'
            OR (scope = 'TENANT' AND tenant_id = $1::uuid)
            OR (
              $2::uuid IS NOT NULL
              AND scope = 'ORGANIZATION'
              AND tenant_id = $1::uuid
              AND organization_id = $2::uuid
            )
          )
        ORDER BY CASE scope
                   WHEN 'ORGANIZATION' THEN 1
                   WHEN 'TENANT' THEN 2
                   WHEN 'PLATFORM' THEN 3
                   ELSE 4
                 END,
                 version DESC
        LIMIT 1`,
      [
        input.tenantId,
        input.organizationId ?? null,
        input.triggerKey.trim(),
        input.channel,
        locale,
      ],
    );

    const row = result.rows[0];
    if (row === undefined) return { matchedScope: 'NONE', template: null };
    return { matchedScope: row.scope, template: mapTemplate(row) };
  }
}

function mapTemplate(row: TemplateRow): CommunicationTemplate {
  const scope = row.scope === 'PLATFORM'
    ? { kind: 'PLATFORM' as const }
    : row.scope === 'TENANT'
      ? { kind: 'TENANT' as const, tenantId: required(row.tenant_id, 'tenant_id') }
      : {
          kind: 'ORGANIZATION' as const,
          tenantId: required(row.tenant_id, 'tenant_id'),
          organizationId: required(row.organization_id, 'organization_id'),
        };

  return {
    templateId: row.template_id,
    scope,
    key: {
      triggerKey: row.trigger_key,
      channel: row.channel,
      locale: row.locale,
    },
    content: {
      format: row.content_format,
      ...(row.subject !== null ? { subject: row.subject } : {}),
      ...(row.title !== null ? { title: row.title } : {}),
      body: row.body,
    },
    requiredVariables: [...row.required_variables],
    defaultVariables: { ...row.default_variables },
    version: row.version,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function required(value: string | null, field: string): string {
  if (value === null) throw new Error(`COMMUNICATION_TEMPLATE_INVALID_${field.toUpperCase()}`);
  return value;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
