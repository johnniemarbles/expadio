import styles from '../../page.module.css';
import { EmptyState } from '@expadio/ui';

export default function CredentialsPage() {
  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Platform Administration</p>
          <h1 id="page-title">Credential Custody</h1>
          <p>Provider secrets are accepted only through the governed wrapping, validation, vault and rotation lifecycle.</p>
        </div>
      </section>
      <EmptyState
        title="Legacy credential form retired"
        description="Raw API keys and provider tokens are no longer accepted by the configuration route."
        primaryAction={{ label: 'Open Provider Infrastructure', href: '/communications?tab=providers' }}
      />
    </>
  );
}
