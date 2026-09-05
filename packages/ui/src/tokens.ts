/**
 * expadioTokens — single source of truth for the Expadio design system.
 *
 * The CSS layer (`packages/ui/src/tokens/*.css`) derives all `--tok-*`
 * custom properties from these exact values.  Use this object in TypeScript
 * contexts where you need token values directly (e.g. canvas drawing,
 * server-side style injection, test assertions, Storybook).
 */
export const expadioTokens = {
  color: {
    bg: {
      base:     "#0A0C0F",
      surface:  "#12151A",
      elevated: "#161B22",
      overlay:  "#1C2128",
    },
    border: {
      subtle:  "#21262D",
      default: "#30363D",
      strong:  "#484F58",
      focus:   "#22D3EE",
    },
    text: {
      primary:   "#E6EDF3",
      secondary: "#C9D1D9",
      tertiary:  "#8B949E",
      muted:     "#6E7681",
      disabled:  "#484F58",
      inverse:   "#0A0C0F",
    },
    accent: {
      primary:       "#22D3EE",
      primaryHover:  "#67E8F9",
      primaryMuted:  "rgba(34, 211, 238, 0.15)",
      primarySubtle: "rgba(34, 211, 238, 0.08)",
    },
    semantic: {
      success:      "#10B981",
      successMuted: "rgba(16, 185, 129, 0.15)",
      warning:      "#F59E0B",
      warningMuted: "rgba(245, 158, 11, 0.15)",
      critical:     "#F43F5E",
      criticalMuted:"rgba(244, 63, 94, 0.15)",
      info:         "#3B82F6",
    },
    status: {
      open:  "#F59E0B",
      clear: "#10B981",
      live:  "#22D3EE",
      idle:  "#6E7681",
      error: "#F43F5E",
    },
  },
  radius: {
    sm:   "4px",
    md:   "6px",
    lg:   "8px",
    xl:   "12px",
    "2xl":"16px",
    full: "9999px",
  },
  shadow: {
    sm:          "0 1px 2px rgba(0,0,0,0.4)",
    md:          "0 4px 12px rgba(0,0,0,0.45)",
    lg:          "0 8px 24px rgba(0,0,0,0.5)",
    glowPrimary: "0 0 20px rgba(34,211,238,0.25)",
  },
  motion: {
    duration: {
      fast:   "120ms",
      normal: "200ms",
      slow:   "320ms",
    },
    easing: {
      default: "cubic-bezier(0.4,0,0.2,1)",
      out:     "cubic-bezier(0,0,0.2,1)",
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

/** Flatten a nested object into CSS variable declarations.
 *
 * @example
 * tokenToCssVars()
 * // → { '--tok-color-bg-base': '#0A0C0F', '--tok-color-accent-primary': '#22D3EE', ... }
 */
export function tokenToCssVars(): CssVarMap {
  const out: CssVarMap = {};

  function walk(node: unknown, prefix: string): void {
    if (typeof node === "string") {
      out[prefix] = node;
      return;
    }
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
 * Inject all `--tok-*` variables onto a DOM element (default: `:root`).
 * Safe to call in a browser `useEffect` or a Next.js `<Script>` strategy.
 *
 * @example
 * injectTokens();                     // injects onto document.documentElement
 * injectTokens(document.getElementById('modal')!);
 */
export function injectTokens(el: HTMLElement = document.documentElement): void {
  const vars = tokenToCssVars();
  for (const [prop, value] of Object.entries(vars)) {
    el.style.setProperty(prop, value);
  }
}
