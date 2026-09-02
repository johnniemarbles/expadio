import Link from "next/link";
import { SuppressionPanel } from "./SuppressionPanel";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default function CommunicationsSuppressionsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Platform administration / Communications</p>
          <h1>Suppression control plane</h1>
          <p className={styles.subtitle}>Inspect, add, and revoke tenant-scoped recipient suppressions without exposing or mutating platform-global policy.</p>
        </div>
        <Link className={styles.backLink} href="/communications">Back to communications</Link>
      </div>
      <SuppressionPanel />
    </main>
  );
}
