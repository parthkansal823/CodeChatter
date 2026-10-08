"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The hairline under the header appears only once the page has scrolled. */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-sticky border-b bg-background/80 backdrop-blur-md transition-colors duration-300 supports-[backdrop-filter]:bg-background/70",
        scrolled ? "border-border" : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
        <Link href="/" aria-label="CodeChatter home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-5 text-muted-foreground md:flex">
          <Link href="/#features" className="transition-colors hover:text-foreground">Product</Link>
          <Link href="/#automations" className="transition-colors hover:text-foreground">Automations</Link>
          <Link href="/#security" className="transition-colors hover:text-foreground">Security</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/sign-up">Start a room</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
