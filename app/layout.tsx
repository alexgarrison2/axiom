import type { Metadata } from "next";
import { Geist, Geist_Mono, Caveat, Neonderthaw } from "next/font/google";
import "./globals.css";



const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
});

const neonderthaw = Neonderthaw({
  variable: "--font-neonderthaw",
  subsets: ["latin"],
  weight: "400",
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
        className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable} ${neonderthaw.variable} antialiased`}
      >

        {children}
      </body>
    </html>
  );
}
