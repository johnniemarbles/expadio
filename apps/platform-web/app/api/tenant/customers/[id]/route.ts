import { tenantGET } from '../../../../../lib/tenant-api';
import { readCustomer, uuid } from '../../../../../lib/tenant-read-model';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return tenantGET(request, async (client, identity) => readCustomer(client, identity, uuid((await params).id)));
}
