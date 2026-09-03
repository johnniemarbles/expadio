'use client';

import { useState } from 'react';
import type { LearningCourseVersion } from '@expadio/postgres-runtime/learning';

type AssetState = 'PENDING_UPLOAD' | 'UPLOADED' | 'QUARANTINED' | 'AVAILABLE' | 'REJECTED' | 'DELETED';
interface AssetRecord { assetId: string; state: AssetState; filename: string; contentType: string }
type Phase = 'IDLE' | 'HASHING' | 'REGISTERING' | 'UPLOADING' | 'SCANNING' | 'QUARANTINED' | 'AVAILABLE' | 'REJECTED' | 'SAVING' | 'SAVED' | 'ERROR';

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { reasonKey?: string; error?: string };
  if (!response.ok) throw new Error(body.reasonKey ?? body.error ?? `REQUEST_FAILED_${response.status}`);
  return body;
}

async function digest(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
}

function blockFor(file: File, assetId: string, position: number) {
  const id = `asset-${crypto.randomUUID()}`;
  if (file.type.startsWith('image/')) {
    return { id, type: 'IMAGE', position, data: { assetId }, accessibility: { label: file.name, decorative: false } };
  }
  if (file.type.startsWith('video/')) return { id, type: 'VIDEO', position, data: { assetId } };
  if (file.type.startsWith('audio/')) return { id, type: 'AUDIO', position, data: { assetId } };
  return {
    id,
    type: file.type === 'application/pdf' ? 'DOCUMENT' : 'RESOURCE',
    position,
    data: { assetId, title: file.name },
  };
}

function attach(version: LearningCourseVersion, lessonId: string, file: File, assetId: string) {
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
      lessons: module.lessons.map((lesson) => {
        if (lesson.lessonId !== lessonId) {
          return {
            lessonKey: lesson.lessonKey, title: lesson.title, activityType: lesson.activityType,
            position: lesson.position, required: lesson.required,
            estimatedMinutes: lesson.estimatedMinutes, content: lesson.content,
          };
        }
        const content = lesson.content as { schemaVersion?: unknown; blocks?: unknown };
        if (Object.keys(content).length > 0 && (content.schemaVersion !== 1 || !Array.isArray(content.blocks))) {
          throw new Error('LESSON_CONTENT_MIGRATION_REQUIRED');
        }
        const blocks = Array.isArray(content.blocks) ? [...content.blocks] : [];
        blocks.push(blockFor(file, assetId, blocks.length + 1));
        return {
          lessonKey: lesson.lessonKey, title: lesson.title, activityType: lesson.activityType,
          position: lesson.position, required: lesson.required,
          estimatedMinutes: lesson.estimatedMinutes, content: { schemaVersion: 1, blocks },
        };
      }),
    })),
  };
}

export function CourseAssetEditor({
  courseId,
  version,
}: {
  courseId: string;
  version: LearningCourseVersion;
}) {
  const lessons = version.modules.flatMap((module) => module.lessons);
  const [lessonId, setLessonId] = useState(lessons[0]?.lessonId ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [asset, setAsset] = useState<AssetRecord | null>(null);
  const [phase, setPhase] = useState<Phase>('IDLE');
  const [message, setMessage] = useState<string | null>(null);
  const editable = version.state === 'DRAFT';

  async function refresh(id: string) {
    const value = await json<AssetRecord>(await fetch(`/api/learning/content-assets/${id}`, { cache: 'no-store' }));
    setAsset(value);
    setPhase(value.state === 'AVAILABLE' ? 'AVAILABLE' : value.state === 'REJECTED' ? 'REJECTED' : 'QUARANTINED');
    return value;
  }

  async function scan(id: string) {
    setPhase('SCANNING'); setMessage(null);
    await json(await fetch(`/api/learning/content-assets/${id}/scan`, { method: 'POST' }));
    await refresh(id);
  }

  async function upload() {
    if (!file || !lessonId || !editable) return;
    try {
      setMessage(null); setPhase('HASHING');
      const sha256 = await digest(file);
      setPhase('REGISTERING');
      const registered = await json<AssetRecord>(await fetch('/api/learning/content-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          byteLength: file.size,
          sha256,
          idempotencyKey: `course:${courseId}:v${version.version}:lesson:${lessonId}:${sha256}`,
        }),
      }));
      setAsset(registered); setPhase('UPLOADING');
      const uploaded = await json<AssetRecord>(await fetch(`/api/learning/content-assets/${registered.assetId}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      }));
      setAsset(uploaded);
      await scan(registered.assetId);
    } catch (error) {
      setPhase('ERROR'); setMessage(error instanceof Error ? error.message : 'CONTENT_ASSET_WORKFLOW_FAILED');
    }
  }

  async function save() {
    if (!file || !asset || asset.state !== 'AVAILABLE') return;
    try {
      setPhase('SAVING'); setMessage(null);
      const draft = attach(version, lessonId, file, asset.assetId);
      await json(await fetch(`/api/learning/courses/${courseId}/versions/${version.version}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      }));
      setPhase('SAVED');
      setMessage('Asset attached to the draft lesson.');
    } catch (error) {
      setPhase('ERROR'); setMessage(error instanceof Error ? error.message : 'DRAFT_SAVE_FAILED');
    }
  }

  async function preview() {
    if (!asset || asset.state !== 'AVAILABLE') return;
    try {
      const grant = await json<{ url: string }>(await fetch(
        `/api/learning/content-assets/${asset.assetId}/read-grant`,
        { method: 'POST' },
      ));
      window.open(grant.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'PREVIEW_FAILED');
    }
  }

  if (!editable) return <p>This version is immutable. Create a draft before attaching assets.</p>;
  return (
    <div className="learningAssetEditor">
      <label>Lesson
        <select value={lessonId} onChange={(event) => setLessonId(event.target.value)}>
          {lessons.map((lesson) => <option key={lesson.lessonId} value={lesson.lessonId}>{lesson.title}</option>)}
        </select>
      </label>
      <label>File
        <input type="file" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setAsset(null); setPhase('IDLE'); }} />
      </label>
      <div className="assetActions">
        <button type="button" disabled={!file || !lessonId || !['IDLE', 'ERROR'].includes(phase)} onClick={() => void upload()}>
          Upload and scan
        </button>
        <button type="button" disabled={!asset || !['QUARANTINED', 'ERROR'].includes(phase)} onClick={() => asset && void scan(asset.assetId)}>
          Retry scan
        </button>
        <button type="button" disabled={asset?.state !== 'AVAILABLE'} onClick={() => void preview()}>Safe preview</button>
        <button type="button" disabled={asset?.state !== 'AVAILABLE' || phase === 'SAVING'} onClick={() => void save()}>
          {phase === 'SAVING' ? 'Saving…' : 'Attach to lesson'}
        </button>
      </div>
      <p role="status" aria-live="polite">Status: {phase}{asset ? ` · ${asset.state}` : ''}</p>
      {message ? <p role={phase === 'ERROR' ? 'alert' : 'status'}>{message}</p> : null}
    </div>
  );
}
