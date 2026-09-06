'use client';

import { useState } from 'react';
import { MotionDrawer } from '@expadio/ui';
import styles from '../workspace.module.css';

export interface Lesson {
  id: string;
  title: string;
  contentType: 'video' | 'article' | 'document' | 'quiz' | 'interactive' | 'link';
  durationMinutes: number;
  contentUrl?: string;
  bodyText?: string;
}

export interface Module {
  id: string;
  title: string;
  description?: string;
  lessons: Lesson[];
}

export interface CourseDraft {
  title: string;
  description: string;
  category: string;
  level: string;
  estimatedDuration: number;
  thumbnailUrl: string;
  language: string;
  modules: Module[];
  visibility: 'DRAFT' | 'PUBLISHED' | 'ASSIGNED_ONLY';
  enrollmentMode: 'OPEN' | 'APPROVAL' | 'INVITE';
  certificateEnabled: boolean;
  passingScore: number;
}

interface CourseCreateDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onCreated?: () => void;
}

const STEPS = [
  '1. Basics',
  '2. Structure',
  '3. Content',
  '4. Assessment',
  '5. Settings',
  '6. Review',
] as const;

export function CourseCreateDrawer({
  isOpen,
  onClose,
  onCreated,
}: CourseCreateDrawerProps) {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  // Form State
  const [draft, setDraft] = useState<CourseDraft>({
    title: '',
    description: '',
    category: 'General',
    level: 'Beginner',
    estimatedDuration: 45,
    thumbnailUrl: '',
    language: 'English',
    modules: [
      {
        id: 'mod-1',
        title: 'Module 1: Introduction',
        description: 'Getting started and core foundations.',
        lessons: [
          {
            id: 'les-1',
            title: '1.1 Welcome & Overview',
            contentType: 'video',
            durationMinutes: 10,
            bodyText: '',
          },
        ],
      },
    ],
    visibility: 'DRAFT',
    enrollmentMode: 'OPEN',
    certificateEnabled: true,
    passingScore: 80,
  });

  // Selected item in Step 2 Structure Editor
  const [selectedModuleId, setSelectedModuleId] = useState<string>('mod-1');
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>('les-1');

  if (!isOpen) return null;

  // Navigation validation
  function canProceed(): boolean {
    if (currentStep === 1) {
      return draft.title.trim().length > 0 && draft.description.trim().length > 0;
    }
    if (currentStep === 2) {
      return (
        draft.modules.length > 0 &&
        draft.modules.some((m) => m.lessons.length > 0)
      );
    }
    return true;
  }

  function handleAddModule() {
    const newId = `mod-${Date.now()}`;
    const newMod: Module = {
      id: newId,
      title: `Module ${draft.modules.length + 1}: New Module`,
      lessons: [],
    };
    setDraft((prev) => ({ ...prev, modules: [...prev.modules, newMod] }));
    setSelectedModuleId(newId);
    setSelectedLessonId(null);
  }

  function handleAddLesson(moduleId: string) {
    const newLesId = `les-${Date.now()}`;
    const newLes: Lesson = {
      id: newLesId,
      title: 'New Lesson',
      contentType: 'article',
      durationMinutes: 15,
    };
    setDraft((prev) => ({
      ...prev,
      modules: prev.modules.map((m) =>
        m.id === moduleId ? { ...m, lessons: [...m.lessons, newLes] } : m
      ),
    }));
    setSelectedModuleId(moduleId);
    setSelectedLessonId(newLesId);
  }

  function handleDeleteModule(moduleId: string) {
    setDraft((prev) => ({
      ...prev,
      modules: prev.modules.filter((m) => m.id !== moduleId),
    }));
  }

  function handleDeleteLesson(moduleId: string, lessonId: string) {
    setDraft((prev) => ({
      ...prev,
      modules: prev.modules.map((m) =>
        m.id === moduleId
          ? { ...m, lessons: m.lessons.filter((l) => l.id !== lessonId) }
          : m
      ),
    }));
  }

  async function handlePublish(isPublish = true) {
    setIsSubmitting(true);
    setErrorNotice(null);
    try {
      const response = await fetch('/api/learning/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title,
          description: draft.description,
          category: draft.category,
          language: draft.language,
          estimatedDuration: draft.estimatedDuration,
          visibility: draft.visibility,
          enrollmentMode: draft.enrollmentMode,
          certificateEnabled: draft.certificateEnabled,
          passingScore: draft.passingScore,
          modules: draft.modules,
          publish: isPublish,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : 'Course creation failed');
      }

      if (onCreated) onCreated();
      onClose();
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Failed to create course');
    } finally {
      setIsSubmitting(false);
    }
  }

  const selectedModule = draft.modules.find((m) => m.id === selectedModuleId);
  const selectedLesson = selectedModule?.lessons.find((l) => l.id === selectedLessonId);

  return (
    <>
      {/* Translucent Backdrop Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          zIndex: 99,
          transition: 'opacity 0.2s ease',
        }}
        aria-hidden="true"
      />

      <MotionDrawer
        open={isOpen}
        side="right"
        style={{
          width: '100%',
          maxWidth: 680,
          background: 'var(--card, #0A0A0A)',
          borderLeft: '1px solid var(--border, #272727)',
          borderRadius: 'var(--radius-xl, 8px) 0 0 var(--radius-xl, 8px)',
          boxShadow: '-12px 0 32px rgba(0, 0, 0, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          position: 'fixed',
          top: 0,
          right: 0,
          zIndex: 100,
          overflow: 'hidden',
        }}
      >
        {/* Header with Step Indicator */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--border, #272727)',
            background: 'var(--background, #000000)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <span className={styles.pill} style={{ fontSize: 11, marginBottom: 4 }}>
                GUIDED AUTHORING FLOW
              </span>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--foreground, #FAFAFA)' }}>
                Create New Course
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: '1px solid var(--border, #272727)',
                borderRadius: 'var(--radius-md, 4px)',
                color: 'var(--muted-foreground, #A1A1AA)',
                fontSize: 16,
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>

          {/* 6 Step Progress Indicator */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
            {STEPS.map((stepLabel, idx) => {
              const stepNum = idx + 1;
              const active = currentStep === stepNum;
              const completed = currentStep > stepNum;

              return (
                <button
                  key={stepLabel}
                  type="button"
                  onClick={() => {
                    if (completed || active) setCurrentStep(stepNum);
                  }}
                  disabled={!completed && !active}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-md, 4px)',
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
                    whiteSpace: 'nowrap',
                    background: active
                      ? 'var(--brand-primary, #FACC15)'
                      : completed
                      ? 'color-mix(in srgb, var(--brand-primary, #FACC15) 20%, transparent)'
                      : 'var(--muted, #171717)',
                    color: active ? '#000000' : completed ? 'var(--brand-primary, #FACC15)' : 'var(--muted-foreground, #A1A1AA)',
                    border: 'none',
                    cursor: completed || active ? 'pointer' : 'not-allowed',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {stepLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* Notice Error Bar */}
        {errorNotice ? (
          <div className={styles.notice} style={{ margin: '12px 24px 0' }}>
            <strong>Action failed</strong>
            <p>{errorNotice}</p>
          </div>
        ) : null}

        {/* Step Body Content */}
        <div style={{ padding: 24, flex: 1, overflowY: 'auto' }}>
          {/* STEP 1: BASICS */}
          {currentStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground, #FAFAFA)', margin: 0 }}>
                Step 1: Course Identity & Basics
              </h3>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                Course Title *
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Platform Operations & Governance 101"
                  required
                  style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md, 4px)',
                    border: '1px solid var(--border, #272727)',
                    background: 'var(--card, #0A0A0A)',
                    color: 'var(--foreground, #FAFAFA)',
                    fontSize: 13,
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                Short Description *
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Provide a clear, engaging overview of what learners will accomplish in this course…"
                  rows={3}
                  required
                  style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md, 4px)',
                    border: '1px solid var(--border, #272727)',
                    background: 'var(--card, #0A0A0A)',
                    color: 'var(--foreground, #FAFAFA)',
                    fontSize: 13,
                    resize: 'vertical',
                  }}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  Category / Topic
                  <select
                    value={draft.category}
                    onChange={(e) => setDraft((p) => ({ ...p, category: e.target.value }))}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md, 4px)',
                      border: '1px solid var(--border, #272727)',
                      background: 'var(--card, #0A0A0A)',
                      color: 'var(--foreground, #FAFAFA)',
                      fontSize: 13,
                    }}
                  >
                    {['General', 'Onboarding', 'Compliance', 'Product Knowledge', 'Sales & Growth', 'Technical & Operations'].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  Level
                  <select
                    value={draft.level}
                    onChange={(e) => setDraft((p) => ({ ...p, level: e.target.value }))}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md, 4px)',
                      border: '1px solid var(--border, #272727)',
                      background: 'var(--card, #0A0A0A)',
                      color: 'var(--foreground, #FAFAFA)',
                      fontSize: 13,
                    }}
                  >
                    {['Beginner', 'Intermediate', 'Advanced', 'All Levels'].map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  Estimated Duration (Minutes)
                  <input
                    type="number"
                    value={draft.estimatedDuration}
                    onChange={(e) => setDraft((p) => ({ ...p, estimatedDuration: Number(e.target.value) }))}
                    min={5}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md, 4px)',
                      border: '1px solid var(--border, #272727)',
                      background: 'var(--card, #0A0A0A)',
                      color: 'var(--foreground, #FAFAFA)',
                      fontSize: 13,
                    }}
                  />
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                  Language
                  <select
                    value={draft.language}
                    onChange={(e) => setDraft((p) => ({ ...p, language: e.target.value }))}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md, 4px)',
                      border: '1px solid var(--border, #272727)',
                      background: 'var(--card, #0A0A0A)',
                      color: 'var(--foreground, #FAFAFA)',
                      fontSize: 13,
                    }}
                  >
                    {['English', 'Spanish', 'French', 'German', 'Japanese'].map((lang) => (
                      <option key={lang} value={lang}>
                        {lang}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}

          {/* STEP 2: STRUCTURE (Outline Builder) */}
          {currentStep === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground, #FAFAFA)', margin: 0 }}>
                  Step 2: Course Structure & Outline
                </h3>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleAddModule}
                  style={{ padding: '6px 12px', fontSize: 12 }}
                >
                  + Add Module
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minHeight: 360 }}>
                {/* Left Pane: Outline Tree */}
                <div
                  style={{
                    background: 'var(--background, #000000)',
                    border: '1px solid var(--border, #272727)',
                    borderRadius: 'var(--radius-md, 6px)',
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted-foreground, #A1A1AA)' }}>
                    Outline Tree
                  </span>

                  {draft.modules.map((mod) => {
                    const isModSelected = selectedModuleId === mod.id && selectedLessonId === null;

                    return (
                      <div key={mod.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div
                          onClick={() => {
                            setSelectedModuleId(mod.id);
                            setSelectedLessonId(null);
                          }}
                          style={{
                            padding: '8px 12px',
                            borderRadius: 4,
                            background: isModSelected ? 'color-mix(in srgb, var(--brand-primary, #FACC15) 15%, transparent)' : 'var(--card, #0A0A0A)',
                            border: `1px solid ${isModSelected ? 'var(--brand-primary, #FACC15)' : 'var(--border, #272727)'}`,
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <strong style={{ fontSize: 12, color: 'var(--foreground, #FAFAFA)' }}>{mod.title}</strong>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddLesson(mod.id);
                              }}
                              style={{ background: 'none', border: 'none', color: 'var(--brand-primary, #FACC15)', cursor: 'pointer', fontSize: 11 }}
                            >
                              + Lesson
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteModule(mod.id);
                              }}
                              style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 11 }}
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {/* Lessons under this Module */}
                        {mod.lessons.map((les) => {
                          const isLesSelected = selectedLessonId === les.id;

                          return (
                            <div
                              key={les.id}
                              onClick={() => {
                                setSelectedModuleId(mod.id);
                                setSelectedLessonId(les.id);
                              }}
                              style={{
                                marginLeft: 16,
                                padding: '6px 10px',
                                borderRadius: 4,
                                background: isLesSelected ? 'color-mix(in srgb, var(--brand-primary, #FACC15) 15%, transparent)' : 'var(--card, #0A0A0A)',
                                border: `1px solid ${isLesSelected ? 'var(--brand-primary, #FACC15)' : 'var(--border, #272727)'}`,
                                cursor: 'pointer',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                fontSize: 12,
                              }}
                            >
                              <span>{les.title}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteLesson(mod.id, les.id);
                                }}
                                style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 11 }}
                              >
                                ✕
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* Right Pane: Properties for Selected Item */}
                <div
                  style={{
                    background: 'var(--background, #000000)',
                    border: '1px solid var(--border, #272727)',
                    borderRadius: 'var(--radius-md, 6px)',
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted-foreground, #A1A1AA)' }}>
                    {selectedLesson ? 'Lesson Properties' : selectedModule ? 'Module Properties' : 'Item Properties'}
                  </span>

                  {selectedLesson ? (
                    <>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                        Lesson Title
                        <input
                          type="text"
                          value={selectedLesson.title}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDraft((p) => ({
                              ...p,
                              modules: p.modules.map((m) =>
                                m.id === selectedModuleId
                                  ? {
                                      ...m,
                                      lessons: m.lessons.map((l) =>
                                        l.id === selectedLesson.id ? { ...l, title: val } : l
                                      ),
                                    }
                                  : m
                              ),
                            }));
                          }}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 4,
                            border: '1px solid var(--border, #272727)',
                            background: 'var(--card, #0A0A0A)',
                            color: 'var(--foreground, #FAFAFA)',
                            fontSize: 12,
                          }}
                        />
                      </label>

                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                        Content Type
                        <select
                          value={selectedLesson.contentType}
                          onChange={(e) => {
                            const val = e.target.value as Lesson['contentType'];
                            setDraft((p) => ({
                              ...p,
                              modules: p.modules.map((m) =>
                                m.id === selectedModuleId
                                  ? {
                                      ...m,
                                      lessons: m.lessons.map((l) =>
                                        l.id === selectedLesson.id ? { ...l, contentType: val } : l
                                      ),
                                    }
                                  : m
                              ),
                            }));
                          }}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 4,
                            border: '1px solid var(--border, #272727)',
                            background: 'var(--card, #0A0A0A)',
                            color: 'var(--foreground, #FAFAFA)',
                            fontSize: 12,
                          }}
                        >
                          <option value="video">Video</option>
                          <option value="article">Article / Text</option>
                          <option value="document">Document / PDF</option>
                          <option value="quiz">Quiz / Assessment</option>
                          <option value="link">External Link</option>
                        </select>
                      </label>

                      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                        Estimated Minutes
                        <input
                          type="number"
                          value={selectedLesson.durationMinutes}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setDraft((p) => ({
                              ...p,
                              modules: p.modules.map((m) =>
                                m.id === selectedModuleId
                                  ? {
                                      ...m,
                                      lessons: m.lessons.map((l) =>
                                        l.id === selectedLesson.id ? { ...l, durationMinutes: val } : l
                                      ),
                                    }
                                  : m
                              ),
                            }));
                          }}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 4,
                            border: '1px solid var(--border, #272727)',
                            background: 'var(--card, #0A0A0A)',
                            color: 'var(--foreground, #FAFAFA)',
                            fontSize: 12,
                          }}
                        />
                      </label>
                    </>
                  ) : selectedModule ? (
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600 }}>
                      Module Title
                      <input
                        type="text"
                        value={selectedModule.title}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDraft((p) => ({
                            ...p,
                            modules: p.modules.map((m) =>
                              m.id === selectedModule.id ? { ...m, title: val } : m
                            ),
                          }));
                        }}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 4,
                          border: '1px solid var(--border, #272727)',
                          background: 'var(--card, #0A0A0A)',
                          color: 'var(--foreground, #FAFAFA)',
                          fontSize: 12,
                        }}
                      />
                    </label>
                  ) : (
                    <p style={{ fontSize: 12, color: 'var(--muted-foreground, #A1A1AA)' }}>
                      Select a module or lesson from the outline to edit properties.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: CONTENT */}
          {currentStep === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground, #FAFAFA)', margin: 0 }}>
                Step 3: Attach Material & Content
              </h3>
              <p style={{ fontSize: 13, color: 'var(--muted-foreground, #A1A1AA)', margin: 0 }}>
                Add video links, rich text, or documents for each lesson in your course outline.
              </p>

              {draft.modules.flatMap((m) => m.lessons).map((les) => (
                <div
                  key={les.id}
                  style={{
                    background: 'var(--background, #000000)',
                    border: '1px solid var(--border, #272727)',
                    borderRadius: 'var(--radius-md, 6px)',
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 13, color: 'var(--foreground, #FAFAFA)' }}>{les.title}</strong>
                    <span className={styles.pill} style={{ fontSize: 11 }}>
                      {les.contentType.toUpperCase()}
                    </span>
                  </div>

                  <input
                    type="text"
                    placeholder={
                      les.contentType === 'video'
                        ? 'Video URL (e.g. MP4 link or Vimeo embed)…'
                        : les.contentType === 'document'
                        ? 'Document / PDF URL…'
                        : 'Content reference link…'
                    }
                    value={les.contentUrl ?? ''}
                    onChange={(e) => {
                      const url = e.target.value;
                      setDraft((p) => ({
                        ...p,
                        modules: p.modules.map((m) => ({
                          ...m,
                          lessons: m.lessons.map((l) => (l.id === les.id ? { ...l, contentUrl: url } : l)),
                        })),
                      }));
                    }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 4,
                      border: '1px solid var(--border, #272727)',
                      background: 'var(--card, #0A0A0A)',
                      color: 'var(--foreground, #FAFAFA)',
                      fontSize: 12,
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* STEP 4: ASSESSMENT (Optional) */}
          {currentStep === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground, #FAFAFA)', margin: 0 }}>
                Step 4: Optional Evaluation & Assessment
              </h3>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                Passing Score (%)
                <input
                  type="number"
                  value={draft.passingScore}
                  onChange={(e) => setDraft((p) => ({ ...p, passingScore: Number(e.target.value) }))}
                  min={50}
                  max={100}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md, 4px)',
                    border: '1px solid var(--border, #272727)',
                    background: 'var(--card, #0A0A0A)',
                    color: 'var(--foreground, #FAFAFA)',
                    fontSize: 13,
                    width: 140,
                  }}
                />
              </label>

              <div
                style={{
                  background: 'var(--background, #000000)',
                  border: '1px solid var(--border, #272727)',
                  borderRadius: 'var(--radius-md, 6px)',
                  padding: 16,
                  textAlign: 'center',
                }}
              >
                <p style={{ fontSize: 13, color: 'var(--muted-foreground, #A1A1AA)', margin: '0 0 12px' }}>
                  Learners will complete quizzes at the end of each module or after final lessons.
                </p>
                <button type="button" className={styles.secondaryButton} style={{ padding: '6px 14px', fontSize: 12 }}>
                  + Add Quiz Question
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: SETTINGS */}
          {currentStep === 5 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground, #FAFAFA)', margin: 0 }}>
                Step 5: Visibility & Completion Rules
              </h3>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                Publication Visibility
                <select
                  value={draft.visibility}
                  onChange={(e) => setDraft((p) => ({ ...p, visibility: e.target.value as CourseDraft['visibility'] }))}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md, 4px)',
                    border: '1px solid var(--border, #272727)',
                    background: 'var(--card, #0A0A0A)',
                    color: 'var(--foreground, #FAFAFA)',
                    fontSize: 13,
                  }}
                >
                  <option value="DRAFT">Save as Draft (Private)</option>
                  <option value="PUBLISHED">Published to Catalog</option>
                  <option value="ASSIGNED_ONLY">Assigned Learners Only</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
                Enrollment Rule
                <select
                  value={draft.enrollmentMode}
                  onChange={(e) => setDraft((p) => ({ ...p, enrollmentMode: e.target.value as CourseDraft['enrollmentMode'] }))}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md, 4px)',
                    border: '1px solid var(--border, #272727)',
                    background: 'var(--card, #0A0A0A)',
                    color: 'var(--foreground, #FAFAFA)',
                    fontSize: 13,
                  }}
                >
                  <option value="OPEN">Open Self-Enrollment</option>
                  <option value="APPROVAL">Requires Manager Approval</option>
                  <option value="INVITE">Invite / Assigned Only</option>
                </select>
              </label>

              <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, fontWeight: 600, marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={draft.certificateEnabled}
                  onChange={(e) => setDraft((p) => ({ ...p, certificateEnabled: e.target.checked }))}
                />
                Auto-issue completion certificate upon passing course
              </label>
            </div>
          )}

          {/* STEP 6: REVIEW & PUBLISH */}
          {currentStep === 6 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--foreground, #FAFAFA)', margin: 0 }}>
                Step 6: Review & Final Confirmation
              </h3>

              <div
                style={{
                  background: 'var(--background, #000000)',
                  border: '1px solid var(--border, #272727)',
                  borderRadius: 'var(--radius-md, 6px)',
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  fontSize: 13,
                }}
              >
                <div>
                  <span style={{ color: 'var(--muted-foreground, #A1A1AA)', fontSize: 11, display: 'block' }}>Course Title</span>
                  <strong style={{ fontSize: 15 }}>{draft.title}</strong>
                </div>

                <div>
                  <span style={{ color: 'var(--muted-foreground, #A1A1AA)', fontSize: 11, display: 'block' }}>Description</span>
                  <p style={{ margin: '2px 0 0', color: 'var(--foreground, #FAFAFA)' }}>{draft.description}</p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <span style={{ color: 'var(--muted-foreground, #A1A1AA)', fontSize: 11, display: 'block' }}>Category & Level</span>
                    <strong>{draft.category} · {draft.level}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--muted-foreground, #A1A1AA)', fontSize: 11, display: 'block' }}>Structure Count</span>
                    <strong>{draft.modules.length} Modules · {draft.modules.reduce((acc, m) => acc + m.lessons.length, 0)} Lessons</strong>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border, #272727)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--background, #000000)',
          }}
        >
          <div>
            {currentStep > 1 && (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setCurrentStep((p) => p - 1)}
                disabled={isSubmitting}
                style={{ padding: '8px 16px', fontSize: 13 }}
              >
                ← Back
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => handlePublish(false)}
              disabled={isSubmitting || !canProceed()}
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              {isSubmitting ? 'Saving…' : 'Save as Draft'}
            </button>

            {currentStep < 6 ? (
              <button
                type="button"
                className={styles.button}
                onClick={() => setCurrentStep((p) => p + 1)}
                disabled={!canProceed()}
                style={{ padding: '8px 20px', fontSize: 13 }}
              >
                Continue →
              </button>
            ) : (
              <button
                type="button"
                className={styles.button}
                onClick={() => handlePublish(true)}
                disabled={isSubmitting}
                style={{ padding: '8px 24px', fontSize: 13 }}
              >
                {isSubmitting ? 'Publishing…' : 'Publish Course'}
              </button>
            )}
          </div>
        </div>
      </MotionDrawer>
    </>
  );
}
