import type { Pool, PoolClient } from 'pg';

export interface CommunicationWebhookEndpoint {
  readonly endpointId: string;
  readonly tenantId: string;
  readonly connectorKey: string;
  readonly providerKey: 'resend' | 'twilio';
  readonly adapterKey:
    | 'resend-email-v1'
    | 'twilio-sms-whatsapp-v1'
    | 'twilio-voice-v1';
  readonly verificationCredentialRef: string;
}

interface EndpointRow {
  readonly endpoint_id: string;
  readonly tenant_id: string;
  readonly connector_key: string;
  readonly connector_provider_key: string;
  readonly endpoint_provider_key: string;
  readonly adapter_key: string;
  readonly verification_credential_ref: string;
  readonly connector_enabled: boolean;
  readonly endpoint_enabled: boolean;
}

async function withWebhookControlPlane<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let released = false;
  try {
    await client.query(
      "SELECT set_config('app.webhook_control_plane', 'on', false)",
    );
    return await work(client);
  } finally {
    try {
      await client.query('RESET app.webhook_control_plane');
    } catch {
      client.release(true);
      released = true;
    }
    if (!released) client.release();
  }
}

function adapterKey(value: string): CommunicationWebhookEndpoint['adapterKey'] {
  if (
    value === 'resend-email-v1'
    || value === 'twilio-sms-whatsapp-v1'
    || value === 'twilio-voice-v1'
  ) {
    return value;
  }
  throw new Error('COMMUNICATION_WEBHOOK_ADAPTER_INVALID');
}

export async function resolveCommunicationWebhookEndpoint(
  pool: Pool,
  input: {
    readonly endpointId: string;
    readonly providerKey: 'resend' | 'twilio';
  },
): Promise<CommunicationWebhookEndpoint | null> {
  return withWebhookControlPlane(pool, async (client) => {
    const result = await client.query<EndpointRow>(
      `SELECT
         endpoint.endpoint_id,
         endpoint.tenant_id,
         connector.connector_key,
         connector.provider_key AS connector_provider_key,
         endpoint.provider_key AS endpoint_provider_key,
         endpoint.adapter_key,
         endpoint.verification_credential_ref,
         connector.enabled AS connector_enabled,
         endpoint.enabled AS endpoint_enabled
       FROM platform.communication_webhook_endpoints endpoint
       JOIN platform.connectors connector
         ON connector.connector_id = endpoint.connector_id
        AND (
          connector.ownership_scope = 'PLATFORM'
          OR connector.tenant_id = endpoint.tenant_id
        )
      WHERE endpoint.endpoint_id = $1::uuid
        AND endpoint.provider_key = $2
      LIMIT 1`,
      [input.endpointId, input.providerKey],
    );

    const row = result.rows[0];
    if (
      row === undefined
      || !row.endpoint_enabled
      || !row.connector_enabled
      || row.endpoint_provider_key !== input.providerKey
      || row.connector_provider_key !== input.providerKey
    ) {
      return null;
    }

    return {
      endpointId: row.endpoint_id,
      tenantId: row.tenant_id,
      connectorKey: row.connector_key,
      providerKey: input.providerKey,
      adapterKey: adapterKey(row.adapter_key),
      verificationCredentialRef: row.verification_credential_ref,
    };
  });
}

export async function withWebhookTenantContext<T>(
  pool: Pool,
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let released = false;
  try {
    await client.query(
      "SELECT set_config('app.tenant_id', $1, false)",
      [tenantId],
    );
    return await work(client);
  } finally {
    try {
      await client.query('RESET app.tenant_id');
    } catch {
      client.release(true);
      released = true;
    }
    if (!released) client.release();
  }
}
