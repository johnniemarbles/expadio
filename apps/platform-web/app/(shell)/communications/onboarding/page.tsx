import Link from "next/link";
import { DeniedState } from "@expadio/ui";
import { isDenied } from "@expadio/ui/contracts";
import { fetchApi } from "../../../../lib/live-adapter";
import type { SetupState } from "../../../api/communications/setup/state/route";
import styles from "./page.module.css";

const STEP_NUMBERS: Record<string, number> = {
  CHOOSE_CUSTODY: 1,
  CONNECT_PROVIDER: 2,
  VERIFY_DOMAIN: 3,
  CREATE_SENDER: 4,
  SET_LIMITS: 5,
  TEST_SEND: 6,
  GO_LIVE: 7,
};

export default async function CommunicationsOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (typeof params.account === "string") qs.set("account", params.account);
  if (typeof params.org === "string") qs.set("org", params.org);
  const q = qs.toString() ? `?${qs.toString()}` : "";

  const state = await fetchApi<SetupState>(`/api/communications/setup/state${q}`);
  if (isDenied(state)) return <DeniedState result={state} />;

  const selectedStep = typeof params.step === "string" ? params.step : "";
  const next = state.steps.find((step) => step.key === state.nextStep) ?? state.steps.find((step) => !step.complete);

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <div className={styles.crumb}>Platform administration / Communications</div>
        <h1 className={styles.title}>Communication onboarding</h1>
        <p className={styles.lede}>
          Follow the governed setup path from credential custody to signed live-delivery certification.
        </p>
      </header>

      <ol className={styles.rail} aria-label="Communications setup progress">
        {state.steps.map((step) => {
          const isCurrent = selectedStep.length > 0
            ? step.href.includes(`step=${selectedStep}`)
            : step.key === state.nextStep;
          const className = [
            styles.railStep,
            step.complete ? styles.railDone : "",
            isCurrent ? styles.railNow : "",
            step.blocked ? styles.railBlocked : "",
          ].filter(Boolean).join(" ");
          return (
            <li key={step.key} className={className}>
              <span className={styles.railNum}>{step.complete ? "OK" : STEP_NUMBERS[step.key]}</span>
              <span className={styles.railBody}>
                <span className={styles.railTitle}>{step.title}</span>
                <span className={styles.railDesc}>{step.description}</span>
                {step.blockedReason && <span className={styles.railReason}>{step.blockedReason}</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <section className={state.isLive ? `${styles.card} ${styles.cardOk}` : styles.card}>
        <h2 className={styles.cardTitle}>
          {state.isLive ? "Live certification complete" : next?.title ?? "Setup complete"}
        </h2>
        <p className={styles.cardNote}>
          Status: {state.certificationStatus}. Completed {state.completedCount} of {state.steps.length} steps.
          {state.liveCertifiedConnectors > 0
            ? ` ${state.liveCertifiedConnectors} connector${state.liveCertifiedConnectors === 1 ? "" : "s"} live certified.`
            : " No connector is live certified yet."}
        </p>
        {state.degradedReasons.length > 0 && (
          <ul className={styles.findings}>
            {state.degradedReasons.map((reason) => (
              <li key={reason}><span className={styles.warn}>!</span><span>{reason}</span></li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Continue in Provider Control</h2>
        <p className={styles.cardNote}>
          Provider registration, domain verification, limits, test sends, and live certification are handled by the live Communications console.
        </p>
        <div className={styles.fingerprint}>
          <div>
            <div className={styles.fpLabel}>Next step</div>
            <div className={styles.fpValue}>{state.nextStep ?? "DONE"}</div>
          </div>
          <div className={styles.fpNote}>
            Open Provider Control and use Add provider, Manage Domains, Capacity &amp; spend, then Manage on a connector.
          </div>
        </div>
        <p className={styles.note}>
          <Link href={`/communications${q}`} className={styles.primary}>
            Open Communications console
          </Link>
        </p>
      </section>
    </main>
  );
}
