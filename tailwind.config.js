/* eslint-disable @typescript-eslint/no-require-imports */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./utils/**/*.{js,ts,jsx,tsx,mdx}",
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
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Existing Custom Colors
        neon: {
          blue: '#00f3ff',
          green: '#0aff00',
          purple: '#bc13fe',
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ['var(--font-fira-sans)', 'sans-serif'],
        mono: ['var(--font-fira-code)', 'monospace'],
        hand: ['Caveat', 'cursive'],
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in-up': 'fade-in-up 0.5s ease-out forwards',
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        // Irregular flicker — non-uniform keyframe spacing mimics real flame rhythm
        'flame-flicker': 'flame-flicker 2.6s ease-in-out infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '1', filter: 'brightness(1.2)' },
          '50%': { opacity: '0.8', filter: 'brightness(1)' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // Non-uniform stops (0, 20, 38, 55, 72, 88, 100) create organic flicker
        'flame-flicker': {
          '0%':   { boxShadow: '0 0 18px -4px rgba(251,146,60,0.38), 0 0 45px -8px rgba(234,88,12,0.2),  0 0 80px -16px rgba(185,28,28,0.12)' },
          '20%':  { boxShadow: '0 0 32px -4px rgba(251,146,60,0.58), 0 0 65px -8px rgba(234,88,12,0.34), 0 0 110px -16px rgba(185,28,28,0.22)' },
          '38%':  { boxShadow: '0 0 12px -4px rgba(251,146,60,0.24), 0 0 36px -8px rgba(234,88,12,0.14), 0 0 64px -16px rgba(185,28,28,0.09)' },
          '55%':  { boxShadow: '0 0 38px -4px rgba(251,146,60,0.64), 0 0 72px -8px rgba(234,88,12,0.38), 0 0 118px -16px rgba(185,28,28,0.26)' },
          '72%':  { boxShadow: '0 0 22px -4px rgba(251,146,60,0.44), 0 0 52px -8px rgba(234,88,12,0.26), 0 0 90px -16px rgba(185,28,28,0.16)' },
          '88%':  { boxShadow: '0 0 28px -4px rgba(251,146,60,0.52), 0 0 60px -8px rgba(234,88,12,0.30), 0 0 96px -16px rgba(185,28,28,0.18)' },
          '100%': { boxShadow: '0 0 18px -4px rgba(251,146,60,0.38), 0 0 45px -8px rgba(234,88,12,0.2),  0 0 80px -16px rgba(185,28,28,0.12)' },
        },
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
  plugins: [require("tailwindcss-animate")],
}
