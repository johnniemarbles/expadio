'use client';

import { useState } from 'react';

export interface ApprovalCardProps {
  readonly approvalId: string;
  readonly missionId: string;
  readonly taskId: string;
  readonly title: string;
  readonly description: string;
  readonly stagedChanges?: unknown;
  readonly onResolved?: (approved: boolean) => void;
}

export function ApprovalCard({
  approvalId,
  missionId,
  title,
  description,
  stagedChanges,
  onResolved,
}: ApprovalCardProps) {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [resolved, setResolved] = useState<boolean | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  async function handleAction(approved: boolean) {
    setLoading(approved ? 'approve' : 'reject');
    try {
      const res = await fetch(`/api/agent/missions/${missionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, approvalId }),
      });
      if (!res.ok) throw new Error('Failed to submit approval');
      setResolved(approved);
      onResolved?.(approved);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(null);
    }
  }

  if (resolved !== null) {
    return (
      <div className={`rounded-xl border p-4 flex items-center gap-3 ${
        resolved ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400' : 'border-red-500/30 bg-red-500/5 text-red-400'
      }`}>
        <div>
          <p className="text-sm font-medium">
            {resolved ? 'Approved — task executing' : 'Rejected — task cancelled'}
          </p>
          <p className="text-xs text-white/40 mt-0.5">{title}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden p-4 space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">Approval Required</p>
        <p className="text-sm font-semibold text-white mt-1">{title}</p>
        <p className="text-xs text-white/60 mt-1">{description}</p>
      </div>

      {stagedChanges !== undefined && (
        <div className="border-t border-amber-500/20 pt-2">
          <button
            onClick={() => setShowDiff(!showDiff)}
            className="text-xs text-amber-400/80 hover:text-amber-300 transition-colors"
          >
            {showDiff ? 'Hide staged action' : 'View staged action'}
          </button>
          {showDiff && (
            <pre className="mt-2 p-2 rounded text-xs text-white/60 font-mono bg-black/40 overflow-x-auto">
              {JSON.stringify(stagedChanges, null, 2)}
            </pre>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          onClick={() => handleAction(true)}
          disabled={loading !== null}
          className="flex-1 rounded-lg bg-emerald-600 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
        >
          {loading === 'approve' ? 'Approving...' : 'Approve'}
        </button>
        <button
          onClick={() => handleAction(false)}
          disabled={loading !== null}
          className="flex-1 rounded-lg border border-red-500/30 bg-red-500/10 py-2 text-xs font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
        >
          {loading === 'reject' ? 'Rejecting...' : 'Reject'}
        </button>
      </div>
    </div>
  );
}
