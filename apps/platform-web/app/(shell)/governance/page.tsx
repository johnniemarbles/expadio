import { liveWorkspaceAdapter, liveWorkspaceSource } from "../../../lib/live-adapter";
import styles from "../page.module.css";
import { isDenied } from "@expadio/ui/contracts";
import { WiringBanner, DeniedState, EmptyState } from "@expadio/ui";
import { ReviewQueue } from "../../../components/ReviewQueue/ReviewQueue";
import { requestedOrganizationId, type RouteSearchParams } from "../../../lib/request-context";
import { GovernanceSummaryStrip } from "./GovernanceSummaryStrip";
export default async function GovernancePage({ searchParams }: { searchParams: RouteSearchParams }) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (typeof params.account === "string") qs.set("account", params.account);
  if (typeof params.org === "string") qs.set("org", params.org);
  const q = qs.toString() ? `?${qs.toString()}` : "";
  const result = await liveWorkspaceAdapter.loadReviews(await requestedOrganizationId(searchParams));
  if (isDenied(result)) return <DeniedState result={result} />;
  return <><WiringBanner source={liveWorkspaceSource}/><section className={styles.pageHeading} aria-labelledby="page-title"><div><p className={styles.eyebrow}>Command center</p><h1 id="page-title">Governance</h1><p>Review policy-controlled work in the active scope.</p></div></section><GovernanceSummaryStrip queryString={q}/><section className={styles.panel} aria-labelledby="governance-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Policy-controlled work</p><h2 id="governance-title">Review queue</h2></div><span className={styles.countBadge}>{result.length}</span></div>{result.length ? <ReviewQueue reviews={result}/> : <EmptyState title="No reviews pending" description="This scope has no pending review work."/>}</section></>;
}
