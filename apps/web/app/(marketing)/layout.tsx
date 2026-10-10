import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { SiteHeader } from "@/components/marketing/site-header";
import { REPO_URL, RUN_IT_URL, SHOWCASE } from "@/lib/showcase";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Scroll-in animations start hidden; without JavaScript, show everything. */}
      <noscript>
        <style>{".reveal{opacity:1!important;transform:none!important}"}</style>
      </noscript>
      <SiteHeader />

      <main className="flex-1">{children}</main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-muted-foreground sm:flex-row sm:items-center">
          <Logo className="text-muted-foreground" />
          <p className="sm:ml-4">Built for teams who write code together.</p>
          <div className="flex gap-5 sm:ml-auto">
            {SHOWCASE ? (
              <>
                {REPO_URL && <a href={REPO_URL} className="hover:text-foreground">The code</a>}
                {RUN_IT_URL && <a href={RUN_IT_URL} className="hover:text-foreground">Run it yourself</a>}
              </>
            ) : (
              <>
                <Link href="/sign-in" className="hover:text-foreground">Sign in</Link>
                <Link href="/sign-up" className="hover:text-foreground">Create account</Link>
              </>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
