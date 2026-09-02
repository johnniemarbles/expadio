import Link from 'next/link';
import type { PoolClient } from 'pg';
import { resolveBrandContext, withBrandTransaction } from '../../../lib/brand-context';
import styles from '../workspace.module.css';

export const dynamic = 'force-dynamic';

export default async function BrandBrainPage() {
  const context = await resolveBrandContext();
  const data = await withBrandTransaction(context, async (client: PoolClient) => {
    const [observations, insights] = await Promise.all([
      client.query(`SELECT count(*)::int AS count FROM platform.brand_brain_observations WHERE tenant_id=$1::uuid AND organization_id=$2::uuid`, [context.tenantId, context.organizationId]),
      client.query(`SELECT insight_id, insight_key, statement, confidence, status, model_name, model_version, created_at
        FROM platform.brand_brain_insights
        WHERE tenant_id=$1::uuid AND organization_id=$2::uuid AND status IN ('REVIEWED','PUBLISHED')
        ORDER BY created_at DESC LIMIT 8`, [context.tenantId, context.organizationId]),
    ]);
    return { observationCount: Number(observations.rows[0]?.count ?? 0), insights: insights.rows };
  });
  return <>
    <section className={styles.pageHead}><div><p className={styles.eyebrow}>Brand intelligence</p><h1>Brand Brain</h1><p>Your private operating memory: evidence-backed insights from the work your brand performs.</p></div><Link className={styles.secondaryButton} href="/api/brain/insights">Open insight feed</Link></section>
    <section className={styles.appStats}><article className={styles.metric}><div className={styles.metricLabel}>Captured observations</div><div className={styles.metricValue}>{data.observationCount}</div><div className={styles.metricDetail}>Tenant-private operational evidence</div></article><article className={styles.metric}><div className={styles.metricLabel}>Published insights</div><div className={styles.metricValue}>{data.insights.length}</div><div className={styles.metricDetail}>Reviewed projections only</div></article></section>
    <section className={styles.panel}><div className={styles.panelHead}><div><p className={styles.eyebrow}>Evidence-backed intelligence</p><h2>What your Brand Brain knows</h2></div></div><div className={styles.panelBody}>{data.insights.length===0?<p>No reviewed insights yet. As your workflows produce governed observations, reviewed intelligence will appear here.</p>:<div className={styles.appGrid}>{data.insights.map((insight: { insight_id: string; insight_key: string; statement: string; confidence: number | string; status: string; model_name: string; model_version: string })=><article className={styles.appCard} key={insight.insight_id}><div className={styles.appCardHead}><div><h2>{insight.insight_key}</h2><p>{insight.statement}</p></div><span className={styles.pill}>{insight.status}</span></div><div className={styles.appMeta}><span className={styles.metaChip}>Confidence {Math.round(Number(insight.confidence)*100)}%</span><span className={styles.metaChip}>{insight.model_name} · {insight.model_version}</span></div></article>)}</div>}</div></section>
  </>;
}
