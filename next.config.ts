import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/*
 * ── Serverless file tracing ────────────────────────────────────────────────
 * Server code builds fs paths with path.join(process.cwd(), ...), so the
 * tracer pulls in whole directories (the /playoffs function traced 163MB).
 *
 * Excludes strip everything no route reads; per-route includes add back the
 * files a route really reads. With Turbopack (the Next 16 default builder)
 * includes win over excludes, so a global `pipeline/**\/*.csv` exclude is safe.
 *
 * Careful: Turbopack matches BOTH sides loosely. A route key matches any route
 * that contains it ("/teams" also hits /api/teams/[abbr]/stats, "/" hits every
 * route), and a file glob matches any path that contains it ("data/x.csv"
 * also strips "public/data/x.csv"). Verified empirically on next 16.3.7.
 * Keep keys specific and never exclude a file some route might read.
 */

// Raw CSVs that app/playoffs/page.tsx still reads on every request. The
// include is only emitted while the page source mentions the file, so it
// drops out by itself once the precomputed playoff archive (G2) lands.
const PLAYOFFS_PAGE = "app/playoffs/page.tsx";
const PLAYOFFS_RAW_CSVS = [
  "pipeline/moneypuck_bios.csv",
  "pipeline/nhl_season_2025_2026_shifts.csv",
  "pipeline/nhl_season_2025_2026_shots.csv",
];

function sourceMentions(file: string, needle: string): boolean {
  try {
    return fs.readFileSync(path.join(process.cwd(), file), "utf8").includes(needle);
  } catch {
    return false;
  }
}

// Never read at request time by any route.
const NEVER_READ_AT_RUNTIME = [
  "pipeline/**/*.csv",
  "pipeline/**/*.py",
  "pipeline/**/__pycache__/**",
  "pipeline/**/*.pkl",
  "pipeline/**/*.db",
  "pipeline/**/*.sh",
  "pipeline/**/*.plist",
  "pipeline/**/*.txt",
  "pipeline/**/*.md",
  "data/*.bak*",
  "data/**/*.bak*",
  "data/training_*",
  "data/historical_pbp/**",
  "**/*.log",
  "**/*.pdf",
  "**/*.xlsx",
  "public/data/shots.csv",
  "public/logos-animated/**",
  "output/**",
  "analysis/**",
  ".playwright-cli/**",
  "DailyImages/**",
  "SocialImages/**",
];

/*
 * ── Security headers ───────────────────────────────────────────────────────
 * CSP ships report-only first: violations surface in the browser console
 * (the CI smoke suite fails on console errors) without breaking the page.
 * Next injects inline bootstrap scripts, so script-src needs 'unsafe-inline'
 * until nonces are wired through the root layout.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval' https://mcp.figma.com" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://assets.nhle.com https://cms.nhl.bamgrid.com",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: https://mcp.figma.com" : ""}`,
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Content-Security-Policy-Report-Only", value: csp },
];

/*
 * ── Static asset caching ───────────────────────────────────────────────────
 * Logos/images change only when the repo changes. /data files are rewritten by
 * the hourly pipeline and every run redeploys, which purges the Vercel CDN, so
 * the edge can hold them (s-maxage) while browsers revalidate after a minute.
 */
const WEEK = 60 * 60 * 24 * 7;
const DAY = 60 * 60 * 24;
const assetCache = `public, max-age=${WEEK}, stale-while-revalidate=${DAY}`;
const dataCache = `public, max-age=60, s-maxage=3600, stale-while-revalidate=${DAY}`;

const nextConfig: NextConfig = {
  poweredByHeader: false,

  outputFileTracingExcludes: {
    "/*": NEVER_READ_AT_RUNTIME,
    // Only /api/odds-history reads SiteHistory; these routes trace it because
    // they join paths under public/data dynamically.
    "/playoffs": ["public/data/SiteHistory/**", "public/data/*.csv"],
    "/api/teams/**": ["public/data/SiteHistory/**"],
  },
  outputFileTracingIncludes: {
    "/api/odds-history": ["public/data/SiteHistory/*.csv"],
    "/playoffs": PLAYOFFS_RAW_CSVS.filter((f) =>
      sourceMentions(PLAYOFFS_PAGE, path.basename(f)),
    ),
  },

  /*
   * public/logos/{TRI}.svg ARE the NHL dark-surface variants (byte-identical
   * to assets.nhle.com/logos/nhl/svg/{TRI}_dark.svg before SVGO). The explicit
   * /logos/{TRI}_dark.svg name is served from the same file instead of a
   * duplicate copy; use it wherever the old *_light.svg CDN URLs appeared.
   */
  async rewrites() {
    return [{ source: "/logos/:team([A-Z]{3})_dark.svg", destination: "/logos/:team.svg" }];
  },

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/logos/:path*", headers: [{ key: "Cache-Control", value: assetCache }] },
      { source: "/images/:path*", headers: [{ key: "Cache-Control", value: assetCache }] },
      { source: "/ponyxG_full.svg", headers: [{ key: "Cache-Control", value: assetCache }] },
      { source: "/data/:path*", headers: [{ key: "Cache-Control", value: dataCache }] },
    ];
  },
};

export default nextConfig;
