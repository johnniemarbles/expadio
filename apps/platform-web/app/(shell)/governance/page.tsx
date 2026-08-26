import { fixtureWorkspaceAdapter, fixtureSource } from "../../../lib/fixture-adapter";
import styles from "../page.module.css";
import { isDenied } from "@expadio/ui/contracts";
import { WiringBanner, DeniedState, EmptyState } from "@expadio/ui";
import { ReviewQueue } from "../../../components/ReviewQueue/ReviewQueue";
import { requestedOrganizationId, type RouteSearchParams } from "../../../lib/request-context";
export default async function GovernancePage({ searchParams }: { searchParams: RouteSearchParams }) {
  const result = await fixtureWorkspaceAdapter.loadReviews(await requestedOrganizationId(searchParams));
  if (isDenied(result)) return <DeniedState result={result} />;
  return <><WiringBanner source={fixtureSource}/><section className={styles.pageHeading} aria-labelledby="page-title"><div><p className={styles.eyebrow}>Command center</p><h1 id="page-title">Governance</h1><p>Review policy-controlled work in the active scope.</p></div></section><section className={styles.panel} aria-labelledby="governance-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Policy-controlled work</p><h2 id="governance-title">Review queue</h2></div><span className={styles.countBadge}>{result.length}</span></div>{result.length ? <ReviewQueue reviews={result}/> : <EmptyState title="No reviews pending" description="This scope has no pending review work."/>}</section></>;
}
