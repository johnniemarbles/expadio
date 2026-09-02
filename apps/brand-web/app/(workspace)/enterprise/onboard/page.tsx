import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import { loadBrandOnboardingPortfolio } from '../../../../lib/enterprise-onboarding';
import { BrandEnterpriseOnboarding } from '../../../../components/BrandEnterpriseOnboarding';

export const dynamic = 'force-dynamic';

export default async function BrandEnterpriseOnboardPage() {
  const context = await resolveBrandContext();
  const portfolio = await withBrandTransaction(
    context,
    (client) => loadBrandOnboardingPortfolio(client, context),
  );

  return (
    <BrandEnterpriseOnboarding
      subjectId={context.subjectId}
      selectedOrganizationName={context.organizationName}
      initialRequests={portfolio.requests}
      initialPlans={portfolio.plans}
    />
  );
}
