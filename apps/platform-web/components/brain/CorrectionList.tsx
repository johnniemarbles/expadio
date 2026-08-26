import { CorrectionProposal } from '@/lib/brain-contracts';
import styles from './CorrectionList.module.css';

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


interface CorrectionListProps {
  corrections: CorrectionProposal[];
}

export function CorrectionList({ corrections }: CorrectionListProps) {
  if (corrections.length === 0) {
    return null;
  }

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
              <StatusBadge label={correction.stage} variant={stateVariant as "success" | "warning" | "error" | "neutral" | "info"} />
            </div>
            
            <div className={styles.details}>
              <span className={styles.detailItem}>
                <strong>Category:</strong> {correction.category}
              </span>
              <span className={styles.detailItem}>
                <strong>Proposed By:</strong> {correction.proposedBy}
              </span>
              <span className={styles.detailItem}>
                <strong>Evidence:</strong> {correction.evidenceRefs.length} refs
              </span>
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
