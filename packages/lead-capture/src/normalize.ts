/**
 * Deterministic normalization for the submission contract. Pure and
 * unit-tested. The same rules run wherever a submission is built so the wire
 * shape is identical regardless of surface, and the server can re-run them to
 * verify a client did not smuggle unexpected shapes.
 */
import {
  CONSENT_CHANNELS,
  CaptureContractError,
  type CaptureAttribution,
  type CaptureConsent,
  type CaptureFieldValue,
  type CaptureInterestSubmissionInput,
  type CaptureSubmission,
  type CaptureSubmissionInput,
} from './contract.ts';
import type { CaptureInterestPayload, CaptureInterestType } from './interest-payload.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const INTEREST_TYPES: readonly CaptureInterestType[] = [
  'FRANCHISEE',
  'MASTER_FRANCHISEE',
  'DISTRIBUTOR',
  'AFFILIATE',
  'LICENSEE',
  'AGENT',
];

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, max);
}

/** Lowercase + trim. Not an identity resolver — that is the dedup engine's job
 *  (Gate 1); this only makes the stored value tidy and comparable. */
export function normalizeEmail(raw: unknown): string {
  const value = cleanString(raw, 320);
  if (!value) throw new CaptureContractError('CAPTURE_EMAIL_REQUIRED', 'A contact email is required.');
  const lowered = value.toLowerCase();
  if (!EMAIL.test(lowered)) throw new CaptureContractError('CAPTURE_EMAIL_INVALID', 'The contact email is not valid.');
  return lowered;
}

/** Light phone tidy-up: keep a leading +, digits and spacing collapse. Real
 *  E.164 canonicalization belongs to the identity engine, not the wire. */
export function normalizePhone(raw: unknown): string | undefined {
  const value = cleanString(raw, 40);
  if (!value) return undefined;
  const compact = value.replace(/[^\d+]/gu, '');
  return compact === '' ? undefined : compact.slice(0, 20);
}

function normalizeAttribution(input: CaptureAttribution | undefined): CaptureAttribution {
  const a = input ?? {};
  const pick = (v: unknown, max = 512) => cleanString(v, max);
  const out: Record<string, string> = {};
  const map: Record<string, keyof CaptureAttribution> = {
    pageUrl: 'pageUrl',
    referrerUrl: 'referrerUrl',
    utmSource: 'utmSource',
    utmMedium: 'utmMedium',
    utmCampaign: 'utmCampaign',
    utmTerm: 'utmTerm',
    utmContent: 'utmContent',
    utmId: 'utmId',
    gclid: 'gclid',
    fbclid: 'fbclid',
    referralCode: 'referralCode',
    affiliateKey: 'affiliateKey',
  };
  for (const [prop, key] of Object.entries(map)) {
    const val = pick(a[key], key === 'pageUrl' || key === 'referrerUrl' ? 2048 : 512);
    if (val !== undefined) out[prop] = val;
  }
  return out as CaptureAttribution;
}

function normalizeConsent(input: readonly CaptureConsent[] | undefined): CaptureConsent[] {
  if (!input) return [];
  const out: CaptureConsent[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    if (!CONSENT_CHANNELS.includes(entry.channel)) {
      throw new CaptureContractError('CAPTURE_CONSENT_CHANNEL_INVALID', `Unsupported consent channel: ${String(entry.channel)}`);
    }
    const purpose = cleanString(entry.purpose, 80);
    if (!purpose) throw new CaptureContractError('CAPTURE_CONSENT_PURPOSE_REQUIRED', 'Consent purpose is required.');
    const textVersion = cleanString(entry.textVersion, 40);
    out.push({
      channel: entry.channel,
      purpose,
      granted: entry.granted === true,
      ...(textVersion !== undefined ? { textVersion } : {}),
    });
  }
  return out;
}

function normalizeFields(input: Readonly<Record<string, CaptureFieldValue>> | undefined): Record<string, CaptureFieldValue> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, CaptureFieldValue> = {};
  let count = 0;
  for (const key of Object.keys(input)) {
    if (count >= 100) break;
    const cleanKey = key.trim().slice(0, 80);
    if (cleanKey === '') continue;
    const value = input[key];
    if (typeof value === 'string') out[cleanKey] = value.trim().slice(0, 2000);
    else if (typeof value === 'number' && Number.isFinite(value)) out[cleanKey] = value;
    else if (typeof value === 'boolean' || value === null) out[cleanKey] = value;
    else continue;
    count += 1;
  }
  return out;
}

function normalizeInterest(input: CaptureInterestPayload | undefined): CaptureInterestPayload | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object') {
    throw new CaptureContractError('CAPTURE_INTEREST_INVALID', 'Interest payload must be an object.');
  }
  if (!INTEREST_TYPES.includes(input.interestType)) {
    throw new CaptureContractError('CAPTURE_INTEREST_TYPE_INVALID', `Unsupported interest type: ${String(input.interestType)}`);
  }
  if (!input.person || typeof input.person !== 'object' || !Array.isArray(input.locationSought)) {
    throw new CaptureContractError('CAPTURE_INTEREST_BASE_INVALID', 'Interest payload requires person and locationSought blocks.');
  }
  return input;
}

function displayTitle(input: CaptureSubmissionInput, email: string): string {
  const explicit = cleanString(input.title, 200);
  if (explicit) return explicit;
  const name = [cleanString(input.contact?.firstName, 100), cleanString(input.contact?.lastName, 100)]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (name) return name.slice(0, 200);
  return `New enquiry from ${email}`.slice(0, 200);
}

/**
 * Validate and normalize a raw surface input into the canonical wire submission.
 * Email remains the hard requirement for legacy/generic capture. New commercial
 * interest surfaces should call normalizeInterestSubmission instead.
 */
export function normalizeSubmission(input: CaptureSubmissionInput): CaptureSubmission {
  if (!input || typeof input !== 'object' || !input.contact || typeof input.contact !== 'object') {
    throw new CaptureContractError('CAPTURE_CONTACT_REQUIRED', 'A contact object is required.');
  }
  const email = normalizeEmail(input.contact.email);
  const fn = cleanString(input.contact.firstName, 100);
  const ln = cleanString(input.contact.lastName, 100);
  const ph = normalizePhone(input.contact.phone);
  const cc = cleanString(input.contact.phoneCountryCode, 8);
  const lang = cleanString(input.contact.preferredLanguage, 16);
  const contact = {
    email,
    ...(fn !== undefined ? { firstName: fn } : {}),
    ...(ln !== undefined ? { lastName: ln } : {}),
    ...(ph !== undefined ? { phone: ph } : {}),
    ...(cc !== undefined ? { phoneCountryCode: cc } : {}),
    ...(lang !== undefined ? { preferredLanguage: lang } : {}),
  };
  const organizationName = cleanString(input.organization?.name, 200);
  const organizationDomain = cleanString(input.organization?.domain, 253);
  const organizationRole = cleanString(input.organization?.roleTitle, 120);
  const organization = organizationName || organizationDomain || organizationRole
    ? {
        ...(organizationName !== undefined ? { name: organizationName } : {}),
        ...(organizationDomain !== undefined ? { domain: organizationDomain } : {}),
        ...(organizationRole !== undefined ? { roleTitle: organizationRole } : {}),
      }
    : undefined;

  const extRef = cleanString(input.externalReference, 200);
  const formId = cleanString(input.formId, 120);
  const formVersion = cleanString(input.formVersion, 40);
  const interest = normalizeInterest(input.interest);

  return {
    contact,
    ...(organization !== undefined ? { organization } : {}),
    consent: normalizeConsent(input.consent),
    attribution: normalizeAttribution(input.attribution),
    ...(interest !== undefined ? { interest } : {}),
    title: displayTitle(input, email),
    ...(extRef !== undefined ? { externalReference: extRef } : {}),
    ...(formId !== undefined ? { formId } : {}),
    ...(formVersion !== undefined ? { formVersion } : {}),
    fields: normalizeFields(input.fields),
  };
}

/** Strict Tier 1 + Tier 2 entry point for commercial-interest forms. The
 * presence checks are runtime counterparts to CaptureInterestSubmissionInput,
 * so untyped JSON callers cannot omit attribution/consent/interest silently. */
export function normalizeInterestSubmission(input: CaptureInterestSubmissionInput): CaptureSubmission {
  if (input.consent === undefined) {
    throw new CaptureContractError('CAPTURE_CONSENT_REQUIRED', 'Interest capture requires a consent array.');
  }
  if (input.attribution === undefined) {
    throw new CaptureContractError('CAPTURE_ATTRIBUTION_REQUIRED', 'Interest capture requires attribution metadata.');
  }
  if (input.interest === undefined) {
    throw new CaptureContractError('CAPTURE_INTEREST_REQUIRED', 'Interest capture requires a typed interest payload.');
  }
  return normalizeSubmission(input);
}

/**
 * The fields the thin CRM projection reads directly. A superset of the current
 * server extraction (title/email/externalReference), so the ingress can adopt
 * this shared definition when Rail B lands.
 */
export function extractLeadFields(submission: CaptureSubmission): {
  readonly title: string;
  readonly email: string;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly phone?: string | undefined;
  readonly externalReference?: string | undefined;
} {
  return {
    title: submission.title,
    email: submission.contact.email,
    firstName: submission.contact.firstName,
    lastName: submission.contact.lastName,
    phone: submission.contact.phone,
    externalReference: submission.externalReference,
  };
}
