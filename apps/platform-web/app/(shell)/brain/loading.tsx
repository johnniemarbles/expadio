export default function BrainLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', padding: '1rem' }}>
      <div style={{ width: '100%', height: '200px', background: 'var(--canvas)', borderRadius: '12px', animation: 'pulse 1.5s infinite' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ width: '30%', height: '2rem', background: 'var(--canvas)', borderRadius: '4px', animation: 'pulse 1.5s infinite' }} />
        <div style={{ width: '100%', height: '300px', background: 'var(--canvas)', borderRadius: '8px', animation: 'pulse 1.5s infinite' }} />
      </div>
      <style>{`
        @keyframes pulse {
          0% { opacity: 0.6; }
          50% { opacity: 1; }
          100% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
