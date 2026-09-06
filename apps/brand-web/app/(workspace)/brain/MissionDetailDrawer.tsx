'use client';

import { FormEvent, useState } from 'react';
import { MotionDrawer } from '@expadio/ui';

interface MissionDetailDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onMissionDispatched?: () => void;
}

export function MissionDetailDrawer({
  isOpen,
  onClose,
  onMissionDispatched,
}: MissionDetailDrawerProps) {
  const [intent, setIntent] = useState('');
  const [selectedTool, setSelectedTool] = useState('ops-admin-1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleDispatch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!intent.trim() || busy) return;

    setError(null);
    setBusy(true);

    try {
      const res = await fetch('/api/brain/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: intent.trim(),
          taskPlans:
            selectedTool !== 'ops-admin-1'
              ? [
                  {
                    assignedAgentId: 'agent-stub',
                    title: `Execute ${selectedTool}`,
                    description: intent.trim(),
                    actionPayload: { toolKey: selectedTool },
                  },
                ]
              : undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to dispatch mission');

      setIntent('');
      onMissionDispatched?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dispatch error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          zIndex: 99,
        }}
      />

      <MotionDrawer
        open={isOpen}
        side="right"
        style={{
          width: '100%',
          maxWidth: 640,
          background: 'var(--card, #0A0A0A)',
          borderLeft: '1px solid var(--border, #272727)',
          borderRadius: 'var(--radius-xl, 8px) 0 0 var(--radius-xl, 8px)',
          boxShadow: '-12px 0 32px rgba(0, 0, 0, 0.85)',
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
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--border, #272727)',
            background: 'var(--background, #000000)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--brand-primary, #FACC15)',
              }}
            >
              GOVERNED EXECUTIVE AGENT
            </span>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--foreground, #FAFAFA)' }}>
              Spawn Autonomous Mission
            </h2>
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
          >
            ✕
          </button>
        </div>

        {error && (
          <div
            style={{
              margin: '16px 24px 0',
              padding: '12px 14px',
              borderRadius: 'var(--radius-md, 4px)',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid #EF4444',
              color: '#F87171',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleDispatch} style={{ padding: 24, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
            Executive Intent & Objectives *
            <textarea
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              required
              rows={4}
              placeholder="e.g. Audit brand communications SLA, evaluate lead score distribution, and flag high-value unassigned opportunities..."
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-md, 4px)',
                border: '1px solid var(--border, #272727)',
                background: 'var(--background, #000000)',
                color: 'var(--foreground, #FAFAFA)',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
            Target Agent Capability
            <select
              value={selectedTool}
              onChange={(e) => setSelectedTool(e.target.value)}
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-md, 4px)',
                border: '1px solid var(--border, #272727)',
                background: 'var(--background, #000000)',
                color: 'var(--foreground, #FAFAFA)',
                fontSize: 13,
              }}
            >
              <option value="ops-admin-1">Default Ops Admin (General Execution)</option>
              <option value="content.editorial.debate">Editorial Debate & Content Quality</option>
              <option value="revenue.lead.osint">Lead OSINT & Firmographic Enrichment</option>
              <option value="revenue.outreach.draft_sequence">Outreach Sequence Generation</option>
              <option value="voice.callback.prepare">Voice Callback Preparation</option>
            </select>
          </label>

          <div
            style={{
              padding: 14,
              borderRadius: 'var(--radius-md, 6px)',
              background: 'var(--background, #000000)',
              border: '1px solid var(--border, #272727)',
              fontSize: 12,
              color: 'var(--muted-foreground, #A1A1AA)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>Governance & Verification Contract:</strong>
            <span>• Missions execute within your organization boundary.</span>
            <span>• High-impact state modifications require human-in-the-loop approval.</span>
            <span>• All task outputs produce evidence observations logged to Brand Brain.</span>
          </div>

          <button
            type="submit"
            disabled={busy || !intent.trim()}
            style={{
              marginTop: 12,
              height: 40,
              fontSize: 13,
              fontWeight: 700,
              borderRadius: 'var(--radius-md, 4px)',
              background: 'var(--brand-primary, #FACC15)',
              color: '#000000',
              border: 'none',
              cursor: busy || !intent.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Spawning Mission...' : 'Dispatch Mission →'}
          </button>
        </form>
      </MotionDrawer>
    </>
  );
}
