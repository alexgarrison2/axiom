# UI/UX Audit & Recommendations

**Target:** NHL Predictions App
**Design System Baseline:** Dark Mode (OLED), Fira Code/Sans Typography, High Contrast Data Visualization.

## Executive Summary

The application currently employs a "Neon/Cyberpunk" aesthetic with a strong dark mode implementation (`bg-black`). While visually striking, it deviates from the "Professional Analytics" baseline recommendation of Fira Code/Sans and a more restrained color palette. The interactions are generally good (using Framer Motion), but there are opportunities to tighten the typography and standardize the component hierarchy.

## 1. Global Design & Layout (`layout.tsx`)

**Status:** ⚠️ Needs Improvement

* **Typography:** Currently using `Geist`, `Geist_Mono`, `Caveat`, and `Neonderthaw`.
  * **Recommendation:** Switch strictly to **Fira Code** (for numbers/data) and **Fira Sans** (for UI text) to enhance the "Data Analytics" feel. `Neonderthaw` can remain for the brand logo but should be used sparingly.
* **Meta Viewport:** Standard Next.js defaults are present.
* **Theme:** `bg-black` is consistent.

## 2. Landing Page (`page.tsx` & `PredictionsViewer.tsx`)

**Status:** ✅ Good

* **Hero/Engagement:** The "Ambient Glow" background is a nice touch for depth.
* **Navigation:** The "History / Teams / News" toggle is clear, but the "Date" selector buttons might crow on mobile if many dates are available.
  * **Recommendation:** Implement a horizontal scroll container for dates with `snap-x` to ensure usability on mobile.
* **Loading States:** "No data available" has `animate-pulse`, which is good. Ensure `PredictionsViewer` has a skeleton state for initial load (SSR helps here).

## 3. Teams Pages (`teams/page.tsx` & `teams/[id]/page.tsx`)

**Status:** ⚠️ Mixed

* **Teams List:**
  * The manual grid of logos in `TeamDetailPage` navigation (`/teams/[id]`) is a great quick-nav feature.
* **Team Detail Layout:**
  * **Filters:** The filter buttons for "Goalie", "Location", "Period" etc. use `bg-white/5`.
    * **Recommendation:** Increase active state contrast. Currently "All" is White/Black, but inactive is Gray/Transparent. Ensure hover states are distinct (`hover:bg-white/10`).
  * **Accessibility:**
    * The red/green/blue logic for `getGradientColor` is custom.
    * **Recommendation:** Ensure these colors pass WCAG AA contrast against the dark background. The red range (248, 113, 113) might be vibrant, but check against pure black.
  * **Consistency:**
    * Team Colors are applied as ambient glows. This is excellent for context.

## 4. Design System Gap Analysis

| Category | Current Implementation | Recommended (UI Pro Max) | Action |
| :--- | :--- | :--- | :--- |
| **Typography** | Geist / Neu-Brutalism | Fira Code (Technical) | **Adopt Fira Code** for statistics tables. |
| **Colors** | Neon Green/Purple/Amber | Blue/Orange/Black | Keep Neon for Brand, but adopt Blue/Orange for **Actionable Data** to reduce eye strain. |
| **Icons** | SVG / Lucide (Inferred) | Heroicons/Lucide | ✅ Keep current usage. Avoid emojis. |
| **Animation** | Framer Motion (Spring) | 150-300ms Ease | ✅ Current implementation is excellent. |

## 5. Top 3 Action Items

1. **Typography Overhaul:** Import `Fira Code` and apply it to all `.font-mono` elements (data tables, scores, probabilities). This will instantly make the app feel more like a professional analytics tool.
2. **Mobile Date Navigation:** In `PredictionsViewer`, ensure the date selector row is horizontally scrollable with visible padding to prevent cut-off on mobile devices.
3. **Contrast Audit:** Run a check on the `text-gray-500` labels against `bg-black`. They might be too dark. Bump to `text-gray-400` or `slate-400` for better readability.

## 6. Implementation Guide

### A. Installing Fira Code

```tsx
import { Fira_Code, Fira_Sans } from 'next/font/google'

const firaCode = Fira_Code({ subsets: ['latin'], variable: '--font-fira-code' })
const firaSans = Fira_Sans({ weight: ['400', '500', '700'], subsets: ['latin'], variable: '--font-fira-sans' })
```

### B. Updating Tailwind Config

```js
theme: {
  extend: {
    fontFamily: {
      sans: ['var(--font-fira-sans)', 'sans-serif'],
      mono: ['var(--font-fira-code)', 'monospace'],
    }
  }
}
```
