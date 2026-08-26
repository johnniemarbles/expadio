import { fixtureWorkspaceAdapter } from "../../../lib/fixture-adapter";
import styles from "../page.module.css";
import { isDenied } from "@expadio/ui/contracts";
import { WiringBanner, DeniedState } from "@expadio/ui";
import { ReviewQueue } from "../../../components/ReviewQueue/ReviewQueue";
import { brainFixtureSource } from "@/lib/brain-fixture-adapter";

export default async function GovernancePage() {
  const result = await fixtureWorkspaceAdapter.loadReviews("org_dreamware");

  if (isDenied(result)) {
    return <DeniedState result={result} />;
  }

  return (
    <>
      <WiringBanner source={brainFixtureSource} />
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Command center</p>
          <h1 id="page-title">Governance</h1>
          <p>Manage governance within the active organization scope.</p>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="governance-title">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Policy-controlled work</p>
            <h2 id="governance-title">Review queue</h2>
          </div>
          <span className={styles.countBadge}>{result.length}</span>
        </div>
        <ReviewQueue reviews={result} />
      </section>
    </>
  );
}
