'use client';

import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { ThemeModeControl } from '@expadio/ui';
import { useEffect, useState } from 'react';
import styles from './setup.module.css';

interface SetupContext {
  subjectId: string;
  tenantId: string;
  enterpriseId: string;
  organizationId: string;
  setupPlanId: string;
  role: 'OWNER' | 'CONTRIBUTOR' | 'REVIEWER';
  organizationName: string;
  organizationKind: string;
  parentOrganizationId: string | null;
  setupState: 'PROVISIONING' | 'CONFIGURING' | 'READY_FOR_ACTIVATION';
  completionPercent: number;
  blockingOpenRequirements: number;
}

interface ContextResponse {
  contexts?: SetupContext[];
  denied?: true;
  reasonKey?: string;
  message?: string;
}

function stateLabel(state: SetupContext['setupState']): string {
  if (state === 'READY_FOR_ACTIVATION') return 'Ready for activation';
  if (state === 'CONFIGURING') return 'Configuration in progress';
  return 'Provisioning';
}

export function EnterpriseSetupLanding() {
  const [data, setData] = useState<ContextResponse | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/enterprise/setup/context', { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok && !body.denied) {
          throw new Error('Unable to load setup assignments.');
        }
        return body as ContextResponse;
      })
      .then((body) => {
        if (active) setData(body);
      })
      .catch(() => {
        if (active) {
          setData({
            denied: true,
            reasonKey: 'ENTERPRISE_SETUP_LOAD_FAILED',
            message: 'Your organization setup assignments could not be loaded.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className={styles.workspaceShell} data-expadio-theme="platform">
      <header className={styles.topbar}>
        <Link href="/enterprise-setup" className={styles.brand}>
          <span className={styles.brandMark}>E</span>
          <span>
            <strong>EXPADIO</strong>
            <small>Organization Setup</small>
          </span>
        </Link>
        <div className={styles.topbarActions}>
          <ThemeModeControl />
          <UserButton />
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Enterprise onboarding</p>
            <h1>Organization setup</h1>
            <p>
              Complete the governed requirements assigned to your organization.
              Business-runtime access remains locked until the parent authority
              approves activation.
            </p>
          </div>
        </section>

        {data === null ? (
          <section className={styles.empty}>
            <h2>Loading assignments</h2>
            <p>Resolving your governed setup scope.</p>
          </section>
        ) : data.denied ? (
          <section className={styles.error}>
            <h2>Setup access unavailable</h2>
            <p>{data.message ?? 'You do not have an active organization setup assignment.'}</p>
          </section>
        ) : (data.contexts?.length ?? 0) === 0 ? (
          <section className={styles.empty}>
            <h2>No active setup assignments</h2>
            <p>
              You are not currently assigned to a provisioning organization.
              Activated organizations are accessed through their normal workspace.
            </p>
          </section>
        ) : (
          <section className={styles.contextGrid} aria-label="Organization setup assignments">
            {data.contexts!.map((context) => (
              <Link
                key={context.setupPlanId}
                href={'/enterprise-setup/' + context.setupPlanId}
                className={styles.contextCard}
              >
                <div className={styles.cardTop}>
                  <h2 className={styles.cardTitle}>{context.organizationName}</h2>
                  <span className={styles.roleBadge}>{context.role}</span>
                </div>
                <div className={styles.cardMeta}>
                  <span>{context.organizationKind}</span>
                  <span>•</span>
                  <span>{stateLabel(context.setupState)}</span>
                </div>
                <div className={styles.progressTrack} aria-label="Setup completion">
                  <div
                    className={styles.progressFill}
                    style={{ width: context.completionPercent + '%' }}
                  />
                </div>
                <div className={styles.progressMeta}>
                  <span>{context.completionPercent.toFixed(0)}% complete</span>
                  <span>
                    {context.blockingOpenRequirements === 0
                      ? 'No blocking gaps'
                      : context.blockingOpenRequirements + ' blocking open'}
                  </span>
                </div>
              </Link>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
