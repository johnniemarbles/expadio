"use client";

import { useMemo, useState } from "react";
import type { TemplateCatalogueItem } from "../../api/communications/templates/route";
import motionStyles from "./TemplateLibraryModal.module.css";

/**
 * The template library operators actually asked for: the whole catalogue with
 * search and channel/scope filters, each row opening the lifecycle inspector —
 * rather than "Manage Templates" silently opening whichever template happens to
 * be first.
 */

interface TemplateLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: TemplateCatalogueItem[];
  onOpenTemplate: (triggerKey: string) => void;
  onNewTemplate: () => void;
}

export function TemplateLibraryModal({ isOpen, onClose, templates, onOpenTemplate, onNewTemplate }: TemplateLibraryModalProps) {
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("");
  const [scope, setScope] = useState("");

  const channels = useMemo(() => {
    const set = new Set<string>();
    templates.forEach((t) => t.channels.forEach((c) => set.add(c)));
    return [...set].sort();
  }, [templates]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (q && !t.triggerKey.toLowerCase().includes(q)) return false;
      if (channel && !t.channels.includes(channel)) return false;
      if (scope && t.scope !== scope) return false;
      return true;
    });
  }, [templates, query, channel, scope]);

  if (!isOpen) return null;

  return (
    <div role="presentation" onClick={onClose} className={motionStyles.backdrop} style={{ position: "fixed", inset: 0, zIndex: 120, background: "var(--theme-overlay)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className={motionStyles.dialog} style={{ width: "min(920px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "var(--theme-surface-raised)", border: "1px solid var(--theme-border)", borderRadius: 16, padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 800, color: "var(--theme-primary)" }}>Communications / Templates</span>
            <h2 style={{ margin: "4px 0 0", fontSize: 20 }}>Template library</h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--theme-text-muted)" }}>{templates.length} templates. Open one to preview, version, publish or clone.</p>
          </div>
          <div className={motionStyles.headerActions} style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onNewTemplate} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--theme-primary)", background: "transparent", color: "var(--theme-primary)", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>+ New template</button>
            <button type="button" onClick={onClose} aria-label="Close" style={{ border: "1px solid var(--theme-border)", background: "transparent", borderRadius: 8, width: 34, height: 34, cursor: "pointer" }}>✕</button>
          </div>
        </div>

        <div className={motionStyles.toolbar} style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search trigger key…" style={{ flex: "1 1 240px", padding: "8px 12px", border: "1px solid var(--theme-border)", borderRadius: 8, fontSize: 13 }} />
          <select value={channel} onChange={(e) => setChannel(e.target.value)} style={{ padding: "8px 12px", border: "1px solid var(--theme-border)", borderRadius: 8, fontSize: 13 }}>
            <option value="">All channels</option>
            {channels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ padding: "8px 12px", border: "1px solid var(--theme-border)", borderRadius: 8, fontSize: 13 }}>
            <option value="">All scopes</option>
            <option value="PLATFORM">Platform</option>
            <option value="TENANT">Tenant (brand)</option>
          </select>
        </div>

        {filtered.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--theme-text-muted)", fontSize: 12 }}>
                  <th style={{ padding: "8px" }}>Trigger</th>
                  <th style={{ padding: "8px" }}>Channels</th>
                  <th style={{ padding: "8px" }}>Scope</th>
                  <th style={{ padding: "8px" }}>Active</th>
                  <th style={{ padding: "8px" }}>Drafts</th>
                  <th style={{ padding: "8px" }}>Versions</th>
                  <th style={{ padding: "8px" }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={`${t.triggerKey}-${t.scope}`} className={motionStyles.row} style={{ borderTop: "1px solid var(--theme-border)" }}>
                    <td style={{ padding: "8px", fontWeight: 600 }}>{t.triggerKey}</td>
                    <td style={{ padding: "8px" }}>{t.channels.map((c) => <span key={c} style={{ display: "inline-block", padding: "1px 6px", marginRight: 4, borderRadius: 999, background: "var(--theme-surface-muted)", color: "var(--theme-text-secondary)", fontSize: 11 }}>{c}</span>)}</td>
                    <td style={{ padding: "8px" }}><span style={{ fontSize: 11, fontWeight: 700, color: t.scope === "PLATFORM" ? "var(--theme-primary)" : "var(--theme-secondary)" }}>{t.scope}</span></td>
                    <td style={{ padding: "8px" }}>{t.hasActiveVersion ? <span style={{ color: "var(--theme-success)", fontWeight: 700 }}>{t.activeCount}</span> : <span style={{ color: "var(--theme-warning)" }}>none</span>}</td>
                    <td style={{ padding: "8px" }}>{t.draftCount}</td>
                    <td style={{ padding: "8px" }}>{t.totalVersions}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>
                      <button type="button" className={motionStyles.openButton} onClick={() => onOpenTemplate(t.triggerKey)} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 6, border: "1px solid var(--theme-border)", background: "transparent", cursor: "pointer", fontWeight: 700 }}>Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={motionStyles.empty} style={{ padding: 30, textAlign: "center", color: "var(--theme-text-muted)" }}>
            {templates.length === 0 ? "No templates yet. Create the first one." : "No templates match these filters."}
          </div>
        )}
      </div>
    </div>
  );
}
