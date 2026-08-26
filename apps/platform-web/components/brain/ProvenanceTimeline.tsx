import { ProvenanceEntry } from '@/lib/brain-contracts';
import styles from './ProvenanceTimeline.module.css';

interface ProvenanceTimelineProps {
  entries: ProvenanceEntry[];
}

export function ProvenanceTimeline({ entries }: ProvenanceTimelineProps) {
  if (entries.length === 0) {
    return <div className={styles.empty}>No provenance data.</div>;
  }

  return (
    <div className={styles.timelineContainer}>
      <ul className={styles.timeline}>
        {entries.map((entry, index) => (
          <li key={entry.id} className={styles.item}>
            <div className={styles.nodeWrapper}>
              <div className={styles.node} />
              {index !== entries.length - 1 && <div className={styles.line} />}
            </div>
            <div className={styles.content}>
              <p className={styles.text}>
                <span className={styles.actor}>{entry.actor}</span> performed{' '}
                <span className={styles.action}>{entry.action}</span>
              </p>
              <p className={styles.detail}>
                {entry.detail}
                {entry.auditRef && (
                  <span className={styles.auditRef}>
                    Ref: {entry.auditRef}
                  </span>
                )}
              </p>
              <time className={styles.time} dateTime={entry.timestamp}>
                {new Date(entry.timestamp).toLocaleString()}
              </time>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
