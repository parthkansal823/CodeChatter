"use client";

import { Bot, Compass, LayoutGrid, Menu, Settings, Users, Workflow } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";

import { OrgSwitcher } from "@/components/app/org-switcher";
import { UserMenu } from "@/components/app/user-menu";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { Me } from "@/lib/me";
import { cn } from "@/lib/utils";

const MeContext = createContext<Me | null>(null);
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe must be used inside <AppShell>");
  return me;
}

const NAV = [
  { href: "/dashboard", label: "Rooms", icon: LayoutGrid },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/automations", label: "Automations", icon: Workflow },
  { href: "/interviews", label: "Interviews", icon: Users },
  { href: "/agent", label: "Agent runs", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function Sidebar({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center px-4">
        <Link href="/dashboard" onClick={onNavigate} aria-label="CodeChatter home">
          <Logo />
        </Link>
      </div>
      <div className="px-3">
        <OrgSwitcher />
      </div>
      <nav className="mt-4 flex flex-col gap-px px-3" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href as never}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                active && "bg-accent font-medium text-foreground",
              )}
            >
              {active && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-thread rounded-full bg-brand" />}
              <Icon className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t p-3">
        <UserMenu me={me} />
      </div>
    </div>
  );
}

export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <MeContext value={me}>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r bg-panel md:block">
          <Sidebar me={me} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 items-center gap-2 border-b px-4 md:hidden">
            <Button variant="ghost" size="icon-sm" aria-label="Open menu" onClick={() => setOpen(true)}>
              <Menu />
            </Button>
            <Logo />
          </div>
          <main className="flex-1">{children}</main>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-72 bg-panel p-0">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <Sidebar me={me} onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>
    </MeContext>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 border-b px-6 py-6 sm:flex-row sm:items-end sm:px-8">
      <div>
        <h1 className="font-wide text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex gap-2 sm:ml-auto">{actions}</div>}
    </div>
  );
}
