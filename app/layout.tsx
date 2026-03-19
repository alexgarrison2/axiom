import type { Metadata } from "next";
import { Fira_Code, Fira_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { AdminProvider } from "@/components/AdminProvider";



const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "900"],
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pony xG",
  description: "Advanced NHL Analytics & Predictions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${firaSans.variable} ${firaCode.variable} antialiased`}
      >
        {process.env.NODE_ENV === "development" ? (
          <Script
            src="https://mcp.figma.com/mcp/html-to-design/capture.js"
            strategy="afterInteractive"
          />
        ) : null}
        <AdminProvider>
          {children}
        </AdminProvider>
      </body>
    </html>
  );
}
