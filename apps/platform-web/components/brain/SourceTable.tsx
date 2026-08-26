import { BrainSource } from '@/lib/brain-contracts';
import styles from './SourceTable.module.css';

function StatusBadge({ label, variant }: { label: string; variant: "success" | "warning" | "error" | "neutral" | "info" }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    success: { bg: "var(--green-soft)", fg: "var(--green)" },
    warning: { bg: "var(--amber-soft)", fg: "var(--amber)" },
    error: { bg: "var(--red-soft)", fg: "var(--red)" },
    info: { bg: "var(--brand-soft)", fg: "var(--brand-dark)" },
    neutral: { bg: "var(--surface-soft)", fg: "var(--ink-600)" },
  };
  const c = colors[variant] ?? colors.neutral;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", backgroundColor: c.bg, color: c.fg }}>
      {label}
    </span>
  );
}


interface SourceTableProps {
  sources: BrainSource[];
}

export function SourceTable({ sources }: SourceTableProps) {
  if (sources.length === 0) {
    return <div className={styles.empty}>No sources available.</div>;
  }

  // Sort by precedence (lowest number = highest authority, so ascending)
  const sorted = [...sources].sort((a, b) => a.precedence - b.precedence);

  return (
    <div className={styles.tableContainer}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Precedence</th>
            <th>Name</th>
            <th>Kind</th>
            <th>Review Status</th>
            <th>Digest</th>
            <th>Effective Date</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(source => {
            let stateVariant: 'success' | 'warning' | 'error' | 'neutral' = 'neutral';
            if (source.reviewStatus === 'approved') stateVariant = 'success';
            else if (source.reviewStatus === 'pending') stateVariant = 'warning';
            else if (source.reviewStatus === 'rejected') stateVariant = 'error';
            
            return (
              <tr key={source.id}>
                <td className={styles.precedenceCell}>L{source.precedence}</td>
                <td className={styles.nameCell}>{source.name}</td>
                <td className={styles.kindCell}>{source.kind}</td>
                <td>
                  <StatusBadge label={source.reviewStatus} variant={stateVariant as "success" | "warning" | "error" | "neutral" | "info"} />
                </td>
                <td className={styles.digestCell}>{source.contentDigest.substring(0, 15)}...</td>
                <td className={styles.dateCell}>{new Date(source.effectiveDate).toLocaleDateString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
