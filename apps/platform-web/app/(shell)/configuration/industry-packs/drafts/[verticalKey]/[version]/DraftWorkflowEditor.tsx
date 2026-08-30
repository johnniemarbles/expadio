'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CASE_RELATIONSHIP_CONCEPTS } from '@expadio/industry-packs';
import {
  applyDraftWorkflowEditorState,
  hasDraftWorkflowEditorErrors,
  validateDraftWorkflowEditorState,
  type DraftWorkflowDefinitionShape,
  type DraftWorkflowEditorState,
} from './draft-editor-model';
import {
  applyDraftTerminologyEditorState,
  draftTerminologyStateFromDefinition,
  hasDraftTerminologyEditorErrors,
  terminologyIssueForPath,
  validateDraftTerminologyEditorState,
  type DraftTerminologyConceptState,
  type DraftTerminologyDefinitionShape,
} from './terminology-editor-model';
import {
  applyDraftOntologyRolesEditorState,
  draftOntologyRolesStateFromDefinition,
  hasDraftOntologyRoleErrors,
  validateDraftOntologyRolesEditorState,
  type DraftOntologyRolesDefinitionShape,
} from './ontology-role-editor-model';
import {
  applyDraftCaseSchemaEditorState,
  caseSchemaFieldKeys,
  draftCaseSchemaStateFromDefinition,
  hasDraftCaseSchemaEditorErrors,
  validateDraftCaseSchemaEditorState,
  type DraftCaseSchemaDefinitionShape,
  type DraftCaseSchemaFieldState,
} from './case-schema-editor-model';
import {
  applyDraftCaseSemanticsEditorState,
  draftCaseSemanticsStateFromDefinition,
  hasDraftCaseSemanticsEditorErrors,
  validateDraftCaseSemanticsEditorState,
  type DraftCaseSemanticsDefinitionShape,
  type DraftCaseSemanticRuleState,
} from './case-semantics-editor-model';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line, #cbd5e1)',
  borderRadius: 8,
  fontSize: 13,
};

const errorStyle: React.CSSProperties = { color: '#b91c1c', fontSize: 12, marginTop: 4 };

type EditableDraftDefinition =
  Omit<DraftWorkflowDefinitionShape, 'terminology'>
  & DraftTerminologyDefinitionShape
  & DraftOntologyRolesDefinitionShape
  & DraftCaseSchemaDefinitionShape
  & DraftCaseSemanticsDefinitionShape;

interface DraftSaveResponse {
  readonly draft?: {
    readonly revision?: number;
  };
  readonly error?: string;
}

export function DraftWorkflowEditor({
  initial,
  definition,
  verticalKey,
  version,
  initialRevision,
}: {
  readonly initial: DraftWorkflowEditorState;
  readonly definition: EditableDraftDefinition;
  readonly verticalKey: string;
  readonly version: number;
  readonly initialRevision: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<DraftWorkflowEditorState>(initial);
  const [terminologyState, setTerminologyState] = useState(() => draftTerminologyStateFromDefinition(definition));
  const [ontologyRoleState, setOntologyRoleState] = useState(() => draftOntologyRolesStateFromDefinition(definition));
  const [schemaState, setSchemaState] = useState(() => draftCaseSchemaStateFromDefinition(definition));
  const [semanticState, setSemanticState] = useState(() => draftCaseSemanticsStateFromDefinition(definition));
  const [revision, setRevision] = useState(initialRevision);
  const [validated, setValidated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const errors = useMemo(() => validateDraftWorkflowEditorState(state), [state]);
  const terminologyErrors = useMemo(
    () => validateDraftTerminologyEditorState(terminologyState, state.defaultLocale),
    [terminologyState, state.defaultLocale],
  );
  const ontologyRoleErrors = useMemo(
    () => validateDraftOntologyRolesEditorState(ontologyRoleState),
    [ontologyRoleState],
  );
  const schemaErrors = useMemo(() => validateDraftCaseSchemaEditorState(schemaState), [schemaState]);
  const availableAttributeKeys = useMemo(() => caseSchemaFieldKeys(schemaState), [schemaState]);
  const semanticErrors = useMemo(
    () => validateDraftCaseSemanticsEditorState(semanticState, availableAttributeKeys),
    [semanticState, availableAttributeKeys],
  );
  const invalid = hasDraftWorkflowEditorErrors(errors)
    || hasDraftTerminologyEditorErrors(terminologyErrors)
    || hasDraftOntologyRoleErrors(ontologyRoleErrors)
    || hasDraftCaseSchemaEditorErrors(schemaErrors)
    || hasDraftCaseSemanticsEditorErrors(semanticErrors);

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={() => {
            setSaveMessage(null);
            setSaveError(null);
            setEditing(true);
          }}
        >
          Edit draft
        </button>
        {saveMessage ? <span style={{ color: '#166534', fontSize: 13 }}>{saveMessage}</span> : null}
      </div>
    );
  }

  const updateStage = (index: number, patch: Partial<{ label: string; guidance: string }>) => {
    setValidated(false);
    setSaveError(null);
    setState((current) => ({
      ...current,
      stages: current.stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)),
    }));
  };

  const updateSemanticRule = (index: number, patch: Partial<DraftCaseSemanticRuleState>) => {
    setValidated(false);
    setSaveError(null);
    setSemanticState((current) => ({
      rules: current.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    }));
  };

  const toggleSemanticValue = (
    index: number,
    field: 'requiredAttributeKeys' | 'requiredRelationships',
    value: string,
  ) => {
    const rule = semanticState.rules[index];
    if (rule === undefined) return;
    const current = rule[field];
    updateSemanticRule(index, {
      [field]: current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    });
  };

  const saveDraft = async () => {
    setValidated(true);
    setSaveError(null);
    setSaveMessage(null);
    if (invalid) return;

    setSaving(true);
    try {
      const response = await fetch(
        `/api/configuration/industry-packs/drafts/${encodeURIComponent(verticalKey)}/${version}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            expectedRevision: revision,
            definition: applyDraftCaseSemanticsEditorState(
              applyDraftCaseSchemaEditorState(
                applyDraftOntologyRolesEditorState(
                  applyDraftTerminologyEditorState(
                    applyDraftWorkflowEditorState(definition, state),
                    terminologyState,
                  ),
                  ontologyRoleState,
                ),
                schemaState,
              ),
              semanticState,
            ),
          }),
        },
      );
      const payload = await response.json().catch(() => null) as DraftSaveResponse | null;

      if (!response.ok) {
        setSaveError(
          response.status === 409
            ? 'This draft changed since you opened it. Refresh before saving again.'
            : payload?.error ?? 'Draft could not be saved.',
        );
        return;
      }

      const nextRevision = payload?.draft?.revision;
      if (!Number.isInteger(nextRevision) || Number(nextRevision) <= revision) {
        setSaveError('Draft save returned an invalid revision. Refresh before continuing.');
        return;
      }

      setRevision(Number(nextRevision));
      setValidated(false);
      setEditing(false);
      setSaveMessage(`Draft saved at revision ${nextRevision}.`);
      router.refresh();
    } catch {
      setSaveError('Draft could not be saved. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="draft-editor-title" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <h2 id="draft-editor-title" style={{ margin: 0 }}>Edit draft</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
            Saving uses optimistic revision checks so stale edits cannot overwrite a newer draft.
          </p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setState(initial);
            setTerminologyState(draftTerminologyStateFromDefinition(definition));
            setOntologyRoleState(draftOntologyRolesStateFromDefinition(definition));
            setSchemaState(draftCaseSchemaStateFromDefinition(definition));
            setSemanticState(draftCaseSemanticsStateFromDefinition(definition));
            setEditing(false);
            setValidated(false);
            setSaveError(null);
          }}
        >
          Cancel
        </button>
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 16 }}>
        <label>
          <span>Pack label</span>
          <input
            style={inputStyle}
            value={state.label}
            disabled={saving}
            onChange={(event) => {
              setValidated(false);
              setSaveError(null);
              setState({ ...state, label: event.target.value });
            }}
          />
          {validated && errors.label ? <div style={errorStyle}>{errors.label}</div> : null}
        </label>
        <label>
          <span>Default locale</span>
          <input
            style={inputStyle}
            value={state.defaultLocale}
            disabled={saving}
            onChange={(event) => {
              setValidated(false);
              setSaveError(null);
              setState({ ...state, defaultLocale: event.target.value });
            }}
          />
          {validated && errors.defaultLocale ? <div style={errorStyle}>{errors.defaultLocale}</div> : null}
        </label>
        <label>
          <span>Workflow name</span>
          <input
            style={inputStyle}
            value={state.workType}
            disabled={saving}
            onChange={(event) => {
              setValidated(false);
              setSaveError(null);
              setState({ ...state, workType: event.target.value });
            }}
          />
          {validated && errors.workType ? <div style={errorStyle}>{errors.workType}</div> : null}
        </label>
      </div>

      <section aria-labelledby="terminology-editor-title" style={{ marginTop: 20 }}>
        <div>
          <h3 id="terminology-editor-title" style={{ margin: 0 }}>Industry terminology</h3>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
            Customize vocabulary without changing canonical concept identity, authorization, or persisted keys.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {terminologyState.concepts.map((concept, conceptIndex) => {
            const updateConcept = (patch: Partial<DraftTerminologyConceptState>) => {
              setValidated(false);
              setSaveError(null);
              setTerminologyState((current) => ({
                concepts: current.concepts.map((item, i) => i === conceptIndex ? { ...item, ...patch } : item),
              }));
            };
            const conceptPath = `concepts[${conceptIndex}]`;
            const aliasInvalid = terminologyErrors.issues.some(
              (issue) => issue.path.startsWith(`${conceptPath}.aliases[`),
            );
            return (
              <fieldset
                key={concept.conceptKey}
                disabled={saving}
                style={{ border: '1px solid var(--line, #e2e8f0)', borderRadius: 8, padding: 12 }}
              >
                <legend style={{ fontWeight: 700 }}>{concept.conceptKey}</legend>
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  Canonical concept key — stable and not editable.
                </div>

                <label style={{ display: 'block', marginTop: 10 }}>
                  <span>Aliases (comma separated)</span>
                  <input
                    style={inputStyle}
                    value={concept.aliases.join(', ')}
                    onChange={(event) => updateConcept({
                      aliases: event.target.value.split(',').map((value) => value.trim()),
                    })}
                  />
                  {validated && aliasInvalid
                    ? <div style={errorStyle}>Aliases must be unique and non-empty.</div>
                    : null}
                </label>

                <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                  {concept.labels.map((label, labelIndex) => {
                    const labelPath = `${conceptPath}.labels[${labelIndex}]`;
                    const updateLabel = (
                      patch: Partial<{ locale: string; singular: string; plural: string }>,
                    ) => {
                      updateConcept({
                        labels: concept.labels.map((item, i) => i === labelIndex ? { ...item, ...patch } : item),
                      });
                    };
                    return (
                      <fieldset
                        key={labelIndex}
                        style={{ border: '1px solid var(--line, #e2e8f0)', borderRadius: 8, padding: 10 }}
                      >
                        <legend>Locale label {labelIndex + 1}</legend>
                        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                          <label>
                            <span>Locale</span>
                            <input
                              style={inputStyle}
                              value={label.locale}
                              onChange={(event) => updateLabel({ locale: event.target.value })}
                            />
                            {validated && terminologyIssueForPath(terminologyErrors, `${labelPath}.locale`)
                              ? <div style={errorStyle}>Use a valid, unique locale.</div>
                              : null}
                          </label>
                          <label>
                            <span>Singular</span>
                            <input
                              style={inputStyle}
                              value={label.singular}
                              onChange={(event) => updateLabel({ singular: event.target.value })}
                            />
                            {validated && terminologyIssueForPath(terminologyErrors, `${labelPath}.singular`)
                              ? <div style={errorStyle}>Singular label is required.</div>
                              : null}
                          </label>
                          <label>
                            <span>Plural</span>
                            <input
                              style={inputStyle}
                              value={label.plural}
                              onChange={(event) => updateLabel({ plural: event.target.value })}
                            />
                            {validated && terminologyIssueForPath(terminologyErrors, `${labelPath}.plural`)
                              ? <div style={errorStyle}>Plural label is required.</div>
                              : null}
                          </label>
                        </div>
                        <button
                          type="button"
                          style={{ marginTop: 8 }}
                          onClick={() => updateConcept({
                            labels: concept.labels.filter((_, i) => i !== labelIndex),
                          })}
                        >
                          Remove locale
                        </button>
                      </fieldset>
                    );
                  })}
                </div>

                {validated && terminologyIssueForPath(terminologyErrors, `${conceptPath}.labels`)
                  ? <div style={errorStyle}>A label for the default locale is required.</div>
                  : null}

                <button
                  type="button"
                  style={{ marginTop: 10 }}
                  onClick={() => updateConcept({
                    labels: [...concept.labels, {
                      locale: state.defaultLocale,
                      singular: '',
                      plural: '',
                    }],
                  })}
                >
                  Add locale label
                </button>
              </fieldset>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="relationship-role-editor-title" style={{ marginTop: 20 }}>
        <div>
          <h3 id="relationship-role-editor-title" style={{ margin: 0 }}>Relationship vocabulary</h3>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
            Name canonical CRM relationships in this industry without changing their stable identities.
          </p>
        </div>

        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {ontologyRoleState.roles.map((entry, index) => (
            <label key={entry.conceptKey}>
              <span>{entry.conceptKey}</span>
              <input
                style={inputStyle}
                value={entry.role}
                placeholder="Leave blank to use the neutral fallback"
                disabled={saving}
                onChange={(event) => {
                  setValidated(false);
                  setSaveError(null);
                  setOntologyRoleState((current) => ({
                    roles: current.roles.map((item, i) => (
                      i === index ? { ...item, role: event.target.value } : item
                    )),
                  }));
                }}
              />
              {validated && ontologyRoleErrors.roles?.[index]
                ? <div style={errorStyle}>{ontologyRoleErrors.roles[index]}</div>
                : null}
            </label>
          ))}
        </div>
      </section>

      <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
        {state.stages.map((stage, index) => (
          <fieldset key={stage.key} disabled={saving} style={{ border: '1px solid var(--line, #e2e8f0)', borderRadius: 8, padding: 12 }}>
            <legend style={{ fontWeight: 700 }}>{stage.key}</legend>
            <label>
              <span>Stage label</span>
              <input
                style={inputStyle}
                value={stage.label}
                onChange={(event) => updateStage(index, { label: event.target.value })}
              />
              {validated && errors.stages?.[stage.key]?.label
                ? <div style={errorStyle}>{errors.stages[stage.key]?.label}</div>
                : null}
            </label>
            <label style={{ display: 'block', marginTop: 8 }}>
              <span>Guidance</span>
              <textarea
                style={{ ...inputStyle, minHeight: 72 }}
                value={stage.guidance}
                onChange={(event) => updateStage(index, { guidance: event.target.value })}
              />
            </label>
          </fieldset>
        ))}
      </div>


      <section aria-labelledby="schema-editor-title" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <h3 id="schema-editor-title" style={{ margin: 0 }}>Case schema</h3>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
              Define Pack-owned case attributes that executable semantics may reference.
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setValidated(false);
              setSchemaState((current) => ({
                ...current,
                fields: [...current.fields, {
                  key: '',
                  label: '',
                  type: 'text',
                  required: false,
                  options: [],
                }],
              }));
            }}
          >
            Add case field
          </button>
        </div>

        <label style={{ display: 'block', maxWidth: 220, marginTop: 12 }}>
          <span>Schema version</span>
          <input
            style={inputStyle}
            type="number"
            min={1}
            value={schemaState.version}
            onChange={(event) => {
              setValidated(false);
              setSchemaState({ ...schemaState, version: Number(event.target.value) });
            }}
          />
          {validated && schemaErrors.version ? <div style={errorStyle}>{schemaErrors.version}</div> : null}
        </label>

        {schemaState.fields.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: 13 }}>No Pack-owned case fields are declared.</p>
        ) : (
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {schemaState.fields.map((field, index) => {
              const fieldErrors = schemaErrors.fields?.[index];
              const updateField = (patch: Partial<DraftCaseSchemaFieldState>) => {
                setValidated(false);
                setSaveError(null);
                setSchemaState((current) => ({
                  ...current,
                  fields: current.fields.map((item, i) => i === index ? { ...item, ...patch } : item),
                }));
              };
              return (
                <fieldset
                  key={index}
                  disabled={saving}
                  style={{ border: '1px solid var(--line, #e2e8f0)', borderRadius: 8, padding: 12 }}
                >
                  <legend style={{ fontWeight: 700 }}>Field {index + 1}</legend>
                  <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                    <label>
                      <span>Field key</span>
                      <input style={inputStyle} value={field.key} onChange={(event) => updateField({ key: event.target.value })} />
                      {validated && fieldErrors?.key ? <div style={errorStyle}>{fieldErrors.key}</div> : null}
                    </label>
                    <label>
                      <span>Label</span>
                      <input style={inputStyle} value={field.label} onChange={(event) => updateField({ label: event.target.value })} />
                      {validated && fieldErrors?.label ? <div style={errorStyle}>{fieldErrors.label}</div> : null}
                    </label>
                    <label>
                      <span>Type</span>
                      <select
                        style={inputStyle}
                        value={field.type}
                        onChange={(event) => updateField({
                          type: event.target.value,
                          options: event.target.value === 'select' ? field.options : [],
                        })}
                      >
                        <option value="text">text</option>
                        <option value="number">number</option>
                        <option value="select">select</option>
                      </select>
                      {validated && fieldErrors?.type ? <div style={errorStyle}>{fieldErrors.type}</div> : null}
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 22 }}>
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(event) => updateField({ required: event.target.checked })}
                      />
                      Required
                    </label>
                  </div>

                  {field.type === 'select' ? (
                    <label style={{ display: 'block', marginTop: 10 }}>
                      <span>Options (comma separated)</span>
                      <input
                        style={inputStyle}
                        value={field.options.join(', ')}
                        onChange={(event) => updateField({
                          options: event.target.value.split(',').map((value) => value.trim()),
                        })}
                      />
                      {validated && fieldErrors?.options ? <div style={errorStyle}>{fieldErrors.options}</div> : null}
                    </label>
                  ) : validated && fieldErrors?.options ? (
                    <div style={errorStyle}>{fieldErrors.options}</div>
                  ) : null}

                  <button
                    type="button"
                    style={{ marginTop: 10 }}
                    onClick={() => {
                      setValidated(false);
                      setSchemaState((current) => ({
                        ...current,
                        fields: current.fields.filter((_, i) => i !== index),
                      }));
                    }}
                  >
                    Remove field
                  </button>
                </fieldset>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="semantic-editor-title" style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div>
            <h3 id="semantic-editor-title" style={{ margin: 0 }}>Executable stage semantics</h3>
            <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
              Define business rules over canonical case facts. Server validation remains authoritative.
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setValidated(false);
              setSemanticState((current) => ({
                rules: [...current.rules, {
                  stageKey: state.stages[0]?.key ?? 'INTAKE',
                  phase: 'EXIT',
                  requiredAttributeKeys: [],
                  requiredRelationships: [],
                  requiredDecisionOutcomes: [],
                  message: '',
                }],
              }));
            }}
          >
            Add semantic rule
          </button>
        </div>

        {semanticState.rules.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: 13 }}>No executable semantic rules are declared.</p>
        ) : (
          <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
            {semanticState.rules.map((rule, index) => {
              const ruleErrors = semanticErrors.rules?.[index];
              return (
                <fieldset
                  key={index}
                  disabled={saving}
                  style={{ border: '1px solid var(--line, #e2e8f0)', borderRadius: 8, padding: 12 }}
                >
                  <legend style={{ fontWeight: 700 }}>Rule {index + 1}</legend>

                  <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                    <label>
                      <span>Stage</span>
                      <select
                        style={inputStyle}
                        value={rule.stageKey}
                        onChange={(event) => updateSemanticRule(index, { stageKey: event.target.value })}
                      >
                        {state.stages.map((stage) => (
                          <option key={stage.key} value={stage.key}>{stage.key}</option>
                        ))}
                      </select>
                      {validated && ruleErrors?.stageKey ? <div style={errorStyle}>{ruleErrors.stageKey}</div> : null}
                    </label>
                    <label>
                      <span>Phase</span>
                      <select
                        style={inputStyle}
                        value={rule.phase}
                        onChange={(event) => updateSemanticRule(index, { phase: event.target.value as 'ENTRY' | 'EXIT' })}
                      >
                        <option value="ENTRY">ENTRY</option>
                        <option value="EXIT">EXIT</option>
                      </select>
                      {validated && ruleErrors?.phase ? <div style={errorStyle}>{ruleErrors.phase}</div> : null}
                    </label>
                    <label>
                      <span>Required decision outcomes</span>
                      <input
                        style={inputStyle}
                        value={rule.requiredDecisionOutcomes.join(', ')}
                        placeholder="APPROVE, VERIFIED"
                        onChange={(event) => updateSemanticRule(index, {
                          requiredDecisionOutcomes: event.target.value
                            .split(',')
                            .map((value) => value.trim())
                            .filter(Boolean),
                        })}
                      />
                      {validated && ruleErrors?.requiredDecisionOutcomes
                        ? <div style={errorStyle}>{ruleErrors.requiredDecisionOutcomes}</div>
                        : null}
                    </label>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <strong style={{ fontSize: 13 }}>Required case attributes</strong>
                    {availableAttributeKeys.length === 0 ? (
                      <span style={{ marginLeft: 8, color: '#64748b', fontSize: 13 }}>No case-schema fields available.</span>
                    ) : (
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
                        {availableAttributeKeys.map((key) => (
                          <label key={key}>
                            <input
                              type="checkbox"
                              checked={rule.requiredAttributeKeys.includes(key)}
                              onChange={() => toggleSemanticValue(index, 'requiredAttributeKeys', key)}
                            />{' '}{key}
                          </label>
                        ))}
                      </div>
                    )}
                    {validated && ruleErrors?.requiredAttributeKeys
                      ? <div style={errorStyle}>{ruleErrors.requiredAttributeKeys}</div>
                      : null}
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <strong style={{ fontSize: 13 }}>Required canonical relationships</strong>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
                      {CASE_RELATIONSHIP_CONCEPTS.map((key) => (
                        <label key={key}>
                          <input
                            type="checkbox"
                            checked={rule.requiredRelationships.includes(key)}
                            onChange={() => toggleSemanticValue(index, 'requiredRelationships', key)}
                          />{' '}{key}
                        </label>
                      ))}
                    </div>
                    {validated && ruleErrors?.requiredRelationships
                      ? <div style={errorStyle}>{ruleErrors.requiredRelationships}</div>
                      : null}
                  </div>

                  <label style={{ display: 'block', marginTop: 10 }}>
                    <span>Blocking message</span>
                    <textarea
                      style={{ ...inputStyle, minHeight: 64 }}
                      value={rule.message}
                      onChange={(event) => updateSemanticRule(index, { message: event.target.value })}
                    />
                    {validated && ruleErrors?.message ? <div style={errorStyle}>{ruleErrors.message}</div> : null}
                  </label>

                  {validated && ruleErrors?.requirement
                    ? <div style={errorStyle}>{ruleErrors.requirement}</div>
                    : null}

                  <button
                    type="button"
                    style={{ marginTop: 10 }}
                    onClick={() => {
                      setValidated(false);
                      setSemanticState((current) => ({
                        rules: current.rules.filter((_, i) => i !== index),
                      }));
                    }}
                  >
                    Remove rule
                  </button>
                </fieldset>
              );
            })}
          </div>
        )}
      </section>

      <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" disabled={saving} onClick={() => setValidated(true)}>
          Validate changes
        </button>
        <button type="button" disabled={saving || (validated && invalid)} onClick={saveDraft}>
          {saving ? 'Saving…' : `Save revision ${revision}`}
        </button>
        {validated && !invalid ? <span style={{ color: '#166534', fontSize: 13 }}>Draft changes are locally valid.</span> : null}
        {validated && invalid ? <span style={{ color: '#b91c1c', fontSize: 13 }}>Fix the highlighted fields before saving.</span> : null}
        {saveError ? <span role="alert" style={{ color: '#b91c1c', fontSize: 13 }}>{saveError}</span> : null}
      </div>
    </section>
  );
}
