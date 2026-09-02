export interface ExecutableCommunicationProvider {
  readonly providerKey: 'resend' | 'twilio-sms' | 'twilio-whatsapp' | 'twilio-voice';
  readonly providerType: 'email' | 'sms' | 'whatsapp' | 'voice';
  readonly label: string;
  readonly custodyBaseKey: 'resend' | 'twilio';
  readonly capabilityKey: string;
}

export const EXECUTABLE_COMMUNICATION_PROVIDERS: readonly ExecutableCommunicationProvider[] = [
  {
    providerKey: 'resend',
    providerType: 'email',
    label: 'Resend',
    custodyBaseKey: 'resend',
    capabilityKey: 'communication.email.send',
  },
  {
    providerKey: 'twilio-sms',
    providerType: 'sms',
    label: 'Twilio SMS',
    custodyBaseKey: 'twilio',
    capabilityKey: 'communication.sms.send',
  },
  {
    providerKey: 'twilio-whatsapp',
    providerType: 'whatsapp',
    label: 'Twilio WhatsApp',
    custodyBaseKey: 'twilio',
    capabilityKey: 'communication.whatsapp.send',
  },
  {
    providerKey: 'twilio-voice',
    providerType: 'voice',
    label: 'Twilio Voice',
    custodyBaseKey: 'twilio',
    capabilityKey: 'communication.voice.dial',
  },
] as const;

export function executableCommunicationProvider(
  providerKey: string,
  providerType: string,
): ExecutableCommunicationProvider | null {
  return EXECUTABLE_COMMUNICATION_PROVIDERS.find(
    (provider) => provider.providerKey === providerKey.trim().toLowerCase()
      && provider.providerType === providerType.trim().toLowerCase(),
  ) ?? null;
}
