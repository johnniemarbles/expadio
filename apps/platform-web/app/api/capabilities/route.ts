import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { CapabilitySummary } from '../../../lib/contracts';
import type { DeniedResult } from '@expadio/ui/contracts';

export async function GET(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'UNAUTHENTICATED',
      message: 'User is not authenticated'
    };
    return NextResponse.json(denied, { status: 401 });
  }

  const capabilities: CapabilitySummary[] = [
    { id: 'cap_live_1', name: 'Live Incident Response', kind: 'Worker', version: '2.0.1', state: 'Published', scope: 'Global', updated: '2026-08-26T10:00:00Z' },
    { id: 'cap_live_2', name: 'Compliance Auditing', kind: 'Skill', version: '1.4.0', state: 'Review', scope: 'EU-Region', updated: '2026-08-25T14:30:00Z' }
  ];

  return NextResponse.json(capabilities);
}
