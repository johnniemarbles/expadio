"use client";
import React, { useState } from 'react';
import styles from '../../page.module.css';

export function RotateForm() {
  const [provider, setProvider] = useState('twilio-sms-whatsapp-v1');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function handleRotate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/configuration/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connector_key: provider })
      });
      const data = await response.json();
      if (data.success) {
        setMessage(`Success! Staged credential rotation. Rotation ID: ${data.rotation_id}`);
        // Refresh page after a brief delay
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setMessage('Failed to stage credential rotation.');
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.panel} style={{ marginBottom: '24px' }}>
      <div className={styles.panelHeading}>
        <div>
          <h2>Configure & Rotate Provider Credentials</h2>
          <p style={{ margin: '4px 0 0 0', color: 'var(--ink-500)', fontSize: '13px' }}>
            Select a provider connector to stage new configuration keys.
          </p>
        </div>
      </div>
      <form onSubmit={handleRotate} style={{ padding: '20px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label htmlFor="provider-select" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-700)' }}>Provider Connector</label>
          <select 
            id="provider-select" 
            value={provider} 
            onChange={(e) => setProvider(e.target.value)}
            style={{ 
              padding: '8px 12px', 
              borderRadius: '6px', 
              border: '1px solid var(--ink-200)',
              backgroundColor: 'white',
              fontSize: '14px',
              minWidth: '220px'
            }}
          >
            <option value="twilio-sms-whatsapp-v1">Twilio (SMS & WhatsApp)</option>
            <option value="twilio-voice-v1">Twilio (Voice Telephony)</option>
            <option value="resend-email-v1">Resend (Email Service)</option>
          </select>
        </div>
        <button 
          type="submit" 
          disabled={loading}
          style={{
            padding: '8px 16px',
            borderRadius: '6px',
            backgroundColor: 'var(--ink-900)',
            color: 'white',
            fontWeight: 600,
            fontSize: '14px',
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? 'Rotating...' : 'Rotate & Configure'}
        </button>
        {message && (
          <div style={{ 
            width: '100%', 
            marginTop: '12px', 
            fontSize: '13px', 
            fontWeight: 500,
            color: message.startsWith('Success') ? 'var(--green)' : 'var(--red)'
          }}>
            {message}
          </div>
        )}
      </form>
    </div>
  );
}
