import { NextResponse } from 'next/server';

const retired = {
  denied: true,
  reasonKey: 'LEGACY_CREDENTIAL_ROUTE_RETIRED',
  message: 'This raw-secret credential route has been retired. Use governed credential custody from Provider Infrastructure.',
} as const;

export async function GET() {
  return NextResponse.json(retired, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST() {
  return NextResponse.json(retired, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}
