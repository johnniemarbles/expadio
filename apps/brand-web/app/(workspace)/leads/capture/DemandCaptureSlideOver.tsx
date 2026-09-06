'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MotionDrawer } from '@expadio/ui';
import {
  DEMAND_CAPTURE_STAGES,
  DEMAND_CAPTURE_STATUSES,
  getTransitionRequirements,
  requiresCloseReason,
  requiresStageReason,
  requiresStatusReason,
} from '../../../../lib/demand-capture-governance';
import styles from '../../workspace.module.css';

export type CaptureLead = {
  captureLeadId: string;
  organizationId: string;
  sourceKey: string;
  surface: string;
  title: string | null;
  email: string | null;
  stage: string;
  operationalStatus: string;
  ownerSubjectId: string | null;
  stageEnteredAt: string;
  closeReasonCode: string | null;
  closedAt: string | null;
  projectedToCrm: boolean;
  createdAt: string;
  updatedAt: string;
};

interface DemandCaptureSlideOverProps {
  readonly lead: CaptureLead | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onRoute: (lead: CaptureLead) => Promise<void>;
  readonly onTransitionStage: (
    lead: CaptureLead,
    stage: string,
    reason?: string,
    closeReasonCode?: string
  ) => Promise<void>;
  readonly onTransitionStatus: (
    lead: CaptureLead,
    status: string,
    reason: string
  ) => Promise<void>;
  readonly workingId: string | null;
}

export function DemandCaptureSlideOver({
  lead,
  isOpen,
  onClose,
  onRoute,
  onTransitionStage,
  onTransitionStatus,
  workingId,
}: DemandCaptureSlideOverProps) {
  const [selectedStage, setSelectedStage] = useState<string>('');
  const [stageReason, setStageReason] = useState<string>('');
  const [closeReasonCode, setCloseReasonCode] = useState<string>('');

  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [statusReason, setStatusReason] = useState<string>('');

  const [isSubmittingStage, setIsSubmittingStage] = useState(false);
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false);

  // Sync state when lead changes or opens
  useEffect(() => {
    if (lead) {
      setSelectedStage(lead.stage);
      setStageReason('');
      setCloseReasonCode(lead.closeReasonCode ?? '');
      setSelectedStatus(lead.operationalStatus);
      setStatusReason('');
    }
  }, [lead]);

  if (!lead) return null;

  const isWorking = workingId === lead.captureLeadId;

  const transitionReqs = getTransitionRequirements(
    lead.stage,
    selectedStage,
    lead.operationalStatus,
    selectedStatus
  );

  const showStageReasonField = requiresStageReason(lead.stage, selectedStage);
  const showCloseReasonField = requiresCloseReason(selectedStage);
  const showStatusReasonField = requiresStatusReason(lead.operationalStatus, selectedStatus);

  const isStageChanged = selectedStage !== lead.stage;
  const isStatusChanged = selectedStatus !== lead.operationalStatus;

  async function handleStageSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lead || isWorking || isSubmittingStage) return;
    setIsSubmittingStage(true);
    try {
      await onTransitionStage(
        lead,
        selectedStage,
        stageReason.trim() || undefined,
        closeReasonCode.trim() || undefined
      );
    } finally {
      setIsSubmittingStage(false);
    }
  }

  async function handleStatusSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lead || isWorking || isSubmittingStatus) return;
    setIsSubmittingStatus(true);
    try {
      await onTransitionStatus(lead, selectedStatus, statusReason.trim());
    } finally {
      setIsSubmittingStatus(false);
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
            alignItems: 'flex-start',
            background: 'var(--background, #000000)',
          }}
        >
          <div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <span className={styles.pill}>{lead.stage}</span>
              <span className={styles.pill} style={{ opacity: 0.85 }}>{lead.operationalStatus}</span>
              {lead.projectedToCrm ? (
                <span className={styles.pill} style={{ background: 'color-mix(in srgb, var(--brand-primary, #FACC15) 15%, transparent)', color: 'var(--brand-primary, #FACC15)', border: '1px solid var(--brand-primary, #FACC15)' }}>
                  CRM LINKED
                </span>
              ) : null}
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--foreground, #FAFAFA)' }}>
              {lead.title || lead.email || 'Inbound Enquiry'}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--muted-foreground, #A1A1AA)', margin: '4px 0 0' }}>
              {lead.email || 'No email specified'} · ID: <code style={{ fontSize: 11 }}>{lead.captureLeadId.slice(0, 8)}</code>
            </p>
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
            gap: 24,
          }}
        >
          {/* Section A: Contact Details & Metadata */}
          <div
            style={{
              background: 'var(--background, #000000)',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-md, 6px)',
              padding: 16,
            }}
          >
            <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground, #A1A1AA)', margin: '0 0 12px' }}>
              Lead Identity & Origin
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', fontSize: 11, display: 'block' }}>Source Key</span>
                <strong>{lead.sourceKey}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', fontSize: 11, display: 'block' }}>Surface</span>
                <strong>{lead.surface}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', fontSize: 11, display: 'block' }}>Created At</span>
                <span>{new Date(lead.createdAt).toLocaleString()}</span>
              </div>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', fontSize: 11, display: 'block' }}>Stage Entered</span>
                <span>{new Date(lead.stageEnteredAt).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Section B: Governed Stage Management */}
          <form
            onSubmit={handleStageSubmit}
            style={{
              background: 'var(--background, #000000)',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-md, 6px)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground, #A1A1AA)', margin: 0 }}>
                Governed Journey Stage
              </h3>
              <span className={styles.pill}>{lead.stage}</span>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600 }}>
              Target Stage
              <select
                value={selectedStage}
                onChange={(e) => setSelectedStage(e.target.value)}
                disabled={isWorking || isSubmittingStage}
                style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md, 4px)',
                  border: '1px solid var(--border, #272727)',
                  background: 'var(--card, #0A0A0A)',
                  color: 'var(--foreground, #FAFAFA)',
                  fontSize: 13,
                }}
              >
                {DEMAND_CAPTURE_STAGES.map((stg) => (
                  <option key={stg} value={stg}>
                    {stg}
                  </option>
                ))}
              </select>
            </label>

            {/* Progressive Disclosure: Stage Reason */}
            {showStageReasonField && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600 }}>
                Transition Reason *
                <textarea
                  value={stageReason}
                  onChange={(e) => setStageReason(e.target.value)}
                  placeholder={transitionReqs.stageReasonPlaceholder}
                  required
                  rows={2}
                  maxLength={1000}
                  disabled={isWorking || isSubmittingStage}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md, 4px)',
                    border: '1px solid var(--brand-primary, #FACC15)',
                    background: 'var(--card, #0A0A0A)',
                    color: 'var(--foreground, #FAFAFA)',
                    fontSize: 13,
                    resize: 'vertical',
                  }}
                />
              </label>
            )}

            {/* Progressive Disclosure: Close Reason Code for Terminal Stages */}
            {showCloseReasonField && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600 }}>
                Close Reason Code *
                <input
                  type="text"
                  value={closeReasonCode}
                  onChange={(e) => setCloseReasonCode(e.target.value)}
                  placeholder={transitionReqs.closeReasonPlaceholder}
                  required
                  maxLength={120}
                  disabled={isWorking || isSubmittingStage}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md, 4px)',
                    border: '1px solid var(--brand-primary, #FACC15)',
                    background: 'var(--card, #0A0A0A)',
                    color: 'var(--foreground, #FAFAFA)',
                    fontSize: 13,
                  }}
                />
              </label>
            )}

            <button
              type="submit"
              disabled={!isStageChanged || isWorking || isSubmittingStage}
              className={styles.button}
              style={{ padding: '8px 16px', fontSize: 13, alignSelf: 'flex-start', marginTop: 4 }}
            >
              {isSubmittingStage ? 'Updating stage…' : 'Save Stage Transition'}
            </button>
          </form>

          {/* Section C: Operational Status Management */}
          <form
            onSubmit={handleStatusSubmit}
            style={{
              background: 'var(--background, #000000)',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-md, 6px)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground, #A1A1AA)', margin: 0 }}>
                Operational Status
              </h3>
              <span className={styles.pill}>{lead.operationalStatus}</span>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600 }}>
              Target Operational Status
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                disabled={isWorking || isSubmittingStatus}
                style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md, 4px)',
                  border: '1px solid var(--border, #272727)',
                  background: 'var(--card, #0A0A0A)',
                  color: 'var(--foreground, #FAFAFA)',
                  fontSize: 13,
                }}
              >
                {DEMAND_CAPTURE_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </label>

            {/* Progressive Disclosure: Operational Status Reason */}
            {showStatusReasonField && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, fontWeight: 600 }}>
                Status Reason *
                <textarea
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  placeholder={transitionReqs.statusReasonPlaceholder}
                  required
                  rows={2}
                  maxLength={1000}
                  disabled={isWorking || isSubmittingStatus}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md, 4px)',
                    border: '1px solid var(--brand-primary, #FACC15)',
                    background: 'var(--card, #0A0A0A)',
                    color: 'var(--foreground, #FAFAFA)',
                    fontSize: 13,
                    resize: 'vertical',
                  }}
                />
              </label>
            )}

            <button
              type="submit"
              disabled={!isStatusChanged || isWorking || isSubmittingStatus}
              className={styles.button}
              style={{ padding: '8px 16px', fontSize: 13, alignSelf: 'flex-start', marginTop: 4 }}
            >
              {isSubmittingStatus ? 'Updating status…' : 'Save Operational Status'}
            </button>
          </form>

          {/* Section D: Ownership & Routing */}
          <div
            style={{
              background: 'var(--background, #000000)',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-md, 6px)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground, #A1A1AA)', margin: 0 }}>
              Ownership & Routing Governance
            </h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
              <div>
                <span style={{ color: 'var(--muted-foreground, #A1A1AA)', fontSize: 11, display: 'block' }}>Current Owner</span>
                {lead.ownerSubjectId ? (
                  <strong>{lead.ownerSubjectId}</strong>
                ) : (
                  <span className={styles.pill} style={{ background: '#3F3F46', color: '#FAFAFA' }}>UNASSIGNED</span>
                )}
              </div>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void onRoute(lead)}
                disabled={isWorking}
                style={{ padding: '8px 14px', fontSize: 12 }}
              >
                {isWorking ? 'Routing…' : 'Route Lead Now'}
              </button>
            </div>
          </div>

          {/* Section E: CRM Projection Linkage */}
          <div
            style={{
              background: 'var(--background, #000000)',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-md, 6px)',
              padding: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted-foreground, #A1A1AA)', margin: 0 }}>
                CRM Projection Status
              </h3>
              <p style={{ fontSize: 13, margin: '4px 0 0', color: 'var(--foreground, #FAFAFA)' }}>
                {lead.projectedToCrm ? 'Active commercial lead in sales pipeline.' : 'Capture engine record only.'}
              </p>
            </div>
            <Link href="/leads" className={styles.secondaryButton} style={{ padding: '6px 12px', fontSize: 12 }}>
              Open CRM Pipeline →
            </Link>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border, #272727)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 12,
            background: 'var(--background, #000000)',
          }}
        >
          <button
            type="button"
            className={styles.button}
            onClick={onClose}
            style={{ padding: '8px 24px', fontSize: 13 }}
          >
            Done
          </button>
        </div>
      </MotionDrawer>
    </>
  );
}
