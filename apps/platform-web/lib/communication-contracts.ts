export const COMMUNICATION_CHANNELS = [
  "email",
  "sms",
  "whatsapp",
  "voice",
  "in_app",
  "push",
  "rcs",
  "social",
] as const;

export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export type CommunicationDeliveryState =
  | "PENDING"
  | "ACCEPTED"
  | "SENT"
  | "DELIVERED"
  | "FAILED"
  | "BOUNCED"
  | "COMPLAINED"
  | "CANCELLED";

export interface CommunicationChannelHealth {
  channel: CommunicationChannel;
  total: number;
  delivered: number;
  failed: number;
  deliveryRate: number | null;
}

export interface CommunicationReadiness {
  activeTemplates: number;
  draftTemplates: number;
  verifiedSenders: number;
  pendingSenders: number;
  activeSuppressions: number;
}

export interface CommunicationRecentDelivery {
  id: string;
  channel: CommunicationChannel;
  state: CommunicationDeliveryState;
  connectorKey: string;
  attemptCount: number;
  reasonCode: string | null;
  requestedAt: string;
  updatedAt: string;
}

export interface CommunicationOverview {
  source: "live";
  capturedAt: string;
  totals: {
    deliveries: number;
    delivered: number;
    inFlight: number;
    failed: number;
  };
  readiness: CommunicationReadiness;
  channels: CommunicationChannelHealth[];
  recentDeliveries: CommunicationRecentDelivery[];
}
