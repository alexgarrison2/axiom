/* eslint-disable @typescript-eslint/no-require-imports */
const colors = require("tailwindcss/colors");

/** Channel-based token so opacity modifiers work: bg-brand/10, text-neg/80 … */
const token = (name) => `rgb(var(--${name}-rgb) / <alpha-value>)`;

/**
 * Legacy gray text shades → contrast-safe text roles.
 * 400 → --text-2, 500/600 → --text-3 (≥4.5:1 on every surface). 700+ stay
 * as-is (borders / fills); don't use them for text.
 */
const remapGray = (scale) => ({
  ...scale,
  400: "#a9b4c2",
  500: "#7c8796",
  600: "#7c8796",
});

/** @type {import('tailwindcss').Config} */
module.exports = {
  future: {
    // hover: styles only on devices that can hover (no sticky hover on touch)
    hoverOnlyWhenSupported: true,
  },
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./utils/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      /* Type scale (px / line-height). Floor is `micro` = 11px. Body is
         JetBrains Mono, so sizes run a step smaller than a sans scale. */
      fontSize: {
        micro: ["11px", { lineHeight: "14px" }],
        caption: ["12px", { lineHeight: "16px" }],
        "body-sm": ["13px", { lineHeight: "18px" }],
        body: ["14px", { lineHeight: "20px" }],
        title: ["16px", { lineHeight: "20px" }],
        h2: ["22px", { lineHeight: "26px" }],
        display: ["30px", { lineHeight: "32px" }],
        hero: ["40px", { lineHeight: "40px" }],
      },
      letterSpacing: {
        label: "0.16em",
        chip: "0.14em",
        wide: "0.08em",
      },
      colors: {
        /* Neon Arcade palette (brief) */
        ink: "var(--ink)",
        dim: "var(--dim)",
        mute: "var(--mute)",
        // DEFAULT = the neon; the numbered Tailwind scales stay available.
        cyan: { ...colors.cyan, DEFAULT: token("brand") },
        green: { ...colors.green, DEFAULT: token("pos") },
        magenta: token("model"),
        amber: { ...colors.amber, DEFAULT: token("warn") },
        red: { ...colors.red, DEFAULT: token("neg") },
        model: token("model"),
        /* Semantic tokens */
        bg: token("bg"),
        "surface-1": token("surface-1"),
        "surface-2": token("surface-2"),
        "surface-3": token("surface-3"),
        well: "var(--well)",
        track: "var(--track)",
        line: token("line"),
        "line-strong": "var(--line-strong)",
        brand: { DEFAULT: token("brand"), ink: "var(--brand-ink)" },
        pos: token("pos"),
        neg: token("neg"),
        warn: token("warn"),
        info: token("info"),
        playoff: token("playoff"),
        /* Text roles: text-fg-1 / text-fg-2 / text-fg-3 */
        fg: {
          1: token("text-1"),
          2: token("text-2"),
          3: token("text-3"),
          disabled: "var(--text-disabled)",
        },
        stale: "var(--stale)",

        /* Contrast-safe legacy grays */
        gray: remapGray(colors.gray),
        neutral: remapGray(colors.neutral),
        zinc: remapGray(colors.zinc),
        slate: remapGray(colors.slate),

        /* shadcn/ui names, pointed at the tokens */
        border: "var(--line)",
        input: "var(--line-strong)",
        ring: token("brand"),
        background: token("bg"),
        foreground: token("text-1"),
        primary: {
          DEFAULT: token("brand"),
          foreground: "var(--brand-ink)",
        },
        secondary: {
          DEFAULT: token("surface-2"),
          foreground: token("text-1"),
        },
        destructive: {
          DEFAULT: token("neg"),
          foreground: "var(--brand-ink)",
        },
        muted: {
          DEFAULT: token("surface-2"),
          foreground: token("text-2"),
        },
        accent: {
          DEFAULT: token("surface-3"),
          foreground: token("text-1"),
        },
        popover: {
          DEFAULT: token("surface-2"),
          foreground: token("text-1"),
        },
        card: {
          DEFAULT: token("surface-1"),
          foreground: token("text-1"),
        },
        /* Legacy neon names → the palette */
        neon: {
          blue: token("brand"),
          green: token("pos"),
          purple: token("playoff"),
        },
      },
      borderRadius: {
        chip: "var(--r-chip)",
        control: "var(--r-control)",
        bar: "var(--r-bar)",
        card: "var(--r-card)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        glow: "var(--glow-brand)",
      },
      height: {
        appbar: "var(--appbar-h)",
        tabbar: "var(--tabbar-h)",
      },
      spacing: {
        appbar: "var(--appbar-h)",
        tabbar: "var(--tabbar-h)",
        /* Card padding: 14px phone, 16px md+ (p-card, px-card …). */
        card: "var(--pad-card)",
      },
      fontWeight: {
        // JetBrains Mono tops out at 800; Chakra Petch at 700.
        extrabold: "800",
        black: "800",
      },
      fontFamily: {
        // Everything is JetBrains Mono except display type (font-display).
        sans: ["var(--font-jetbrains-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        mono: ["var(--font-jetbrains-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        display: ["var(--font-chakra-petch)", "Arial Narrow", "system-ui", "sans-serif"],
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out both",
        "pop-in": "pop-in 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "sheet-up": "sheet-up 0.24s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "sheet-left": "sheet-left 0.24s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // coarse: touch-first pointers (44px targets), fine: mouse/trackpad
    ({ addVariant }) => {
      addVariant("coarse", "@media (pointer: coarse)");
      addVariant("fine", "@media (pointer: fine)");
      // Container queries (nearest ancestor with [container-type:inline-size]),
      // e.g. the matchup card lays out by its own width, not the viewport.
      addVariant("cq-sm", "@container (min-width: 30rem)");
      addVariant("cq-md", "@container (min-width: 34rem)");
      addVariant("cq-lg", "@container (min-width: 44rem)");
    },
  ],
};
