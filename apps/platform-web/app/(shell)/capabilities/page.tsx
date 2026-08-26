import { liveWorkspaceAdapter, liveWorkspaceSource } from "../../../lib/live-adapter";
import { CapabilityCatalog } from "../../../components/CapabilityCatalog/CapabilityCatalog";
import styles from "../page.module.css";
import { isDenied } from "@expadio/ui/contracts";
import { WiringBanner, DeniedState } from "@expadio/ui";
import { requestedOrganizationId, type RouteSearchParams } from "../../../lib/request-context";
export default async function CapabilitiesPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const result = await liveWorkspaceAdapter.loadCapabilities(await requestedOrganizationId(searchParams));
  if (isDenied(result)) return <DeniedState result={result} />;
  return <><WiringBanner source={liveWorkspaceSource}/><section className={styles.pageHeading} aria-labelledby="page-title"><div><p className={styles.eyebrow}>Command center</p><h1 id="page-title">Capabilities</h1><p>Inspect published and in-progress capabilities in the active scope.</p></div></section><CapabilityCatalog capabilities={result}/></>;
}
