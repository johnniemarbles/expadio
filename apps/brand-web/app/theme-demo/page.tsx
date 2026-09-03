'use client';

import React, { useState, useRef } from 'react';

const defaultTheme = {
  name: 'Default EXPADIO',
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeTheme = themes[activeThemeIndex];

  // Convert image to base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setIsGenerating(true);

    try {
      const base64Image = await fileToBase64(file);
      await generateThemeFromAI(base64Image, prompt);
    } catch (err: any) {
      setError(err.message || 'Failed to process image');
    } finally {
      setIsGenerating(false);
      // Reset input so the same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const generateThemeFromAI = async (base64Image: string, customPrompt: string) => {
    const response = await fetch('/api/extract-theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image, prompt: customPrompt })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'API request failed');
    }

    const newTheme = await response.json();
    setThemes([...themes, newTheme]);
    setActiveThemeIndex(themes.length); // Switch to the new theme
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setError('');
      setIsGenerating(true);
      try {
        const base64Image = await fileToBase64(file);
        await generateThemeFromAI(base64Image, prompt);
      } catch (err: any) {
        setError(err.message || 'Failed to process image');
      } finally {
        setIsGenerating(false);
      }
    } else {
      setError('Please drop a valid image file.');
    }
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
        fontFamily: 'sans-serif',
        transition: 'all 0.3s ease'
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
                fontWeight: index === activeThemeIndex ? 'bold' : 'normal',
                whiteSpace: 'nowrap'
              }}
            >
              {theme.name || `Theme ${index + 1}`}
            </button>
          ))}
        </div>
      </div>

      {/* Generator Panel */}
      <div style={{ padding: '40px 20px', backgroundColor: 'var(--theme-surface)' }}>
        <h2>Generate New Theme with AI</h2>
        
        <input 
          type="text" 
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Optional: Add hints (e.g., 'Make it dark mode', 'Use soft pastels')"
          style={{
            padding: '12px',
            borderRadius: 'var(--theme-radius)',
            border: '1px solid #ccc',
            width: '100%',
            maxWidth: '600px',
            marginBottom: '20px',
            display: 'block'
          }}
        />

        <div 
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{ 
            padding: '40px 20px', 
            border: '2px dashed var(--theme-primary)', 
            borderRadius: 'var(--theme-radius)', 
            maxWidth: '600px', 
            textAlign: 'center',
            backgroundColor: 'var(--theme-background)',
            cursor: isGenerating ? 'wait' : 'pointer',
            opacity: isGenerating ? 0.7 : 1
          }}
        >
          {isGenerating ? (
            <p style={{ fontWeight: 'bold' }}>🤖 AI is analyzing your image and extracting theme...</p>
          ) : (
            <>
              <p>Click or drag & drop a UI screenshot here to extract its theme</p>
              <small>Supported formats: JPG, PNG, WEBP</small>
            </>
          )}
        </div>
        
        {error && <p style={{ color: 'red', marginTop: '10px' }}>Error: {error}</p>}
        
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleImageUpload} 
          accept="image/*" 
          style={{ display: 'none' }} 
        />
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
            <label style={{ display: 'block', marginBottom: '10px', cursor: 'pointer' }}>
              <input type="checkbox" defaultChecked style={{ marginRight: '8px', accentColor: 'var(--theme-primary)' }} />
              Enable Notifications
            </label>
            <label style={{ display: 'block', marginBottom: '10px', cursor: 'pointer' }}>
              <input type="checkbox" style={{ marginRight: '8px', accentColor: 'var(--theme-primary)' }} />
              Dark Mode Preferences
            </label>
            <input 
              type="text" 
              placeholder="Sample Input Field" 
              style={{
                width: '100%',
                padding: '10px',
                marginTop: '10px',
                border: '1px solid #ccc',
                borderRadius: 'var(--theme-radius)',
                backgroundColor: 'var(--theme-background)',
                color: 'var(--theme-text)'
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
