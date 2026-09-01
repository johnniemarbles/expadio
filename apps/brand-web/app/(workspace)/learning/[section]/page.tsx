import { notFound } from 'next/navigation';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import { loadLearningReport, loadLearningSection } from '../../../../lib/learning-data';
import styles from '../../workspace.module.css';

const META: Record<string, { title: string; description: string }> = {
  learners: { title: 'Learners', description: 'People, audiences, enrollment load and progress.' },
  assessments: { title: 'Assessments', description: 'Versioned assessment definitions and publication state.' },
  programs: { title: 'Programs & credentials', description: 'Structured programs, certifications and durable credentials.' },
  skills: { title: 'Skills', description: 'Competency frameworks, evidence rules and learner achievements.' },
  assignments: { title: 'Assignments', description: 'Governed assignment rules and automated learning allocation.' },
  reports: { title: 'Reports', description: 'Operational learning data without a second analytics truth store.' },
};

function table(rows: readonly Record<string, unknown>[]) {
  if (rows.length === 0) return <div className={styles.empty}>No records yet.</div>;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 8);
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.key ?? index)}>{columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? '—' : String(row[column])}</td>)}</tr>)}</tbody></table></div>;
}

export default async function LearningSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const meta = META[section];
  if (!meta) notFound();
  const context = await resolveBrandContext();
  const data = await withBrandTransaction(context, async (client) => {
    const module = await loadTenantProductModule(client, { tenantId: context.tenantId, moduleKey: 'learning' });
    if (module?.availability !== 'ACTIVE') return { module, rows: [] as readonly Record<string, unknown>[] };
    const rows = section === 'reports'
      ? await loadLearningReport(client, context.tenantId)
      : await loadLearningSection(client, context.tenantId, section);
    return { module, rows };
  });

  return <><section className={styles.pageHead}><div><p className={styles.eyebrow}>Learning</p><h1>{meta.title}</h1><p>{meta.description}</p></div></section>{data.module?.availability !== 'ACTIVE' ? <div className={styles.notice}>Activate Learning before using this surface.</div> : <section className={styles.panel}><div className={styles.panelHead}><h2>{meta.title}</h2></div>{table(data.rows)}</section>}</>;
}
