import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ActiveProfileProvider } from "@/components/active-profile";
import { SiteHeader } from "@/components/site-header";
import { THEME_BOOTSTRAP } from "@/components/theme-toggle";

import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Trialandfit", template: "%s · Trialandfit" },
  description: "Get your body measurements from a photo or enter them yourself.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: THEME_BOOTSTRAP may add the "dark" class before React loads.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-3 focus:ring-ring/50"
        >
          Skip to content
        </a>
        <ActiveProfileProvider>
          <SiteHeader />
          <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:py-12">
            {children}
          </main>
        </ActiveProfileProvider>
      </body>
    </html>
  );
}
