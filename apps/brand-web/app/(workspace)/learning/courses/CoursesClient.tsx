'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { LearningCourseSummary } from '@expadio/postgres-runtime/learning';
import styles from '../../workspace.module.css';
import { CourseCreateDrawer } from '../CourseCreateDrawer';
import { LearningNav } from '../LearningNav';

interface CoursesClientProps {
  readonly initialCourses: readonly LearningCourseSummary[];
  readonly organizationName: string;
}

export default function CoursesClient({
  initialCourses,
  organizationName,
}: CoursesClientProps) {
  const [courses] = useState<readonly LearningCourseSummary[]>(initialCourses);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const filteredCourses = useMemo(() => {
    let result = [...courses];
    if (statusFilter) {
      if (statusFilter === 'PUBLISHED') {
        result = result.filter((c) => c.currentPublishedVersion !== null);
      } else if (statusFilter === 'DRAFT') {
        result = result.filter((c) => c.draftVersion !== null);
      } else {
        result = result.filter((c) => c.status === statusFilter);
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (c) =>
          c.courseKey.toLowerCase().includes(q) ||
          (c.draftTitle ?? '').toLowerCase().includes(q) ||
          (c.publishedTitle ?? '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [courses, statusFilter, searchQuery]);

  return (
    <>
      {/* Navigation Header */}
      <section className={styles.pageHead} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, width: '100%' }}>
          <div>
            <p className={styles.eyebrow}>Learning · {organizationName}</p>
            <h1 style={{ margin: '2px 0 6px' }}>Courses Catalog</h1>
            <p style={{ margin: 0, color: 'var(--muted-foreground, #A1A1AA)', fontSize: 14 }}>
              Authored courses, versioned content releases, and learner catalogs.
            </p>
          </div>

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

        <LearningNav activeKey="courses" />
      </section>

      {/* Primary Working Surface Panel */}
      <section className={styles.panel} style={{ marginTop: 20, borderRadius: 'var(--radius-lg, 6px)' }}>
        {/* Toolbar Header */}
        <div
          className={styles.panelHead}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '16px 20px',
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Course Catalog</h2>
            <span className={styles.pill} style={{ fontSize: 11 }}>
              {filteredCourses.length} VISIBLE
            </span>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Search Input */}
            <input
              type="search"
              placeholder="Search by title, key…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                height: 36,
                padding: '0 12px',
                borderRadius: 'var(--radius-md, 4px)',
                border: '1px solid var(--border, #272727)',
                background: 'var(--background, #000000)',
                color: 'var(--foreground, #FAFAFA)',
                fontSize: 13,
                minWidth: 240,
              }}
            />

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                height: 36,
                padding: '0 12px',
                borderRadius: 'var(--radius-md, 4px)',
                border: '1px solid var(--border, #272727)',
                background: 'var(--background, #000000)',
                color: 'var(--foreground, #FAFAFA)',
                fontSize: 13,
              }}
            >
              <option value="">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
              <option value="ARCHIVED">Archived</option>
            </select>

            {/* View Mode Toggle */}
            <div
              style={{
                display: 'flex',
                background: 'var(--muted, #171717)',
                padding: 3,
                borderRadius: 'var(--radius-md, 4px)',
                border: '1px solid var(--border, #272727)',
              }}
            >
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                style={{
                  height: 30,
                  padding: '0 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 3,
                  border: 'none',
                  background: viewMode === 'grid' ? 'var(--brand-primary, #FACC15)' : 'transparent',
                  color: viewMode === 'grid' ? '#000000' : 'var(--muted-foreground, #A1A1AA)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Grid
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                style={{
                  height: 30,
                  padding: '0 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 3,
                  border: 'none',
                  background: viewMode === 'table' ? 'var(--brand-primary, #FACC15)' : 'transparent',
                  color: viewMode === 'table' ? '#000000' : 'var(--muted-foreground, #A1A1AA)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Table
              </button>
            </div>
          </div>
        </div>

        {/* Content Body */}
        {filteredCourses.length === 0 ? (
          <div className={styles.empty} style={{ padding: '56px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground, #FAFAFA)', margin: '0 0 6px' }}>
              No courses found
            </p>
            <p style={{ fontSize: 13, color: 'var(--muted-foreground, #A1A1AA)', margin: '0 0 20px' }}>
              {searchQuery ? `No matching courses for "${searchQuery}"` : 'Start building your course catalog.'}
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
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 16,
              padding: 20,
            }}
          >
            {filteredCourses.map((course) => (
              <div
                key={course.courseId}
                style={{
                  background: 'var(--card, #0A0A0A)',
                  border: '1px solid var(--border, #272727)',
                  borderRadius: 'var(--radius-lg, 6px)',
                  padding: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 14,
                  transition: 'all 0.15s ease',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span
                      className={styles.pill}
                      style={{
                        borderColor: course.currentPublishedVersion !== null ? '#22C55E' : undefined,
                        color: course.currentPublishedVersion !== null ? '#22C55E' : undefined,
                        fontSize: 11,
                      }}
                    >
                      {course.currentPublishedVersion !== null ? 'PUBLISHED' : course.status}
                    </span>
                    <code style={{ fontSize: 11, color: 'var(--muted-foreground, #A1A1AA)' }}>{course.courseKey}</code>
                  </div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 6px', color: 'var(--foreground, #FAFAFA)' }}>
                    {course.draftTitle ?? course.publishedTitle ?? course.courseKey}
                  </h3>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTop: '1px solid var(--border, #272727)',
                    paddingTop: 12,
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--muted-foreground, #A1A1AA)' }}>
                    {course.currentPublishedVersion ? `Published v${course.currentPublishedVersion}` : 'Draft v1'}
                  </span>
                  <Link
                    href={`/learning/courses/${course.courseId}`}
                    className={styles.secondaryButton}
                    style={{ fontSize: 12, padding: '4px 12px' }}
                  >
                    Edit / Manage →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Table View */
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Course Title</th>
                  <th>Key</th>
                  <th>Status</th>
                  <th>Published Version</th>
                  <th>Draft Version</th>
                  <th style={{ textAlign: 'right', paddingRight: 16 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredCourses.map((course) => (
                  <tr key={course.courseId}>
                    <td>
                      <Link href={`/learning/courses/${course.courseId}`}>
                        <strong style={{ color: 'var(--foreground, #FAFAFA)' }}>
                          {course.draftTitle ?? course.publishedTitle ?? course.courseKey}
                        </strong>
                      </Link>
                    </td>
                    <td><code>{course.courseKey}</code></td>
                    <td>
                      <span
                        className={styles.pill}
                        style={{
                          borderColor: course.currentPublishedVersion !== null ? '#22C55E' : undefined,
                          color: course.currentPublishedVersion !== null ? '#22C55E' : undefined,
                        }}
                      >
                        {course.currentPublishedVersion !== null ? 'PUBLISHED' : course.status}
                      </span>
                    </td>
                    <td>{course.currentPublishedVersion ? `v${course.currentPublishedVersion}` : '—'}</td>
                    <td>{course.draftVersion ? `v${course.draftVersion}` : '—'}</td>
                    <td style={{ textAlign: 'right', paddingRight: 16 }}>
                      <Link className={styles.secondaryButton} href={`/learning/courses/${course.courseId}`} style={{ padding: '4px 12px', fontSize: 12 }}>
                        Edit / Manage →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Guided Course Creator Wizard Drawer */}
      <CourseCreateDrawer
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
      />
    </>
  );
}
