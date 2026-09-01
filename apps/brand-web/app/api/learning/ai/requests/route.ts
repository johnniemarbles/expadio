import { NextResponse } from 'next/server';
import { resolveBrandContext } from '../../../../../lib/brand-context';
import { platformLearningAiFetch } from '../../../../../lib/platform-learning-ai';

const TYPES = new Set(['TUTOR', 'AUTHOR_DRAFT', 'ASSESSMENT_FEEDBACK', 'COACH']);

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'REQUEST_BODY_INVALID' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;
    if (typeof body.requestType !== 'string' || !TYPES.has(body.requestType)) {
      return NextResponse.json({ error: 'REQUEST_TYPE_INVALID' }, { status: 400 });
    }
    if (typeof body.prompt !== 'string' || body.prompt.trim() === '') {
      return NextResponse.json({ error: 'PROMPT_REQUIRED' }, { status: 400 });
    }
    if (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.trim() === '') {
      return NextResponse.json({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });
    }

    const upstream = await platformLearningAiFetch(context, '/api/learning/ai/requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': request.headers.get('x-correlation-id') ?? crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_AI_PROXY_FAILED';
    return NextResponse.json({ error: code }, { status: 502 });
  }
}
