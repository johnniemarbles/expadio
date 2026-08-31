import { brandHostStatus, assertPlatformPayloadHasNoCustomerPii } from '@expadio/tenancy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const payload = {
    ...brandHostStatus(new URL(request.url).host),
    package: '@expadio/brand-web',
  };
  assertPlatformPayloadHasNoCustomerPii(payload);
  return Response.json(payload, { headers: { 'Cache-Control': 'private, no-store' } });
}
