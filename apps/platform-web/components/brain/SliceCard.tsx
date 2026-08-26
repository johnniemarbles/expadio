import { ContextSlice } from '@/lib/brain-contracts';
import styles from './SliceCard.module.css';

interface SliceCardProps {
  slice: ContextSlice;
}

export function SliceCard({ slice }: SliceCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h3 className={styles.purpose}>{slice.purpose}</h3>
        <span className={styles.tenantScope}>{slice.tenantScope}</span>
      </div>
      
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{slice.sourceCount}</span>
          <span className={styles.statLabel}>Sources</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{slice.itemLimit}</span>
          <span className={styles.statLabel}>Limit</span>
        </div>
      </div>
      
      <div className={styles.footer}>
        <span className={styles.lastResolved}>
          Resolved {new Date(slice.lastResolved).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}
