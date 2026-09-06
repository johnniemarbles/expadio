'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { MotionDrawer } from '@expadio/ui';
import type { BrandLeadSummary, BrandLeadStage } from '../../../lib/brand-leads';
import { BRAND_LEAD_STAGES } from '../../../lib/brand-leads';
import CreateLeadForm from './CreateLeadForm';
import { LeadDetailDrawer } from './LeadDetailDrawer';
import styles from '../workspace.module.css';

interface LeadManagementClientProps {
  readonly initialLeads: readonly BrandLeadSummary[];
  readonly initialStage?: string;
  readonly organizationName: string;
  readonly updateStageAction: (formData: FormData) => Promise<void>;
  readonly convertLeadAction: (formData: FormData) => Promise<void>;
}

const STAGE_COLORS: Record<BrandLeadStage, string> = {
  NEW: '#3B82F6',       // Blue
  QUALIFIED: '#A88CF8', // Purple
  PROPOSAL: '#FACC15',  // Motion Yellow
  WON: '#22C55E',       // Green
  LOST: '#EF4444',      // Red
};

export default function LeadManagementClient({
  initialLeads,
  initialStage = '',
  organizationName,
  updateStageAction,
  convertLeadAction,
}: LeadManagementClientProps) {
  const [selectedStage, setSelectedStage] = useState<string>(initialStage.toUpperCase());
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<BrandLeadSummary | null>(null);

  // Compute metric card counts for all 5 stages
  const counts = useMemo(() => {
    return BRAND_LEAD_STAGES.map((s) => ({
      stage: s,
      count: initialLeads.filter((l) => l.stage === s).length,
    }));
  }, [initialLeads]);

  // Filter leads based on selected stage and search query
  const filteredLeads = useMemo(() => {
    let result = [...initialLeads];
    if (selectedStage !== '') {
      result = result.filter((l) => l.stage === selectedStage);
    }
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((l) => {
        const name = (l.contactName ?? l.title ?? '').toLowerCase();
        const email = (l.contactEmail ?? '').toLowerCase();
        const phone = (l.contactPhone ?? '').toLowerCase();
        const company = (l.accountName ?? '').toLowerCase();
        return name.includes(q) || email.includes(q) || phone.includes(q) || company.includes(q);
      });
    }
    return result;
  }, [initialLeads, selectedStage, searchQuery]);

  return (
    <>
      {/* Top Header & Quick Action */}
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Growth · {organizationName}</p>
          <h1>Lead Management</h1>
          <p>
            Organization-scoped CRM projection for active demand. Capture, qualify and convert high-intent leads.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Sub-nav bar */}
          <nav
            style={{
              display: 'flex',
              gap: 4,
              padding: 4,
              background: 'var(--theme-surface-raised, #0D0E11)',
              borderRadius: 'var(--theme-radius-card, 8px)',
              border: '1px solid var(--theme-border, #1F242D)',
              width: 'fit-content',
              flexWrap: 'nowrap',
            }}
            aria-label="Lead management navigation"
          >
            <Link className={styles.button} style={{ height: 32, fontSize: 12, padding: '0 12px', whiteSpace: 'nowrap' }} href="/leads">
              Leads
            </Link>
            <Link className={styles.secondaryButton} style={{ border: 'none', background: 'transparent', whiteSpace: 'nowrap', height: 32, fontSize: 12, padding: '0 12px' }} href="/leads/contacts">
              Contacts
            </Link>
            <Link className={styles.secondaryButton} style={{ border: 'none', background: 'transparent', whiteSpace: 'nowrap', height: 32, fontSize: 12, padding: '0 12px' }} href="/leads/accounts">
              Accounts
            </Link>
            <Link className={styles.secondaryButton} style={{ border: 'none', background: 'transparent', whiteSpace: 'nowrap', height: 32, fontSize: 12, padding: '0 12px' }} href="/leads/capture/configuration">
              Capture Config
            </Link>
            <Link className={styles.secondaryButton} style={{ border: 'none', background: 'transparent', whiteSpace: 'nowrap', height: 32, fontSize: 12, padding: '0 12px' }} href="/leads/publications">
              Publications
            </Link>
            <Link className={styles.secondaryButton} style={{ border: 'none', background: 'transparent', whiteSpace: 'nowrap', height: 32, fontSize: 12, padding: '0 12px' }} href="/leads/capture">
              Demand Capture
            </Link>
          </nav>

          {/* Primary Action Button */}
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className={styles.button}
            style={{ height: 40, padding: '0 18px', fontWeight: 700, fontSize: 13 }}
          >
            + Create Lead
          </button>
        </div>
      </section>

      {/* Overview Stage Summary Metric Cards (Interactive deep-link filter) */}
      <section className={styles.grid}>
        {counts.map(({ stage, count }) => {
          const isActive = selectedStage === stage;
          const color = STAGE_COLORS[stage as BrandLeadStage] ?? '#9CA3AF';
          return (
            <article
              key={stage}
              onClick={() => setSelectedStage(isActive ? '' : stage)}
              className={styles.metric}
              style={{
                cursor: 'pointer',
                borderColor: isActive ? color : 'var(--theme-border, #1F242D)',
                boxShadow: isActive ? `0 0 0 1px ${color}` : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className={styles.metricLabel} style={{ color: isActive ? color : undefined }}>
                  {stage}
                </div>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: color,
                    display: 'inline-block',
                  }}
                />
              </div>
              <div className={styles.metricValue}>{count}</div>
              <div className={styles.metricDetail}>
                {isActive ? 'Active filter — click to clear' : 'Click to filter inbox'}
              </div>
            </article>
          );
        })}
      </section>

      {/* Main Inbox Controls Section */}
      <section className={styles.panel} style={{ marginTop: 24 }}>
        {/* Inbox Toolbar */}
        <div
          className={styles.panelHead}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Lead Inbox</h2>
            <span className={styles.pill}>
              {selectedStage || 'ALL'} · {filteredLeads.length}
            </span>
          </div>

          {/* Search + View Mode Controls */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Search Input */}
            <input
              type="search"
              placeholder="Search by name, email, phone…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: '7px 12px',
                borderRadius: 'var(--theme-radius-control, 6px)',
                border: '1px solid var(--theme-border, #1F242D)',
                background: 'var(--theme-surface, #060707)',
                color: 'var(--theme-text-primary, #FFFFFF)',
                fontSize: 13,
                minWidth: 240,
              }}
            />

            {/* View Mode Toggle */}
            <div
              style={{
                display: 'flex',
                background: 'var(--theme-surface-raised, #0D0E11)',
                padding: 3,
                borderRadius: 'var(--theme-radius-control, 6px)',
                border: '1px solid var(--theme-border, #1F242D)',
              }}
            >
              <button
                type="button"
                onClick={() => setViewMode('list')}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 4,
                  border: 'none',
                  background: viewMode === 'list' ? 'var(--theme-accent, #FACC15)' : 'transparent',
                  color: viewMode === 'list' ? '#060707' : 'var(--theme-text-muted, #9CA3AF)',
                  cursor: 'pointer',
                }}
              >
                List View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('board')}
                style={{
                  padding: '4px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 4,
                  border: 'none',
                  background: viewMode === 'board' ? 'var(--theme-accent, #FACC15)' : 'transparent',
                  color: viewMode === 'board' ? '#060707' : 'var(--theme-text-muted, #9CA3AF)',
                  cursor: 'pointer',
                }}
              >
                Board View
              </button>
            </div>
          </div>
        </div>

        {/* Stage Filter Tab Strip */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--theme-border, #1F242D)',
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
          }}
        >
          <button
            type="button"
            onClick={() => setSelectedStage('')}
            className={selectedStage === '' ? styles.button : styles.secondaryButton}
            style={{ height: 32, fontSize: 12, padding: '0 14px' }}
          >
            All ({initialLeads.length})
          </button>
          {BRAND_LEAD_STAGES.map((s) => {
            const count = initialLeads.filter((l) => l.stage === s).length;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSelectedStage(s)}
                className={selectedStage === s ? styles.button : styles.secondaryButton}
                style={{ height: 32, fontSize: 12, padding: '0 14px' }}
              >
                {s} ({count})
              </button>
            );
          })}
        </div>

        {/* Content Views */}
        {filteredLeads.length === 0 ? (
          <div className={styles.empty} style={{ padding: '48px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--theme-text-primary, #FFFFFF)', margin: '0 0 8px' }}>
              No leads found
            </p>
            <p style={{ fontSize: 13, color: 'var(--theme-text-muted, #9CA3AF)', margin: '0 0 16px' }}>
              {searchQuery ? `No results for "${searchQuery}"` : `No leads currently in stage ${selectedStage || 'ALL'}`}
            </p>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className={styles.button}
            >
              + Create Lead
            </button>
          </div>
        ) : viewMode === 'list' ? (
          /* List View Table */
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Interest</th>
                  <th>Stage</th>
                  <th>Value</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => (
                  <tr
                    key={lead.leadId}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedLead(lead)}
                  >
                    <td>
                      <strong style={{ color: 'var(--theme-text-primary, #FFFFFF)' }}>
                        {lead.contactName ?? lead.title}
                      </strong>
                      {lead.contactEmail ? (
                        <>
                          <br />
                          <small style={{ color: 'var(--theme-text-muted, #9CA3AF)' }}>{lead.contactEmail}</small>
                        </>
                      ) : null}
                      {lead.contactPhone ? (
                        <>
                          <br />
                          <small style={{ color: 'var(--theme-text-muted, #9CA3AF)' }}>{lead.contactPhone}</small>
                        </>
                      ) : null}
                    </td>
                    <td>{lead.enquiryInterestType ?? '—'}</td>
                    <td>
                      <span
                        className={styles.pill}
                        style={{
                          borderColor: STAGE_COLORS[lead.stage] ?? undefined,
                          color: STAGE_COLORS[lead.stage] ?? undefined,
                        }}
                      >
                        {lead.stage}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {lead.amountMinorUnits == null
                        ? '—'
                        : `${lead.currency} ${(lead.amountMinorUnits / 100).toFixed(2)}`}
                    </td>
                    <td style={{ color: 'var(--theme-text-muted, #9CA3AF)', fontSize: 12 }}>
                      {new Date(lead.createdAt).toLocaleDateString()}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setSelectedLead(lead)}
                        className={styles.secondaryButton}
                        style={{ height: 30, fontSize: 12, padding: '0 10px' }}
                      >
                        View Details →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Board (Kanban) View */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(220px, 1fr))',
              gap: 16,
              padding: 20,
              overflowX: 'auto',
            }}
          >
            {BRAND_LEAD_STAGES.map((stg) => {
              const colLeads = filteredLeads.filter((l) => l.stage === stg);
              const color = STAGE_COLORS[stg];
              return (
                <div
                  key={stg}
                  style={{
                    background: 'var(--theme-surface-raised, #0D0E11)',
                    border: '1px solid var(--theme-border, #1F242D)',
                    borderRadius: 'var(--theme-radius-card, 8px)',
                    display: 'flex',
                    flexDirection: 'column',
                    maxHeight: 700,
                  }}
                >
                  {/* Column Header */}
                  <div
                    style={{
                      padding: '12px 14px',
                      borderBottom: '1px solid var(--theme-border, #1F242D)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: 'var(--theme-surface, #060707)',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                      <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {stg}
                      </strong>
                    </div>
                    <span className={styles.pill} style={{ fontSize: 11 }}>
                      {colLeads.length}
                    </span>
                  </div>

                  {/* Column Body / Cards */}
                  <div
                    style={{
                      padding: 12,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                      overflowY: 'auto',
                      flex: 1,
                    }}
                  >
                    {colLeads.length === 0 ? (
                      <div
                        style={{
                          padding: '24px 12px',
                          textAlign: 'center',
                          fontSize: 12,
                          color: 'var(--theme-text-muted, #9CA3AF)',
                          border: '1px dashed var(--theme-border, #1F242D)',
                          borderRadius: 6,
                        }}
                      >
                        No {stg.toLowerCase()} leads
                      </div>
                    ) : (
                      colLeads.map((lead) => (
                        <div
                          key={lead.leadId}
                          onClick={() => setSelectedLead(lead)}
                          style={{
                            background: 'var(--theme-surface, #060707)',
                            border: '1px solid var(--theme-border, #1F242D)',
                            borderRadius: 6,
                            padding: 12,
                            cursor: 'pointer',
                            transition: 'border-color 0.15s ease',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--theme-accent, #FACC15)')}
                          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--theme-border, #1F242D)')}
                        >
                          <strong
                            style={{
                              fontSize: 13,
                              color: 'var(--theme-text-primary, #FFFFFF)',
                              display: 'block',
                              marginBottom: 4,
                            }}
                          >
                            {lead.contactName ?? lead.title}
                          </strong>
                          {lead.contactEmail ? (
                            <p style={{ fontSize: 11, color: 'var(--theme-text-muted, #9CA3AF)', margin: '0 0 6px' }}>
                              {lead.contactEmail}
                            </p>
                          ) : null}
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginTop: 8,
                              paddingTop: 8,
                              borderTop: '1px solid var(--theme-border, #1F242D)',
                              fontSize: 11,
                            }}
                          >
                            <span style={{ color: 'var(--theme-accent, #FACC15)', fontWeight: 600 }}>
                              {lead.amountMinorUnits == null
                                ? '—'
                                : `${lead.currency} ${(lead.amountMinorUnits / 100).toFixed(2)}`}
                            </span>
                            <span style={{ color: 'var(--theme-text-muted, #9CA3AF)' }}>
                              {new Date(lead.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Slide-over Drawer for Create Lead */}
      <MotionDrawer
        open={isCreateOpen}
        side="right"
        style={{
          width: '100%',
          maxWidth: 540,
          background: 'var(--theme-surface-raised, #0D0E11)',
          borderLeft: '1px solid var(--theme-border, #1F242D)',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          position: 'fixed',
          top: 0,
          right: 0,
          zIndex: 100,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--theme-border, #1F242D)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--theme-surface, #060707)',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--theme-text-primary, #FFFFFF)' }}>
            Create New Lead
          </h2>
          <button
            type="button"
            onClick={() => setIsCreateOpen(false)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--theme-text-muted, #9CA3AF)',
              fontSize: 24,
              cursor: 'pointer',
              padding: '4px 8px',
            }}
            aria-label="Close drawer"
          >
            ×
          </button>
        </div>
        <div style={{ padding: 24, flex: 1, overflowY: 'auto' }}>
          <CreateLeadForm onCreated={() => setIsCreateOpen(false)} />
        </div>
      </MotionDrawer>

      {/* Slide-over Drawer for Lead Details */}
      <LeadDetailDrawer
        lead={selectedLead}
        isOpen={Boolean(selectedLead)}
        onClose={() => setSelectedLead(null)}
        updateStageAction={updateStageAction}
        convertLeadAction={convertLeadAction}
      />
    </>
  );
}
