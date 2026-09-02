import { BrandEnterpriseProfileOnboarding } from '../../../../../components/BrandEnterpriseProfileOnboarding';
import { resolveBrandContext } from '../../../../../lib/brand-context';

export const dynamic = 'force-dynamic';

export default async function BrandEnterpriseProfileOnboardingPage() {
  const context = await resolveBrandContext();
  return <BrandEnterpriseProfileOnboarding subjectId={context.subjectId} />;
}
