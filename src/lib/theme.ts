// Every value is a CSS custom property defined in src/styles.css, where
// :root holds the light (default) theme and :root[data-theme="dark"] the
// dark overrides. Inline styles using these strings re-resolve on the fly
// when the data-theme attribute flips — but SVG colors must be applied via
// `style`, not presentation attributes, which don't support var().
export const COLORS = {
  panel: "var(--panel)",
  border: "var(--border)",
  text: "var(--text)",
  textDim: "var(--text-dim)",
  muted: "var(--muted)",
  faint: "var(--faint)",
  up: "var(--up)",
  down: "var(--down)",
  // Decorative-only accent (LIVE dot); too low-contrast for text in light mode.
  accent: "var(--accent)",
  // Accent for text-sized marks (LIVE label); darkened in light mode.
  accentText: "var(--accent-text)",
  shadowTile: "var(--shadow-tile)",
} as const;

export const FONTS = {
  display: '"Instrument Serif", serif',
  mono: '"JetBrains Mono", monospace',
} as const;
