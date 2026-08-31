import {
  PLATFORM_SAFE_ERROR_MESSAGE,
  SHELL_NAVIGATION,
  assertPlatformPayloadHasNoCustomerPii,
  classifyRequestPath,
  platformSafeErrorBody,
  platformSafeLogLine,
} from '@expadio/tenancy';
import type { WorkspaceSection } from './contracts';

export const PLATFORM_PRODUCT_CACHE = { 'Cache-Control': 'private, no-store' } as const;

export const SHELL_PLATFORM_SECTIONS: WorkspaceSection[] = [
  { id: 'plat_home', label: 'Home', short: 'HO', href: '/' },
  { id: 'plat_work', label: 'My work', short: 'MW', href: '/governance/queue' },
  { id: 'plat_tenants', label: 'Tenants', short: 'TN', href: '/organizations' },
  { id: 'plat_capabilities', label: 'Capabilities', short: 'CP', href: '/capabilities' },
  { id: 'plat_sending', label: 'Sending health', short: 'SH', href: '/communications' },
  { id: 'plat_providers', label: 'Providers', short: 'PR', href: '/communications' },
  { id: 'plat_approvals', label: 'Approvals', short: 'AP', href: '/governance' },
  { id: 'plat_safety', label: 'Safety', short: 'SF', href: '/platform-health' },
  { id: 'plat_audit', label: 'Audit', short: 'AU', href: '/audit' },
];

export function assertPlatformSectionsMatchContract(): void {
  const labels = SHELL_PLATFORM_SECTIONS.map((section) => section.label);
  if (labels.join('|') !== SHELL_NAVIGATION.platform.join('|')) {
    throw new Error('PLATFORM_NAV_CONTRACT');
  }
  for (const section of SHELL_PLATFORM_SECTIONS) {
    if (classifyRequestPath(section.href) === 'lab' || classifyRequestPath(section.href) === 'brand') {
      throw new Error('PLATFORM_NAV_LAB_LEAK');
    }
  }
}

export function platformProductDenied(reasonKey = 'INTERNAL_ERROR') {
  return platformSafeErrorBody(reasonKey);
}

export function assertPlatformProductPayload(payload: unknown): void {
  assertPlatformPayloadHasNoCustomerPii(payload);
}

export function writePlatformProductLog(write: (line: string) => void, line: string): void {
  write(platformSafeLogLine(line));
}

export { PLATFORM_SAFE_ERROR_MESSAGE };
