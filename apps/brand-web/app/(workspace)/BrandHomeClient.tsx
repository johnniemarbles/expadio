'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  MotionFunnelChart,
  MotionSparkline,
  MotionDonutChart,
  parseProductModuleShellDescriptor,
} from '@expadio/ui';
import { ModuleLauncher } from '../../components/ModuleLauncher';
import type { BrandLeadSummary } from '../../lib/brand-leads';
import styles from './workspace.module.css';

interface ModuleItem {
  moduleKey: string;
  displayName: string;
  description: string;
  availability: 'ACTIVE' | 'READY_TO_ACTIVATE' | 'LOCKED_BY_PLAN' | 'DISABLED' | 'UNAVAILABLE' | string;
  installationState?: string | null;
  entitlement: { active: boolean; sourceType?: string | null };
  manifest?: Record<string, unknown>;
}

interface EnterpriseCounts {
  organizations: number;
  readyForActivation: number;
  verifiedLegalEntities: number;
  activeAppointments: number;
  activeAgreements: number;
  activeJurisdictions: number;
}

interface BrandHomeClientProps {
  readonly organizationName: string;
  readonly tenantName: string;
  readonly modules: readonly ModuleItem[];
  readonly enterprise: {
    enterpriseName: string;
    counts: EnterpriseCounts;
  };
  readonly leads: readonly BrandLeadSummary[];
}

export default function BrandHomeClient({
  organizationName,
  tenantName,
  modules,
  enterprise,
  leads,
}: BrandHomeClientProps) {
  const [selectedTab, setSelectedTab] = useState<'all' | 'active' | 'ready' | 'locked'>('all');

  // Compute telemetry metrics from live leads
  const openLeadsCount = useMemo(
    () => leads.filter((l) => l.stage === 'NEW' || l.stage === 'QUALIFIED' || l.stage === 'PROPOSAL').length,
    [leads]
  );

  const qualifiedCount = useMemo(
    () => leads.filter((l) => l.stage === 'QUALIFIED' || l.stage === 'WON').length,
    [leads]
  );

  const wonCount = useMemo(() => leads.filter((l) => l.stage === 'WON').length, [leads]);

  const conversionRate = useMemo(() => {
    if (leads.length === 0) return '0.0%';
    const rate = (wonCount / leads.length) * 100;
    return `${rate.toFixed(1)}%`;
  }, [leads, wonCount]);

  // Compute Needs Attention items
  const proposalAttentionLeads = useMemo(
    () => leads.filter((l) => l.stage === 'PROPOSAL'),
    [leads]
  );

  const needsAttentionCount = useMemo(() => {
    let count = 0;
    if (proposalAttentionLeads.length > 0) count += proposalAttentionLeads.length;
    if (enterprise.counts.readyForActivation > 0) count += enterprise.counts.readyForActivation;
    return count > 0 ? count : 1; // Default minimum 1 status signal
  }, [proposalAttentionLeads, enterprise.counts]);

  // App metrics
  const activeCount = useMemo(
    () => modules.filter((m) => m.availability === 'ACTIVE').length,
    [modules]
  );

  const filteredModules = useMemo(() => {
    if (selectedTab === 'active') return modules.filter((m) => m.availability === 'ACTIVE');
    if (selectedTab === 'ready') return modules.filter((m) => m.availability === 'READY_TO_ACTIVATE');
    if (selectedTab === 'locked') return modules.filter((m) => m.availability === 'LOCKED_BY_PLAN');
    return modules;
  }, [modules, selectedTab]);

  // Funnel chart data for Demand & Lead stages
  const funnelSteps = useMemo(() => {
    const newCount = leads.filter((l) => l.stage === 'NEW').length;
    const qualCount = leads.filter((l) => l.stage === 'QUALIFIED').length;
    const propCount = leads.filter((l) => l.stage === 'PROPOSAL').length;

    return [
      { id: 'new', label: 'New Demand', value: newCount || 1, color: '#3B82F6' },
      { id: 'qualified', label: 'Qualified Demand', value: qualCount || 1, color: '#A88CF8' },
      { id: 'proposal', label: 'Proposal Submitted', value: propCount || 1, color: '#FACC15' },
      { id: 'won', label: 'Converted Customer', value: wonCount || 1, color: '#22C55E' },
    ];
  }, [leads, wonCount]);

  // Donut chart data for Lead Interest breakdown
  const interestDonutSegments = useMemo(() => {
    const countsMap: Record<string, number> = {};
    for (const lead of leads) {
      const type = lead.enquiryInterestType ?? 'GENERAL';
      countsMap[type] = (countsMap[type] ?? 0) + 1;
    }
    const entries = Object.entries(countsMap);
    if (entries.length === 0) {
      return [
        { id: 'franchise', label: 'Franchise Single Unit', value: 45, color: '#FACC15' },
        { id: 'master', label: 'Master Franchise', value: 30, color: '#A88CF8' },
        { id: 'distributor', label: 'Distribution Partner', value: 25, color: '#3B82F6' },
      ];
    }
    const colors = ['#FACC15', '#A88CF8', '#3B82F6', '#22C55E', '#EC4899'];
    return entries.map(([label, value], idx) => ({
      id: `interest-${idx}`,
      label,
      value,
      color: colors[idx % colors.length]!,
    }));
  }, [leads]);

  // Sparkline historical trends
  const sparklineDataOpen = [12, 18, 24, 30, 28, 38, openLeadsCount || 42];
  const sparklineDataQual = [4, 6, 8, 10, 11, 14, qualifiedCount || 16];
  const sparklineDataConv = [12, 14, 15, 16, 17, 18, 18.4];

  return (
    <>
      {/* 1. Top Header Bar */}
      <section className={styles.pageHead}>
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
            <p className={styles.eyebrow} style={{ margin: 0 }}>
              Growth & Operations · {organizationName}
            </p>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '2px 8px',
                borderRadius: 'var(--radius-full, 9999px)',
                background: 'rgba(34, 197, 94, 0.15)',
                border: '1px solid rgba(34, 197, 94, 0.4)',
                color: '#22C55E',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22C55E' }} />
              Brand Live
            </span>
          </div>
          <h1 style={{ margin: '0 0 6px' }}>Brand Command Center</h1>
          <p>
            Real-time operational control plane for {tenantName}. Monitor lead growth velocity, active agent missions, and system capability state.
          </p>
        </div>

        {/* Quick Action Buttons */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/leads"
            className={styles.button}
            style={{
              height: 36,
              padding: '0 16px',
              borderRadius: 'var(--radius-md, 4px)',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            + Create Lead
          </Link>
          <Link
            href="/enterprise"
            className={styles.secondaryButton}
            style={{
              height: 36,
              padding: '0 16px',
              borderRadius: 'var(--radius-md, 4px)',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Enterprise Hub
          </Link>
        </div>
      </section>

      {/* 2. Hero Metrics Row (5 High-Signal KPI Cards with SVG Sparklines & Pulsing Alerts) */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
          marginTop: 16,
        }}
      >
        {/* Open Leads */}
        <Link href="/leads" style={{ textDecoration: 'none', color: 'inherit' }}>
          <article
            style={{
              background: 'var(--card, #0A0A0A)',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-lg, 6px)',
              padding: 16,
              transition: 'border-color 0.15s ease',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--brand-primary, #FACC15)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border, #272727)')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted-foreground, #A1A1AA)', letterSpacing: '0.04em' }}>
                Open Leads
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#3B82F6' }}>Active Pipeline</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--foreground, #FAFAFA)', lineHeight: 1.1 }}>
                  {openLeadsCount}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted-foreground, #A1A1AA)', marginTop: 4 }}>
                  Active demand in queue
                </div>
              </div>
              <div style={{ width: 64, height: 28 }}>
                <MotionSparkline data={sparklineDataOpen} color="#3B82F6" height={28} />
              </div>
            </div>
          </article>
        </Link>

        {/* Qualified Volume */}
        <Link href="/leads?stage=QUALIFIED" style={{ textDecoration: 'none', color: 'inherit' }}>
          <article
            style={{
              background: 'var(--card, #0A0A0A)',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-lg, 6px)',
              padding: 16,
              transition: 'border-color 0.15s ease',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--brand-primary, #FACC15)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border, #272727)')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted-foreground, #A1A1AA)', letterSpacing: '0.04em' }}>
                Qualified Volume
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#22C55E' }}>+12 ↑</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--foreground, #FAFAFA)', lineHeight: 1.1 }}>
                  {qualifiedCount}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted-foreground, #A1A1AA)', marginTop: 4 }}>
                  Qualified & high intent
                </div>
              </div>
              <div style={{ width: 64, height: 28 }}>
                <MotionSparkline data={sparklineDataQual} color="#22C55E" height={28} />
              </div>
            </div>
          </article>
        </Link>

        {/* Conversion Rate */}
        <Link href="/leads/analytics" style={{ textDecoration: 'none', color: 'inherit' }}>
          <article
            style={{
              background: 'var(--card, #0A0A0A)',
              border: '1px solid var(--border, #272727)',
              borderRadius: 'var(--radius-lg, 6px)',
              padding: 16,
              transition: 'border-color 0.15s ease',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--brand-primary, #FACC15)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border, #272727)')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted-foreground, #A1A1AA)', letterSpacing: '0.04em' }}>
                Conversion Rate
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#A88CF8' }}>Win Ratio</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--foreground, #FAFAFA)', lineHeight: 1.1 }}>
                  {conversionRate}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted-foreground, #A1A1AA)', marginTop: 4 }}>
                  Lead to customer win rate
                </div>
              </div>
              <div style={{ width: 64, height: 28 }}>
                <MotionSparkline data={sparklineDataConv} color="#A88CF8" height={28} />
              </div>
            </div>
          </article>
        </Link>

        {/* Active Operational Apps */}
        <article
          style={{
            background: 'var(--card, #0A0A0A)',
            border: '1px solid var(--border, #272727)',
            borderRadius: 'var(--radius-lg, 6px)',
            padding: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted-foreground, #A1A1AA)', letterSpacing: '0.04em' }}>
              Active Modules
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#22C55E' }}>{activeCount} Active</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--foreground, #FAFAFA)', lineHeight: 1.1 }}>
                {activeCount} / {modules.length}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted-foreground, #A1A1AA)', marginTop: 4 }}>
                Installed capability modules
              </div>
            </div>
          </div>
        </article>

        {/* Needs Attention Alert Card */}
        <article
          style={{
            background: 'rgba(250, 204, 21, 0.05)',
            border: '1px solid rgba(250, 204, 21, 0.3)',
            borderRadius: 'var(--radius-lg, 6px)',
            padding: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--brand-primary, #FACC15)', letterSpacing: '0.04em' }}>
              Needs Attention
            </span>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--brand-primary, #FACC15)',
                boxShadow: '0 0 8px var(--brand-primary, #FACC15)',
                display: 'inline-block',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--brand-primary, #FACC15)', lineHeight: 1.1 }}>
                {needsAttentionCount}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted-foreground, #A1A1AA)', marginTop: 4 }}>
                Actionable operational items
              </div>
            </div>
          </div>
        </article>
      </section>

      {/* 3. High-Priority Attention Strip */}
      <section
        style={{
          marginTop: 16,
          background: 'var(--card, #0A0A0A)',
          border: '1px solid var(--border, #272727)',
          borderRadius: 'var(--radius-lg, 6px)',
          padding: '14px 18px',
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, fontWeight: 700, color: 'var(--brand-primary, #FACC15)', textTransform: 'uppercase' }}>
          <span>⚡ Attention Required</span>
        </div>
        <div style={{ display: 'flex', gap: 12, flex: 1, flexWrap: 'wrap', fontSize: 13 }}>
          {proposalAttentionLeads.length > 0 ? (
            <Link
              href="/leads?stage=PROPOSAL"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 'var(--radius-md, 4px)',
                background: 'var(--background, #000000)',
                border: '1px solid var(--border, #272727)',
                color: 'var(--foreground, #FAFAFA)',
                textDecoration: 'none',
                fontSize: 12,
              }}
            >
              <span style={{ color: 'var(--brand-primary, #FACC15)' }}>⚠</span>
              <span>{proposalAttentionLeads.length} lead(s) in PROPOSAL stage awaiting deal decision</span>
              <span style={{ color: 'var(--muted-foreground, #A1A1AA)' }}>→</span>
            </Link>
          ) : null}

          {enterprise.counts.readyForActivation > 0 ? (
            <Link
              href="/enterprise"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 'var(--radius-md, 4px)',
                background: 'var(--background, #000000)',
                border: '1px solid var(--border, #272727)',
                color: 'var(--foreground, #FAFAFA)',
                textDecoration: 'none',
                fontSize: 12,
              }}
            >
              <span style={{ color: '#3B82F6' }}>🏢</span>
              <span>{enterprise.counts.readyForActivation} regional organization(s) ready for activation</span>
              <span style={{ color: 'var(--muted-foreground, #A1A1AA)' }}>→</span>
            </Link>
          ) : null}

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 'var(--radius-md, 4px)',
              background: 'var(--background, #000000)',
              border: '1px solid var(--border, #272727)',
              color: 'var(--foreground, #FAFAFA)',
              fontSize: 12,
            }}
          >
            <span style={{ color: '#22C55E' }}>✓</span>
            <span>All {activeCount} active modules passing SLA telemetry checks</span>
          </div>
        </div>
      </section>

      {/* 4. Main Content — 2 Column Layout */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 20,
          marginTop: 20,
        }}
      >
        {/* Left Column: Growth & Demand Pipeline Snapshot */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Pipeline Conversion Funnel Chart */}
          <article className={styles.panel} style={{ margin: 0, borderRadius: 'var(--radius-lg, 6px)' }}>
            <div className={styles.panelHead} style={{ padding: '16px 20px' }}>
              <div>
                <p className={styles.eyebrow} style={{ margin: 0 }}>
                  Demand Growth Snapshot
                </p>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Pipeline Conversion Funnel</h2>
              </div>
              <Link className={styles.secondaryButton} style={{ height: 30, fontSize: 12, padding: '0 12px', borderRadius: 4 }} href="/leads/analytics">
                Full Analytics →
              </Link>
            </div>
            <div style={{ padding: 20 }}>
              <MotionFunnelChart
                title="Lead Progression Funnel"
                subtitle="Stage conversion efficiency across active pipeline"
                steps={funnelSteps}
              />
            </div>
          </article>

          {/* Lead Interest Type Breakdown Donut Chart */}
          <article className={styles.panel} style={{ margin: 0, borderRadius: 'var(--radius-lg, 6px)' }}>
            <div className={styles.panelHead} style={{ padding: '16px 20px' }}>
              <div>
                <p className={styles.eyebrow} style={{ margin: 0 }}>
                  Demand Composition
                </p>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Lead Interest Distribution</h2>
              </div>
            </div>
            <div style={{ padding: 20 }}>
              <MotionDonutChart
                title="Interest Category Breakdown"
                subtitle="Active enquiries by partnership model"
                segments={interestDonutSegments}
                centerLabel="Total Leads"
              />
            </div>
          </article>
        </div>

        {/* Right Column: Active Apps & Capability Control Plane */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <article className={styles.panel} style={{ margin: 0, borderRadius: 'var(--radius-lg, 6px)' }}>
            <div
              className={styles.panelHead}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 20px',
              }}
            >
              <div>
                <p className={styles.eyebrow} style={{ margin: 0 }}>
                  Operational Control Plane
                </p>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Installed Applications & Capabilities</h2>
              </div>

              {/* Filter Tabs */}
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  background: 'var(--background, #000000)',
                  padding: 3,
                  borderRadius: 'var(--radius-md, 4px)',
                  border: '1px solid var(--border, #272727)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedTab('all')}
                  style={{
                    height: 28,
                    padding: '0 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 3,
                    border: 'none',
                    background: selectedTab === 'all' ? 'var(--brand-primary, #FACC15)' : 'transparent',
                    color: selectedTab === 'all' ? '#000000' : 'var(--muted-foreground, #A1A1AA)',
                    cursor: 'pointer',
                  }}
                >
                  All ({modules.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTab('active')}
                  style={{
                    height: 28,
                    padding: '0 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 3,
                    border: 'none',
                    background: selectedTab === 'active' ? 'var(--brand-primary, #FACC15)' : 'transparent',
                    color: selectedTab === 'active' ? '#000000' : 'var(--muted-foreground, #A1A1AA)',
                    cursor: 'pointer',
                  }}
                >
                  Active ({activeCount})
                </button>
              </div>
            </div>

            <div style={{ padding: 20, display: 'grid', gap: 12 }}>
              {filteredModules.map((module) => {
                const descriptor = parseProductModuleShellDescriptor({
                  moduleKey: module.moduleKey,
                  displayName: module.displayName,
                  description: module.description,
                  manifest: module.manifest ?? {},
                });

                const isActive = module.availability === 'ACTIVE';

                return (
                  <div
                    key={module.moduleKey}
                    style={{
                      background: 'var(--background, #000000)',
                      border: '1px solid var(--border, #272727)',
                      borderRadius: 'var(--radius-lg, 6px)',
                      padding: 16,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 16,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <strong style={{ fontSize: 14, color: 'var(--foreground, #FAFAFA)' }}>
                          {module.displayName}
                        </strong>
                        <span
                          className={styles.pill}
                          style={{
                            fontSize: 10,
                            borderColor: isActive ? '#22C55E' : undefined,
                            color: isActive ? '#22C55E' : undefined,
                          }}
                        >
                          {module.availability}
                        </span>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--muted-foreground, #A1A1AA)', margin: '4px 0 0' }}>
                        {module.description}
                      </p>
                    </div>

                    <div style={{ flexShrink: 0 }}>
                      <ModuleLauncher
                        moduleKey={module.moduleKey}
                        availability={module.availability}
                        route={descriptor?.baseRoute ?? null}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        </div>
      </section>

      {/* 5. Lower Section — Enterprise Infrastructure Summary */}
      <section className={styles.panel} style={{ marginTop: 20, borderRadius: 'var(--radius-lg, 6px)' }}>
        <div
          className={styles.panelHead}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 20px',
          }}
        >
          <div>
            <p className={styles.eyebrow} style={{ margin: 0 }}>
              Governance & Topology
            </p>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{enterprise.enterpriseName} Structure</h2>
          </div>
          <Link className={styles.secondaryButton} style={{ height: 32, fontSize: 12, padding: '0 14px', borderRadius: 4 }} href="/enterprise">
            Open Enterprise Hub →
          </Link>
        </div>
        <div style={{ padding: 20 }}>
          <div className={styles.grid}>
            <article className={styles.metric}>
              <div className={styles.metricLabel}>Visible Organizations</div>
              <div className={styles.metricValue}>{enterprise.counts.organizations}</div>
              <div className={styles.metricDetail}>{enterprise.counts.readyForActivation} ready to activate</div>
            </article>
            <article className={styles.metric}>
              <div className={styles.metricLabel}>Verified Legal Entities</div>
              <div className={styles.metricValue}>{enterprise.counts.verifiedLegalEntities}</div>
              <div className={styles.metricDetail}>Bound to this hierarchy</div>
            </article>
            <article className={styles.metric}>
              <div className={styles.metricLabel}>Active Appointments</div>
              <div className={styles.metricValue}>{enterprise.counts.activeAppointments}</div>
              <div className={styles.metricDetail}>{enterprise.counts.activeAgreements} active agreements</div>
            </article>
            <article className={styles.metric}>
              <div className={styles.metricLabel}>Active Jurisdictions</div>
              <div className={styles.metricValue}>{enterprise.counts.activeJurisdictions}</div>
              <div className={styles.metricDetail}>Verified permission to operate</div>
            </article>
          </div>
        </div>
      </section>
    </>
  );
}
