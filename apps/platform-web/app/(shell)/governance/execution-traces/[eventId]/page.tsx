import type React from 'react';
import { DeniedState } from '@expadio/ui';
import { isDenied } from '@expadio/ui/contracts';
import { fetchApi } from '../../../../../lib/live-adapter';
import type { ExecutionTrace } from '../../../../../lib/execution-trace';

function fmt(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—';
}

function Badge({ value }: { value: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 8px',
      borderRadius: 999,
      background: '#f1f5f9',
      color: '#334155',
      fontSize: 11,
      fontWeight: 800,
    }}>
      {value}
    </span>
  );
}

export default async function ExecutionTracePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const eventId = decodeURIComponent((await params).eventId);
  const trace = await fetchApi<ExecutionTrace>(
    `/api/governance/execution-traces/${encodeURIComponent(eventId)}`,
  );
  if (isDenied(trace)) return <DeniedState result={trace} />;

  return (
    <main style={{ display: 'grid', gap: 18 }}>
      <section>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.08em', color: '#6366f1' }}>
          Governance · execution trace
        </p>
        <h1 style={{ margin: '5px 0 6px' }}>{trace.event.eventType}</h1>
        <p style={{ margin: 0, color: '#64748b', maxWidth: 900 }}>
          Decision → Action → Outcome evidence for one immutable Domain Event. This view is derived from the event, governed actions and capability execution records.
        </p>
      </section>

      <section style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, background: '#fff' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <Badge value={trace.event.outbox?.status ?? 'NO_OUTBOX'} />
          {trace.event.packKey ? <Badge value={trace.event.packKey} /> : null}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12, fontSize: 12 }}>
          <Field label="Event ID" value={trace.event.eventId} mono />
          <Field label="Correlation" value={trace.event.correlationId} mono />
          <Field label="Aggregate" value={`${trace.event.aggregateType} · ${trace.event.aggregateId}`} mono />
          <Field label="Occurred" value={fmt(trace.event.occurredAt)} />
          <Field label="Outbox attempts" value={String(trace.event.outbox?.attempts ?? 0)} />
          <Field label="Published" value={fmt(trace.event.outbox?.publishedAt ?? null)} />
        </div>
        {trace.event.outbox?.lastError ? (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 12 }}>
            {trace.event.outbox.lastError}
          </div>
        ) : null}
      </section>

      <section>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Governed actions</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {trace.actions.map((action) => (
            <article key={action.actionIntentId} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <strong>{action.actionKey}</strong>
                  <div style={{ color: '#64748b', fontSize: 12 }}>{action.ruleKey}</div>
                </div>
                <Badge value={action.executorClass} />
              </div>
              <div style={{ marginTop: 9, fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                intent {action.actionIntentId} · caused by {action.causationId}
              </div>
              <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                {action.attempts.map((attempt) => (
                  <div key={attempt.executionAttemptId} style={{ padding: 9, borderRadius: 8, background: '#f8fafc', fontSize: 12 }}>
                    <strong>{attempt.status}</strong> · {attempt.reasonCode}
                    {attempt.outputReference ? <span> · {attempt.outputReference}</span> : null}
                  </div>
                ))}
                {action.attempts.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 12 }}>No execution attempt recorded yet.</div> : null}
              </div>
            </article>
          ))}
          {trace.actions.length === 0 ? <Empty text="No governed actions were materialized for this event." /> : null}
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14 }}>
        <TraceGroup title="Scheduled outcomes" empty="No scheduled outcomes.">
          {trace.schedules.map((schedule) => (
            <TraceRow key={schedule.scheduledActionId}
              title={`Due ${fmt(schedule.dueAt)}`}
              status={schedule.state}
              detail={schedule.childActionIntentId
                ? `child intent ${schedule.childActionIntentId}`
                : schedule.lastReasonCode ?? 'Awaiting due execution'}
            />
          ))}
        </TraceGroup>

        <TraceGroup title="Operational tasks" empty="No operational tasks.">
          {trace.tasks.map((task) => (
            <TraceRow key={task.taskId}
              title={task.title}
              status={task.status}
              detail={`${task.priority} · ${task.assigneeSubjectId ?? 'Unassigned'}`}
            />
          ))}
        </TraceGroup>
      </section>

      <section>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>External capability outcomes</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {trace.deliveries.map((delivery) => (
            <article key={delivery.deliveryId} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <strong>{delivery.connectorKey}</strong>
                  <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{delivery.deliveryId}</div>
                </div>
                <Badge value={delivery.state} />
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
                Adapter {delivery.adapterKey} · attempts {delivery.attemptCount}
                {delivery.providerMessageId ? ` · provider message ${delivery.providerMessageId}` : ''}
              </div>
              {delivery.providerAttempts.map((attempt) => (
                <div key={attempt.providerAttemptId} style={{ marginTop: 8, padding: 9, background: '#f8fafc', borderRadius: 8, fontSize: 12 }}>
                  <strong>{attempt.providerKey}</strong> · {attempt.outcome} · {attempt.reasonCode}
                </div>
              ))}
            </article>
          ))}
          {trace.deliveries.length === 0 ? <Empty text="No external delivery has been created for this event yet." /> : null}
        </div>
      </section>
    </main>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ color: '#94a3b8', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ marginTop: 3, fontFamily: mono ? 'monospace' : undefined, overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  );
}

function TraceGroup({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section>
      <h2 style={{ fontSize: 16, marginBottom: 10 }}>{title}</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {hasChildren ? children : <Empty text={empty} />}
      </div>
    </section>
  );
}

function TraceRow({ title, status, detail }: { title: string; status: string; detail: string }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 13, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <Badge value={status} />
      </div>
      <div style={{ marginTop: 5, color: '#64748b', fontSize: 12, overflowWrap: 'anywhere' }}>{detail}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ padding: 14, color: '#64748b', border: '1px dashed #cbd5e1', borderRadius: 10, fontSize: 12 }}>{text}</div>;
}
