import type { Metadata, Viewport } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import "./globals.css";
import SiteNav from "@/components/SiteNav";
import Footer from "@/components/Footer";
import { MotionProvider } from "@/components/ui/motion-provider";

// Four preloaded weights (regular, semibold, bold, black). font-medium falls
// back to 400 and font-extrabold is mapped to 900 in tailwind.config.js.
const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
  display: "swap",
});

// Mono is only used for small labels/timestamps and tables below the fold.
const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
  display: "swap",
  preload: false,
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
      className={`${firaSans.variable} ${firaCode.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-control focus:bg-brand focus:px-4 focus:py-2.5 focus:text-body-sm focus:font-bold focus:text-brand-ink"
        >
          Skip to content
        </a>
        <MotionProvider>
          <SiteNav />
          <div id="content" tabIndex={-1} className="outline-none">
            {children}
          </div>
          <Footer />
        </MotionProvider>
      </body>
    </html>
  );
}
