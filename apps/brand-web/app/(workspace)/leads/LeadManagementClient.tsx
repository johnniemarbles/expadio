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

  // Compute stage counts
  const stageCounts = useMemo(() => {
    return BRAND_LEAD_STAGES.map((s) => ({
      stage: s,
      count: initialLeads.filter((l) => l.stage === s).length,
    }));
  }, [initialLeads]);

  // Filter leads by stage and search query
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
      {/* Top Header & Navigation Bar */}
      <section className={styles.pageHead}>
        <div>
          <p className={styles.eyebrow}>Growth · {organizationName}</p>
          <h1>Lead Management</h1>
          <p>
            Organization-scoped CRM projection for active demand. Capture, qualify and convert high-intent leads.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Sub-Navigation Bar */}
          <nav
            style={{
              display: 'flex',
              gap: 4,
              padding: 4,
              background: 'var(--card, #0A0A0A)',
              borderRadius: 'var(--radius-md, 4px)',
              border: '1px solid var(--border, #272727)',
              width: 'fit-content',
              flexWrap: 'nowrap',
            }}
            aria-label="Lead management navigation"
          >
            <Link className={styles.button} style={{ height: 32, fontSize: 12, padding: '0 12px', borderRadius: 4, whiteSpace: 'nowrap' }} href="/leads">
              Leads
            </Link>
            <Link className={styles.secondaryButton} style={{ border: 'none', background: 'transparent', whiteSpace: 'nowrap', height: 32, fontSize: 12, padding: '0 12px', borderRadius: 4 }} href="/leads/contacts">
              Contacts
            </Link>
            <Link className={styles.secondaryButton} style={{ border: 'none', background: 'transparent', whiteSpace: 'nowrap', height: 32, fontSize: 12, padding: '0 12px', borderRadius: 4 }} href="/leads/accounts">
              Accounts
            </Link>
            <Link className={styles.secondaryButton} style={{ border: 'none', background: 'transparent', whiteSpace: 'nowrap', height: 32, fontSize: 12, padding: '0 12px', borderRadius: 4 }} href="/leads/capture/configuration">
              Capture Config
            </Link>
            <Link className={styles.secondaryButton} style={{ border: 'none', background: 'transparent', whiteSpace: 'nowrap', height: 32, fontSize: 12, padding: '0 12px', borderRadius: 4 }} href="/leads/publications">
              Publications
            </Link>
            <Link className={styles.secondaryButton} style={{ border: 'none', background: 'transparent', whiteSpace: 'nowrap', height: 32, fontSize: 12, padding: '0 12px', borderRadius: 4 }} href="/leads/capture">
              Demand Capture
            </Link>
          </nav>

          {/* Primary "+ Create Lead" Button (EXPADIO Design Guide: 36px height, 4px radius, 0 16px padding) */}
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className={styles.button}
            style={{
              height: 36,
              padding: '0 16px',
              borderRadius: 'var(--radius-md, 4px)',
              fontWeight: 600,
              fontSize: 13,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            + Create Lead
          </button>
        </div>
      </section>

      {/* Primary Pipeline Stage Metric Bar (EXPADIO Design Guide: 6px card radius, 16px padding) */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginTop: 16,
        }}
      >
        {/* ALL Summary Card */}
        <article
          onClick={() => setSelectedStage('')}
          style={{
            background: 'var(--card, #0A0A0A)',
            border: `1px solid ${selectedStage === '' ? 'var(--brand-primary, #FACC15)' : 'var(--border, #272727)'}`,
            borderRadius: 'var(--radius-lg, 6px)',
            padding: 16,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            boxShadow: selectedStage === '' ? '0 0 0 1px var(--brand-primary, #FACC15)' : 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: selectedStage === '' ? 'var(--brand-primary, #FACC15)' : 'var(--muted-foreground, #A1A1AA)',
              }}
            >
              ALL LEADS
            </span>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: 'var(--foreground, #FAFAFA)' }}>
            {initialLeads.length}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted-foreground, #A1A1AA)', marginTop: 2 }}>
            {selectedStage === '' ? '● Active Filter' : 'Click to show all'}
          </div>
        </article>

        {/* 5 Stage Summary Cards */}
        {stageCounts.map(({ stage, count }) => {
          const isActive = selectedStage === stage;
          const color = STAGE_COLORS[stage as BrandLeadStage] ?? '#A1A1AA';
          return (
            <article
              key={stage}
              onClick={() => setSelectedStage(isActive ? '' : stage)}
              style={{
                background: 'var(--card, #0A0A0A)',
                border: `1px solid ${isActive ? color : 'var(--border, #272727)'}`,
                borderRadius: 'var(--radius-lg, 6px)',
                padding: 16,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: isActive ? `0 0 0 1px ${color}` : 'none',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: isActive ? color : 'var(--muted-foreground, #A1A1AA)',
                  }}
                >
                  {stage}
                </span>
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
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: 'var(--foreground, #FAFAFA)' }}>
                {count}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted-foreground, #A1A1AA)', marginTop: 2 }}>
                {isActive ? '● Active Filter' : 'Click to filter'}
              </div>
            </article>
          );
        })}
      </section>

      {/* Main Working Surface Panel */}
      <section className={styles.panel} style={{ marginTop: 20, borderRadius: 'var(--radius-lg, 6px)' }}>
        {/* Panel Header Toolbar */}
        <div
          className={styles.panelHead}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 20px',
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Lead Working Surface</h2>
            <span className={styles.pill} style={{ fontSize: 11 }}>
              {selectedStage || 'ALL'} · {filteredLeads.length} visible
            </span>
          </div>

          {/* Search + View Mode Segmented Control */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Search Input */}
            <input
              type="search"
              placeholder="Search by name, email, phone…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                height: 36,
                padding: '0 12px',
                borderRadius: 'var(--radius-md, 4px)',
                border: '1px solid var(--border, #272727)',
                background: 'var(--background, #000000)',
                color: 'var(--foreground, #FAFAFA)',
                fontSize: 13,
                minWidth: 260,
              }}
            />

            {/* View Mode Switcher */}
            <div
              style={{
                display: 'flex',
                background: 'var(--muted, #171717)',
                padding: 3,
                borderRadius: 'var(--radius-md, 4px)',
                border: '1px solid var(--border, #272727)',
              }}
            >
              <button
                type="button"
                onClick={() => setViewMode('list')}
                style={{
                  height: 30,
                  padding: '0 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 3,
                  border: 'none',
                  background: viewMode === 'list' ? 'var(--brand-primary, #FACC15)' : 'transparent',
                  color: viewMode === 'list' ? '#000000' : 'var(--muted-foreground, #A1A1AA)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                List View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('board')}
                style={{
                  height: 30,
                  padding: '0 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 3,
                  border: 'none',
                  background: viewMode === 'board' ? 'var(--brand-primary, #FACC15)' : 'transparent',
                  color: viewMode === 'board' ? '#000000' : 'var(--muted-foreground, #A1A1AA)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Board View
              </button>
            </div>
          </div>
        </div>

        {/* Content Views */}
        {filteredLeads.length === 0 ? (
          <div className={styles.empty} style={{ padding: '56px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground, #FAFAFA)', margin: '0 0 6px' }}>
              No leads visible
            </p>
            <p style={{ fontSize: 13, color: 'var(--muted-foreground, #A1A1AA)', margin: '0 0 20px' }}>
              {searchQuery
                ? `No matching leads found for "${searchQuery}"`
                : `No leads currently in stage ${selectedStage || 'ALL'}`}
            </p>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className={styles.button}
              style={{ height: 36, padding: '0 16px', borderRadius: 'var(--radius-md, 4px)', fontSize: 13 }}
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
                  <th>Action</th>
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
                      <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>
                        {lead.contactName ?? lead.title}
                      </strong>
                      {lead.contactEmail ? (
                        <>
                          <br />
                          <small style={{ color: 'var(--muted-foreground, #A1A1AA)' }}>{lead.contactEmail}</small>
                        </>
                      ) : null}
                      {lead.contactPhone ? (
                        <>
                          <br />
                          <small style={{ color: 'var(--muted-foreground, #A1A1AA)' }}>{lead.contactPhone}</small>
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
                    <td style={{ color: 'var(--muted-foreground, #A1A1AA)', fontSize: 12 }}>
                      {new Date(lead.createdAt).toLocaleDateString()}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setSelectedLead(lead)}
                        className={styles.secondaryButton}
                        style={{ height: 30, fontSize: 12, padding: '0 12px', borderRadius: 4 }}
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
                    background: 'var(--card, #0A0A0A)',
                    border: '1px solid var(--border, #272727)',
                    borderRadius: 'var(--radius-lg, 6px)',
                    display: 'flex',
                    flexDirection: 'column',
                    maxHeight: 700,
                  }}
                >
                  {/* Column Header */}
                  <div
                    style={{
                      padding: '12px 14px',
                      borderBottom: '1px solid var(--border, #272727)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: 'var(--background, #000000)',
                      borderRadius: '5px 5px 0 0',
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

                  {/* Column Cards */}
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
                          color: 'var(--muted-foreground, #A1A1AA)',
                          border: '1px dashed var(--border, #272727)',
                          borderRadius: 4,
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
                            background: 'var(--background, #000000)',
                            border: '1px solid var(--border, #272727)',
                            borderRadius: 4,
                            padding: 12,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--brand-primary, #FACC15)')}
                          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border, #272727)')}
                        >
                          <strong
                            style={{
                              fontSize: 13,
                              color: 'var(--foreground, #FAFAFA)',
                              display: 'block',
                              marginBottom: 4,
                            }}
                          >
                            {lead.contactName ?? lead.title}
                          </strong>
                          {lead.contactEmail ? (
                            <p style={{ fontSize: 11, color: 'var(--muted-foreground, #A1A1AA)', margin: '0 0 6px' }}>
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
                              borderTop: '1px solid var(--border, #272727)',
                              fontSize: 11,
                            }}
                          >
                            <span style={{ color: 'var(--brand-primary, #FACC15)', fontWeight: 600 }}>
                              {lead.amountMinorUnits == null
                                ? '—'
                                : `${lead.currency} ${(lead.amountMinorUnits / 100).toFixed(2)}`}
                            </span>
                            <span style={{ color: 'var(--muted-foreground, #A1A1AA)' }}>
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

      {/* Translucent Backdrop Blur Overlay */}
      {isCreateOpen ? (
        <div
          onClick={() => setIsCreateOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: 99,
            transition: 'opacity 0.2s ease',
          }}
          aria-hidden="true"
        />
      ) : null}

      {/* Slide-over Drawer Modal for Create Lead */}
      <MotionDrawer
        open={isCreateOpen}
        side="right"
        style={{
          width: '100%',
          maxWidth: 540,
          background: 'var(--card, #0A0A0A)',
          borderLeft: '1px solid var(--border, #272727)',
          borderRadius: 'var(--radius-xl, 8px) 0 0 var(--radius-xl, 8px)',
          boxShadow: '-12px 0 32px rgba(0, 0, 0, 0.8)',
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
            borderBottom: '1px solid var(--border, #272727)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--background, #000000)',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--foreground, #FAFAFA)' }}>
            Create New Lead
          </h2>
          <button
            type="button"
            onClick={() => setIsCreateOpen(false)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-md, 4px)',
              color: 'var(--muted-foreground, #A1A1AA)',
              fontSize: 16,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label="Close drawer"
          >
            ✕
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
