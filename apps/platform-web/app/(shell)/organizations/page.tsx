import { fixtureWorkspaceAdapter } from "../../../lib/fixture-adapter";
import styles from "../page.module.css";
import { isDenied } from "@expadio/ui/contracts";
import { WiringBanner, DeniedState } from "@expadio/ui";
import orgStyles from "./organizations.module.css";
import { brainFixtureSource } from "@/lib/brain-fixture-adapter";

export default async function OrganizationsPage() {
  const result = await fixtureWorkspaceAdapter.loadOrganization("org_dreamware");

  if (isDenied(result)) {
    return <DeniedState result={result} />;
  }

  return (
    <>
      <WiringBanner source={brainFixtureSource} />
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Command center</p>
          <h1 id="page-title">Organizations</h1>
          <p>Manage organizations within the active organization scope.</p>
        </div>
      </section>

      <section className={`${styles.panel} ${orgStyles.organizationCard}`} aria-labelledby="organization-title">
        <div className={orgStyles.organizationMonogram} aria-hidden="true">
          {result.name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase()}
        </div>
        <div>
          <p className={styles.eyebrow}>Active scope</p>
          <h2 id="organization-title">{result.name}</h2>
          <p>{result.environment} · Governed platform access</p>
        </div>
        <span className={`${orgStyles.state} ${orgStyles.statePublished}`}>Active</span>
      </section>
    </>
  );
}
