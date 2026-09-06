'use client';

import React, { useState, useEffect } from 'react';
import { SlidePanel, Button, TextField } from '@expadio/ui';
import { useRouter } from 'next/navigation';

export interface AgentEditorSliderProps {
  isOpen: boolean;
  onClose: () => void;
  editingAgent?: any | null; // null if adding new
}

export function AgentEditorSlider({ isOpen, onClose, editingAgent }: AgentEditorSliderProps) {
  const router = useRouter();
  const [department, setDepartment] = useState('');
  const [slug, setSlug] = useState('');
  const [persona, setPersona] = useState('');
  const [tools, setTools] = useState<string[]>([]);
  const [defaultOn, setDefaultOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableDepartments, setAvailableDepartments] = useState<string[]>([]);

  const availableTools = ['GitHub', 'FS', 'DB', 'Audit', 'Comms'];

  useEffect(() => {
    let active = true;
    if (isOpen) {
      fetch('/api/agent-departments')
        .then(r => r.json())
        .then(data => {
          if (active && Array.isArray(data)) setAvailableDepartments(data.map((d: any) => d.name));
        })
        .catch(console.error);

      if (editingAgent) {
        setDepartment(editingAgent.department || '');
        setSlug(editingAgent.capability_key || editingAgent.slug || '');
        setPersona(editingAgent.display_name || editingAgent.persona || '');
        setTools(Array.isArray(editingAgent.tools) ? editingAgent.tools : []);
        setDefaultOn(!!editingAgent.default_on);
      } else {
        setDepartment('');
        setSlug('');
        setPersona('');
        setTools([]);
        setDefaultOn(false);
      }
      setError(null);
    }
    return () => { active = false; };
  }, [isOpen, editingAgent]);

  const toggleTool = (t: string) => {
    setTools(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const url = editingAgent 
        ? `/api/agent-definitions/${editingAgent.agent_id || editingAgent.capability_id}`
        : `/api/agent-definitions`;
      const method = editingAgent ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ department, slug, persona, tools, default_on: defaultOn })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save agent definition');
      }

      router.refresh();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSuspend = async () => {
    if (!editingAgent) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/agent-definitions/${editingAgent.agent_id || editingAgent.capability_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'SUSPENDED' })
      });
      if (!res.ok) throw new Error('Failed to suspend agent');
      router.refresh();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!editingAgent) return;
    if (!confirm('Are you sure you want to permanently delete this agent?')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/agent-definitions/${editingAgent.agent_id || editingAgent.capability_id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete agent');
      router.refresh();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SlidePanel 
      isOpen={isOpen} 
      onClose={onClose} 
      title={editingAgent ? 'Edit Agent Definition' : 'New Agent Definition'}
      width="450px"
    >
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {error && <div style={{ color: 'var(--theme-danger)', fontSize: '13px' }}>{error}</div>}
        
        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}>Department</label>
          <select 
            value={department} 
            onChange={(e) => setDepartment(e.target.value)}
            required
            style={{ width: '100%', padding: '9px 12px', borderRadius: 'var(--theme-radius-card)', border: '1px solid var(--theme-border)', background: 'var(--theme-surface-base)', color: 'var(--theme-text-primary)' }}
          >
            <option value="" disabled>Select Department...</option>
            {availableDepartments.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}>Persona Name</label>
          <TextField 
            placeholder="e.g. Backend API Specialist"
            value={persona}
            onChange={(e: any) => setPersona(e.target.value)}
            required
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}>Slug (Unique ID)</label>
          <TextField 
            placeholder="e.g. eng-backend-specialist"
            value={slug}
            onChange={(e: any) => setSlug(e.target.value)}
            required
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', fontWeight: 600 }}>Tool Grants</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {availableTools.map(t => (
              <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', background: 'var(--theme-surface-muted)', padding: '6px 10px', borderRadius: '4px', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={tools.includes(t)}
                  onChange={() => toggleTool(t)}
                />
                {t}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={defaultOn}
              onChange={(e) => setDefaultOn(e.target.checked)}
            />
            Equipped by default for new tenants
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--theme-border)' }}>
          <div>
            {editingAgent && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button tone="secondary" onClick={handleSuspend} disabled={loading} type="button">Suspend</Button>
                <Button tone="danger" onClick={handleDelete} disabled={loading} type="button">Delete</Button>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button tone="ghost" onClick={onClose} type="button">Cancel</Button>
            <Button tone="primary" type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save Agent'}</Button>
          </div>
        </div>
      </form>
    </SlidePanel>
  );
}
