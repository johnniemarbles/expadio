function requireProviderWebhookSecret(name: 'RESEND_WEBHOOK_SECRET' | 'TWILIO_AUTH_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name}_MISSING`);
  }
  return value;
}

export function resolveResendWebhookSecret(_connectorKey: string): string {
  return requireProviderWebhookSecret('RESEND_WEBHOOK_SECRET');
}

export function resolveTwilioAuthToken(_connectorKey: string): string {
  return requireProviderWebhookSecret('TWILIO_AUTH_TOKEN');
}
