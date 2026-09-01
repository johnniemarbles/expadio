import { NextResponse } from 'next/server';
import { resolveBrandContext } from '../../../../../../lib/brand-context';
import { platformLearningAiFetch } from '../../../../../../lib/platform-learning-ai';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: 'REQUEST_ID_INVALID' }, { status: 400 });

    const upstream = await platformLearningAiFetch(
      context,
      `/api/learning/ai/requests/${encodeURIComponent(id)}`,
      { method: 'GET' },
    );
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_AI_PROXY_FAILED';
    return NextResponse.json({ error: code }, { status: 502 });
  }
}
