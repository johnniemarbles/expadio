import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '../../../../../../lib/brand-context';
import { loadBrandSetupPlan } from '../../../../../../lib/enterprise-onboarding';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const { planId } = await params;
    const result = await withBrandTransaction(
      context,
      (client) => loadBrandSetupPlan(client, context, planId),
    );
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ENTERPRISE_SETUP_LOAD_FAILED';
    return NextResponse.json(
      { denied: true, reasonKey: message, message: 'This setup plan is not available in the selected Brand hierarchy.' },
      { status: message === 'BRAND_ENTERPRISE_SETUP_SCOPE_MISMATCH' ? 403 : 404 },
    );
  }
}
