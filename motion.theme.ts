/**
 * Expadio Motion Theme — canonical instance
 *
 * Import `motionTheme` anywhere in the app to get type-safe spring configs,
 * stagger delays, and travel distances with automatic reduced-motion handling.
 *
 * @example
 * ```ts
 * import { motionTheme } from '@/motion.theme';
 *
 * // With Framer Motion:
 * <motion.div transition={motionTheme.resolve('ui')} />
 *
 * // With Motion.dev (spring):
 * animate(el, { y: 0 }, motionTheme.resolve('snap'))
 *
 * // Stagger children:
 * { delay: motionTheme.resolveStagger('tight') * index }
 *
 * // Travel distance:
 * { y: motionTheme.resolveTravel('enter') }
 * ```
 */
import { defineTheme } from '@expadio/ui';

const motionTheme = defineTheme({
  transitions: {
    /** Ultra-snappy — toolbar toggles, checkbox ticks, immediate feedback */
    snap:    { stiffness: 1218, damping: 70 },
    /** Default UI — menus, cards, reveals, drawer open/close */
    ui:      { stiffness: 305,  damping: 33 },
    /** Gentle — modals, sheets, onboarding overlays */
    gentle:  { stiffness: 110,  damping: 20 },
    /** Lively — status pills, badges, attention-grabbing micro-interactions */
    lively:  { stiffness: 622,  damping: 17 },
    /** Ambient — floating elements, background parallax, idle motion */
    ambient: { stiffness: 43,   damping: 13 },
  },
  stagger: {
    tight:   0.04,
    base:    0.08,
    relaxed: 0.15,
  },
  travel: {
    hover:   4,   // px — subtle lift on hover
    enter:   24,  // px — standard page/panel entrance
    section: 48,  // px — full section reveal
  },
  reducedMotion: 'calm',
});

export default motionTheme;

// Named export for convenience
export { motionTheme };
