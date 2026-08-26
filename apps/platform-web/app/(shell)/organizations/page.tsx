import { fixtureWorkspaceAdapter, fixtureSource } from "../../../lib/fixture-adapter";
import styles from "../page.module.css";
import { isDenied } from "@expadio/ui/contracts";
import { WiringBanner, DeniedState } from "@expadio/ui";
import orgStyles from "./organizations.module.css";
import { requestedOrganizationId, type RouteSearchParams } from "../../../lib/request-context";
export default async function OrganizationsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const result = await fixtureWorkspaceAdapter.loadOrganization(await requestedOrganizationId(searchParams));
  if (isDenied(result)) return <DeniedState result={result} />;
  return <><WiringBanner source={fixtureSource}/><section className={styles.pageHeading} aria-labelledby="page-title"><div><p className={styles.eyebrow}>Command center</p><h1 id="page-title">Organizations</h1><p>Inspect the active position in the organization hierarchy.</p></div></section><section className={[styles.panel,orgStyles.organizationCard].join(" ")} aria-labelledby="organization-title"><div className={orgStyles.organizationMonogram}>{result.name.split(" ").map((word) => word[0]).join("").slice(0,2).toUpperCase()}</div><div><p className={styles.eyebrow}>{result.level} scope</p><h2 id="organization-title">{result.name}</h2><p>{result.environment} · Governed platform access</p></div><span className={[orgStyles.state,orgStyles.statePublished].join(" ")}>Fixture</span></section></>;
}
