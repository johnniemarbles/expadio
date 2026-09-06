'use client';

import { FormEvent, useState } from 'react';
import { MotionDrawer } from '@expadio/ui';

interface AgentDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onRegistered?: () => void;
}

export function AgentDrawer({ isOpen, onClose, onRegistered }: AgentDrawerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch('/api/platform/agents/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentKey: String(form.get('agentKey') || ''),
          title: String(form.get('title') || ''),
          modelName: String(form.get('modelName') || 'gemini-1.5-pro'),
          provider: String(form.get('provider') || 'google-vertex'),
          systemPrompt: String(form.get('systemPrompt') || ''),
          capabilities: ['telemetry', 'analysis', 'execution'],
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Agent registration failed');

      onRegistered?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          zIndex: 99,
        }}
      />

      <MotionDrawer
        open={isOpen}
        side="right"
        style={{
          width: '100%',
          maxWidth: 640,
          background: 'var(--theme-surface)',
          borderLeft: '1px solid var(--theme-border)',
          borderRadius: 'var(--theme-radius-card) 0 0 var(--theme-radius-card)',
          boxShadow: 'var(--theme-shadow-subtle)',
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
        {/* Header */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid var(--theme-border)',
            background: 'var(--theme-surface-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--theme-primary)',
              }}
            >
              AI REGISTRY & BINDINGS
            </span>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--theme-text-primary)' }}>
              Register Autonomous Agent
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--theme-border)',
              borderRadius: 'var(--theme-radius-card)',
              color: 'var(--theme-text-muted)',
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

        {error && (
          <div
            style={{
              margin: '16px 24px 0',
              padding: '12px 14px',
              borderRadius: 'var(--theme-radius-card)',
              background: 'color-mix(in srgb, var(--theme-danger) 10%, transparent)',
              border: '1px solid var(--theme-danger)',
              color: 'var(--theme-danger)',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ padding: 24, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
              Agent Key *
              <input
                name="agentKey"
                required
                placeholder="e.g. ops-telemetry-auditor"
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--theme-radius-card)',
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-surface-muted)',
                  color: 'var(--theme-text-primary)',
                  fontSize: 13,
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
              Display Title *
              <input
                name="title"
                required
                placeholder="e.g. Telemetry & SLA Auditor"
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--theme-radius-card)',
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-surface-muted)',
                  color: 'var(--theme-text-primary)',
                  fontSize: 13,
                }}
              />
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
              AI Model Engine
              <select
                name="modelName"
                defaultValue="gemini-1.5-pro"
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--theme-radius-card)',
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-surface-muted)',
                  color: 'var(--theme-text-primary)',
                  fontSize: 13,
                }}
              >
                <option value="gemini-1.5-pro">Gemini 1.5 Pro (Recommended)</option>
                <option value="gemini-1.5-flash">Gemini 1.5 Flash (Fast)</option>
                <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                <option value="gpt-4o">GPT-4o</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
              Infrastructure Provider
              <select
                name="provider"
                defaultValue="google-vertex"
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--theme-radius-card)',
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-surface-muted)',
                  color: 'var(--theme-text-primary)',
                  fontSize: 13,
                }}
              >
                <option value="google-vertex">Google Vertex AI / Gemini API</option>
                <option value="anthropic-direct">Anthropic API</option>
                <option value="openai-direct">OpenAI API</option>
                <option value="bedrock">AWS Bedrock</option>
              </select>
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600 }}>
            System Directive / Prompt *
            <textarea
              name="systemPrompt"
              required
              rows={5}
              placeholder="Specify the autonomous system behavior, safety guardrails, and action boundaries..."
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--theme-radius-card)',
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-surface-muted)',
                color: 'var(--theme-text-primary)',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            style={{
              marginTop: 12,
              height: 40,
              fontSize: 13,
              fontWeight: 700,
              borderRadius: 'var(--theme-radius-card)',
              background: 'var(--theme-primary)',
              color: 'var(--theme-surface)',
              border: 'none',
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Registering Agent...' : 'Register Agent →'}
          </button>
        </form>
      </MotionDrawer>
    </>
  );
}
