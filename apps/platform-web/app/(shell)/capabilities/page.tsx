import { fixtureWorkspaceAdapter } from "../../../lib/fixture-adapter";
import { CapabilityCatalog } from "../../../components/CapabilityCatalog/CapabilityCatalog";
import styles from "../page.module.css";
import { isDenied } from "@expadio/ui/contracts";
import { WiringBanner, DeniedState } from "@expadio/ui";
import { brainFixtureSource } from "@/lib/brain-fixture-adapter";

export default async function CapabilitiesPage() {
  const result = await fixtureWorkspaceAdapter.loadCapabilities("org_dreamware");

  if (isDenied(result)) {
    return <DeniedState result={result} />;
  }

  return (
    <>
      <WiringBanner source={brainFixtureSource} />
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Command center</p>
          <h1 id="page-title">Capabilities</h1>
          <p>Manage capabilities within the active organization scope.</p>
        </div>
      </section>

      <CapabilityCatalog capabilities={result} />
    </>
  );
}
