import { tenantGET } from '../../../../lib/tenant-api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return tenantGET(request, async (_client, _identity, context) => context);
}
