import { SHELL_NAVIGATION } from './shell-scope.ts';

const PII = /\b(email|phone|mobile|whatsapp|patient|customer name|full_name)\b/i;
const LOOKS_LIKE_PERSON = /\b[A-Z][a-z]+ [A-Z][a-z]+\b/;

export type PlatformSafeRef = {
  readonly tenant: string;
  readonly brand: string;
  readonly correlation: string;
  readonly caseId?: string;
};

/** Platform may carry opaque ids. It may not carry a customer record. */
export function platformSafeRef(input: PlatformSafeRef): PlatformSafeRef {
  return {
    tenant: input.tenant,
    brand: input.brand,
    correlation: input.correlation,
    ...(input.caseId !== undefined ? { caseId: input.caseId } : {}),
  };
}

export function assertPlatformPayloadHasNoCustomerPii(payload: unknown): void {
  const text = JSON.stringify(payload);
  if (PII.test(text) || LOOKS_LIKE_PERSON.test(text)) {
    throw new Error('PLATFORM_PII_BOUNDARY');
  }
}

export function assertBrandNavIsNotInsidePlatform(): void {
  if ((SHELL_NAVIGATION.platform as readonly string[]).includes('Customers')) {
    throw new Error('BRAND_NAV_LEAKED_INTO_PLATFORM');
  }
}
