import { tenantGET } from '../../../../lib/tenant-api';
import { parsePage, readWork } from '../../../../lib/tenant-read-model';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return tenantGET(request, (client, identity, _context, url) => readWork(client, identity, parsePage(url)));
}
