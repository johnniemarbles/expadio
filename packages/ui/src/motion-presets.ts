/**
 * Motion UI spring presets — physics-backed animation configs.
 *
 * Use these with any spring-capable animation library (Motion.dev, Framer Motion, etc.).
 * Each preset defines stiffness + damping for a distinct interaction feel.
 *
 * Stagger and travel values define orchestration timing and distance.
 */
export const motionPresets = {
  /** Ultra-snappy — toolbar toggles, checkbox ticks, immediate feedback */
  snap:    { type: 'spring' as const, stiffness: 1218, damping: 70 },
  /** Default UI — menus, cards, reveals, drawer open/close */
  ui:      { type: 'spring' as const, stiffness: 305,  damping: 33 },
  /** Gentle — modals, sheets, onboarding overlays */
  gentle:  { type: 'spring' as const, stiffness: 110,  damping: 20 },
  /** Lively — status pills, badges, attention-grabbing micro-interactions */
  lively:  { type: 'spring' as const, stiffness: 622,  damping: 17 },
  /** Ambient — floating elements, background parallax, idle motion */
  ambient: { type: 'spring' as const, stiffness: 43,   damping: 13 },
} as const;

/** Stagger delays (seconds) for list/grid orchestration */
export const motionStagger = {
  tight:   0.04,
  base:    0.08,
  relaxed: 0.15,
} as const;

/** Travel distances (px) for enter/hover transitions */
export const motionTravel = {
  hover:   4,
  enter:   24,
  section: 48,
} as const;

export type MotionPresetName   = keyof typeof motionPresets;
export type MotionStaggerName  = keyof typeof motionStagger;
export type MotionTravelName   = keyof typeof motionTravel;
