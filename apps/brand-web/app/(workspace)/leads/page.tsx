import { revalidatePath } from 'next/cache';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../lib/brand-context';
import { convertBrandLeadToCustomer, listBrandLeads, updateBrandLeadStage } from '../../../lib/brand-leads';
import LeadManagementClient from './LeadManagementClient';
import styles from '../workspace.module.css';

export const dynamic = 'force-dynamic';

async function requireLeadModule() {
  const context = await resolveBrandContext();
  const module = await withBrandTransaction(context, (client) =>
    loadTenantProductModule(client, {
      tenantId: context.tenantId,
      moduleKey: 'lead-management',
    })
  );
  return { context, module };
}

async function updateStageAction(formData: FormData) {
  'use server';
  const { context, module } = await requireLeadModule();
  if (module?.availability !== 'ACTIVE') throw new Error('LEAD_MODULE_NOT_ACTIVE');
  await withBrandTransaction(context, async (client) => {
    if (!(await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId))) {
      throw new Error('LEAD_WRITE_FORBIDDEN');
    }
    const leadId = String(formData.get('leadId') ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw new Error('LEAD_ID_INVALID');
    const updated = await updateBrandLeadStage(client, { leadId, stage: formData.get('stage') });
    if (!updated) throw new Error('LEAD_NOT_FOUND');
  });
  revalidatePath('/leads');
}

async function convertLeadAction(formData: FormData) {
  'use server';
  const { context, module } = await requireLeadModule();
  if (module?.availability !== 'ACTIVE') throw new Error('LEAD_MODULE_NOT_ACTIVE');
  await withBrandTransaction(context, async (client) => {
    if (!(await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId))) {
      throw new Error('LEAD_WRITE_FORBIDDEN');
    }
    const leadId = String(formData.get('leadId') ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw new Error('LEAD_ID_INVALID');
    const converted = await convertBrandLeadToCustomer(client, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      leadId,
    });
    if (!converted) throw new Error('LEAD_NOT_FOUND');
  });
  revalidatePath('/leads');
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const { context, module } = await requireLeadModule();
  const params = await searchParams;

  if (module?.availability !== 'ACTIVE') {
    return (
      <>
        <section className={styles.pageHead}>
          <div>
            <p className={styles.eyebrow}>Growth</p>
            <h1>Lead Management</h1>
            <p>Capture, qualify and convert demand inside the selected organization workspace.</p>
          </div>
        </section>
        <div className={styles.notice}>
          <strong>Lead Management is not active for this tenant.</strong>
          <p>
            Availability: {module?.availability ?? 'UNAVAILABLE'}. Catalogue metadata never grants
            entitlement or activates the module.
          </p>
        </div>
      </>
    );
  }

  const allLeads = await withBrandTransaction(context, (client) => listBrandLeads(client, {}));

  return (
    <LeadManagementClient
      initialLeads={allLeads}
      initialStage={params.stage ?? ''}
      organizationName={context.organizationName ?? 'Brand Workspace'}
      updateStageAction={updateStageAction}
      convertLeadAction={convertLeadAction}
    />
  );
}
