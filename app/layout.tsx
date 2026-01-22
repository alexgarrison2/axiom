import type { Metadata } from "next";
import { Fira_Code, Fira_Sans, Caveat, Neonderthaw } from "next/font/google";
import "./globals.css";



const firaSans = Fira_Sans({
  variable: "--font-fira-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
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
        className={`${firaSans.variable} ${firaCode.variable} ${caveat.variable} ${neonderthaw.variable} antialiased`}
      >

        {children}
      </body>
    </html>
  );
}
