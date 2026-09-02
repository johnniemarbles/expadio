import { BrainSource } from '@/lib/brain-contracts';
import styles from './SourceTable.module.css';

function StatusBadge({ label, variant }: { label: string; variant: 'success' | 'warning' | 'error' | 'neutral' | 'info' }) {
  const variantClass = {
    success: styles.statusSuccess,
    warning: styles.statusWarning,
    error: styles.statusError,
    info: styles.statusInfo,
    neutral: styles.statusNeutral,
  }[variant];

  return <span className={[styles.statusBadge, variantClass].join(' ')}>{label}</span>;
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
                <td><StatusBadge label={source.reviewStatus} variant={stateVariant} /></td>
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
