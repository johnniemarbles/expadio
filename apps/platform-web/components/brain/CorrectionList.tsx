import { CorrectionProposal } from '@/lib/brain-contracts';
import styles from './CorrectionList.module.css';

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

interface CorrectionListProps {
  corrections: CorrectionProposal[];
}

export function CorrectionList({ corrections }: CorrectionListProps) {
  if (corrections.length === 0) return null;

  return (
    <div className={styles.list}>
      {corrections.map(correction => {
        let stateVariant: 'success' | 'warning' | 'error' | 'neutral' | 'info' = 'neutral';
        if (correction.stage === 'accepted' || correction.stage === 'published') stateVariant = 'success';
        else if (correction.stage === 'rejected') stateVariant = 'error';
        else if (correction.stage === 'reviewing') stateVariant = 'warning';
        else if (correction.stage === 'routed') stateVariant = 'info';

        return (
          <div key={correction.id} className={styles.item}>
            <div className={styles.header}>
              <h3 className={styles.title}>{correction.title}</h3>
              <StatusBadge label={correction.stage} variant={stateVariant} />
            </div>

            <div className={styles.details}>
              <span className={styles.detailItem}><strong>Category:</strong> {correction.category}</span>
              <span className={styles.detailItem}><strong>Proposed By:</strong> {correction.proposedBy}</span>
              <span className={styles.detailItem}><strong>Evidence:</strong> {correction.evidenceRefs.length} refs</span>
            </div>

            <div className={styles.footer}>
              <span>Created {new Date(correction.createdAt).toLocaleDateString()}</span>
              <span>Updated {new Date(correction.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
