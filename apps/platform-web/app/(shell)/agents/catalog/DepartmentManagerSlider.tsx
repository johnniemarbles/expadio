'use client';

import React, { useState, useEffect } from 'react';
import { SlidePanel, Button, TextField } from '@expadio/ui';
import { useRouter } from 'next/navigation';

export interface DepartmentManagerSliderProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DepartmentManagerSlider({ isOpen, onClose }: DepartmentManagerSliderProps) {
  const router = useRouter();
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states for new department
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // Edit state
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editFormName, setEditFormName] = useState('');
  const [editFormDesc, setEditFormDesc] = useState('');

  const fetchDepartments = async () => {
    try {
      const res = await fetch('/api/agent-departments');
      if (res.ok) {
        const data = await res.json();
        setDepartments(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDepartments();
      setError(null);
      setNewName('');
      setNewDesc('');
      setEditingName(null);
    }
  }, [isOpen]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/agent-departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, description: newDesc })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to add department');
      }
      setNewName('');
      setNewDesc('');
      await fetchDepartments();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (originalName: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent-departments/${encodeURIComponent(originalName)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editFormName, description: editFormDesc })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update department');
      }
      setEditingName(null);
      await fetchDepartments();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Are you sure you want to delete the department "${name}"? This will fail if agents are assigned to it.`)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent-departments/${encodeURIComponent(name)}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete department');
      }
      await fetchDepartments();
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SlidePanel isOpen={isOpen} onClose={onClose} title="Manage Departments" width="450px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {error && <div style={{ color: 'var(--theme-danger)', fontSize: '13px' }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {departments.map((dept) => (
            <div key={dept.name} style={{ 
              border: '1px solid var(--theme-border)', 
              padding: '12px', 
              borderRadius: 'var(--theme-radius-card)',
              background: 'var(--theme-surface)' 
            }}>
              {editingName === dept.name ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <TextField 
                    value={editFormName} 
                    onChange={(e: any) => setEditFormName(e.target.value)} 
                    placeholder="Department Name" 
                  />
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                    <Button tone="ghost" size="sm" onClick={() => setEditingName(null)} disabled={loading}>Cancel</Button>
                    <Button tone="primary" size="sm" onClick={() => handleUpdate(dept.name)} disabled={loading}>Save</Button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--theme-text-primary)' }}>{dept.name}</div>
                    {dept.description && <div style={{ fontSize: '12px', color: 'var(--theme-text-secondary)', marginTop: '2px' }}>{dept.description}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <Button tone="ghost" size="sm" onClick={() => {
                      setEditingName(dept.name);
                      setEditFormName(dept.name);
                      setEditFormDesc(dept.description || '');
                    }}>Edit</Button>
                    <Button tone="ghost" size="sm" onClick={() => handleDelete(dept.name)} style={{ color: 'var(--theme-danger)' }}>Delete</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {departments.length === 0 && <div style={{ fontSize: '13px', color: 'var(--theme-text-muted)' }}>No departments found.</div>}
        </div>

        <div style={{ borderTop: '1px solid var(--theme-border)', paddingTop: '24px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>Add New Department</h3>
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <TextField 
              placeholder="Department Name (e.g. Legal)" 
              value={newName} 
              onChange={(e: any) => setNewName(e.target.value)} 
              required 
            />
            <Button tone="secondary" type="submit" disabled={loading || !newName.trim()}>
              {loading ? 'Adding...' : '+ Add Department'}
            </Button>
          </form>
        </div>
      </div>
    </SlidePanel>
  );
}
