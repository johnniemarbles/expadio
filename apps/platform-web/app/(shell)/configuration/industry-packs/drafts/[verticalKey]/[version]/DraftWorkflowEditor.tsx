'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  applyDraftWorkflowEditorState,
  hasDraftWorkflowEditorErrors,
  validateDraftWorkflowEditorState,
  type DraftWorkflowDefinitionShape,
  type DraftWorkflowEditorState,
} from './draft-editor-model';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line, #cbd5e1)',
  borderRadius: 8,
  fontSize: 13,
};

const errorStyle: React.CSSProperties = { color: '#b91c1c', fontSize: 12, marginTop: 4 };

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
  readonly definition: DraftWorkflowDefinitionShape;
  readonly verticalKey: string;
  readonly version: number;
  readonly initialRevision: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<DraftWorkflowEditorState>(initial);
  const [revision, setRevision] = useState(initialRevision);
  const [validated, setValidated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const errors = useMemo(() => validateDraftWorkflowEditorState(state), [state]);
  const invalid = hasDraftWorkflowEditorErrors(errors);

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
            definition: applyDraftWorkflowEditorState(definition, state),
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
