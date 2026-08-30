export function resolveResendWebhookSecret(_connectorKey: string): string | undefined {
  return process.env.RESEND_WEBHOOK_SECRET;
}

export function resolveTwilioAuthToken(_connectorKey: string): string | undefined {
  return process.env.TWILIO_AUTH_TOKEN;
}
