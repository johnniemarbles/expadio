'use client';

import { useState } from 'react';

export interface SSEEvent {
  readonly type: string;
  readonly missionId?: string;
  readonly taskId?: string;
  readonly timestamp: string;
  readonly message?: string;
  readonly title?: string;
  readonly toolName?: string;
  readonly result?: unknown;
  readonly output?: unknown;
  readonly arguments?: unknown;
  readonly stagedChanges?: unknown;
}

export interface AgentLogProps {
  readonly events: readonly SSEEvent[];
  readonly className?: string;
}

function EventRow({ event }: { readonly event: SSEEvent }) {
  const [expanded, setExpanded] = useState(false);

  const messageText = typeof event.message === 'string'
    ? event.message
    : typeof event.title === 'string'
      ? event.title
      : event.type;

  const toolNameText = typeof event.toolName === 'string' ? event.toolName : undefined;
  const hasPayload = event.toolName !== undefined
    || event.result !== undefined
    || event.output !== undefined
    || event.stagedChanges !== undefined;
  const payloadData = event.result ?? event.output ?? event.arguments ?? event.stagedChanges;

  const time = new Date(event.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return (
    <div className="group border-b border-white/5 py-1.5 px-2 text-xs">
      <div
        className="flex items-center gap-2 cursor-pointer"
        onClick={() => hasPayload && setExpanded(!expanded)}
      >
        <span className="text-white/30 font-mono text-[10px]">{time}</span>
        <span className="font-semibold text-indigo-400">{event.type}</span>
        <span className="flex-1 text-white/80">{messageText}</span>
        {toolNameText && <span className="font-mono text-purple-400">{toolNameText}</span>}
      </div>
      {expanded && payloadData !== undefined && (
        <pre className="mt-2 p-2 rounded bg-black/50 text-[11px] text-white/60 overflow-x-auto font-mono">
          {JSON.stringify(payloadData, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AgentLog({ events, className }: AgentLogProps) {
  if (events.length === 0) {
    return (
      <div className={`py-8 text-center text-white/30 text-sm ${className ?? ''}`}>
        Waiting for agent activity...
      </div>
    );
  }

  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      {events.map((event, idx) => (
        <EventRow key={idx} event={event} />
      ))}
    </div>
  );
}
