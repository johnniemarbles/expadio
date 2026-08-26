'use client';

import React, { useState } from 'react';
import styles from './WiringBanner.module.css';
import { DataSource } from '../contracts.js';

export interface WiringBannerProps {
  source: DataSource;
  dismissible?: boolean;
}

export function WiringBanner({ source, dismissible }: WiringBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  // Fixture banners MUST NOT be dismissible
  const canDismiss = source.kind !== 'fixture' && dismissible !== false;

  if (dismissed) return null;

  return (
    <div className={`${styles.banner} ${styles[source.kind]}`} role="status" aria-live="polite">
      <div className={styles.content}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.text}>
          Data source is running in <strong>{source.kind}</strong> mode. {source.label}
        </span>
      </div>
      {canDismiss && (
        <button 
          onClick={() => setDismissed(true)} 
          className={styles.dismissBtn}
          aria-label="Dismiss banner"
        >
          ×
        </button>
      )}
    </div>
  );
}
