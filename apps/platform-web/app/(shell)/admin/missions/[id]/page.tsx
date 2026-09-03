'use client';

import { useState } from 'react';
import { AgentLog, ApprovalCard, CommandBar, type SSEEvent } from '@expadio/ui';

export default function MissionDashboardPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const [events] = useState<SSEEvent[]>([]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center border-b border-white/10 pb-4">
        <div>
          <h1 className="text-xl font-bold text-white">Company Brain Control Plane</h1>
          <p className="text-xs text-white/50">Master Chief of Staff Executive Command & Mission Log</p>
        </div>
      </div>

      <CommandBar onMissionCreated={(missionId) => console.log('Created mission:', missionId)} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
        <div className="md:col-span-2 space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Agent Mission Activity Stream</h2>
            <AgentLog events={events} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Pending Governance Approvals</h2>
            <ApprovalCard
              approvalId="demo-approval"
              missionId="demo-mission"
              taskId="demo-task"
              title="Deploy Outbound Sales Agent Squad"
              description="Agent requires approval to dispatch 50 outbound communications via Twilio/Resend."
              stagedChanges={{ targetCount: 50, channels: ['EMAIL', 'SMS'] }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
