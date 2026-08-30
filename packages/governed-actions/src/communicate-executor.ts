import type {
  CommunicationChannel,
  CommunicationDispatchResult,
  CommunicationIntent,
  CommunicationPurpose,
  CommunicationRecipient,
} from '@expadio/communication';
import {
  resolveCommunicationIntentIdentity,
} from '@expadio/communication';
import type { CommunicationDispatchPort, PreparedCommunicationDispatch } from '@expadio/communication/dispatch';
import {
  evaluatePersistedCommunicationPreflight,
  type PersistedCommunicationPreflightRepositories,
} from '@expadio/communication/persisted-preflight';
import {
  resolveAndRenderCommunicationTemplate,
} from '@expadio/communication/template-resolve-render';
import type { CommunicationTemplateRepository } from '@expadio/communication';
import type { GovernedActionIntent } from './index.ts';

export interface CommunicateActionConfiguration {
  readonly triggerKey: string;
  readonly recipient: CommunicationRecipient;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly purpose: CommunicationPurpose;
  readonly consentRequired: boolean;
  readonly channel?: CommunicationChannel;
  readonly locale?: string;
  readonly organizationId?: string;
  readonly capabilityKey: string;
  readonly requiredRegions?: readonly string[];
  readonly requiredResidencyTags?: readonly string[];
  readonly requiredComplianceTags?: readonly string[];
}

export interface CommunicateActionExecutorPorts {
  readonly compliance: PersistedCommunicationPreflightRepositories;
  readonly templates: CommunicationTemplateRepository;
  readonly dispatch: CommunicationDispatchPort;
}

export type CommunicateActionExecutionResult =
  | {
      readonly executed: false;
      readonly state: 'REFUSED';
      readonly reasonCode:
        | 'WRONG_EXECUTOR_CLASS'
        | 'CONFIGURATION_INVALID'
        | 'CONSENT_MISSING'
        | 'SUPPRESSED'
        | 'INVALID_RECIPIENT'
        | 'TEMPLATE_MISSING'
        | 'MISSING_VARIABLES';
      readonly reason: string;
    }
  | {
      readonly executed: true;
      readonly communicationIntent: CommunicationIntent;
      readonly preparedDispatch: PreparedCommunicationDispatch;
      readonly dispatch: CommunicationDispatchResult;
    };

function asObject(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return value;
}

function requiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`COMMUNICATE_ACTION_CONFIGURATION_REQUIRED:${field}`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new Error('COMMUNICATE_ACTION_CONFIGURATION_STRING_ARRAY_INVALID');
  }
  return value.map((item) => item.trim());
}

function parseRecipient(value: unknown): CommunicationRecipient {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('COMMUNICATE_ACTION_CONFIGURATION_RECIPIENT_INVALID');
  }
  const raw = value as Record<string, unknown>;
  const recipient: CommunicationRecipient = {
    ...(optionalText(raw.subjectId) === undefined ? {} : { subjectId: optionalText(raw.subjectId) }),
    ...(optionalText(raw.email) === undefined ? {} : { email: optionalText(raw.email) }),
    ...(optionalText(raw.phone) === undefined ? {} : { phone: optionalText(raw.phone) }),
    ...(optionalText(raw.whatsapp) === undefined ? {} : { whatsapp: optionalText(raw.whatsapp) }),
    ...(optionalText(raw.pushEndpoint) === undefined ? {} : { pushEndpoint: optionalText(raw.pushEndpoint) }),
  };
  if (Object.keys(recipient).length === 0) {
    throw new Error('COMMUNICATE_ACTION_CONFIGURATION_RECIPIENT_EMPTY');
  }
  return recipient;
}

function parsePurpose(value: unknown): CommunicationPurpose {
  const purpose = requiredText(value, 'purpose');
  const allowed: readonly CommunicationPurpose[] = [
    'transactional',
    'marketing',
    'system',
    'security',
  ];
  if (!(allowed as readonly string[]).includes(purpose)) {
    throw new Error('COMMUNICATE_ACTION_CONFIGURATION_PURPOSE_INVALID');
  }
  return purpose as CommunicationPurpose;
}

function parseChannel(value: unknown): CommunicationChannel | undefined {
  const channel = optionalText(value);
  if (channel === undefined) return undefined;
  const allowed: readonly CommunicationChannel[] = [
    'email',
    'sms',
    'whatsapp',
    'voice',
    'in_app',
    'push',
    'rcs',
  ];
  if (!(allowed as readonly string[]).includes(channel)) {
    throw new Error('COMMUNICATE_ACTION_CONFIGURATION_CHANNEL_INVALID');
  }
  return channel as CommunicationChannel;
}

export function parseCommunicateActionConfiguration(
  configuration: Readonly<Record<string, unknown>>,
): CommunicateActionConfiguration {
  const raw = asObject(configuration);
  const variables = raw.variables === undefined
    ? {}
    : raw.variables;
  if (typeof variables !== 'object' || variables === null || Array.isArray(variables)) {
    throw new Error('COMMUNICATE_ACTION_CONFIGURATION_VARIABLES_INVALID');
  }
  if (typeof raw.consentRequired !== 'boolean') {
    throw new Error('COMMUNICATE_ACTION_CONFIGURATION_CONSENT_REQUIRED_INVALID');
  }

  return {
    triggerKey: requiredText(raw.triggerKey, 'triggerKey'),
    recipient: parseRecipient(raw.recipient),
    variables: variables as Readonly<Record<string, unknown>>,
    purpose: parsePurpose(raw.purpose),
    consentRequired: raw.consentRequired,
    ...(parseChannel(raw.channel) === undefined ? {} : { channel: parseChannel(raw.channel) }),
    ...(optionalText(raw.locale) === undefined ? {} : { locale: optionalText(raw.locale) }),
    ...(optionalText(raw.organizationId) === undefined
      ? {}
      : { organizationId: optionalText(raw.organizationId) }),
    capabilityKey: requiredText(raw.capabilityKey, 'capabilityKey'),
    ...(stringArray(raw.requiredRegions) === undefined
      ? {}
      : { requiredRegions: stringArray(raw.requiredRegions) }),
    ...(stringArray(raw.requiredResidencyTags) === undefined
      ? {}
      : { requiredResidencyTags: stringArray(raw.requiredResidencyTags) }),
    ...(stringArray(raw.requiredComplianceTags) === undefined
      ? {}
      : { requiredComplianceTags: stringArray(raw.requiredComplianceTags) }),
  };
}

/**
 * Execute one immutable COMMUNICATE Action Intent into the existing
 * provider-neutral Communications queued-dispatch boundary.
 *
 * This adapter never chooses a provider, never leases credentials, and never
 * bypasses persisted consent/suppression or template resolution.
 */
export async function executeCommunicateActionIntent(
  actionIntent: GovernedActionIntent,
  ports: CommunicateActionExecutorPorts,
): Promise<CommunicateActionExecutionResult> {
  if (actionIntent.executorClass !== 'COMMUNICATE') {
    return {
      executed: false,
      state: 'REFUSED',
      reasonCode: 'WRONG_EXECUTOR_CLASS',
      reason: 'This executor only accepts COMMUNICATE Action Intents.',
    };
  }

  let config: CommunicateActionConfiguration;
  try {
    config = parseCommunicateActionConfiguration(actionIntent.configuration);
  } catch (error) {
    return {
      executed: false,
      state: 'REFUSED',
      reasonCode: 'CONFIGURATION_INVALID',
      reason: error instanceof Error ? error.message : 'Communication configuration is invalid.',
    };
  }

  const communicationIntent: CommunicationIntent = {
    triggerKey: config.triggerKey,
    tenantId: actionIntent.tenantId,
    ...(config.organizationId === undefined ? {} : { organizationId: config.organizationId }),
    recipient: config.recipient,
    variables: config.variables,
    ...(config.locale === undefined ? {} : { locale: config.locale }),
    idempotencyKey: actionIntent.idempotencyKey,
    purpose: config.purpose,
    consentRequired: config.consentRequired,
    ...(config.channel === undefined ? {} : { channel: config.channel }),
  };

  let identity;
  try {
    identity = resolveCommunicationIntentIdentity(communicationIntent);
  } catch (error) {
    return {
      executed: false,
      state: 'REFUSED',
      reasonCode: 'INVALID_RECIPIENT',
      reason: error instanceof Error ? error.message : 'Recipient is not addressable.',
    };
  }

  const preflight = await evaluatePersistedCommunicationPreflight({
    intent: communicationIntent,
    repositories: ports.compliance,
    at: actionIntent.requestedAt.toISOString(),
  });
  if (!preflight.allowed) {
    return {
      executed: false,
      state: 'REFUSED',
      reasonCode: preflight.reasonCode,
      reason: preflight.reason,
    };
  }

  const rendered = await resolveAndRenderCommunicationTemplate(
    ports.templates,
    {
      tenantId: actionIntent.tenantId,
      ...(config.organizationId === undefined ? {} : { organizationId: config.organizationId }),
      triggerKey: config.triggerKey,
      channel: identity.channel,
      ...(config.locale === undefined ? {} : { locale: config.locale }),
      variables: config.variables,
    },
  );
  if (!rendered.ok) {
    return {
      executed: false,
      state: 'REFUSED',
      reasonCode: rendered.reasonCode,
      reason: rendered.reasonCode === 'TEMPLATE_MISSING'
        ? 'No active communication template matched this action.'
        : `Template variables are missing: ${rendered.missingVariables.join(', ')}`,
    };
  }

  const preparedDispatch: PreparedCommunicationDispatch = {
    tenantId: actionIntent.tenantId,
    ...(config.organizationId === undefined ? {} : { organizationId: config.organizationId }),
    triggerKey: config.triggerKey,
    purpose: config.purpose,
    channel: identity.channel,
    recipient: config.recipient,
    recipientKey: identity.recipientKey,
    idempotencyKey: actionIntent.idempotencyKey,
    templateScope: rendered.matchedScope,
    rendered: rendered.rendered,
    compliance: {
      preflight,
      evaluatedAt: actionIntent.requestedAt.toISOString(),
    },
    routing: {
      capabilityKey: config.capabilityKey,
      ...(config.requiredRegions === undefined ? {} : { requiredRegions: config.requiredRegions }),
      ...(config.requiredResidencyTags === undefined
        ? {}
        : { requiredResidencyTags: config.requiredResidencyTags }),
      ...(config.requiredComplianceTags === undefined
        ? {}
        : { requiredComplianceTags: config.requiredComplianceTags }),
    },
    requestedAt: actionIntent.requestedAt.toISOString(),
  };

  return {
    executed: true,
    communicationIntent,
    preparedDispatch,
    dispatch: await ports.dispatch.dispatch(preparedDispatch),
  };
}
