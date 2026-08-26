import { fixtureWorkspaceAdapter } from "../../../lib/fixture-adapter";
import styles from "../page.module.css";
import { isDenied } from "@expadio/ui/contracts";
import { DeniedState, ActivityTimeline } from "@expadio/ui";

export default async function AuditPage() {
  const result = await fixtureWorkspaceAdapter.loadActivity("org_dreamware");

  if (isDenied(result)) {
    return <DeniedState result={result} />;
  }

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Command center</p>
          <h1 id="page-title">Audit</h1>
          <p>Manage audit within the active organization scope.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="audit-title">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Immutable references</p>
            <h2 id="audit-title">Audit timeline</h2>
          </div>
        </div>
        <ActivityTimeline items={result} />
      </section>
    </>
  );
}
