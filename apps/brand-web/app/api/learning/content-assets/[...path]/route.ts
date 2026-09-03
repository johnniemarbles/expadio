import { NextResponse } from 'next/server';
import { proxyLearningAssetRequest } from '@/lib/platform-content-asset-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['upload', 'scan', 'read-grant']);

async function target(params: Promise<{ path: string[] }>): Promise<string> {
  const parts = (await params).path;
  const id = parts[0] ?? '';
  if (!UUID.test(id) || parts.length > 2) throw new Error('CONTENT_ASSET_PROXY_PATH_INVALID');
  if (parts.length === 1) return `/api/learning/content-assets/${id}`;
  const action = parts[1] ?? '';
  if (!ACTIONS.has(action)) throw new Error('CONTENT_ASSET_PROXY_PATH_INVALID');
  const surface = action === 'scan' ? 'platform' : 'learning';
  return `/api/${surface}/content-assets/${id}/${action}`;
}

async function run(request: Request, params: Promise<{ path: string[] }>) {
  try {
    return await proxyLearningAssetRequest(request, await target(params));
  } catch {
    return NextResponse.json(
      { denied: true, reasonKey: 'CONTENT_ASSET_SERVICE_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return run(request, params);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return run(request, params);
}
