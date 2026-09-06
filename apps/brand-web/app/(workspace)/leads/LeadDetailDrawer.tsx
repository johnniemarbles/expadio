'use client';

import { useState } from 'react';
import { MotionDrawer } from '@expadio/ui';
import type { BrandLeadSummary, BrandLeadStage } from '../../../lib/brand-leads';
import { BRAND_LEAD_STAGES } from '../../../lib/brand-leads';
import styles from '../workspace.module.css';

interface LeadDetailDrawerProps {
  readonly lead: BrandLeadSummary | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly updateStageAction: (formData: FormData) => Promise<void>;
  readonly convertLeadAction: (formData: FormData) => Promise<void>;
}

export function LeadDetailDrawer({
  lead,
  isOpen,
  onClose,
  updateStageAction,
  convertLeadAction,
}: LeadDetailDrawerProps) {
  const [updatingStage, setUpdatingStage] = useState(false);
  const [converting, setConverting] = useState(false);

  if (!lead) return null;

  async function handleStageSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUpdatingStage(true);
    try {
      const formData = new FormData(e.currentTarget);
      await updateStageAction(formData);
    } finally {
      setUpdatingStage(false);
    }
  }

  async function handleConvertSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setConverting(true);
    try {
      const formData = new FormData(e.currentTarget);
      await convertLeadAction(formData);
      onClose();
    } finally {
      setConverting(false);
    }
  }

  return (
    <>
      {/* Translucent Backdrop Overlay with Blur */}
      {isOpen ? (
        <div
          onClick={onClose}
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

      <MotionDrawer
        open={isOpen}
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
        {/* Header */}
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
          <div>
            <span className={styles.pill} style={{ marginBottom: 6, display: 'inline-block' }}>
              {lead.stage}
            </span>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--foreground, #FAFAFA)' }}>
              {lead.contactName ?? lead.title}
            </h2>
            {lead.accountName ? (
              <p style={{ fontSize: 13, color: 'var(--muted-foreground, #A1A1AA)', margin: '4px 0 0' }}>
                Account: {lead.accountName}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
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

        {/* Body */}
        <div
          style={{
            padding: 24,
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          {/* Stage Management Bar */}
          <div
            style={{
              background: 'var(--background, #000000)',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-lg, 6px)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted-foreground, #A1A1AA)' }}>
              Lead Pipeline Stage
            </span>
            <form onSubmit={handleStageSubmit} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="hidden" name="leadId" value={lead.leadId} />
              <select
                name="stage"
                defaultValue={lead.stage}
                disabled={updatingStage}
                className={styles.secondaryButton}
                style={{ flex: 1, height: 36, borderRadius: 'var(--radius-md, 4px)' }}
              >
                {BRAND_LEAD_STAGES.map((s: BrandLeadStage) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={updatingStage}
                className={styles.secondaryButton}
                style={{ height: 36, padding: '0 16px', borderRadius: 'var(--radius-md, 4px)', whiteSpace: 'nowrap' }}
              >
                {updatingStage ? 'Updating…' : 'Update Stage'}
              </button>
            </form>

            {lead.stage !== 'LOST' && lead.stage !== 'WON' ? (
              <form onSubmit={handleConvertSubmit} style={{ marginTop: 4 }}>
                <input type="hidden" name="leadId" value={lead.leadId} />
                <button
                  type="submit"
                  disabled={converting}
                  className={styles.button}
                  style={{ width: '100%', height: 36, borderRadius: 'var(--radius-md, 4px)', justifyContent: 'center' }}
                >
                  {converting ? 'Converting…' : '✓ Convert Lead to Customer Account'}
                </button>
              </form>
            ) : null}
          </div>

          {/* Contact Details Card */}
          <div
            style={{
              background: 'var(--background, #000000)',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-lg, 6px)',
              padding: 16,
              display: 'grid',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted-foreground, #A1A1AA)' }}>
              Contact Information
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', display: 'block', fontSize: 11 }}>Email</span>
                <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>{lead.contactEmail ?? '—'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', display: 'block', fontSize: 11 }}>Phone</span>
                <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>{lead.contactPhone ?? '—'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', display: 'block', fontSize: 11 }}>First Name</span>
                <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>{lead.firstName ?? '—'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', display: 'block', fontSize: 11 }}>Last Name</span>
                <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>{lead.lastName ?? '—'}</strong>
              </div>
            </div>
          </div>

          {/* Interest & Deal Value */}
          <div
            style={{
              background: 'var(--background, #000000)',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-lg, 6px)',
              padding: 16,
              display: 'grid',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted-foreground, #A1A1AA)' }}>
              Interest & Deal Value
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', display: 'block', fontSize: 11 }}>Interest Type</span>
                <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>{lead.enquiryInterestType ?? '—'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', display: 'block', fontSize: 11 }}>Opportunity Type</span>
                <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>{lead.enquiryOpportunityType ?? '—'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', display: 'block', fontSize: 11 }}>Estimated Value</span>
                <strong style={{ color: 'var(--brand-primary, #FACC15)', fontSize: 15 }}>
                  {lead.amountMinorUnits == null ? '—' : `${lead.currency} ${(lead.amountMinorUnits / 100).toFixed(2)}`}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', display: 'block', fontSize: 11 }}>Source</span>
                <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>{lead.source ?? 'Manual'}</strong>
              </div>
            </div>
          </div>

          {/* Location & Metadata */}
          <div
            style={{
              background: 'var(--background, #000000)',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-lg, 6px)',
              padding: 16,
              display: 'grid',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted-foreground, #A1A1AA)' }}>
              Location & Timeline
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', display: 'block', fontSize: 11 }}>City</span>
                <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>{lead.city ?? '—'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', display: 'block', fontSize: 11 }}>Region / State</span>
                <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>{lead.regionOrState ?? '—'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', display: 'block', fontSize: 11 }}>Country</span>
                <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>{lead.countryCode ?? '—'}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', display: 'block', fontSize: 11 }}>Created</span>
                <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>
                  {new Date(lead.createdAt).toLocaleDateString()}
                </strong>
              </div>
            </div>
          </div>
        </div>
      </MotionDrawer>
    </>
  );
}
