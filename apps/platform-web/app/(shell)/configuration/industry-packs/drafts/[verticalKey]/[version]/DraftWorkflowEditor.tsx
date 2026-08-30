'use client';

import { useMemo, useState } from 'react';
import {
  hasDraftWorkflowEditorErrors,
  validateDraftWorkflowEditorState,
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

export function DraftWorkflowEditor({
  initial,
}: {
  readonly initial: DraftWorkflowEditorState;
}) {
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<DraftWorkflowEditorState>(initial);
  const [validated, setValidated] = useState(false);
  const errors = useMemo(() => validateDraftWorkflowEditorState(state), [state]);
  const invalid = hasDraftWorkflowEditorErrors(errors);

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)}>
        Edit draft
      </button>
    );
  }

  const updateStage = (index: number, patch: Partial<{ label: string; guidance: string }>) => {
    setValidated(false);
    setState((current) => ({
      ...current,
      stages: current.stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)),
    }));
  };

  return (
    <section aria-labelledby="draft-editor-title" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <h2 id="draft-editor-title" style={{ margin: 0 }}>Edit draft</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
            Local editing and validation only in this slice. Server save is intentionally not wired yet.
          </p>
        </div>
        <button type="button" onClick={() => { setState(initial); setEditing(false); setValidated(false); }}>
          Cancel
        </button>
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 16 }}>
        <label>
          <span>Pack label</span>
          <input
            style={inputStyle}
            value={state.label}
            onChange={(event) => { setValidated(false); setState({ ...state, label: event.target.value }); }}
          />
          {validated && errors.label ? <div style={errorStyle}>{errors.label}</div> : null}
        </label>
        <label>
          <span>Default locale</span>
          <input
            style={inputStyle}
            value={state.defaultLocale}
            onChange={(event) => { setValidated(false); setState({ ...state, defaultLocale: event.target.value }); }}
          />
          {validated && errors.defaultLocale ? <div style={errorStyle}>{errors.defaultLocale}</div> : null}
        </label>
        <label>
          <span>Workflow name</span>
          <input
            style={inputStyle}
            value={state.workType}
            onChange={(event) => { setValidated(false); setState({ ...state, workType: event.target.value }); }}
          />
          {validated && errors.workType ? <div style={errorStyle}>{errors.workType}</div> : null}
        </label>
      </div>

      <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
        {state.stages.map((stage, index) => (
          <fieldset key={stage.key} style={{ border: '1px solid var(--line, #e2e8f0)', borderRadius: 8, padding: 12 }}>
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

      <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" onClick={() => setValidated(true)}>Validate changes</button>
        {validated && !invalid ? <span style={{ color: '#166534', fontSize: 13 }}>Draft changes are locally valid.</span> : null}
        {validated && invalid ? <span style={{ color: '#b91c1c', fontSize: 13 }}>Fix the highlighted fields before saving.</span> : null}
      </div>
    </section>
  );
}
