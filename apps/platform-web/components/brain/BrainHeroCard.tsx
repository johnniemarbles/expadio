import { BrainOverview } from '@/lib/brain-contracts';
import styles from './BrainHeroCard.module.css';

interface BrainHeroCardProps {
  overview: BrainOverview;
}

export function BrainHeroCard({ overview }: BrainHeroCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.content}>
        <h2 className={styles.title}>Company Brain</h2>
        <p className={styles.summary}>{overview.healthSummary}</p>
        
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{overview.indexedSources}</span>
            <span className={styles.metricLabel}>Indexed Sources</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{overview.pendingCorrections}</span>
            <span className={styles.metricLabel}>Pending Corrections</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricValue}>{overview.freshnessTargetHours}h</span>
            <span className={styles.metricLabel}>Freshness Target</span>
          </div>
        </div>
      </div>
    </div>
  );
}
