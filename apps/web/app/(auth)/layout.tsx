import { Globe, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { LiveCodeCard } from "@/components/auth/live-code-card";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";

const POINTS = [
  { icon: Users, text: "Everyone gets a caret and a colour. See who is where, live." },
  { icon: ShieldCheck, text: "Each room runs code in its own private sandbox." },
  { icon: Globe, text: "Nothing to install. Share a link and start typing." },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,600px)]">
      <div className="flex flex-col px-6 py-5 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="CodeChatter home">
            <Logo />
          </Link>
          <ThemeToggle />
        </div>
        <main className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[380px] animate-rise [animation-duration:0.5s]">{children}</div>
        </main>
        <p className="text-center text-xs text-muted-foreground lg:text-left">© CodeChatter. Built for teams who write code together.</p>
      </div>

      {/* A quiet panel with the product's signature: two people finishing one function. */}
      <aside className="relative hidden flex-col justify-center gap-10 overflow-hidden border-l bg-panel px-12 lg:flex">
        <div className="max-w-md">
          <h2 className="font-wide text-2xl font-semibold tracking-[-0.02em] text-balance">
            Your team, one file, no merge conflicts.
          </h2>
          <p className="mt-2 text-muted-foreground">Edits from everyone land together, as they type.</p>
        </div>
        <LiveCodeCard />
        <ul className="grid gap-3">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-sm text-muted-foreground">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border bg-background text-foreground">
                <Icon className="size-3.5" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
