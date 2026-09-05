'use client';

import { useCallback, useRef, useState } from 'react';
import styles from '../../workspace.module.css';

type RowResult = {
  row: number;
  status: 'created' | 'skipped' | 'error';
  captureLeadId?: string;
  reason?: string;
};

type ImportResult = {
  success: boolean;
  created: number;
  skipped: number;
  errors: number;
  results: RowResult[];
};

const TEMPLATE_CSV = `email,name,phone,notes
alice@example.com,Alice Smith,+15550001111,Met at trade show
bob@example.com,Bob Jones,,Follow up Q4
,Carol Lee,+15550002222,
`;

export default function LeadImportClient() {
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [pasteText, setPasteText] = useState('');
  const [sourceKey, setSourceKey] = useState('IMPORT');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      let response: Response;

      if (mode === 'file') {
        if (!file) { setError('Select a CSV file first.'); setLoading(false); return; }
        const form = new FormData();
        form.append('file', file);
        response = await fetch(`/api/leads/import?sourceKey=${encodeURIComponent(sourceKey)}`, {
          method: 'POST',
          body: form,
        });
      } else {
        if (!pasteText.trim()) { setError('Paste CSV text first.'); setLoading(false); return; }
        response = await fetch(`/api/leads/import?sourceKey=${encodeURIComponent(sourceKey)}`, {
          method: 'POST',
          headers: { 'content-type': 'text/csv' },
          body: pasteText,
        });
      }

      const body = await response.json().catch(() => ({})) as Record<string, unknown>;

      if (!response.ok) {
        setError(typeof body.error === 'string' ? body.error : `Import failed (${response.status}).`);
        setLoading(false);
        return;
      }

      setResult(body as unknown as ImportResult);
      if (mode === 'file') { setFile(null); if (fileRef.current) fileRef.current.value = ''; }
      else { setPasteText(''); }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [mode, file, pasteText, sourceKey]);

  const createdRows = result?.results.filter((r) => r.status === 'created') ?? [];
  const skippedRows = result?.results.filter((r) => r.status === 'skipped') ?? [];
  const errorRows = result?.results.filter((r) => r.status === 'error') ?? [];

  return (
    <div>
      {/* Config strip */}
      <div className={styles.panel} style={{ marginTop: 0 }}>
        <div className={styles.panelHead}><h2>Import settings</h2></div>
        <div className={styles.panelBody} style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700 }}>
            Capture source key
            <input
              value={sourceKey}
              onChange={(e) => setSourceKey(e.target.value.trim() || 'IMPORT')}
              maxLength={120}
              style={{ padding: '8px 10px', borderRadius: "var(--theme-radius-card)", border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13, minWidth: 200 }}
            />
            <span style={{ color: 'var(--theme-text-muted)', fontWeight: 400 }}>Must match an ACTIVE source in this workspace</span>
          </label>
          <label style={{ display: 'grid', gap: 5, fontSize: 12, fontWeight: 700 }}>
            Input mode
            <select value={mode} onChange={(e) => setMode(e.target.value as 'file' | 'paste')} style={{ padding: '8px 10px', borderRadius: "var(--theme-radius-card)", border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontSize: 13 }}>
              <option value="file">Upload file</option>
              <option value="paste">Paste CSV</option>
            </select>
          </label>
          <button type="button" onClick={downloadTemplate} className={styles.secondaryButton} style={{ fontSize: 12 }}>
            Download template
          </button>
        </div>
      </div>

      {/* Input */}
      <form onSubmit={submit}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>{mode === 'file' ? 'Upload CSV file' : 'Paste CSV'}</h2>
            <span style={{ fontSize: 11, color: 'var(--theme-text-muted)' }}>Max 4 MB · 2,000 rows · Columns: email, name, phone, notes</span>
          </div>
          <div className={styles.panelBody}>
            {mode === 'file' ? (
              <div
                style={{
                  border: `2px dashed ${file ? 'var(--theme-primary)' : 'var(--theme-border)'}`,
                  borderRadius: "var(--theme-radius-card)",
                  padding: '40px 24px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: file ? 'color-mix(in srgb,var(--theme-primary) 5%,var(--theme-surface))' : 'var(--theme-surface-muted)',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const dropped = e.dataTransfer.files[0];
                  if (dropped) setFile(dropped);
                }}
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  style={{ display: 'none' }}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                {file ? (
                  <div>
                    <strong style={{ fontSize: 14 }}>{file.name}</strong>
                    <div style={{ fontSize: 12, color: 'var(--theme-text-muted)', marginTop: 4 }}>{(file.size / 1024).toFixed(1)} KB</div>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setFile(null); if (fileRef.current) fileRef.current.value = ''; }} style={{ marginTop: 10, fontSize: 11, cursor: 'pointer', border: 'none', background: 'none', color: 'var(--theme-text-muted)' }}>Remove</button>
                  </div>
                ) : (
                  <div style={{ color: 'var(--theme-text-muted)' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                    <strong style={{ fontSize: 14 }}>Drop a CSV file here, or click to browse</strong>
                    <div style={{ fontSize: 12, marginTop: 4 }}>Accepts .csv files up to 4 MB</div>
                  </div>
                )}
              </div>
            ) : (
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={'email,name,phone,notes\nalice@example.com,Alice Smith,+15550001111,Met at trade show'}
                rows={10}
                style={{ width: '100%', padding: '10px 12px', borderRadius: "var(--theme-radius-card)", border: '1px solid var(--theme-border)', background: 'var(--theme-surface)', color: 'var(--theme-text-primary)', fontFamily: 'var(--theme-font-mono)', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }}
              />
            )}
          </div>
        </div>

        {error && (
          <div className={styles.notice} style={{ marginTop: 12, background: 'color-mix(in srgb,var(--theme-danger) 8%,var(--theme-surface))' }}>
            <strong>Import failed:</strong> {error}
          </div>
        )}

        <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
          <button type="submit" disabled={loading} className={styles.button}>
            {loading ? 'Importing…' : 'Run import'}
          </button>
          {result && (
            <button type="button" onClick={() => setResult(null)} className={styles.secondaryButton}>
              Clear results
            </button>
          )}
        </div>
      </form>

      {/* Results */}
      {result && (
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <h2>Import results</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className={styles.pill} style={{ background: 'color-mix(in srgb,var(--theme-success) 14%,transparent)', color: 'var(--theme-success)' }}>
                {result.created} created
              </span>
              {result.skipped > 0 && (
                <span className={styles.pill}>{result.skipped} skipped</span>
              )}
              {result.errors > 0 && (
                <span className={styles.pill} style={{ background: 'color-mix(in srgb,var(--theme-danger) 14%,transparent)', color: 'var(--theme-danger)' }}>
                  {result.errors} errors
                </span>
              )}
            </div>
          </div>
          {errorRows.length > 0 && (
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--theme-border)' }}>
              <strong style={{ fontSize: 12 }}>Errors</strong>
              <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                {errorRows.map((r) => (
                  <div key={r.row} style={{ fontSize: 12, display: 'flex', gap: 10 }}>
                    <span style={{ color: 'var(--theme-text-muted)', minWidth: 50 }}>Row {r.row}</span>
                    <span style={{ color: 'var(--theme-danger)' }}>{r.reason ?? 'Unknown error'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Row</th><th>Status</th><th>Lead ID</th><th>Reason</th></tr></thead>
              <tbody>
                {result.results.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>
                      <span className={styles.pill} style={{
                        background: r.status === 'created' ? 'color-mix(in srgb,var(--theme-success) 14%,transparent)' : r.status === 'error' ? 'color-mix(in srgb,var(--theme-danger) 14%,transparent)' : undefined,
                        color: r.status === 'created' ? 'var(--theme-success)' : r.status === 'error' ? 'var(--theme-danger)' : undefined,
                      }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--theme-font-mono)', fontSize: 11 }}>{r.captureLeadId ?? '—'}</td>
                    <td style={{ color: 'var(--theme-text-muted)', fontSize: 12 }}>{r.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
