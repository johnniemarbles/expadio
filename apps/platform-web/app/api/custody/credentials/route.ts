import { NextResponse } from 'next/server';
import {
  CredentialIntakeService,
  CustodyError,
  parseFingerprintKey,
  type WrappedSecretEnvelope,
} from '@expadio/credential-custody';
import { resolveRequestContext, requireStepUp, deniedResponse } from '../../../../lib/request-context';
import { wrappingKeys } from '../wrapping-key/route';
import { secretVault } from '../../../../lib/custody-adapter';

/**
 * Design spec §2.2 steps 4–8 — POST /custody/credentials.
 *
 * This is G1: the missing BYOK intake path. Before this route existed,
 * POST /api/communications/providers demanded a credentialRef that already
 * resolved, and nothing turned a customer's pasted Twilio token into a
 * vault:// reference. BYOK was architecturally supported and operationally
 * impossible.
 *
 * What crosses back to the caller: a reference, a fingerprint, detected
 * capabilities, and probe warnings. There is no field in the response schema
 * capable of holding a secret, and none can be added without a type change a
 * reviewer would see (§8, the negative requirement).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED_PROVIDERS = new Set([
  'ses', 'sendgrid', 'resend', 'postmark', 'mailgun',
  'twilio', 'twilio-sms', 'twilio-whatsapp', 'twilio-voice',
  'vonage', 'vonage-sms', 'vonage-voice',
]);

// Companion fields that are NOT secret and may travel in the clear.
// Anything not on this list is dropped rather than forwarded, so a caller
// cannot smuggle a second secret through `parameters`.
const ALLOWED_PARAMETERS = new Set([
  'accountSid', 'region', 'apiKey', 'accessKeyId', 'domain', 'sessionToken', 'fromAddress', 'fromNumber',
]);

interface IntakeBody {
  connectorKey?: unknown;
  providerKey?: unknown;
  envelope?: unknown;
  parameters?: unknown;
}

function isEnvelope(value: unknown): value is WrappedSecretEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.kid === 'string' &&
    typeof candidate.epk === 'string' &&
    typeof candidate.iv === 'string' &&
    typeof candidate.ct === 'string' &&
    typeof candidate.tag === 'string'
  );
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext();
    await requireStepUp();

    const body = (await request.json()) as IntakeBody;

    const providerKey = typeof body.providerKey === 'string' ? body.providerKey.trim().toLowerCase() : '';
    const connectorKey = typeof body.connectorKey === 'string' ? body.connectorKey.trim() : '';

    if (!SUPPORTED_PROVIDERS.has(providerKey)) {
      return NextResponse.json(
        { error: `We do not have an intake probe for '${providerKey}'. Pick a supported provider.` },
        { status: 400 },
      );
    }
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(connectorKey)) {
      return NextResponse.json(
        { error: 'connectorKey must be 1–128 characters of letters, digits, dot, underscore or hyphen.' },
        { status: 400 },
      );
    }
    if (!isEnvelope(body.envelope)) {
      return NextResponse.json(
        { error: 'The credential envelope is missing or malformed. Reload the form and try again.' },
        { status: 400 },
      );
    }

    const parameters: Record<string, string> = {};
    if (typeof body.parameters === 'object' && body.parameters !== null) {
      for (const [key, value] of Object.entries(body.parameters as Record<string, unknown>)) {
        if (ALLOWED_PARAMETERS.has(key) && typeof value === 'string') {
          parameters[key] = value.trim();
        }
      }
    }

    const service = new CredentialIntakeService({
      wrappingKeys,
      vault: secretVault,
      fingerprintKey: parseFingerprintKey(process.env.CUSTODY_FINGERPRINT_KEY),
    });

    const result = await service.intake({
      tenantId: context.tenantId,
      connectorKey,
      providerKey,
      custodyMode: 'DELEGATED',
      envelope: body.envelope,
      parameters,
      correlationId: crypto.randomUUID(),
    });

    // §2.4 item 1 — never persist a credential that has never succeeded once.
    if (result.probeStatus === 'INVALID') {
      return NextResponse.json(
        {
          probeStatus: 'INVALID',
          warnings: result.warnings,
          error: 'That credential did not work. Nothing has been saved.',
        },
        { status: 422 },
      );
    }

    // Keep credentialRef as the canonical custody contract while exposing the
    // legacy `reference` alias consumed by the provider-registration modal.
    // Neither field contains credential material; both are opaque vault refs.
    return NextResponse.json({ ...result, reference: result.credentialRef }, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof CustodyError) {
      const recoverable =
        error.code === 'CUSTODY_WRAPPING_KEY_EXPIRED' || error.code === 'CUSTODY_WRAPPING_KEY_UNKNOWN';
      return NextResponse.json(
        { error: error.message, reasonKey: error.code },
        { status: recoverable ? 409 : 400 },
      );
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}