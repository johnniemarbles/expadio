import { requireCommunicationReverification } from '../../../../lib/communication-reverification';
import { requireCommunicationAdmin } from '../../../../lib/communication-admin';
import { NextResponse } from 'next/server';
import { WrappingKeyStore } from '@expadio/credential-custody';
import { resolveRequestContext, deniedResponse } from '../../../../lib/request-context';

/**
 * Design spec §2.2 step 1–2 — GET /custody/wrapping-key.
 *
 * DEPLOYMENT NOTE (§2.2, and this is the control, not the code):
 * in production this route and /custody/credentials must run in a separate
 * process from the control-plane API, with:
 *   · no database credentials in its environment
 *   · a dedicated log sink, info max level, structured only
 *   · egress allowlisted to provider API hosts and the KMS endpoint
 *   · request bodies never persisted, never forwarded
 *
 * They live under apps/platform-web here so the flow is testable end to end.
 * The extraction is P2's deliverable; the CI assertions in §2.2 are what stop
 * this becoming permanent.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

declare global {
  var _custodyWrappingKeys: WrappingKeyStore | undefined;
}

// In-memory and single-pod by design. A wrapping key that outlives the
// process, or that is shared through a datastore, is one that can be
// exfiltrated at rest.
export const wrappingKeys = globalThis._custodyWrappingKeys ?? new WrappingKeyStore(120);
globalThis._custodyWrappingKeys = wrappingKeys;

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    await requireCommunicationAdmin(context);
    const challenge = await requireCommunicationReverification(context.subjectId);
    if (challenge) return challenge;

    wrappingKeys.evictExpired();
    const key = wrappingKeys.issue();

    return NextResponse.json(key, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        Pragma: 'no-cache',
      },
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
