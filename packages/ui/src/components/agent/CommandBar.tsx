'use client';

import { useState, type FormEvent } from 'react';

export interface CommandBarProps {
  readonly onMissionCreated: (missionId: string) => void;
  readonly tenantId?: string;
}

export function CommandBar({ onMissionCreated, tenantId = 'expadio' }: CommandBarProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const examples = [
    'Review all open PRs on the Expadio repo and summarize',
    'Analyze our last 30 days of data and create an executive summary',
    'Draft follow-up emails for the 3 most recent leads',
    'Audit the codebase for security vulnerabilities',
  ];

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/agent/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: input.trim(), tenantId, userId: 'admin-001' }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Failed to process command');
      }

      const { missionId } = (await res.json()) as { missionId: string };
      onMissionCreated(missionId);
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full space-y-3">
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative flex items-end gap-2 rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-sm focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/30 transition-all">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit(e);
              }
            }}
            placeholder="What do you need done? e.g. Review open PRs, summarize leads, audit security..."
            rows={2}
            className="flex-1 resize-none bg-transparent text-white placeholder-white/30 text-sm focus:outline-none leading-relaxed"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="flex-shrink-0 flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Planning...' : 'Execute'}
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {examples.map((ex) => (
          <button
            key={ex}
            onClick={() => setInput(ex)}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/50 hover:text-white/80 hover:border-white/20 transition-all"
          >
            {ex.length > 45 ? ex.slice(0, 45) + '…' : ex}
          </button>
        ))}
      </div>
    </div>
  );
}
