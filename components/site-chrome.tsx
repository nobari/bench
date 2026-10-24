import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ToolNav } from "@/components/tool-nav";

/** The site around a page: header, sidebar and footer. The embed route leaves it out. */
export function SiteChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="contents" data-site-chrome>
        <SiteHeader />
      </div>
      <div className="flex w-full flex-1">
        <div className="contents" data-site-chrome>
          <ToolNav className="hidden lg:block" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1">{children}</main>
          <div className="contents" data-site-chrome>
            <SiteFooter />
          </div>
        </div>
      </div>
    </>
  );
}
