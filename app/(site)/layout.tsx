import { SiteChrome } from "@/components/site-chrome";

export default function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SiteChrome>{children}</SiteChrome>;
}
