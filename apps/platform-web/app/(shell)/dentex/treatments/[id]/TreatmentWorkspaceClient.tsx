'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  DentexTreatmentReadiness,
  DentexTreatmentRequirement,
  DentexTreatmentWorkspace,
} from '@expadio/dentex';
import styles from './treatment-workspace.module.css';

type TabKey =
  | 'overview'
  | 'clinical'
  | 'care-plan'
  | 'workflow'
  | 'documents'
  | 'communications'
  | 'activity'
  | 'audit';

const TABS: readonly { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'clinical', label: 'Clinical' },
  { key: 'care-plan', label: 'Care Plan' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'documents', label: 'Documents' },
  { key: 'communications', label: 'Communications' },
  { key: 'activity', label: 'Activity' },
  { key: 'audit', label: 'Audit' },
];

async function responseBody(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export default function TreatmentWorkspaceClient({
  treatmentId,
}: {
  treatmentId: string;
}) {
  const [workspace, setWorkspace] = useState<DentexTreatmentWorkspace | null>(null);
  const [readiness, setReadiness] = useState<DentexTreatmentReadiness | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const treatmentUrl = `/api/dentex/treatments/${encodeURIComponent(treatmentId)}`;
  const workflowUrl = `/api/crm/cases/${encodeURIComponent(treatmentId)}/workflow`;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [workspaceResponse, readinessResponse] = await Promise.all([
        fetch(treatmentUrl, { cache: 'no-store' }),
        fetch(`${treatmentUrl}/readiness`, { cache: 'no-store' }),
      ]);
      const workspaceBody = await responseBody(workspaceResponse);
      const readinessBody = await responseBody(readinessResponse);

      if (!workspaceResponse.ok) {
        throw new Error(workspaceBody.error ?? 'Unable to load this Treatment.');
      }
      if (!readinessResponse.ok) {
        throw new Error(readinessBody.error ?? 'Unable to load Treatment readiness.');
      }

      setWorkspace(workspaceBody as DentexTreatmentWorkspace);
      setReadiness(readinessBody as DentexTreatmentReadiness);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load this Treatment.');
    } finally {
      setLoading(false);
    }
  }, [treatmentUrl]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function mutate(
    key: string,
    url: string,
    method: 'POST' | 'PATCH',
    body: Record<string, unknown>,
  ) {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await responseBody(response);
      if (!response.ok) {
        const blockerText = Array.isArray(data.blockers)
          ? data.blockers.map((item: any) => item.message).filter(Boolean).join(' ')
          : '';
        throw new Error(data.error ?? blockerText ?? 'The governed action was rejected.');
      }
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The governed action failed.');
    } finally {
      setBusy(null);
    }
  }

  const assignableRequirement = useMemo(
    () => readiness?.requirements.find(
      (requirement) => requirement.kind === 'PARTICIPANT' && !requirement.satisfied,
    ) ?? null,
    [readiness],
  );
  const decisionRequirement = useMemo(
    () => readiness?.requirements.find(
      (requirement) => requirement.kind === 'DECISION' && !requirement.satisfied,
    ) ?? null,
    [readiness],
  );

  if (loading && workspace === null) {
    return <div className={styles.stateCard}>Loading Treatment workspace…</div>;
  }

  if (workspace === null) {
    return (
      <div className={styles.stateCard}>
        <h1>Treatment unavailable</h1>
        <p>{error ?? 'This Treatment could not be loaded.'}</p>
        <button type="button" onClick={() => void reload()} className={styles.primaryButton}>Retry</button>
      </div>
    );
  }

  const treatment = workspace.treatment;
  const currentLabel = readiness?.currentStageLabel ?? treatment.stage ?? 'Not started';
  const nextLabel = readiness?.nextStageLabel ?? null;
  const requirements = readiness?.requirements ?? [];

  return (
    <main className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <a href="/crm" className={styles.backLink}>← Treatments</a>
          <div className={styles.eyebrow}>DENTEX Treatment</div>
          <h1>{treatment.subject}</h1>
          <div className={styles.headerMeta}>
            <span className={styles.stagePill}>{currentLabel}</span>
            <span>{treatment.priority} priority</span>
            <span>{treatment.status}</span>
            <span>Pack: {workspace.pack.runtimeSource}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          {!readiness?.workflowStarted ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void mutate('start', workflowUrl, 'POST', {})}
              className={styles.primaryButton}
            >
              {busy === 'start' ? 'Starting…' : 'Start workflow'}
            </button>
          ) : null}
          {assignableRequirement ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                const [, stageKey, participantKey] = assignableRequirement.key.split(':');
                if (!stageKey || !participantKey) return;
                void mutate(
                  'assign',
                  `${workflowUrl}/participants`,
                  'POST',
                  { stageKey, participantKey },
                );
              }}
              className={styles.secondaryButton}
            >
              {busy === 'assign' ? 'Assigning…' : 'Assign me'}
            </button>
          ) : null}
          {decisionRequirement ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void mutate(
                'approve',
                `${workflowUrl}/decision`,
                'POST',
                { outcome: 'APPROVE' },
              )}
              className={styles.secondaryButton}
            >
              {busy === 'approve' ? 'Recording…' : 'Record approval'}
            </button>
          ) : null}
          {readiness?.canAdvance && readiness.nextStage && readiness.revision !== null ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void mutate(
                'advance',
                workflowUrl,
                'PATCH',
                {
                  toStageKey: readiness.nextStage,
                  expectedRevision: readiness.revision,
                },
              )}
              className={styles.primaryButton}
            >
              {busy === 'advance' ? 'Advancing…' : `Advance to ${nextLabel}`}
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div role="alert" className={styles.errorBanner}>{error}</div> : null}

      <section className={styles.stageRail} aria-label="Treatment journey">
        {(readiness?.stages ?? []).map((stage) => {
          const current = stage.stageKey === readiness?.currentStage;
          const complete = readiness?.currentStage
            ? stage.sequence < (readiness.stages.find((item) => item.stageKey === readiness.currentStage)?.sequence ?? 0)
            : false;
          return (
            <div key={stage.stageKey} className={styles.stageStep}>
              <span className={`${styles.stageDot} ${current ? styles.stageDotCurrent : complete ? styles.stageDotComplete : ''}`}>
                {complete ? '✓' : stage.sequence}
              </span>
              <span className={current ? styles.stageNameCurrent : styles.stageName}>{stage.label}</span>
            </div>
          );
        })}
      </section>

      <nav className={styles.tabs} aria-label="Treatment workspace sections">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={tab === item.key ? styles.tabActive : styles.tab}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? (
        <div className={styles.twoColumn}>
          <div className={styles.stack}>
            <SectionCard title="Treatment summary">
              <DefinitionGrid rows={[
                ['Patient', workspace.patient?.fullName ?? 'Not linked'],
                ['Practice', workspace.practice?.name ?? 'Not linked'],
                ['Owner', workspace.owner?.subjectId ?? 'Unassigned'],
                ['Provider', workspace.provider?.subjectId ?? 'Unassigned'],
                ['Current stage', currentLabel],
                ['Care Plan', workspace.carePlan?.title ?? 'Not attached'],
              ]} />
            </SectionCard>
            <SectionCard title="Clinical snapshot">
              <DefinitionGrid rows={[
                ['Urgency', treatment.attributes.urgency],
                ['Tooth / quadrant', treatment.attributes.tooth ?? 'Not recorded'],
                ['Procedure', treatment.attributes.procedureCode ?? 'Not recorded'],
                ['Description', treatment.description ?? '—'],
              ]} />
            </SectionCard>
          </div>
          <RequirementsCard requirements={requirements} nextLabel={nextLabel} />
        </div>
      ) : null}

      {tab === 'clinical' ? (
        <SectionCard title="Clinical">
          <DefinitionGrid rows={[
            ['Patient', workspace.patient?.fullName ?? 'Not linked'],
            ['Urgency', treatment.attributes.urgency],
            ['Tooth / quadrant', treatment.attributes.tooth ?? 'Not recorded'],
            ['Performed procedure', treatment.attributes.procedureCode ?? 'Not recorded'],
            ['Treating provider', workspace.provider?.subjectId ?? 'Unassigned'],
          ]} />
          <TruthfulEmpty text="Clinical findings and notes are not yet attached to the Treatment projection. They remain a planned DENTEX domain slice rather than fabricated fields." />
        </SectionCard>
      ) : null}

      {tab === 'care-plan' ? (
        <SectionCard title="Care Plan">
          {workspace.carePlan ? (
            <DefinitionGrid rows={[
              ['Title', workspace.carePlan.title],
              ['Status', workspace.carePlan.status],
              ['Starts', workspace.carePlan.startsOn ?? '—'],
              ['Ends', workspace.carePlan.endsOn ?? '—'],
              ['Agreement ID', workspace.carePlan.agreementId],
            ]} />
          ) : (
            <TruthfulEmpty text="No active Care Plan is explicitly attached to this Treatment." />
          )}
        </SectionCard>
      ) : null}

      {tab === 'workflow' ? (
        <div className={styles.twoColumn}>
          <SectionCard title="Decision Fabric">
            <DefinitionGrid rows={[
              ['State', readiness?.state ?? 'Not started'],
              ['Current stage', currentLabel],
              ['Next stage', nextLabel ?? 'Terminal'],
              ['Revision', readiness?.revision?.toString() ?? '—'],
              ['Decision', readiness?.currentDecision?.outcome ?? 'None'],
            ]} />
          </SectionCard>
          <RequirementsCard requirements={requirements} nextLabel={nextLabel} />
        </div>
      ) : null}

      {tab === 'documents' ? (
        <SectionCard title="Documents">
          <TruthfulEmpty text="Treatment-specific document attachment is not wired yet. This tab is reserved for the platform Document capability once the Treatment document relationship is introduced." />
        </SectionCard>
      ) : null}

      {tab === 'communications' ? (
        <SectionCard title="Communications">
          <TruthfulEmpty text="No Treatment communication timeline is projected yet. Communications will be consumed through the governed event/action path rather than direct workflow calls." />
        </SectionCard>
      ) : null}

      {tab === 'activity' ? (
        <SectionCard title="Activity">
          <TruthfulEmpty text="Treatment activity projection is not wired in this slice. Workflow history remains available through the existing Decision Fabric trace." />
        </SectionCard>
      ) : null}

      {tab === 'audit' ? (
        <SectionCard title="Audit">
          <TruthfulEmpty text="The workspace does not fabricate an audit log. Relationship and workflow authorities already retain audit/history records; a unified Treatment audit projection is the next read-model extension." />
        </SectionCard>
      ) : null}
    </main>
  );
}

function RequirementsCard({
  requirements,
  nextLabel,
}: {
  requirements: readonly DentexTreatmentRequirement[];
  nextLabel: string | null;
}) {
  return (
    <SectionCard title={nextLabel ? `Requirements for ${nextLabel}` : 'Stage requirements'}>
      {requirements.length === 0 ? (
        <div className={styles.successState}>✓ No blocking requirements for the next transition.</div>
      ) : (
        <div className={styles.requirements}>
          {requirements.map((requirement) => (
            <div key={requirement.key} className={styles.requirement}>
              <span className={requirement.satisfied ? styles.checkGood : styles.checkBad}>
                {requirement.satisfied ? '✓' : '×'}
              </span>
              <div>
                <strong>{requirement.label}</strong>
                {!requirement.satisfied && requirement.actionHint ? (
                  <div className={styles.requirementHint}>{requirement.actionHint}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.card}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function DefinitionGrid({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className={styles.definitionGrid}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TruthfulEmpty({ text }: { text: string }) {
  return <div className={styles.emptyState}>{text}</div>;
}
