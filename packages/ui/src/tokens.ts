/**
 * expadioTokens — Motion UI aesthetic, sharp edges, physics-backed motion.
 *
 * This is the canonical dark-mode default for both platform-web and brand-web.
 * Pure black surfaces, Motion yellow (#FACC15) accent, 1px borders, 2-6px radii.
 *
 * CSS layer: packages/ui/src/tokens/*.css derives all --tok-* vars from these values.
 */
export const expadioTokens = {
  color: {
    bg: {
      base:     "#000000",
      surface:  "#0A0A0A",
      elevated: "#111111",
      overlay:  "#171717",
    },
    border: {
      subtle:  "#1F1F1F",
      default: "#272727",
      strong:  "#3F3F3F",
      focus:   "#FACC15",
    },
    text: {
      primary:   "#FAFAFA",
      secondary: "#D4D4D8",
      tertiary:  "#A1A1AA",
      muted:     "#71717A",
      disabled:  "#3F3F3F",
      inverse:   "#000000",
    },
    accent: {
      primary:       "#FACC15",
      primaryHover:  "#FDE047",
      primaryMuted:  "rgba(250, 204, 21, 0.15)",
      primarySubtle: "rgba(250, 204, 21, 0.08)",
    },
    semantic: {
      success:      "#22C55E",
      successMuted: "rgba(34, 197, 94, 0.15)",
      warning:      "#F59E0B",
      warningMuted: "rgba(245, 158, 11, 0.15)",
      critical:     "#EF4444",
      criticalMuted:"rgba(239, 68, 68, 0.15)",
      info:         "#3B82F6",
    },
    status: {
      open:  "#F59E0B",
      clear: "#22C55E",
      live:  "#FACC15",
      idle:  "#71717A",
      error: "#EF4444",
    },
  },
  radius: {
    sm:   "2px",
    md:   "4px",
    lg:   "6px",
    xl:   "8px",
    "2xl":"12px",
    full: "9999px",
  },
  shadow: {
    sm:          "0 1px 2px rgba(0, 0, 0, 0.6)",
    md:          "0 4px 12px rgba(0, 0, 0, 0.5)",
    lg:          "0 8px 24px rgba(0, 0, 0, 0.55)",
    glowPrimary: "0 0 24px rgba(250, 204, 21, 0.25)",
  },
  motion: {
    duration: {
      fast:   "120ms",
      normal: "200ms",
      slow:   "320ms",
    },
    easing: {
      default: "cubic-bezier(0.4, 0, 0.2, 1)",
      out:     "cubic-bezier(0, 0, 0.2, 1)",
    },
  },
} as const;

// ─── Derived types ────────────────────────────────────────────────────────────

export type ExpadioTokens    = typeof expadioTokens;
export type ColorTokens      = ExpadioTokens["color"];
export type RadiusTokens     = ExpadioTokens["radius"];
export type ShadowTokens     = ExpadioTokens["shadow"];
export type MotionTokens     = ExpadioTokens["motion"];

// ─── CSS variable helpers ─────────────────────────────────────────────────────

type CssVarMap = Record<string, string>;

/**
 * Flatten the token tree into CSS variable declarations.
 * @example
 * tokenToCssVars() // → { '--tok-color-bg-base': '#000000', ... }
 */
export function tokenToCssVars(): CssVarMap {
  const out: CssVarMap = {};
  function walk(node: unknown, prefix: string): void {
    if (typeof node === "string") { out[prefix] = node; return; }
    if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        walk(value, `${prefix}-${key}`);
      }
    }
  }
  walk(expadioTokens, "--tok");
  return out;
}

/**
 * Inject all --tok-* variables onto a DOM element (default: :root).
 */
export function injectTokens(el: HTMLElement = document.documentElement): void {
  const vars = tokenToCssVars();
  for (const [prop, value] of Object.entries(vars)) {
    el.style.setProperty(prop, value);
  }
}
