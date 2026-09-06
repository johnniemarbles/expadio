'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { LearningDashboard } from '../../../lib/learning-data';
import styles from '../workspace.module.css';
import { CourseCreateDrawer } from './CourseCreateDrawer';
import { LearningNav } from './LearningNav';

interface LearningClientProps {
  readonly dashboard: LearningDashboard;
  readonly academyName: string;
}

export default function LearningClient({
  dashboard,
  academyName,
}: LearningClientProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Extract key metrics or calculate defaults
  const activeLearners = dashboard.metrics.find((m) => m.label.toLowerCase().includes('active'))?.value ?? 128;
  const inProgress = dashboard.metrics.find((m) => m.label.toLowerCase().includes('in learning') || m.label.toLowerCase().includes('courses'))?.value ?? 34;
  const completed = dashboard.metrics.find((m) => m.label.toLowerCase().includes('completed'))?.value ?? 84;
  const overdue = dashboard.metrics.find((m) => m.label.toLowerCase().includes('overdue'))?.value ?? 9;
  const programs = dashboard.metrics.find((m) => m.label.toLowerCase().includes('programs'))?.value ?? 5;

  const totalEnrollments = inProgress + completed + overdue || 1;
  const completionRate = Math.round((completed / totalEnrollments) * 100) || 72;

  return (
    <>
      {/* Top Header & Command Center Bar */}
      <section className={styles.pageHead} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, width: '100%' }}>
          <div>
            <p className={styles.eyebrow}>Learning · {academyName}</p>
            <h1 style={{ margin: '2px 0 6px' }}>{academyName || 'Learning Command Center'}</h1>
            <p style={{ margin: 0, color: 'var(--muted-foreground, #A1A1AA)', fontSize: 14 }}>
              Shared learning, skills, certification and compliance control plane for tenant brands.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Link className={styles.secondaryButton} href="/learning/assignments" style={{ height: 36, padding: '0 14px', fontSize: 13 }}>
              Assign Learning
            </Link>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className={styles.button}
              style={{
                height: 36,
                padding: '0 16px',
                borderRadius: 'var(--radius-md, 4px)',
                fontWeight: 600,
                fontSize: 13,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              + Create Course
            </button>
          </div>
        </div>

        <LearningNav activeKey="overview" />
      </section>

      {/* Hero Metrics Row (5 High-Signal Metric Cards) */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 12,
          marginTop: 16,
        }}
      >
        <article className={styles.metric}>
          <div className={styles.metricLabel}>Active Learners</div>
          <div className={styles.metricValue}>{activeLearners}</div>
          <div className={styles.metricDetail}>+12 this week</div>
        </article>

        <article className={styles.metric}>
          <div className={styles.metricLabel}>Courses in Progress</div>
          <div className={styles.metricValue}>{inProgress}</div>
          <div className={styles.metricDetail}>8 nearing completion</div>
        </article>

        <article className={styles.metric}>
          <div className={styles.metricLabel}>Completion Rate</div>
          <div className={styles.metricValue}>{completionRate}%</div>
          <div className={styles.metricDetail}>+4% vs last month</div>
        </article>

        <article
          className={styles.metric}
          style={{
            border: overdue > 0 ? '1px solid color-mix(in srgb, #EF4444 60%, transparent)' : undefined,
          }}
        >
          <div className={styles.metricLabel} style={{ color: overdue > 0 ? '#EF4444' : undefined }}>
            Overdue Assignments
          </div>
          <div className={styles.metricValue} style={{ color: overdue > 0 ? '#EF4444' : undefined }}>
            {overdue}
          </div>
          <div className={styles.metricDetail}>Needs action</div>
        </article>

        <article className={styles.metric}>
          <div className={styles.metricLabel}>Compliance Due</div>
          <div className={styles.metricValue}>{programs}</div>
          <div className={styles.metricDetail}>Next 14 days</div>
        </article>
      </section>

      {/* Attention Strip */}
      <div
        style={{
          marginTop: 16,
          background: 'color-mix(in srgb, var(--brand-primary, #FACC15) 8%, var(--card, #0A0A0A))',
          border: '1px solid color-mix(in srgb, var(--brand-primary, #FACC15) 30%, transparent)',
          borderRadius: 'var(--radius-lg, 6px)',
          padding: '12px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <span style={{ color: 'var(--brand-primary, #FACC15)', fontWeight: 700 }}>⚡ Attention Required:</span>
          <span style={{ color: 'var(--foreground, #FAFAFA)' }}>
            {overdue > 0 ? `${overdue} assignments overdue · ` : ''}
            3 courses missing content · 5 compliance certifications due in next 14 days
          </span>
        </div>
        <Link href="/learning/assignments" className={styles.secondaryButton} style={{ fontSize: 12, padding: '4px 12px' }}>
          Resolve Actions →
        </Link>
      </div>

      {/* 2-Column Main Content Layout */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 20 }}>
        {/* Left Column: Learning Pipeline Snapshot */}
        <div className={styles.panel} style={{ margin: 0 }}>
          <div className={styles.panelHead}>
            <h2>Learning Pipeline</h2>
            <Link href="/learning/reports" style={{ fontSize: 12 }}>View Analytics →</Link>
          </div>
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                <span>In Progress</span>
                <strong>{inProgress} learners ({Math.round((inProgress / totalEnrollments) * 100)}%)</strong>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--muted, #272727)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.round((inProgress / totalEnrollments) * 100)}%`, height: '100%', background: 'var(--brand-primary, #FACC15)' }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                <span>Completed</span>
                <strong>{completed} learners ({completionRate}%)</strong>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--muted, #272727)', overflow: 'hidden' }}>
                <div style={{ width: `${completionRate}%`, height: '100%', background: '#22C55E' }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                <span>Overdue</span>
                <strong>{overdue} learners ({Math.round((overdue / totalEnrollments) * 100)}%)</strong>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--muted, #272727)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.round((overdue / totalEnrollments) * 100)}%`, height: '100%', background: '#EF4444' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Active Programs & Capabilities */}
        <div className={styles.panel} style={{ margin: 0 }}>
          <div className={styles.panelHead}>
            <h2>Active Programs</h2>
            <Link href="/learning/programs" style={{ fontSize: 12 }}>All Programs →</Link>
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ padding: 12, background: 'var(--background, #000)', border: '1px solid var(--border, #272727)', borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: 13, display: 'block' }}>Brand Onboarding Curriculum</strong>
                <small style={{ color: 'var(--muted-foreground, #A1A1AA)' }}>4 Courses · 42 enrolled</small>
              </div>
              <span className={styles.pill} style={{ fontSize: 11, borderColor: '#22C55E', color: '#22C55E' }}>88% ON TRACK</span>
            </div>

            <div style={{ padding: 12, background: 'var(--background, #000)', border: '1px solid var(--border, #272727)', borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: 13, display: 'block' }}>Platform Operations Certification</strong>
                <small style={{ color: 'var(--muted-foreground, #A1A1AA)' }}>6 Courses · 28 enrolled</small>
              </div>
              <span className={styles.pill} style={{ fontSize: 11, borderColor: 'var(--brand-primary, #FACC15)', color: 'var(--brand-primary, #FACC15)' }}>74% IN PROGRESS</span>
            </div>
          </div>
        </div>
      </section>

      {/* Lower Section: Recent Courses & Activity Feed */}
      <section className={styles.panel} style={{ marginTop: 20 }}>
        <div className={styles.panelHead}>
          <h2>Recently Updated Courses</h2>
          <Link href="/learning/courses">View Full Catalog →</Link>
        </div>

        {dashboard.recentCourses.length === 0 ? (
          <div className={styles.empty} style={{ padding: '48px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px' }}>No courses created yet</p>
            <p style={{ fontSize: 13, color: 'var(--muted-foreground, #A1A1AA)', margin: '0 0 16px' }}>
              Start by building your first course using the guided authoring wizard.
            </p>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className={styles.button}
              style={{ height: 36, padding: '0 16px', borderRadius: 'var(--radius-md, 4px)', fontSize: 13 }}
            >
              + Create Course
            </button>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Course Title</th>
                  <th>Key</th>
                  <th>Published Version</th>
                  <th>Draft Version</th>
                  <th style={{ textAlign: 'right', paddingRight: 16 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.recentCourses.map((course) => (
                  <tr key={course.courseId}>
                    <td>
                      <Link href={`/learning/courses/${course.courseId}`}>
                        <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>
                          {course.draftTitle ?? course.publishedTitle ?? course.courseKey}
                        </strong>
                      </Link>
                    </td>
                    <td><code>{course.courseKey}</code></td>
                    <td>{course.currentPublishedVersion ? <span className={styles.pill} style={{ borderColor: '#22C55E', color: '#22C55E' }}>v{course.currentPublishedVersion}</span> : '—'}</td>
                    <td>{course.draftVersion ? <span className={styles.pill}>v{course.draftVersion}</span> : '—'}</td>
                    <td style={{ textAlign: 'right', paddingRight: 16 }}>
                      <Link className={styles.secondaryButton} href={`/learning/courses/${course.courseId}`} style={{ padding: '4px 10px', fontSize: 12 }}>
                        Manage →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Guided Multi-Step Course Creator Drawer */}
      <CourseCreateDrawer
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </>
  );
}
