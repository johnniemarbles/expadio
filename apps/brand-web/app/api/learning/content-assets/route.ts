import { NextResponse } from 'next/server';
import { proxyLearningAssetRequest } from '../../../../lib/platform-content-asset-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    return await proxyLearningAssetRequest(request, '/api/learning/content-assets');
  } catch {
    return NextResponse.json(
      { denied: true, reasonKey: 'CONTENT_ASSET_SERVICE_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
