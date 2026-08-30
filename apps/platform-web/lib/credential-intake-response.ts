/** Validate the custody API response shape before attempting registration.
 * This is a UI contract check, not server-side proof of a credential probe. */
export function credentialReferenceFromIntake(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Credential intake returned an invalid response. Registration was not attempted.');
  }
  const result = value as Record<string, unknown>;
  if (result.probeStatus !== 'VALID'
    || typeof result.credentialRef !== 'string'
    || result.credentialRef.length >= 512
    || !/^(kms|vault|secret|provider-secret):\/\/[^\s]+$/.test(result.credentialRef)) {
    throw new Error('Credential intake did not return a validated secret reference. Registration was not attempted.');
  }
  return result.credentialRef;
}
