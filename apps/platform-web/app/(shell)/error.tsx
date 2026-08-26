"use client";
import { useEffect } from "react";
import styles from "./route-state.module.css";
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void; }) {
  useEffect(() => { console.error(error); }, [error]);
  return <section className={styles.errorState} role="alert" aria-labelledby="route-error-title"><div className={styles.errorMark} aria-hidden="true">!</div><h2 id="route-error-title">This view could not be loaded</h2><p>No changes were made. Try loading the view again; if the problem continues, use the correlation ID when contacting support.</p>{error.digest && <p className={styles.correlation}>Correlation ID: {error.digest}</p>}<button type="button" className={styles.retryButton} onClick={reset}>Try again</button></section>;
}
