import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import { AgentsClient } from './AgentsClient';

export const dynamic = 'force-dynamic';

export default async function AgentSettingsPage() {
  const context = await resolveBrandContext();
  const bindings = await withBrandTransaction(context, async (client) => {
    const res = await client.query(
      `SELECT b.binding_id, c.capability_key, b.mode AS mapped_to_resource,
              COALESCE(s.state, 'NOT_CONFIGURED') AS status, b.created_at
         FROM platform.tenant_capability_bindings b
         JOIN platform.capabilities c ON b.capability_id = c.capability_id
         LEFT JOIN platform.capability_state s ON b.binding_id = s.binding_id
        WHERE b.tenant_id = $1
        ORDER BY b.created_at DESC`,
      [context.tenantId]
    );
    return res.rows;
  });

  return <AgentsClient initial={bindings} />;
}
