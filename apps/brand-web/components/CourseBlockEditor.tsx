'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LearningCourseVersion } from '@expadio/postgres-runtime/learning';

type BlockType = 'RICH_TEXT' | 'HEADING' | 'CALLOUT';
interface Block {
  id: string;
  type: BlockType | string;
  position: number;
  data: Record<string, unknown>;
  accessibility?: Record<string, unknown>;
}
interface ContentDocument { schemaVersion: 1; blocks: Block[] }

function editableDraft(version: LearningCourseVersion) {
  return {
    title: version.title,
    summary: version.summary,
    description: version.description,
    language: version.language,
    visibility: version.visibility,
    estimatedMinutes: version.estimatedMinutes,
    learningObjectives: [...version.learningObjectives],
    modules: version.modules.map((module) => ({
      moduleKey: module.moduleKey,
      title: module.title,
      position: module.position,
      lessons: module.lessons.map((lesson) => ({
        lessonId: lesson.lessonId,
        lessonKey: lesson.lessonKey,
        title: lesson.title,
        activityType: lesson.activityType,
        position: lesson.position,
        required: lesson.required,
        estimatedMinutes: lesson.estimatedMinutes,
        content: lesson.content,
      })),
    })),
  };
}

function normalized(blocks: Block[]): Block[] {
  return blocks.map((block, index) => ({ ...block, position: index + 1 }));
}

function documentFor(value: Readonly<Record<string, unknown>>): ContentDocument {
  if (Object.keys(value).length === 0) return { schemaVersion: 1, blocks: [] };
  if (value.schemaVersion !== 1 || !Array.isArray(value.blocks)) {
    throw new Error('LESSON_CONTENT_MIGRATION_REQUIRED');
  }
  return { schemaVersion: 1, blocks: normalized(value.blocks as Block[]) };
}

function initialBlock(type: BlockType): Block {
  const common = { id: `block-${crypto.randomUUID()}`, type, position: 1 };
  if (type === 'HEADING') return { ...common, data: { text: 'New heading', level: 2 } };
  if (type === 'CALLOUT') return { ...common, data: { text: 'New callout', tone: 'INFO' } };
  return { ...common, data: { text: 'New text block' } };
}

export function CourseBlockEditor({
  courseId,
  version,
}: {
  courseId: string;
  version: LearningCourseVersion;
}) {
  const [draft, setDraft] = useState(() => editableDraft(version));
  const lessons = useMemo(() => draft.modules.flatMap((module) => module.lessons), [draft]);
  const [lessonId, setLessonId] = useState(lessons[0]?.lessonId ?? '');
  const [command, setCommand] = useState('');
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<'SAVED' | 'UNSAVED' | 'SAVING' | 'ERROR'>('SAVED');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const editable = version.state === 'DRAFT';

  const selected = lessons.find((lesson) => lesson.lessonId === lessonId);
  let content: ContentDocument | null = null;
  let migrationRequired = false;
  try {
    content = selected ? documentFor(selected.content) : null;
  } catch {
    migrationRequired = true;
  }

  const validationIssues = migrationRequired
    ? ['Legacy content must be migrated before editing.']
    : (content?.blocks ?? []).flatMap((block, index) => {
        if (['RICH_TEXT', 'HEADING', 'CALLOUT'].includes(block.type) && String(block.data.text ?? '').trim() === '') {
          return [`Block ${index + 1} requires text.`];
        }
        return [];
      });
  const validationKey = validationIssues.join('|');

  function updateBlocks(change: (blocks: Block[]) => Block[]) {
    if (!selected || migrationRequired) return;
    setDraft((current) => ({
      ...current,
      modules: current.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson) => lesson.lessonId === lessonId
          ? { ...lesson, content: { schemaVersion: 1, blocks: normalized(change(documentFor(lesson.content).blocks)) } }
          : lesson),
      })),
    }));
    setDirty(true); setStatus('UNSAVED'); setError(null);
  }

  async function save(signal?: AbortSignal) {
    if (validationIssues.length > 0) throw new Error('LESSON_CONTENT_VALIDATION_FAILED');
    setStatus('SAVING');
    const response = await fetch(`/api/learning/courses/${courseId}/versions/${version.version}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...draft,
        modules: draft.modules.map((module) => ({
          moduleKey: module.moduleKey,
          title: module.title,
          position: module.position,
          lessons: module.lessons.map(({ lessonId: _lessonId, ...lesson }) => lesson),
        })),
      }),
      signal,
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? 'DRAFT_SAVE_FAILED');
    setDirty(false); setStatus('SAVED'); setError(null);
  }

  useEffect(() => {
    if (!dirty || !editable || validationIssues.length > 0) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void save(controller.signal).catch((cause) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setStatus('ERROR');
        setError(cause instanceof Error ? cause.message : 'DRAFT_SAVE_FAILED');
      });
    }, 800);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [draft, dirty, editable, validationKey]);

  async function insertCommand() {
    const text = command.trim();
    if (text.toLowerCase().startsWith('/ai ')) {
      const prompt = text.substring(4).trim();
      if (!prompt) { setError('Provide a prompt for the AI.'); return; }
      
      setCommand('');
      setStatus('SAVING');
      try {
        const response = await fetch('/api/learning/ai/requests', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            requestType: 'AUTHOR_DRAFT',
            prompt,
            courseId,
            idempotencyKey: crypto.randomUUID(),
            metadata: { surface: 'course-block-editor' },
          }),
        });
        const created = await response.json() as { learningAiRequestId?: string; error?: string };
        if (!response.ok || !created.learningAiRequestId) throw new Error(created.error ?? 'AI request failed');

        let outputContent = null;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const statusRes = await fetch(`/api/learning/ai/requests/${created.learningAiRequestId}`, { cache: 'no-store' });
          const current = await statusRes.json() as any;
          if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(current.jobStatus)) {
            if (current.jobStatus === 'SUCCEEDED' && current.output?.content) {
              outputContent = current.output.content;
            } else {
              throw new Error(current.lastFailureCode ?? 'AI job failed');
            }
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        if (outputContent) {
          updateBlocks((blocks) => [...blocks, { ...initialBlock('RICH_TEXT'), data: { text: outputContent } }]);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'AI generation failed');
      } finally {
        setStatus('SAVED');
      }
      return;
    }

    const commands: Record<string, BlockType> = {
      '/text': 'RICH_TEXT',
      '/heading': 'HEADING',
      '/callout': 'CALLOUT',
    };
    const type = commands[text.toLowerCase()];
    if (!type) { setError('Use /text, /heading, /callout, or /ai <prompt>.'); return; }
    updateBlocks((blocks) => [...blocks, initialBlock(type)]);
    setCommand('');
  }

  if (!editable) return <p>This version is immutable. Create a draft to edit blocks.</p>;
  if (lessons.length === 0) return <p>Add a lesson before creating content blocks.</p>;

  return (
    <div className="learningBlockEditor">
      <div className="blockEditorToolbar">
        <label>Lesson
          <select value={lessonId} onChange={(event) => setLessonId(event.target.value)}>
            {lessons.map((lesson) => <option key={lesson.lessonId} value={lesson.lessonId}>{lesson.title}</option>)}
          </select>
        </label>
        <label>Insert block
          <span><input value={command} placeholder="/text" onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); insertCommand(); } }} /><button type="button" onClick={insertCommand}>Insert</button></span>
        </label>
        <button type="button" aria-pressed={preview} onClick={() => setPreview((value) => !value)}>{preview ? 'Edit' : 'Preview'}</button>
        <button type="button" disabled={!dirty || status === 'SAVING'} onClick={() => void save().catch((cause) => { setStatus('ERROR'); setError(cause instanceof Error ? cause.message : 'DRAFT_SAVE_FAILED'); })}>Save now</button>
      </div>
      {migrationRequired ? <p role="alert">This lesson uses legacy content and must be migrated before block editing.</p> : null}
      {!migrationRequired && content && preview ? (
        <div className="blockPreview" aria-label="Lesson preview">
          {content.blocks.map((block) => {
            const text = String(block.data.text ?? '');
            if (block.type === 'HEADING') return <h3 key={block.id}>{text}</h3>;
            if (block.type === 'CALLOUT') return <aside key={block.id}>{text}</aside>;
            if (block.type === 'RICH_TEXT') return <p key={block.id}>{text}</p>;
            return <p key={block.id}>Preview is provided by the specialized {block.type} renderer.</p>;
          })}
        </div>
      ) : null}
      {!migrationRequired && content && !preview ? (
        <ol className="blockList" aria-label="Lesson content blocks">
          {content.blocks.map((block, index) => (
            <li key={block.id}>
              <div className="blockHead"><strong>{block.position}. {block.type}</strong><div>
                <button type="button" aria-label={`Move ${block.type} up`} disabled={index === 0} onClick={() => updateBlocks((blocks) => { const next = [...blocks]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next; })}>↑</button>
                <button type="button" aria-label={`Move ${block.type} down`} disabled={index === content!.blocks.length - 1} onClick={() => updateBlocks((blocks) => { const next = [...blocks]; [next[index], next[index + 1]] = [next[index + 1]!, next[index]!]; return next; })}>↓</button>
                <button type="button" onClick={() => updateBlocks((blocks) => { const copy = { ...block, id: `block-${crypto.randomUUID()}`, data: { ...block.data } }; return [...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)]; })}>Duplicate</button>
                <button type="button" onClick={() => updateBlocks((blocks) => blocks.filter((entry) => entry.id !== block.id))}>Delete</button>
              </div></div>
              {['RICH_TEXT', 'HEADING', 'CALLOUT'].includes(block.type) ? <textarea aria-label={`${block.type} content`} value={String(block.data.text ?? '')} onChange={(event) => updateBlocks((blocks) => blocks.map((entry) => entry.id === block.id ? { ...entry, data: { ...entry.data, text: event.target.value } } : entry))} /> : <p>Managed by its specialized editor.</p>}
            </li>
          ))}
        </ol>
      ) : null}
      {validationIssues.length > 0 ? <section className="validationSummary" aria-labelledby="lesson-validation-title"><strong id="lesson-validation-title">Validation</strong><ul>{validationIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></section> : null}
      <p role="status" aria-live="polite">Draft: {status}{dirty ? ' · unsaved changes' : ''}</p>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
