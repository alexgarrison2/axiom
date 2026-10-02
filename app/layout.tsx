import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Condensed } from "next/font/google";
import "./globals.css";
import SiteNav from "@/components/SiteNav";
import Footer from "@/components/Footer";
import { FocusReveal } from "@/components/ui/focus-reveal";

// One family for everything: IBM Plex Sans Condensed. Narrow letterforms fit
// dense tables and notes; numbers use tabular figures (set on body in
// globals.css) so columns still align without a monospace face.
const sans = IBM_Plex_Sans_Condensed({
  variable: "--font-plex-condensed",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  fallback: ["Arial Narrow", "system-ui", "sans-serif"],
});

// Bold italic for the win-bar percentages only (.num-pct, `font-display italic`).
const sansItalic = IBM_Plex_Sans_Condensed({
  variable: "--font-plex-condensed-italic",
  subsets: ["latin"],
  weight: "700",
  style: "italic",
  display: "swap",
  fallback: ["Arial Narrow", "system-ui", "sans-serif"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.ponyxg.com";

// The browser's first Intl.DateTimeFormat with a time zone loads ICU's zone
// data: tens of ms on a phone, once per page. Every page formats times while
// it hydrates (the app-bar badge, puck drops), which put that load inside a
// hydration long task. Pay it here instead, in its own idle task while the
// main thread is waiting on the JS chunks.
const WARM_INTL = `(window.requestIdleCallback||setTimeout)(function(){try{new Intl.DateTimeFormat("en-US",{hour:"numeric",timeZone:"America/New_York",timeZoneName:"short"}).format(0)}catch(e){}})`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    // Pages without their own title. The home page sets a dated title
    // (components/ui/slate-date.ts) in app/page.tsx.
    default: "Pony xG · NHL predictions and expected-goals analytics",
    template: "%s | Pony xG",
  },
  description:
    "Nightly NHL win probabilities from an expected-goals model, compared honestly with the betting market. Team and player analytics, standings odds and a public model record.",
  applicationName: "Pony xG",
  openGraph: {
    type: "website",
    siteName: "Pony xG",
    locale: "en_US",
  },
  twitter: { card: "summary_large_image" },
  appleWebApp: {
    capable: true,
    title: "Pony xG",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#05070B",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${sansItalic.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <script dangerouslySetInnerHTML={{ __html: WARM_INTL }} />
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-control focus:bg-brand focus:px-4 focus:py-2.5 focus:text-caption focus:font-bold focus:uppercase focus:tracking-chip focus:text-brand-ink"
        >
          Skip to content
        </a>
        {/* No framer-motion provider: nothing on the site animates with it any
            more (the home slate used to), and it cost ~21KB of JS on every page. */}
        <SiteNav />
        <div id="content" tabIndex={-1} className="outline-none">
          {children}
        </div>
        <Footer />
        <FocusReveal />
      </body>
    </html>
  );
}
