import { revalidatePath } from 'next/cache';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../lib/brand-context';
import { BRAND_LEAD_STAGES, convertBrandLeadToCustomer, createBrandLead, listBrandLeads, updateBrandLeadStage } from '../../../lib/brand-leads';
import styles from '../workspace.module.css';

export const dynamic = 'force-dynamic';

async function requireLeadModule() {
  const context = await resolveBrandContext();
  const module = await withBrandTransaction(context, (client) => loadTenantProductModule(client, {
    tenantId: context.tenantId,
    moduleKey: 'lead-management',
  }));
  return { context, module };
}

async function createLeadAction(formData: FormData) {
  'use server';
  const { context, module } = await requireLeadModule();
  if (module?.availability !== 'ACTIVE') throw new Error('LEAD_MODULE_NOT_ACTIVE');
  await withBrandTransaction(context, async (client) => {
    if (!(await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId))) {
      throw new Error('LEAD_WRITE_FORBIDDEN');
    }
    await createBrandLead(client, {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      actorSubjectId: context.subjectId,
      body: {
        title: formData.get('title'),
        stage: 'NEW',
        amountMinorUnits: formData.get('amountMinorUnits'),
        currency: formData.get('currency'),
      },
    });
  });
  revalidatePath('/leads');
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

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  const { context, module } = await requireLeadModule();
  const params = await searchParams;
  if (module?.availability !== 'ACTIVE') {
    return <>
      <section className={styles.pageHead}><div><p className={styles.eyebrow}>Growth</p><h1>Lead Management</h1><p>Capture, qualify and convert demand inside the selected organization workspace.</p></div></section>
      <div className={styles.notice}><strong>Lead Management is not active for this tenant.</strong><p>Availability: {module?.availability ?? 'UNAVAILABLE'}. Catalogue metadata never grants entitlement or activates the module.</p></div>
    </>;
  }

  const selectedStage = params.stage?.trim().toUpperCase() ?? '';
  const leads = await withBrandTransaction(context, (client) => listBrandLeads(client, { stage: selectedStage }));
  const counts = BRAND_LEAD_STAGES.map((stage) => ({ stage, count: leads.filter((lead) => lead.stage === stage).length }));

  return <>
    <section className={styles.pageHead}>
      <div><p className={styles.eyebrow}>Growth · {context.organizationName}</p><h1>Lead Management</h1><p>Organization-scoped CRM projection for active demand. Demand Capture’s 19-stage journey remains a separate governed layer.</p></div>
    </section>

    <section className={styles.grid}>{counts.map(({ stage, count }) => <article className={styles.metric} key={stage}><div className={styles.metricLabel}>{stage}</div><div className={styles.metricValue}>{count}</div><div className={styles.metricDetail}>Visible in this workspace scope</div></article>)}</section>

    <section id="new-lead" className={styles.panel}>
      <div className={styles.panelHead}><h2>Create lead</h2></div>
      <div className={styles.panelBody}>
        <form action={createLeadAction} className="learningForm">
          <label className="wide">Lead title<input name="title" maxLength={200} required /></label>
          <label>Amount (minor units)<input name="amountMinorUnits" type="number" min="0" step="1" /></label>
          <label>Currency<input name="currency" defaultValue="USD" maxLength={3} /></label>
          <div className="wide"><button className={styles.button} type="submit">Create lead</button></div>
        </form>
      </div>
    </section>

    <section className={styles.panel}>
      <div className={styles.panelHead}><h2>Lead inbox</h2><span className={styles.pill}>{selectedStage || 'ALL'} · {leads.length}</span></div>
      {leads.length === 0 ? <div className={styles.empty}>No leads are visible in this organization scope.</div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Lead</th><th>Stage</th><th>Value</th><th>Account</th><th>Source</th><th>Actions</th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.leadId}>
        <td><strong>{lead.title}</strong><br /><small>{new Date(lead.createdAt).toLocaleDateString()}</small></td>
        <td><span className={styles.pill}>{lead.stage}</span></td>
        <td>{lead.amountMinorUnits == null ? '—' : `${lead.currency} ${(lead.amountMinorUnits / 100).toFixed(2)}`}</td>
        <td>{lead.accountName ?? '—'}</td><td>{lead.source ?? '—'}</td>
        <td><form action={updateStageAction} style={{display:'flex',gap:6,flexWrap:'wrap'}}><input type="hidden" name="leadId" value={lead.leadId}/><select name="stage" defaultValue={lead.stage}>{BRAND_LEAD_STAGES.map((stage) => <option value={stage} key={stage}>{stage}</option>)}</select><button type="submit">Update</button></form>{lead.stage !== 'LOST' && lead.stage !== 'WON' ? <form action={convertLeadAction} style={{marginTop:6}}><input type="hidden" name="leadId" value={lead.leadId}/><button type="submit">Convert to customer</button></form> : null}</td>
      </tr>)}</tbody></table></div>}
    </section>
  </>;
}
