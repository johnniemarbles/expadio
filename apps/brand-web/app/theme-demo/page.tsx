'use client';

import React, { useState } from 'react';

// Default theme matching standard styles
const defaultTheme = {
  name: 'Default',
  primary: '#0070f3',
  background: '#ffffff',
  text: '#111111',
  surface: '#f5f5f5',
  borderRadius: '8px'
};

export default function ThemeDemoPage() {
  const [themes, setThemes] = useState([defaultTheme]);
  const [activeThemeIndex, setActiveThemeIndex] = useState(0);
  const [prompt, setPrompt] = useState('');
  
  const activeTheme = themes[activeThemeIndex];

  const handleAddTheme = () => {
    // Generate a random mock theme for demonstration purposes
    const randomColor = () => '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    
    const newTheme = {
      name: prompt || `Generated Theme ${themes.length}`,
      primary: randomColor(),
      background: randomColor(),
      text: randomColor(),
      surface: randomColor(),
      borderRadius: `${Math.floor(Math.random() * 20)}px`
    };
    
    setThemes([...themes, newTheme]);
    setActiveThemeIndex(themes.length); // Switch to the new theme
    setPrompt('');
  };

  return (
    <div 
      style={{
        '--theme-primary': activeTheme.primary,
        '--theme-background': activeTheme.background,
        '--theme-text': activeTheme.text,
        '--theme-surface': activeTheme.surface,
        '--theme-radius': activeTheme.borderRadius,
        backgroundColor: 'var(--theme-background)',
        color: 'var(--theme-text)',
        minHeight: '100vh',
        fontFamily: 'sans-serif'
      } as React.CSSProperties}
    >
      {/* Tab Navigation */}
      <div style={{ padding: '20px', borderBottom: '1px solid var(--theme-surface)' }}>
        <h1>Theme Design Playground</h1>
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px', overflowX: 'auto' }}>
          {themes.map((theme, index) => (
            <button
              key={index}
              onClick={() => setActiveThemeIndex(index)}
              style={{
                padding: '10px 20px',
                backgroundColor: index === activeThemeIndex ? 'var(--theme-primary)' : 'var(--theme-surface)',
                color: index === activeThemeIndex ? '#fff' : 'var(--theme-text)',
                border: 'none',
                borderRadius: 'var(--theme-radius)',
                cursor: 'pointer',
                fontWeight: index === activeThemeIndex ? 'bold' : 'normal'
              }}
            >
              {theme.name}
            </button>
          ))}
        </div>
      </div>

      {/* Generator Panel */}
      <div style={{ padding: '40px 20px', backgroundColor: 'var(--theme-surface)' }}>
        <h2>Generate New Theme</h2>
        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
          <input 
            type="text" 
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter a theme prompt (e.g. 'Dark neon cyberpunk')"
            style={{
              padding: '10px',
              borderRadius: 'var(--theme-radius)',
              border: '1px solid #ccc',
              flex: 1,
              maxWidth: '400px'
            }}
          />
          <button 
            onClick={handleAddTheme}
            style={{
              padding: '10px 20px',
              backgroundColor: 'var(--theme-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--theme-radius)',
              cursor: 'pointer'
            }}
          >
            Generate & Apply
          </button>
        </div>
        <div style={{ marginTop: '20px', padding: '20px', border: '2px dashed #ccc', borderRadius: 'var(--theme-radius)', maxWidth: '400px', textAlign: 'center' }}>
          <p>Or drag and drop a screenshot here</p>
          <small>(Screenshot extraction coming soon)</small>
        </div>
      </div>

      {/* The Demo Sandbox Area */}
      <div style={{ padding: '40px 20px' }}>
        <h2>Dashboard Preview</h2>
        <p>This sandbox updates dynamically to reflect the active theme.</p>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginTop: '20px' }}>
          {/* Sample Card */}
          <div style={{ backgroundColor: 'var(--theme-surface)', padding: '20px', borderRadius: 'var(--theme-radius)', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginTop: 0 }}>Analytics Summary</h3>
            <div style={{ fontSize: '2rem', color: 'var(--theme-primary)', fontWeight: 'bold' }}>+24%</div>
            <p>Traffic increase over the last 30 days.</p>
            <button style={{
              padding: '8px 16px',
              backgroundColor: 'var(--theme-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--theme-radius)',
              cursor: 'pointer',
              marginTop: '10px'
            }}>
              View Report
            </button>
          </div>

          {/* Sample Form Element */}
          <div style={{ backgroundColor: 'var(--theme-surface)', padding: '20px', borderRadius: 'var(--theme-radius)', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginTop: 0 }}>Quick Settings</h3>
            <label style={{ display: 'block', marginBottom: '10px' }}>
              <input type="checkbox" defaultChecked style={{ marginRight: '8px', accentColor: 'var(--theme-primary)' }} />
              Enable Notifications
            </label>
            <label style={{ display: 'block', marginBottom: '10px' }}>
              <input type="checkbox" style={{ marginRight: '8px', accentColor: 'var(--theme-primary)' }} />
              Dark Mode Preferences
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
