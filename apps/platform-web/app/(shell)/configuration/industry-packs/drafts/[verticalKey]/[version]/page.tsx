import Link from 'next/link';
import { DeniedState, StatePill } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { fetchApi } from '../../../../../../../lib/live-adapter';
import styles from '../../../page.module.css';
import { DraftWorkflowEditor } from './DraftWorkflowEditor';
import { DraftSubmitReviewAction } from './DraftSubmitReviewAction';

interface DraftDefinition {
  readonly verticalKey: string;
  readonly label: string;
  readonly profile: {
    readonly industryKey: string;
    readonly label: string;
    readonly components: readonly {
      readonly kind: string;
      readonly key: string;
      readonly version: number;
    }[];
  };
  readonly terminology: {
    readonly defaultLocale: string;
    readonly concepts: readonly {
      readonly conceptKey: string;
      readonly labels: readonly {
        readonly locale: string;
        readonly singular: string;
        readonly plural: string;
      }[];
    }[];
  };
  readonly caseWorkflow?: {
    readonly workType: string;
    readonly stages: Readonly<Record<string, string>>;
    readonly decisionOutcomeLabels?: Readonly<Record<string, string>>;
    readonly stageGuidance?: Readonly<Record<string, string>>;
  };
  readonly caseSchema?: {
    readonly version: number;
    readonly fields: readonly {
      readonly key: string;
      readonly label: string;
      readonly type: string;
      readonly required?: boolean;
      readonly options?: readonly string[];
    }[];
  };
  readonly caseOntologyRoles?: Readonly<Record<string, string>>;
  readonly caseStageSemantics?: {
    readonly requirements: readonly {
      readonly stageKey: string;
      readonly phase: 'ENTRY' | 'EXIT';
      readonly requiredAttributeKeys?: readonly string[];
      readonly requiredRelationships?: readonly string[];
      readonly requiredDecisionOutcomes?: readonly string[];
      readonly message: string;
    }[];
  };
}

interface DraftResponse {
  readonly draft: {
    readonly identity: { readonly verticalKey: string; readonly version: number };
    readonly state: 'DRAFT';
    readonly revision: number;
    readonly source: string;
    readonly definition: DraftDefinition;
    readonly createdBySubjectId: string;
    readonly createdAt: string;
    readonly updatedBySubjectId: string;
    readonly updatedAt: string;
  };
}

export default async function IndustryPackDraftPage({
  params,
}: {
  params: Promise<{ verticalKey: string; version: string }>;
}) {
  const resolved = await params;
  const verticalKey = decodeURIComponent(resolved.verticalKey).trim().toLowerCase();
  const version = Number(resolved.version);

  const result = await fetchApi<DraftResponse>(
    `/api/configuration/industry-packs/drafts/${encodeURIComponent(verticalKey)}/${version}`,
  );
  if (isDenied(result)) return <DeniedState result={result} />;

  const { draft } = result;
  const definition = draft.definition;
  const workflowEntries = Object.entries(definition.caseWorkflow?.stages ?? {});
  const schemaFields = definition.caseSchema?.fields ?? [];
  const ontologyEntries = Object.entries(definition.caseOntologyRoles ?? {});
  const semanticRequirements = definition.caseStageSemantics?.requirements ?? [];

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Industry Pack Draft</p>
          <h1 id="page-title">{definition.label}</h1>
          <p>
            {draft.identity.verticalKey} · v{draft.identity.version} · revision {draft.revision}
          </p>
        </div>
        <Link href={`/configuration/industry-packs?vertical=${encodeURIComponent(verticalKey)}`}>
          Back to versions
        </Link>
      </section>

      <DraftWorkflowEditor
        initial={{
          label: definition.label,
          defaultLocale: definition.terminology.defaultLocale,
          workType: definition.caseWorkflow?.workType ?? 'Case',
          stages: workflowEntries.map(([key, label]) => ({
            key,
            label,
            guidance: definition.caseWorkflow?.stageGuidance?.[key] ?? '',
          })),
        }}
        definition={definition}
        verticalKey={draft.identity.verticalKey}
        version={draft.identity.version}
        initialRevision={draft.revision}
      />

      <DraftSubmitReviewAction
        verticalKey={draft.identity.verticalKey}
        version={draft.identity.version}
      />

      <section className={styles.summaryGrid} aria-label="Draft summary">
        <article className={styles.summaryCard}>
          <span>State</span>
          <strong><StatePill state="Draft" /></strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Source</span>
          <strong>{draft.source}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Default locale</span>
          <strong>{definition.terminology.defaultLocale}</strong>
        </article>
        <article className={styles.summaryCard}>
          <span>Schema</span>
          <strong>v{definition.caseSchema?.version ?? 0}</strong>
        </article>
      </section>

      <section className={styles.panel} aria-labelledby="workflow-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="workflow-title">Workflow vocabulary</h2>
            <p>{definition.caseWorkflow?.workType ?? 'Neutral case'}</p>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Stage key</th><th>Label</th><th>Guidance</th></tr></thead>
            <tbody>
              {workflowEntries.map(([key, label]) => (
                <tr key={key}>
                  <td><span className={styles.code}>{key}</span></td>
                  <td><strong>{label}</strong></td>
                  <td>{definition.caseWorkflow?.stageGuidance?.[key] ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="semantics-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="semantics-title">Executable stage semantics</h2>
            <p>Governed Pack rules evaluated against canonical case facts before workflow transitions.</p>
          </div>
        </div>
        {semanticRequirements.length === 0 ? (
          <p>No executable case-stage semantics are declared by this Pack revision.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Stage</th><th>Phase</th><th>Attributes</th><th>Relationships</th><th>Outcomes</th><th>Blocking message</th>
                </tr>
              </thead>
              <tbody>
                {semanticRequirements.map((requirement, index) => (
                  <tr key={`${requirement.stageKey}:${requirement.phase}:${index}`}>
                    <td><span className={styles.code}>{requirement.stageKey}</span></td>
                    <td>{requirement.phase}</td>
                    <td>{requirement.requiredAttributeKeys?.join(', ') || '—'}</td>
                    <td>{requirement.requiredRelationships?.join(', ') || '—'}</td>
                    <td>{requirement.requiredDecisionOutcomes?.join(', ') || '—'}</td>
                    <td>{requirement.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="schema-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="schema-title">Case schema</h2>
            <p>Domain fields declared by this Pack revision.</p>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Key</th><th>Label</th><th>Type</th><th>Required</th><th>Options</th></tr></thead>
            <tbody>
              {schemaFields.map((field) => (
                <tr key={field.key}>
                  <td><span className={styles.code}>{field.key}</span></td>
                  <td><strong>{field.label}</strong></td>
                  <td>{field.type}</td>
                  <td>{field.required === true ? 'Yes' : 'No'}</td>
                  <td>{field.options?.join(', ') ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="ontology-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="ontology-title">Relationship vocabulary</h2>
            <p>Pack labels over canonical CRM relationships.</p>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Canonical concept</th><th>Role</th></tr></thead>
            <tbody>
              {ontologyEntries.map(([concept, role]) => (
                <tr key={concept}>
                  <td><span className={styles.code}>{concept}</span></td>
                  <td><strong>{role}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel} aria-labelledby="terminology-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="terminology-title">Entity terminology</h2>
          </div>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Concept</th><th>Locale</th><th>Singular</th><th>Plural</th></tr></thead>
            <tbody>
              {definition.terminology.concepts.flatMap((concept) =>
                concept.labels.map((label) => (
                  <tr key={`${concept.conceptKey}:${label.locale}`}>
                    <td><span className={styles.code}>{concept.conceptKey}</span></td>
                    <td>{label.locale}</td>
                    <td><strong>{label.singular}</strong></td>
                    <td>{label.plural}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
