import React from 'react';

/**
 * A directory of the governance oversight tools, so the growing suite is
 * discoverable from the Governance Center rather than only via the nav. Pure
 * static navigation — each card links to a tool and says, in one line, the
 * question it answers.
 */

const TOOLS: { href: string; title: string; blurb: string }[] = [
  { href: '/governance/queue', title: 'My review queue', blurb: 'What is waiting on me to act, across every vertical.' },
  { href: '/governance/pending', title: 'Pending review load', blurb: 'What is waiting on anyone — and who is the bottleneck.' },
  { href: '/governance/workflows', title: 'In-flight workflows', blurb: 'Every open governed process and the stage it sits at.' },
  { href: '/governance/decisions', title: 'Governed decisions', blurb: 'The append-only log of who approved what, with evidence.' },
  { href: '/governance/analytics', title: 'Decision analytics', blurb: 'Approval rate and time to decision, per vertical.' },
  { href: '/governance/authorization', title: 'Auth inspector', blurb: 'Trace how an authorization decision is reached, gate by gate.' },
  { href: '/governance/domain-events', title: 'Domain Event delivery', blurb: 'Inspect retries, failures and terminal dead letters — and requeue with audit evidence.' },
];

const card: React.CSSProperties = {
  border: '1px solid var(--line, #e2e8f0)', borderRadius: "var(--theme-radius-card)", padding: '14px 16px',
  background: 'var(--surface, #fff)', textDecoration: 'none', color: 'inherit', display: 'block',
};

export function GovernanceToolsDirectory() {
  return (
    <section aria-label="Oversight tools" style={{ margin: '0 0 20px' }}>
      <p style={{ fontSize: 11, color: 'var(--ink-500, #64748b)', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, margin: '0 0 10px' }}>
        Oversight tools
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {TOOLS.map((t) => (
          <a key={t.href} href={t.href} style={card}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t.title}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-600, #475569)', lineHeight: 1.4 }}>{t.blurb}</div>
          </a>
        ))}
      </div>
    </section>
  );
}
