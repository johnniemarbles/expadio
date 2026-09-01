'use client';

import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { ThemeModeControl } from '@expadio/ui';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import styles from '../setup.module.css';

type SetupRole = 'OWNER' | 'CONTRIBUTOR' | 'REVIEWER';
type SetupAction = 'START' | 'SATISFY' | 'WAIVE' | 'BLOCK' | 'REOPEN';
type RequirementStatus = 'PENDING' | 'IN_PROGRESS' | 'SATISFIED' | 'WAIVED' | 'BLOCKED';
type SatisfactionMode = 'MANUAL' | 'EVIDENCE' | 'AUTOMATED' | 'APPROVAL';

interface SetupContext {
  subjectId: string;
  tenantId: string;
  enterpriseId: string;
  organizationId: string;
  setupPlanId: string;
  role: SetupRole;
  organizationName: string;
  organizationKind: string;
  parentOrganizationId: string | null;
  setupState: 'PROVISIONING' | 'CONFIGURING' | 'READY_FOR_ACTIVATION';
  completionPercent: number;
  blockingOpenRequirements: number;
}

interface SetupPlan {
  setupPlanId: string;
  tenantId: string;
  enterpriseId: string;
  organizationId: string;
  state: 'PROVISIONING' | 'CONFIGURING' | 'READY_FOR_ACTIVATION' | 'ACTIVATED' | 'CANCELLED';
  totalRequirements: number;
  completedRequirements: number;
  blockingOpenRequirements: number;
  completionPercent: number;
  startedAt: string;
  readyAt: string | null;
  updatedAt: string;
}

interface Requirement {
  setupRequirementId: string;
  requirementKey: string;
  category: string;
  sourceKind: string;
  sourceKey: string | null;
  title: string;
  description: string;
  blocking: boolean;
  satisfactionMode: SatisfactionMode;
  status: RequirementStatus;
  ownerSubjectId: string | null;
  dueAt: string | null;
  waiverReason: string | null;
  evidenceRefs: string[];
  sortOrder: number;
}

interface Dependency {
  requirementId: string;
  dependsOnRequirementId: string;
}

interface LegalEntityOption {
  legalEntityId: string;
  legalName: string;
  entityType: string;
  jurisdictionCountryCode: string;
}

interface OperatingEntityBinding {
  bindingId: string;
  legalEntityId: string;
  legalName: string;
  jurisdictionCountryCode: string;
}

interface PlanResponse {
  context?: SetupContext;
  plan?: SetupPlan;
  requirements?: Requirement[];
  dependencies?: Dependency[];
  verifiedLegalEntities?: LegalEntityOption[];
  operatingEntities?: OperatingEntityBinding[];
  denied?: true;
  reasonKey?: string;
  message?: string;
}

interface ActionTarget {
  requirement: Requirement;
  action: SetupAction;
}

const categories = [
  'ORGANIZATION',
  'LEGAL',
  'GOVERNANCE',
  'ACCESS',
  'FINANCE',
  'COMPLIANCE',
  'OPERATIONS',
  'DATA',
  'COMMUNICATION',
  'CUSTOM',
] as const;

function statusClass(status: RequirementStatus): string {
  if (status === 'SATISFIED' || status === 'WAIVED') return styles.statusSatisfied;
  if (status === 'BLOCKED') return styles.statusBlocked;
  if (status === 'IN_PROGRESS') return styles.statusProgress;
  return '';
}

function stateLabel(state: SetupPlan['state']): string {
  if (state === 'READY_FOR_ACTIVATION') return 'Ready for parent activation';
  if (state === 'CONFIGURING') return 'Configuration in progress';
  if (state === 'ACTIVATED') return 'Activated';
  if (state === 'CANCELLED') return 'Cancelled';
  return 'Provisioning';
}

function actionsFor(requirement: Requirement, role: SetupRole): SetupAction[] {
  if (requirement.satisfactionMode === 'AUTOMATED') return [];
  const candidates: SetupAction[] = [];
  if (requirement.status === 'PENDING') candidates.push('START', 'SATISFY', 'WAIVE', 'BLOCK');
  if (requirement.status === 'IN_PROGRESS') candidates.push('SATISFY', 'WAIVE', 'BLOCK');
  if (requirement.status === 'BLOCKED') candidates.push('SATISFY', 'WAIVE', 'REOPEN');
  if (requirement.status === 'SATISFIED' || requirement.status === 'WAIVED') {
    candidates.push('REOPEN');
  }

  if (role === 'OWNER') return candidates;
  if (role === 'CONTRIBUTOR') {
    return candidates.filter((action) => action === 'START' || action === 'SATISFY');
  }
  return candidates.filter(
    (action) => action === 'SATISFY' || action === 'WAIVE' || action === 'BLOCK' || action === 'REOPEN',
  );
}

function actionLabel(action: SetupAction): string {
  const labels: Record<SetupAction, string> = {
    START: 'Start',
    SATISFY: 'Mark satisfied',
    WAIVE: 'Waive',
    BLOCK: 'Block',
    REOPEN: 'Reopen',
  };
  return labels[action];
}

export function OrganizationSetupWorkspace({ planId }: { planId: string }) {
  const [data, setData] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutationError, setMutationError] = useState('');
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionEvidence, setActionEvidence] = useState('');
  const [savingAction, setSavingAction] = useState(false);
  const [showRequirementForm, setShowRequirementForm] = useState(false);
  const [newRequirement, setNewRequirement] = useState({
    requirementKey: '',
    title: '',
    description: '',
    category: 'CUSTOM',
    sourceKind: 'CUSTOM',
    satisfactionMode: 'MANUAL',
    blocking: true,
  });
  const [savingRequirement, setSavingRequirement] = useState(false);
  const [selectedLegalEntityId, setSelectedLegalEntityId] = useState('');
  const [assigningOperatingEntity, setAssigningOperatingEntity] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/enterprise/setup/plans/' + planId, {
        cache: 'no-store',
      });
      const body = (await response.json()) as PlanResponse;
      setData(body);
    } catch {
      setData({
        denied: true,
        reasonKey: 'ENTERPRISE_SETUP_LOAD_FAILED',
        message: 'This setup plan could not be loaded.',
      });
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dependenciesByRequirement = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const dependency of data?.dependencies ?? []) {
      map.set(
        dependency.requirementId,
        [...(map.get(dependency.requirementId) ?? []), dependency.dependsOnRequirementId],
      );
    }
    return map;
  }, [data?.dependencies]);

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!actionTarget) return;
    const reasonRequired = ['WAIVE', 'BLOCK', 'REOPEN'].includes(actionTarget.action);
    if (reasonRequired && !actionReason.trim()) {
      setMutationError('A reason is required for this governed status change.');
      return;
    }
    if (
      actionTarget.action === 'SATISFY'
      && actionTarget.requirement.satisfactionMode === 'EVIDENCE'
      && !actionEvidence.split(',').some((value) => value.trim() !== '')
    ) {
      setMutationError('At least one evidence reference is required.');
      return;
    }

    setSavingAction(true);
    setMutationError('');
    try {
      const response = await fetch(
        '/api/enterprise/setup/plans/' +
          planId +
          '/requirements/' +
          actionTarget.requirement.setupRequirementId,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
            'x-correlation-id': crypto.randomUUID(),
          },
          body: JSON.stringify({
            action: actionTarget.action,
            reason: actionReason.trim() || null,
            evidenceRefs: actionEvidence
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        setMutationError(body.message ?? 'The readiness action was rejected.');
        return;
      }
      setActionTarget(null);
      setActionReason('');
      setActionEvidence('');
      await load();
    } catch {
      setMutationError('The readiness action could not be completed.');
    } finally {
      setSavingAction(false);
    }
  }

  async function submitRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingRequirement(true);
    setMutationError('');
    try {
      const response = await fetch('/api/enterprise/setup/plans/' + planId + '/requirements', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
          'x-correlation-id': crypto.randomUUID(),
        },
        body: JSON.stringify(newRequirement),
      });
      const body = await response.json();
      if (!response.ok) {
        setMutationError(body.message ?? body.error ?? 'The requirement could not be added.');
        return;
      }
      setNewRequirement({
        requirementKey: '',
        title: '',
        description: '',
        category: 'CUSTOM',
        sourceKind: 'CUSTOM',
        satisfactionMode: 'MANUAL',
        blocking: true,
      });
      setShowRequirementForm(false);
      await load();
    } catch {
      setMutationError('The requirement could not be added.');
    } finally {
      setSavingRequirement(false);
    }
  }

  async function assignOperatingEntity() {
    if (!selectedLegalEntityId) {
      setMutationError('Select a verified legal entity first.');
      return;
    }
    setAssigningOperatingEntity(true);
    setMutationError('');
    try {
      const response = await fetch(
        '/api/enterprise/setup/plans/' + planId + '/operating-entity',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
            'x-correlation-id': crypto.randomUUID(),
          },
          body: JSON.stringify({ legalEntityId: selectedLegalEntityId }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        setMutationError(body.message ?? body.error ?? 'The operating entity could not be assigned.');
        return;
      }
      setSelectedLegalEntityId('');
      await load();
    } catch {
      setMutationError('The operating entity could not be assigned.');
    } finally {
      setAssigningOperatingEntity(false);
    }
  }

  const context = data?.context;
  const plan = data?.plan;
  const requirements = data?.requirements ?? [];
  const verifiedLegalEntities = data?.verifiedLegalEntities ?? [];
  const operatingEntities = data?.operatingEntities ?? [];

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
        <Link className={styles.backLink} href="/enterprise-setup">
          ← All setup assignments
        </Link>

        {loading ? (
          <section className={styles.empty}>
            <h2>Loading setup plan</h2>
            <p>Resolving requirements and current readiness state.</p>
          </section>
        ) : data?.denied || !context || !plan ? (
          <section className={styles.error}>
            <h2>Setup plan unavailable</h2>
            <p>{data?.message ?? 'You do not have access to this setup plan.'}</p>
          </section>
        ) : (
          <>
            <section className={styles.hero}>
              <div>
                <p className={styles.eyebrow}>{context.organizationKind} organization</p>
                <h1>{context.organizationName}</h1>
                <p>
                  Complete blocking readiness requirements and attach evidence.
                  Final activation remains controlled by an authorized active ancestor.
                </p>
              </div>
              <span
                className={[
                  styles.statusBadge,
                  plan.state === 'READY_FOR_ACTIVATION' ? styles.statusReady : '',
                ].join(' ')}
              >
                {stateLabel(plan.state)}
              </span>
            </section>

            <div className={styles.detailGrid}>
              <section className={styles.panel} aria-labelledby="requirements-title">
                <div className={styles.panelHeading}>
                  <div>
                    <p className={styles.eyebrow}>Readiness</p>
                    <h2 id="requirements-title">Setup requirements</h2>
                  </div>
                  {context.role === 'OWNER' && (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => setShowRequirementForm((value) => !value)}
                    >
                      {showRequirementForm ? 'Close form' : 'Add requirement'}
                    </button>
                  )}
                </div>
                <div className={styles.panelBody}>
                  {mutationError && <p className={styles.inlineError}>{mutationError}</p>}

                  {showRequirementForm && context.role === 'OWNER' && (
                    <form className={styles.form} onSubmit={submitRequirement}>
                      <div className={styles.field}>
                        <label htmlFor="requirement-title">Requirement title</label>
                        <input
                          id="requirement-title"
                          required
                          value={newRequirement.title}
                          onChange={(event) =>
                            setNewRequirement((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor="requirement-key">Stable requirement key</label>
                        <input
                          id="requirement-key"
                          required
                          placeholder="tenant.country-readiness"
                          value={newRequirement.requirementKey}
                          onChange={(event) =>
                            setNewRequirement((current) => ({
                              ...current,
                              requirementKey: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor="requirement-description">Description</label>
                        <textarea
                          id="requirement-description"
                          value={newRequirement.description}
                          onChange={(event) =>
                            setNewRequirement((current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className={styles.field}>
                        <label htmlFor="requirement-category">Category</label>
                        <select
                          id="requirement-category"
                          value={newRequirement.category}
                          onChange={(event) =>
                            setNewRequirement((current) => ({
                              ...current,
                              category: event.target.value,
                            }))
                          }
                        >
                          {categories.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className={styles.field}>
                        <label htmlFor="requirement-source">Policy source</label>
                        <select
                          id="requirement-source"
                          value={newRequirement.sourceKind}
                          disabled
                        >
                          <option value="CUSTOM">Custom</option>
                        </select>
                      </div>
                      <div className={styles.field}>
                        <label htmlFor="requirement-mode">Completion mode</label>
                        <select
                          id="requirement-mode"
                          value={newRequirement.satisfactionMode}
                          onChange={(event) =>
                            setNewRequirement((current) => ({
                              ...current,
                              satisfactionMode: event.target.value as 'MANUAL' | 'EVIDENCE',
                            }))
                          }
                        >
                          <option value="MANUAL">Manual attestation</option>
                          <option value="EVIDENCE">Evidence required</option>
                        </select>
                      </div>
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={newRequirement.blocking}
                          onChange={(event) =>
                            setNewRequirement((current) => ({
                              ...current,
                              blocking: event.target.checked,
                            }))
                          }
                        />
                        Blocking requirement
                      </label>
                      <div className={styles.actionRow}>
                        <button className={styles.button} disabled={savingRequirement}>
                          {savingRequirement ? 'Adding…' : 'Add governed requirement'}
                        </button>
                      </div>
                    </form>
                  )}

                  <div className={[styles.requirementList, showRequirementForm ? styles.sectionGap : ''].join(' ')}>
                    {requirements.map((requirement) => {
                      const dependencyIds =
                        dependenciesByRequirement.get(requirement.setupRequirementId) ?? [];
                      const actions = actionsFor(requirement, context.role);
                      return (
                        <article className={styles.requirementCard} key={requirement.setupRequirementId}>
                          <div className={styles.requirementTop}>
                            <div>
                              <h3>{requirement.title}</h3>
                              {requirement.description && <p>{requirement.description}</p>}
                            </div>
                            <span
                              className={[
                                styles.statusBadge,
                                statusClass(requirement.status),
                              ].join(' ')}
                            >
                              {requirement.status.replaceAll('_', ' ')}
                            </span>
                          </div>
                          <div className={styles.requirementMeta}>
                            <span>{requirement.category}</span>
                            <span>•</span>
                            <span>{requirement.sourceKind}</span>
                            <span>•</span>
                            <span>{requirement.satisfactionMode}</span>
                            <span>•</span>
                            <span>{requirement.blocking ? 'Blocking' : 'Non-blocking'}</span>
                            {dependencyIds.length > 0 && (
                              <>
                                <span>•</span>
                                <span>
                                  Depends on {dependencyIds.length} requirement
                                  {dependencyIds.length === 1 ? '' : 's'}
                                </span>
                              </>
                            )}
                            {requirement.evidenceRefs.length > 0 && (
                              <>
                                <span>•</span>
                                <span>{requirement.evidenceRefs.length} evidence ref(s)</span>
                              </>
                            )}
                          </div>
                          {requirement.satisfactionMode === 'AUTOMATED' && (
                            <p className={styles.inlineMessage}>
                              This gate is derived from authoritative enterprise state and cannot be manually completed.
                            </p>
                          )}
                          {actions.length > 0 && (
                            <div className={styles.actionRow}>
                              {actions.map((action) => (
                                <button
                                  key={action}
                                  type="button"
                                  className={
                                    action === 'BLOCK'
                                      ? styles.dangerButton
                                      : action === 'SATISFY'
                                        ? styles.button
                                        : styles.secondaryButton
                                  }
                                  onClick={() => {
                                    setActionTarget({ requirement, action });
                                    setActionReason('');
                                    setActionEvidence(requirement.evidenceRefs.join(', '));
                                    setMutationError('');
                                  }}
                                >
                                  {actionLabel(action)}
                                </button>
                              ))}
                            </div>
                          )}

                          {actionTarget?.requirement.setupRequirementId === requirement.setupRequirementId && (
                            <form className={[styles.form, styles.actionPanel].join(' ')} onSubmit={submitAction}>
                              <p className={styles.inlineMessage}>
                                {actionLabel(actionTarget.action)}: {requirement.title}
                              </p>
                              {['WAIVE', 'BLOCK', 'REOPEN'].includes(actionTarget.action) && (
                                <div className={styles.field}>
                                  <label htmlFor={'reason-' + requirement.setupRequirementId}>
                                    Governance reason
                                  </label>
                                  <textarea
                                    id={'reason-' + requirement.setupRequirementId}
                                    required
                                    value={actionReason}
                                    onChange={(event) => setActionReason(event.target.value)}
                                  />
                                </div>
                              )}
                              <div className={styles.field}>
                                <label htmlFor={'evidence-' + requirement.setupRequirementId}>
                                  Evidence references (comma separated)
                                </label>
                                <input
                                  id={'evidence-' + requirement.setupRequirementId}
                                  value={actionEvidence}
                                  onChange={(event) => setActionEvidence(event.target.value)}
                                  placeholder="document:123, approval:456"
                                />
                              </div>
                              <div className={styles.actionRow}>
                                <button className={styles.button} disabled={savingAction}>
                                  {savingAction ? 'Saving…' : 'Confirm action'}
                                </button>
                                <button
                                  type="button"
                                  className={styles.secondaryButton}
                                  onClick={() => setActionTarget(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          )}
                        </article>
                      );
                    })}

                    {requirements.length === 0 && (
                      <div className={styles.empty}>
                        <h2>No requirements registered</h2>
                        <p>
                          An empty setup plan cannot become activation-ready. A setup owner must
                          register at least one blocking requirement.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <aside>
                <section className={styles.panel} aria-labelledby="operating-entity-title">
                  <div className={styles.panelHeading}>
                    <h2 id="operating-entity-title">Operating legal entity</h2>
                  </div>
                  <div className={styles.panelBody}>
                    {operatingEntities.length > 0 ? (
                      <div className={styles.summaryStack}>
                        {operatingEntities.map((binding) => (
                          <div className={styles.summaryRow} key={binding.bindingId}>
                            <span>{binding.jurisdictionCountryCode}</span>
                            <strong>{binding.legalName}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className={styles.inlineMessage}>
                        No verified legal entity is currently bound as OPERATED_BY.
                      </p>
                    )}

                    {context.role === 'OWNER' && (
                      <div className={[styles.form, styles.sectionGap].join(' ')}>
                        <div className={styles.field}>
                          <label htmlFor="operating-entity-select">
                            Assign verified enterprise entity
                          </label>
                          <select
                            id="operating-entity-select"
                            value={selectedLegalEntityId}
                            onChange={(event) => setSelectedLegalEntityId(event.target.value)}
                          >
                            <option value="">Select verified entity</option>
                            {verifiedLegalEntities.map((entity) => (
                              <option key={entity.legalEntityId} value={entity.legalEntityId}>
                                {entity.legalName} · {entity.jurisdictionCountryCode}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          type="button"
                          className={styles.button}
                          disabled={!selectedLegalEntityId || assigningOperatingEntity}
                          onClick={() => void assignOperatingEntity()}
                        >
                          {assigningOperatingEntity ? 'Assigning…' : 'Assign operating entity'}
                        </button>
                        {verifiedLegalEntities.length === 0 && (
                          <p className={styles.inlineMessage}>
                            No verified legal entities are available in this enterprise. Create and verify one through Enterprise Legal Entities before activation.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </section>

                <section className={[styles.panel, styles.sectionGap].join(' ')} aria-labelledby="summary-title">
                  <div className={styles.panelHeading}>
                    <h2 id="summary-title">Readiness summary</h2>
                  </div>
                  <div className={styles.panelBody}>
                    <div className={styles.progressTrack}>
                      <div
                        className={styles.progressFill}
                        style={{ width: plan.completionPercent + '%' }}
                      />
                    </div>
                    <div className={styles.progressMeta}>
                      <span>{plan.completionPercent.toFixed(0)}% complete</span>
                      <span>{plan.blockingOpenRequirements} blocking open</span>
                    </div>

                    <div className={[styles.summaryStack, styles.sectionGap].join(' ')}>
                      <div className={styles.summaryRow}>
                        <span>Your setup role</span>
                        <strong>{context.role}</strong>
                      </div>
                      <div className={styles.summaryRow}>
                        <span>Completed</span>
                        <strong>
                          {plan.completedRequirements} / {plan.totalRequirements}
                        </strong>
                      </div>
                      <div className={styles.summaryRow}>
                        <span>Organization state</span>
                        <strong>{stateLabel(plan.state)}</strong>
                      </div>
                      <div className={styles.summaryRow}>
                        <span>Last recalculated</span>
                        <strong>{new Date(plan.updatedAt).toLocaleString()}</strong>
                      </div>
                    </div>

                    <div className={styles.notice}>
                      {plan.state === 'READY_FOR_ACTIVATION'
                        ? 'All blocking gates are satisfied. An authorized active ancestor must perform final activation.'
                        : 'Normal business-runtime access remains locked until all blocking gates are satisfied and a parent authority activates the organization.'}
                    </div>
                  </div>
                </section>

                <section className={[styles.panel, styles.sectionGap].join(' ')} aria-labelledby="scope-title">
                  <div className={styles.panelHeading}>
                    <h2 id="scope-title">Setup scope</h2>
                  </div>
                  <div className={styles.panelBody}>
                    <div className={styles.summaryStack}>
                      <div className={styles.summaryRow}>
                        <span>Organization</span>
                        <strong>{context.organizationName}</strong>
                      </div>
                      <div className={styles.summaryRow}>
                        <span>Kind</span>
                        <strong>{context.organizationKind}</strong>
                      </div>
                      <div className={styles.summaryRow}>
                        <span>Plan ID</span>
                        <strong className={styles.code}>{plan.setupPlanId}</strong>
                      </div>
                    </div>
                  </div>
                </section>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
