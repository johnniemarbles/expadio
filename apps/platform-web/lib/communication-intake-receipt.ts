/** Called only inside an admin-authorized, tenant-scoped transaction. */
interface QueryClient {
  query(sql: string, values: unknown[]): Promise<{ rows: Record<string, any>[] }>;
}

export class IntakeReceiptRequired extends Error {
  constructor() { super('A fresh verified credential intake is required. Run credential verification again.'); }
}

export function isReceiptId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function intakeProviderKey(providerKey: string): string {
  if (['twilio-sms', 'twilio-whatsapp', 'twilio-voice'].includes(providerKey)) return 'twilio';
  if (['vonage-sms', 'vonage-voice'].includes(providerKey)) return 'vonage';
  return providerKey;
}

export async function consumeIntakeReceipt(
  client: QueryClient,
  input: { receiptId: unknown; tenantId: string; subjectId: string; connectorKey: string; providerKey: string; credentialRef: string },
) {
  if (!isReceiptId(input.receiptId)) throw new IntakeReceiptRequired();
  // The conditional UPDATE is both the replay guard and row lock. A failed
  // connector registration rolls it back in the caller's transaction.
  const result = await client.query(
    `UPDATE platform.communication_intake_receipts
        SET consumed_at = now()
      WHERE receipt_id = $1::uuid AND tenant_id = $2::uuid AND subject_id = $3
        AND connector_key = $4 AND provider_key = $5 AND credential_ref = $6
        AND consumed_at IS NULL AND expires_at > now()
      RETURNING receipt_id, credential_ref, key_version, fingerprint,
                detected_capabilities, probe_warnings, probed_at`,
    [input.receiptId, input.tenantId, input.subjectId, input.connectorKey,
      intakeProviderKey(input.providerKey), input.credentialRef],
  );
  if (result.rows.length !== 1) throw new IntakeReceiptRequired();
  return result.rows[0];
}
