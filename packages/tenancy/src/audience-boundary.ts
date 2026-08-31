import { SHELL_NAVIGATION } from './shell-scope.ts';

const CUSTOMER_PII_TOKEN =
  /\b(email|phone|mobile|whatsapp|full_name|first_name|last_name|patient_name|customer_name|crm_contacts)\b/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /\+?\d[\d\s().-]{8,}\d/;
const SENDING_HEALTH_FORBIDDEN_KEY =
  /^(email|phone|mobile|full_name|first_name|last_name|patient_name|customer_name|recipient|to_address|from_address|crm_contacts)$/i;
const CHANNEL_VALUE = /^(email|sms|whatsapp|voice|in_app|push|rcs|social)$/i;

/** Placeholders must not contain customer-field tokens. `[redacted-email]` fails that test. */
export const REDACTED_ADDR = '[redacted-addr]';
export const REDACTED_TEL = '[redacted-tel]';

export const PLATFORM_SAFE_ERROR_MESSAGE =
  'This information could not be loaded. Please try again.';

export type PlatformSafeRef = {
  readonly tenant: string;
  readonly brand: string;
  readonly correlation: string;
  readonly caseId?: string;
};

export type RequestSurface = 'platform-product' | 'brand' | 'lab' | 'other';

const LAB_PREFIXES = [
  '/crm',
  '/gtm',
  '/dentex',
  '/vendors',
  '/expenses',
  '/tenant',
  '/api/crm',
  '/api/gtm',
  '/api/dentex',
  '/api/tenant',
  '/api/vendors',
  '/api/expenses',
] as const;

const PLATFORM_PRODUCT_PREFIXES = [
  '/api/overview',
  '/api/context',
  '/api/workspaces',
  '/api/capabilities',
  '/api/communications',
  '/api/governance',
  '/api/journey-correlation',
  '/api/tenants',
  '/capabilities',
  '/communications',
  '/organizations',
  '/platform-health',
  '/audit',
  '/governance',
] as const;

/** Platform may carry opaque ids. It may not carry a customer record. */
export function platformSafeRef(input: PlatformSafeRef): PlatformSafeRef {
  return {
    tenant: input.tenant,
    brand: input.brand,
    correlation: input.correlation,
    ...(input.caseId !== undefined ? { caseId: input.caseId } : {}),
  };
}

export function classifyRequestPath(pathname: string): RequestSurface {
  const path = pathname.split('?')[0]?.toLowerCase() ?? '';
  if (path === '/brand' || path.startsWith('/brand/') || path.startsWith('/api/brand/')) return 'brand';
  if (LAB_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + '/'))) return 'lab';
  if (path === '/' || PLATFORM_PRODUCT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + '/'))) {
    return 'platform-product';
  }
  return 'other';
}

export function customerPiiPresent(value: unknown): boolean {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return CUSTOMER_PII_TOKEN.test(text) || EMAIL.test(text);
}

export function redactCustomerPii(value: string): string {
  return value.replace(EMAIL, REDACTED_ADDR).replace(PHONE, REDACTED_TEL);
}

export function assertPlatformPayloadHasNoCustomerPii(payload: unknown): void {
  if (customerPiiPresent(payload)) {
    throw new Error('PLATFORM_PII_BOUNDARY');
  }
}

/**
 * Sending health may name a channel `email` / `whatsapp`.
 * It may not carry recipient fields or address values.
 */
export function assertPlatformSendingHealthPayload(payload: unknown): void {
  visitSendingHealth(payload);
}

function visitSendingHealth(value: unknown, key?: string): void {
  if (key !== undefined && SENDING_HEALTH_FORBIDDEN_KEY.test(key)) {
    throw new Error('PLATFORM_PII_BOUNDARY');
  }
  if (typeof value === 'string') {
    if (EMAIL.test(value) || PHONE.test(value)) {
      throw new Error('PLATFORM_PII_BOUNDARY');
    }
    if (
      key !== 'channel' &&
      key !== 'providerType' &&
      CUSTOMER_PII_TOKEN.test(value) &&
      !CHANNEL_VALUE.test(value)
    ) {
      throw new Error('PLATFORM_PII_BOUNDARY');
    }
  } else if (Array.isArray(value)) {
    for (const item of value) visitSendingHealth(item, key);
  } else if (value && typeof value === 'object') {
    for (const [nextKey, next] of Object.entries(value)) visitSendingHealth(next, nextKey);
  }
}

export function assertPlatformLogHasNoCustomerPii(line: string): void {
  if (customerPiiPresent(line) || PHONE.test(line)) {
    throw new Error('PLATFORM_PII_LOG_BOUNDARY');
  }
}

/** Redact addresses, then refuse leftover customer-field tokens. */
export function platformSafeLogLine(line: string): string {
  const redacted = redactCustomerPii(line);
  assertPlatformLogHasNoCustomerPii(redacted);
  return redacted;
}

export function platformSafeErrorBody(reasonKey = 'INTERNAL_ERROR'): {
  readonly denied: true;
  readonly reasonKey: string;
  readonly message: string;
} {
  return { denied: true, reasonKey, message: PLATFORM_SAFE_ERROR_MESSAGE };
}

export function assertBrandNavIsNotInsidePlatform(): void {
  if ((SHELL_NAVIGATION.platform as readonly string[]).includes('Customers')) {
    throw new Error('BRAND_NAV_LEAKED_INTO_PLATFORM');
  }
}
