import { OrganizationSetupWorkspace } from './OrganizationSetupWorkspace';

export const dynamic = 'force-dynamic';

export default async function OrganizationSetupPlanPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  return <OrganizationSetupWorkspace planId={planId} />;
}
