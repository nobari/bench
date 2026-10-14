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
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#141416" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full`} suppressHydrationWarning>
      <head>
        {/* Applies the remembered theme, the colour switch (or the one a share link carries) and the sidebar state before first paint (globals.css reads data-theme, data-color and data-nav). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('bench:theme');if(t==='light'||t==='wood'||t==='dark'){document.documentElement.dataset.theme=t;var c={light:'#fafafa',wood:'#4a3827',dark:'#141416'}[t];var ms=document.querySelectorAll('meta[name=theme-color]');for(var i=0;i<ms.length;i++)ms[i].content=c}}catch(e){}try{var c=localStorage.getItem('bench:color');var sm=/(?:^|[#&])s=([^&]*)/.exec(location.hash);if(sm){var j=JSON.parse(atob(decodeURIComponent(sm[1]).replace(/-/g,'+').replace(/_/g,'/')));if(j&&j.ui&&j.ui.color===true)c='on'}if(c==='on')document.documentElement.dataset.color='on'}catch(e){}try{var m=localStorage.getItem('bench:nav');if(m==='hidden')document.documentElement.dataset.nav='hidden';else if(m==='rail'||(!m&&localStorage.getItem('bench:nav-collapsed')==='1'))document.documentElement.dataset.nav='collapsed'}catch(e){}",
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <Providers>
          <SiteHeader />
          <div className="flex w-full flex-1">
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
