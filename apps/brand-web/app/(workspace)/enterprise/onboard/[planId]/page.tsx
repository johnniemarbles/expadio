import { notFound } from 'next/navigation';
import { BrandEnterpriseSetupWorkspace } from '../../../../../components/BrandEnterpriseSetupWorkspace';
import { resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';
import { loadBrandSetupPlan } from '../../../../../lib/enterprise-onboarding';

export const dynamic = 'force-dynamic';

export default async function BrandEnterpriseSetupPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const context = await resolveBrandContext();
  const { planId } = await params;
  try {
    const setup = await withBrandTransaction(
      context,
      (client) => loadBrandSetupPlan(client, context, planId),
    );
    return <BrandEnterpriseSetupWorkspace subjectId={context.subjectId} initial={setup} />;
  } catch {
    notFound();
  }
}
