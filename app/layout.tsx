import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { SITE, absoluteUrl, getBaseUrl } from "@/lib/site";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ToolNav } from "@/components/tool-nav";
import { GoogleAnalytics } from "@/components/google-analytics";
import { Providers } from "./providers";
import "./globals.css";

const sans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(getBaseUrl()),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  authors: [{ name: SITE.author }],
  keywords: [
    "developer tools",
    "online utilities",
    "base64",
    "json viewer",
    "gif maker",
    "text converter",
    "encode decode",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    url: absoluteUrl("/"),
    locale: SITE.locale,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  robots: { index: true, follow: true },
  category: "technology",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7ef" },
    { media: "(prefers-color-scheme: dark)", color: "#161b11" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* Applies the remembered sidebar state before first paint (see .tool-nav in globals.css). */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{if(localStorage.getItem('bench:nav-collapsed')==='1')document.documentElement.dataset.nav='collapsed'}catch(e){}",
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <Providers>
          <SiteHeader />
          <div className="mx-auto flex w-full max-w-[1440px] flex-1">
            <ToolNav className="hidden lg:block" />
            <div className="flex min-w-0 flex-1 flex-col">
              <main className="flex-1">{children}</main>
              <SiteFooter />
            </div>
          </div>
        </Providers>
        <Analytics />
        <SpeedInsights />
        <GoogleAnalytics />
      </body>
    </html>
  );
}
