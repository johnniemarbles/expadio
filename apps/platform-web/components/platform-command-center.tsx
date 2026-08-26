"use client";

import { useMemo, useState } from "react";
import type {
  CapabilitySummary,
  PlatformOverview,
  ReviewItem,
} from "../lib/contracts";

const sections = [
  { id: "overview", label: "Overview", short: "OV" },
  { id: "organizations", label: "Organizations", short: "OR" },
  { id: "capabilities", label: "Capabilities", short: "CA" },
  { id: "brain", label: "Company Brain", short: "CB" },
  { id: "governance", label: "Governance", short: "GO" },
  { id: "audit", label: "Audit", short: "AU" },
] as const;

type SectionId = (typeof sections)[number]["id"];

function StatePill({ state }: Pick<CapabilitySummary, "state">) {
  return <span className={`state state--${state.toLowerCase()}`}>{state}</span>;
}

function RiskBadge({ risk }: Pick<ReviewItem, "risk">) {
  return <span className={`risk risk--${risk.toLowerCase()}`}>{risk}</span>;
}

function CapabilityTable({
  capabilities,
  query,
}: {
  capabilities: CapabilitySummary[];
  query: string;
}) {
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return capabilities;
    return capabilities.filter((capability) =>
      [capability.name, capability.kind, capability.scope, capability.state]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [capabilities, query]);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Capability</th>
            <th>Type</th>
            <th>Scope</th>
            <th>Status</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((capability) => (
            <tr key={capability.id}>
              <td>
                <span className="capability-name">{capability.name}</span>
                <span className="version">{capability.version}</span>
              </td>
              <td>{capability.kind}</td>
              <td>{capability.scope}</td>
              <td><StatePill state={capability.state} /></td>
              <td className="muted">{capability.updated}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 ? (
        <div className="empty-state">
          <strong>No capabilities match</strong>
          <span>Try a name, type, scope, or status.</span>
        </div>
      ) : null}
    </div>
  );
}

function ReviewQueue({ reviews }: { reviews: ReviewItem[] }) {
  return (
    <div className="review-list">
      {reviews.map((review) => (
        <article className="review-item" key={review.id}>
          <div className="review-icon" aria-hidden="true">{review.category.slice(0, 1)}</div>
          <div className="review-copy">
            <strong>{review.title}</strong>
            <span>{review.requestedBy} · {review.age}</span>
          </div>
          <RiskBadge risk={review.risk} />
        </article>
      ))}
    </div>
  );
}

export function PlatformCommandCenter({
  overview,
}: {
  overview: PlatformOverview;
}) {
  const [activeSection, setActiveSection] = useState<SectionId>("overview");
  const [query, setQuery] = useState("");
  const current = sections.find((section) => section.id === activeSection) ?? sections[0];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">E</span>
          <span>
            <strong>EXPADIO</strong>
            <small>Platform</small>
          </span>
        </div>

        <nav className="primary-nav" aria-label="Platform sections">
          <p className="nav-label">Workspace</p>
          {sections.map((section) => (
            <button
              className={activeSection === section.id ? "nav-item nav-item--active" : "nav-item"}
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              type="button"
              aria-current={activeSection === section.id ? "page" : undefined}
            >
              <span className="nav-icon" aria-hidden="true">{section.short}</span>
              <span>{section.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="system-status">
            <span className="status-light" aria-hidden="true" />
            <span><strong>Systems healthy</strong><small>All gateways operational</small></span>
          </div>
          <button className="account-card" type="button" aria-label="Open account menu">
            <span className="avatar">JM</span>
            <span><strong>Johnnie Marbles</strong><small>Platform owner</small></span>
            <span aria-hidden="true">···</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="mobile-menu" type="button" aria-label="Open navigation">☰</button>
          <div className="breadcrumb">
            <span>Platform</span>
            <span aria-hidden="true">/</span>
            <strong>{current.label}</strong>
          </div>
          <div className="topbar-actions">
            <span className="source-pill">
              <span className="source-dot" aria-hidden="true" />
              {overview.source.label}
            </span>
            <button className="icon-button" type="button" aria-label="Notifications">
              <span aria-hidden="true">◎</span>
              <span className="notification-dot" />
            </button>
          </div>
        </header>

        <div className="content">
          <section className="page-heading" aria-labelledby="page-title">
            <div>
              <p className="eyebrow">Command center</p>
              <h1 id="page-title">{current.label}</h1>
              <p>
                {activeSection === "overview"
                  ? "A governed view of your organizations, capabilities, and company knowledge."
                  : `Manage ${current.label.toLowerCase()} within the active organization scope.`}
              </p>
            </div>
            <label className="scope-select">
              <span>Active organization</span>
              <select defaultValue={overview.organization.id} aria-label="Active organization">
                <option value={overview.organization.id}>{overview.organization.name}</option>
              </select>
            </label>
          </section>

          <div className="provenance-note" role="status">
            <span><strong>{overview.source.label}</strong> · {overview.source.capturedAt}</span>
            <span>Live API adapter is the next integration step.</span>
          </div>

          {(activeSection === "overview" || activeSection === "organizations") ? (
            <section className="metric-grid" aria-label="Workspace metrics">
              {overview.metrics.map((metric) => (
                <article className="metric-card" key={metric.label}>
                  <div className="metric-top">
                    <span>{metric.label}</span>
                    <span className={`tone-dot tone-dot--${metric.tone}`} aria-hidden="true" />
                  </div>
                  <strong>{metric.value}</strong>
                  <small>{metric.detail}</small>
                </article>
              ))}
            </section>
          ) : null}

          {activeSection === "overview" ? (
            <>
              <div className="dashboard-grid">
                <section className="panel panel--wide" aria-labelledby="capabilities-title">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Capability fabric</p>
                      <h2 id="capabilities-title">Recently changed</h2>
                    </div>
                    <button className="text-button" type="button" onClick={() => setActiveSection("capabilities")}>
                      View all <span aria-hidden="true">→</span>
                    </button>
                  </div>
                  <CapabilityTable capabilities={overview.capabilities.slice(0, 3)} query="" />
                </section>

                <section className="panel" aria-labelledby="review-title">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Human review</p>
                      <h2 id="review-title">Decision queue</h2>
                    </div>
                    <span className="count-badge">{overview.reviews.length}</span>
                  </div>
                  <ReviewQueue reviews={overview.reviews} />
                </section>
              </div>

              <section className="panel activity-panel" aria-labelledby="activity-title">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Traceability</p>
                    <h2 id="activity-title">Latest governed activity</h2>
                  </div>
                  <button className="text-button" type="button" onClick={() => setActiveSection("audit")}>
                    Open audit <span aria-hidden="true">→</span>
                  </button>
                </div>
                <div className="activity-list">
                  {overview.activity.map((item) => (
                    <article key={item.id}>
                      <span className="activity-node" aria-hidden="true" />
                      <p><strong>{item.actor}</strong> {item.action} <b>{item.target}</b></p>
                      <time>{item.time}</time>
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          {activeSection === "capabilities" ? (
            <section className="panel" aria-labelledby="capability-catalog-title">
              <div className="panel-heading panel-heading--responsive">
                <div>
                  <p className="eyebrow">Published and in progress</p>
                  <h2 id="capability-catalog-title">Capability catalog</h2>
                </div>
                <label className="search-field">
                  <span className="sr-only">Filter capabilities</span>
                  <span aria-hidden="true">⌕</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter capabilities"
                  />
                </label>
              </div>
              <CapabilityTable capabilities={overview.capabilities} query={query} />
            </section>
          ) : null}

          {activeSection === "governance" ? (
            <section className="panel" aria-labelledby="governance-title">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Policy-controlled work</p>
                  <h2 id="governance-title">Review queue</h2>
                </div>
                <span className="count-badge">{overview.reviews.length}</span>
              </div>
              <ReviewQueue reviews={overview.reviews} />
            </section>
          ) : null}

          {activeSection === "brain" ? (
            <section className="split-grid">
              <article className="panel brain-card">
                <p className="eyebrow">Company Brain</p>
                <h2>Knowledge publication is traceable</h2>
                <p>Corrections move through review, publication, and indexing without replacing source evidence.</p>
                <dl>
                  <div><dt>Indexed sources</dt><dd>42</dd></div>
                  <div><dt>Pending corrections</dt><dd>3</dd></div>
                  <div><dt>Freshness target</dt><dd>24 hr</dd></div>
                </dl>
              </article>
              <article className="panel">
                <div className="panel-heading">
                  <div><p className="eyebrow">Knowledge activity</p><h2>Recent changes</h2></div>
                </div>
                <div className="activity-list">
                  {overview.activity.slice(0, 2).map((item) => (
                    <article key={item.id}>
                      <span className="activity-node" aria-hidden="true" />
                      <p><strong>{item.actor}</strong> {item.action} <b>{item.target}</b></p>
                      <time>{item.time}</time>
                    </article>
                  ))}
                </div>
              </article>
            </section>
          ) : null}

          {activeSection === "audit" ? (
            <section className="panel" aria-labelledby="audit-title">
              <div className="panel-heading">
                <div><p className="eyebrow">Immutable references</p><h2 id="audit-title">Audit timeline</h2></div>
              </div>
              <div className="activity-list activity-list--large">
                {overview.activity.map((item) => (
                  <article key={item.id}>
                    <span className="activity-node" aria-hidden="true" />
                    <p><strong>{item.actor}</strong> {item.action} <b>{item.target}</b></p>
                    <time>{item.time}</time>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {activeSection === "organizations" ? (
            <section className="panel organization-card" aria-labelledby="organization-title">
              <div className="organization-monogram" aria-hidden="true">DG</div>
              <div>
                <p className="eyebrow">Active scope</p>
                <h2 id="organization-title">{overview.organization.name}</h2>
                <p>{overview.organization.environment} · Governed platform access</p>
              </div>
              <span className="state state--published">Active</span>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
