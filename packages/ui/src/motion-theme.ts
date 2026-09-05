/**
 * Expadio Motion Theme System
 *
 * A typed `defineTheme` factory that encapsulates spring physics configs,
 * stagger orchestration, travel distances, and reduced-motion policy — with
 * zero runtime dependencies. Compatible with Motion.dev, Framer Motion, GSAP,
 * or any library that accepts stiffness/damping spring objects.
 */

// ─── Spring config ────────────────────────────────────────────────────────────

export interface SpringConfig {
  /** Stiffness (k) — higher = snappier. Typical range: 40–1500. */
  stiffness: number;
  /** Damping (c) — higher = less bounce. Typical range: 10–80. */
  damping: number;
  /** Optional mass (default 1). Heavier = slower, more momentum. */
  mass?: number;
}

// ─── Theme input shape ────────────────────────────────────────────────────────

export interface MotionThemeInput<
  TTransitions extends Record<string, SpringConfig> = Record<string, SpringConfig>,
  TStagger extends Record<string, number> = Record<string, number>,
  TTravel extends Record<string, number> = Record<string, number>,
> {
  /** Named spring presets for transitions. */
  transitions: TTransitions;
  /** Stagger delays in seconds for list/grid orchestration. */
  stagger: TStagger;
  /** Travel distances in pixels for enter/hover/section transitions. */
  travel: TTravel;
  /**
   * Reduced-motion strategy:
   * - `"none"`    — disable all animations (zero durations, zero travel)
   * - `"calm"`    — keep subtle feedback, reduce intensity (default)
   * - `"full"`    — ignore prefers-reduced-motion, play everything
   */
  reducedMotion?: 'none' | 'calm' | 'full';
}

// ─── Resolved theme output ────────────────────────────────────────────────────

export interface MotionTheme<
  TTransitions extends Record<string, SpringConfig>,
  TStagger extends Record<string, number>,
  TTravel extends Record<string, number>,
> {
  transitions: TTransitions;
  stagger: TStagger;
  travel: TTravel;
  reducedMotion: 'none' | 'calm' | 'full';

  /**
   * Returns the appropriate spring config, honouring the reduced-motion policy
   * and the user's `prefers-reduced-motion` media query (client-side only).
   *
   * - `full`  → always returns the named preset as-is
   * - `calm`  → if prefers-reduced-motion, returns a stiff/overdamped spring
   *             (still provides physical feedback, no bounce or distance)
   * - `none`  → if prefers-reduced-motion, returns instant config (dur≈0)
   */
  resolve(
    name: keyof TTransitions,
    prefersReduced?: boolean,
  ): SpringConfig;

  /**
   * Returns the travel distance for a named key, clamped to 0 when
   * reduced-motion policy is `"none"` and the user prefers reduced motion.
   */
  resolveTravel(
    name: keyof TTravel,
    prefersReduced?: boolean,
  ): number;

  /**
   * Returns the stagger delay (seconds), clamped to 0 when reduced-motion
   * policy is `"none"` and the user prefers reduced motion.
   */
  resolveStagger(
    name: keyof TStagger,
    prefersReduced?: boolean,
  ): number;

  /**
   * Converts this theme to a flat CSS custom-property map.
   * Useful for injecting into a `:root {}` block at runtime.
   *
   * @example
   * Object.entries(theme.toCssVars()).forEach(([k, v]) =>
   *   document.documentElement.style.setProperty(k, v)
   * );
   */
  toCssVars(): Record<string, string>;
}

// ─── Implementation ────────────────────────────────────────────────────────────

/** Calm reduced-motion spring — stiff, overdamped, no bounce. */
const CALM_SPRING: SpringConfig = { stiffness: 800, damping: 80, mass: 1 };
/** Instant spring — effectively zero duration. */
const INSTANT_SPRING: SpringConfig = { stiffness: 9999, damping: 999, mass: 0.1 };

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Define a typed Expadio motion theme.
 *
 * @example
 * ```ts
 * import { defineTheme } from '@expadio/ui';
 *
 * export default defineTheme({
 *   transitions: {
 *     snap:    { stiffness: 1218, damping: 70 },
 *     ui:      { stiffness: 305,  damping: 33 },
 *     gentle:  { stiffness: 110,  damping: 20 },
 *     lively:  { stiffness: 622,  damping: 17 },
 *     ambient: { stiffness: 43,   damping: 13 },
 *   },
 *   stagger: { tight: 0.04, base: 0.08, relaxed: 0.15 },
 *   travel:  { hover: 4, enter: 24, section: 48 },
 *   reducedMotion: 'calm',
 * });
 * ```
 */
export function defineTheme<
  TTransitions extends Record<string, SpringConfig>,
  TStagger extends Record<string, number>,
  TTravel extends Record<string, number>,
>(
  input: MotionThemeInput<TTransitions, TStagger, TTravel>,
): MotionTheme<TTransitions, TStagger, TTravel> {
  const policy = input.reducedMotion ?? 'calm';

  function shouldReduce(prefersReduced?: boolean): boolean {
    if (policy === 'full') return false;
    return prefersReduced ?? prefersReducedMotion();
  }

  return {
    transitions: input.transitions,
    stagger:     input.stagger,
    travel:      input.travel,
    reducedMotion: policy,

    resolve(name, prefersReduced) {
      const base = input.transitions[name as string] as SpringConfig;
      if (!shouldReduce(prefersReduced)) return base;
      return policy === 'none' ? INSTANT_SPRING : CALM_SPRING;
    },

    resolveTravel(name, prefersReduced) {
      const base = input.travel[name as string] as number;
      if (!shouldReduce(prefersReduced)) return base;
      return policy === 'none' ? 0 : Math.min(base, 4);
    },

    resolveStagger(name, prefersReduced) {
      const base = input.stagger[name as string] as number;
      if (!shouldReduce(prefersReduced)) return base;
      return policy === 'none' ? 0 : base * 0.25;
    },

    toCssVars() {
      const vars: Record<string, string> = {};

      for (const [name, spring] of Object.entries(input.transitions)) {
        vars[`--motion-spring-${name}-stiffness`] = String(spring.stiffness);
        vars[`--motion-spring-${name}-damping`]   = String(spring.damping);
        if (spring.mass != null) {
          vars[`--motion-spring-${name}-mass`] = String(spring.mass);
        }
      }
      for (const [name, seconds] of Object.entries(input.stagger)) {
        vars[`--motion-stagger-${name}`] = `${seconds}s`;
      }
      for (const [name, px] of Object.entries(input.travel)) {
        vars[`--motion-travel-${name}`] = `${px}px`;
      }
      vars['--motion-reduced-motion'] = policy;

      return vars;
    },
  };
}
