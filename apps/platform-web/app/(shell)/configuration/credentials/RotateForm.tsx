"use client";
import React, { useState } from 'react';
import styles from '../../page.module.css';

export function RotateForm() {
  const [provider, setProvider] = useState('twilio-sms-whatsapp-v1');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Form input states
  const [twilioAccountSid, setTwilioAccountSid] = useState('');
  const [twilioAuthToken, setTwilioAuthToken] = useState('');
  const [twilioMessagingServiceSid, setTwilioMessagingServiceSid] = useState('');
  
  const [resendApiKey, setResendApiKey] = useState('');
  const [resendWebhookSecret, setResendWebhookSecret] = useState('');

  async function handleRotate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    // Prepare payload data
    let payload: Record<string, string> = { connector_key: provider };
    if (provider.startsWith('twilio')) {
      if (!twilioAccountSid.trim() || !twilioAuthToken.trim()) {
        setMessage('Error: Account SID and Auth Token are required for Twilio.');
        setLoading(false);
        return;
      }
      payload.accountSid = twilioAccountSid;
      payload.authToken = twilioAuthToken;
      if (twilioMessagingServiceSid.trim()) {
        payload.messagingServiceSid = twilioMessagingServiceSid;
      }
    } else if (provider === 'resend-email-v1') {
      if (!resendApiKey.trim()) {
        setMessage('Error: API Key is required for Resend.');
        setLoading(false);
        return;
      }
      payload.apiKey = resendApiKey;
      if (resendWebhookSecret.trim()) {
        payload.webhookSecret = resendWebhookSecret;
      }
    }

    try {
      const response = await fetch('/api/configuration/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (data.success) {
        setMessage(`Success! Staged credential rotation. Rotation ID: ${data.rotation_id}`);
        // Reset form inputs
        setTwilioAccountSid('');
        setTwilioAuthToken('');
        setTwilioMessagingServiceSid('');
        setResendApiKey('');
        setResendWebhookSecret('');
        // Refresh page after a brief delay
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setMessage(data.message || 'Failed to stage credential rotation.');
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
            Enter credential details to securely save and rotate provider keys.
          </p>
        </div>
      </div>
      
      <form onSubmit={handleRotate} style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '300px' }}>
          <label htmlFor="provider-select" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-700)' }}>Provider Connector</label>
          <select 
            id="provider-select" 
            value={provider} 
            onChange={(e) => {
              setProvider(e.target.value);
              setMessage('');
            }}
            style={{ 
              padding: '8px 12px', 
              borderRadius: '6px', 
              border: '1px solid var(--ink-200)',
              backgroundColor: 'white',
              fontSize: '14px'
            }}
          >
            <option value="twilio-sms-whatsapp-v1">Twilio (SMS & WhatsApp)</option>
            <option value="twilio-voice-v1">Twilio (Voice Telephony)</option>
            <option value="resend-email-v1">Resend (Email Service)</option>
          </select>
        </div>

        {/* Twilio Input Fields */}
        {provider.startsWith('twilio') && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '240px' }}>
              <label htmlFor="twilio-sid" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-700)' }}>Twilio Account SID *</label>
              <input 
                id="twilio-sid"
                type="text"
                placeholder="AC..."
                value={twilioAccountSid}
                onChange={(e) => setTwilioAccountSid(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--ink-200)',
                  fontSize: '14px'
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '240px' }}>
              <label htmlFor="twilio-token" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-700)' }}>Twilio Auth Token *</label>
              <input 
                id="twilio-token"
                type="password"
                placeholder="••••••••••••••••••••••••••••••••"
                value={twilioAuthToken}
                onChange={(e) => setTwilioAuthToken(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--ink-200)',
                  fontSize: '14px'
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '240px' }}>
              <label htmlFor="twilio-msg-sid" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-700)' }}>Messaging Service / Webhook Secret SID</label>
              <input 
                id="twilio-msg-sid"
                type="text"
                placeholder="MG... (optional)"
                value={twilioMessagingServiceSid}
                onChange={(e) => setTwilioMessagingServiceSid(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--ink-200)',
                  fontSize: '14px'
                }}
              />
            </div>
          </div>
        )}

        {/* Resend Input Fields */}
        {provider === 'resend-email-v1' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '240px' }}>
              <label htmlFor="resend-api" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-700)' }}>Resend API Key *</label>
              <input 
                id="resend-api"
                type="password"
                placeholder="re_..."
                value={resendApiKey}
                onChange={(e) => setResendApiKey(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--ink-200)',
                  fontSize: '14px'
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '240px' }}>
              <label htmlFor="resend-secret" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-700)' }}>Svix Webhook Secret</label>
              <input 
                id="resend-secret"
                type="password"
                placeholder="whsec_..."
                value={resendWebhookSecret}
                onChange={(e) => setResendWebhookSecret(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--ink-200)',
                  fontSize: '14px'
                }}
              />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '8px' }}>
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
            {loading ? 'Configuring...' : 'Save & Stage Rotation'}
          </button>
          
          {message && (
            <span style={{ 
              fontSize: '13px', 
              fontWeight: 500,
              color: message.startsWith('Success') ? 'var(--green)' : 'var(--red)'
            }}>
              {message}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
