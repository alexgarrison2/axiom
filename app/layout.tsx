import type { Metadata, Viewport } from "next";
import { Chakra_Petch, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import SiteNav from "@/components/SiteNav";
import Footer from "@/components/Footer";
import { FocusReveal } from "@/components/ui/focus-reveal";

// Body face for everything that is not display type: times, odds, labels,
// tables, nav. Variable font, one file.
const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

// Display face: goalie/team names, headings (500/600/700 upright).
const display = Chakra_Petch({
  variable: "--font-chakra-petch",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  fallback: ["Arial Narrow", "system-ui", "sans-serif"],
});

// Bold italic for the win-bar percentages only (.num-pct, `font-display italic`).
// A separate face so the unused 500/600 italics are never preloaded.
const displayItalic = Chakra_Petch({
  variable: "--font-chakra-petch-italic",
  subsets: ["latin"],
  weight: "700",
  style: "italic",
  display: "swap",
  fallback: ["Arial Narrow", "system-ui", "sans-serif"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.ponyxg.com";

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
      className={`${mono.variable} ${display.variable} ${displayItalic.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
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
