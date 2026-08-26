export default function Loading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '0.5rem' }}>
      <div style={{ width: '35%', height: '1.75rem', background: 'var(--canvas)', borderRadius: '6px', animation: 'brainPulse 1.4s ease-in-out infinite' }} />
      <div style={{ width: '100%', height: '220px', background: 'var(--canvas)', borderRadius: '10px', animation: 'brainPulse 1.4s ease-in-out infinite' }} />
      <style>{`@keyframes brainPulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }`}</style>
    </div>
  );
}
