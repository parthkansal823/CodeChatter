import { BookOpen, Bot, CirclePlay, Code2, Database, GitBranch, ShieldCheck, TerminalSquare } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { DEMO_VIDEO_URL, REPO_URL, RUN_IT_URL, SHOWCASE } from "@/lib/showcase";

import { JoinWithCode } from "@/components/marketing/join-with-code";
import { LiveHeadline } from "@/components/marketing/live-headline";
import { RoomPreview } from "@/components/marketing/room-preview";
import { TryDemoButton } from "@/components/marketing/try-demo-button";
import { InView } from "@/components/motion/in-view";
import { delay, growX, growY, reveal, revealDown } from "@/components/motion/reveal";
import { Caret, PresenceAvatar, presenceVar, type PresenceSlot } from "@/components/presence/presence";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-5 pt-20 pb-16 sm:pt-28">
        <div className="max-w-3xl">
          <LiveHeadline />
          <p className="mt-7 max-w-[60ch] animate-rise text-lg text-muted-foreground [animation-delay:0.5s]">
            A shared editor, terminal and private sandbox for your team. Send a link, start typing, and every
            edit, run and message stays in sync.
          </p>
          <div className="mt-9 flex animate-rise flex-col gap-3 [animation-delay:0.65s] sm:flex-row sm:items-center">
            {SHOWCASE ? (
              <ShowcaseActions />
            ) : (
              <>
                <Button size="lg" asChild>
                  <Link href="/sign-up">Start a room</Link>
                </Button>
                <TryDemoButton />
                <JoinWithCode />
              </>
            )}
          </div>
        </div>
        <div className="mt-16 animate-rise [animation-delay:1s] sm:mt-20">
          <RoomPreview />
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-5 py-12">
        <Feature
          icon={<GitBranch className="size-4" />}
          title="Edit with anyone, live"
          body="Everyone gets a caret and a colour. A thin thread marks the files each person is in, so you can see where the team is at a glance. Click someone to follow them."
          visual={<PresenceVisual />}
        />
        <Feature
          icon={<TerminalSquare className="size-4" />}
          title="Run it in a private sandbox"
          body="Each room has its own container with a terminal, live preview and tests. It has no network unless you allow it, and your server's secrets never reach it."
          visual={<TerminalVisual />}
        />
        <Feature
          icon={<Bot className="size-4" />}
          title="Let the agent take a step"
          body="Ask for a change and the agent plans it, edits the files and runs commands in the room's sandbox, showing each step as a diff you accept or reject. Suggestions appear as you type, too."
          visual={<AgentVisual />}
        />
        <Feature
          id="services"
          icon={<Database className="size-4" />}
          title="Databases and dev servers in one click"
          body="Start PostgreSQL, MySQL, MariaDB, MongoDB or Redis for the room, with a console and a table browser. Templates for React, Vue, Svelte, Express, FastAPI, Flask and Django install and start their dev server, with a live preview."
          visual={<ServicesVisual />}
        />
        <Feature
          id="security"
          icon={<ShieldCheck className="size-4" />}
          title="Safe to share a room"
          body="Every room's sandbox runs locked down on a private network: no internet, no host, no other rooms. Package installs open only while the room's owner allows them, and only to package registries. A program that runs away, a fork bomb say, resets its own sandbox and nothing else."
          visual={<NetworkVisual />}
          last
        />
      </section>

      <InView className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-20 sm:flex-row sm:items-center">
          <h2 className={`font-wide text-2xl font-semibold tracking-[-0.02em] ${reveal}`}>
            {SHOWCASE ? "Run it yourself, in four commands." : "Open a room and send the link."}
          </h2>
          {SHOWCASE ? (
            RUN_IT_URL && (
              <Button size="lg" asChild className={`sm:ml-auto ${reveal}`} style={delay(120)}>
                <a href={RUN_IT_URL}>How to run it</a>
              </Button>
            )
          ) : (
            <Button size="lg" asChild className={`sm:ml-auto ${reveal}`} style={delay(120)}>
              <Link href="/sign-up">Start a room</Link>
            </Button>
          )}
        </div>
      </InView>
    </>
  );
}

function Feature({
  id,
  icon,
  title,
  body,
  visual,
  last,
}: {
  id?: string;
  icon: ReactNode;
  title: string;
  body: string;
  visual: ReactNode;
  last?: boolean;
}) {
  return (
    <InView id={id} className={`grid scroll-mt-20 gap-8 py-12 md:grid-cols-[1fr_1.1fr] md:gap-16 ${last ? "" : "border-b"}`}>
      <div className={`max-w-md ${reveal}`}>
        <span className="inline-flex size-8 items-center justify-center rounded-md border text-foreground">{icon}</span>
        <h3 className="mt-5 font-wide text-xl font-semibold tracking-[-0.015em]">{title}</h3>
        <p className="mt-3 text-base text-muted-foreground">{body}</p>
      </div>
      <div className="min-w-0 self-center">{visual}</div>
    </InView>
  );
}

const Frame = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`overflow-x-auto rounded-lg border bg-panel p-4 font-mono text-[12.5px] leading-[22px] whitespace-pre ${className}`}>
    {children}
  </div>
);

function PresenceVisual() {
  const rows: Array<{ name: string; slots: PresenceSlot[] }> = [
    { name: "api/routes.ts", slots: [2] },
    { name: "web/checkout.tsx", slots: [1, 2] },
    { name: "web/cart.tsx", slots: [] },
    { name: "README.md", slots: [1] },
  ];
  return (
    <Frame className="font-sans">
      <div className={`mb-3 flex items-center gap-2 whitespace-normal ${reveal}`} style={delay(100)}>
        <PresenceAvatar name="Parth" slot={1} size={22} />
        <PresenceAvatar name="Ananya" slot={2} size={22} />
        <span className="ml-1 text-xs text-muted-foreground">2 people in this room</span>
      </div>
      {rows.map((row, i) => (
        <div
          key={row.name}
          className={`flex h-7 items-center gap-2 border-t text-sm first-of-type:border-t-0 ${reveal}`}
          style={delay(200 + i * 110)}
        >
          <span className="font-mono text-[12.5px]">{row.name}</span>
          {/* Threads grow in after their row, like people arriving in files. */}
          <span className="ml-auto flex h-4 gap-[2px]">
            {row.slots.map((slot, j) => (
              <span
                key={slot}
                className={`h-full w-thread rounded-full ${growY}`}
                style={{ backgroundColor: presenceVar(slot), ...delay(520 + i * 110 + j * 90) }}
              />
            ))}
          </span>
        </div>
      ))}
    </Frame>
  );
}

function TerminalVisual() {
  const lines: ReactNode[] = [
    <span key="cmd" className="text-muted-foreground">
      <span className="text-foreground">~/workspace</span> $ npm test
    </span>,
    "✓ orders › validates input with zod",
    "✓ orders › prices every SKU from the catalog",
    "✓ orders › charges once per idempotency key",
    <span key="sum" className="text-muted-foreground">Tests: 12 passed, 12 total</span>,
  ];
  return (
    <Frame>
      {lines.map((line, i) => (
        // Output streams in the way a real run prints it.
        <div key={i} className={reveal} style={delay(150 + i * 230)}>
          {line}
        </div>
      ))}
      <div className={`text-muted-foreground ${reveal}`} style={delay(150 + lines.length * 230)}>
        <span className="text-foreground">~/workspace</span> $ <Caret slot={1} blink />
      </div>
    </Frame>
  );
}

function AgentVisual() {
  return (
    <Frame>
      <div className={`mb-2 font-sans text-xs whitespace-normal text-muted-foreground ${reveal}`} style={delay(100)}>
        Parth asked: add a free-shipping threshold
      </div>
      <div className={`text-muted-foreground ${reveal}`} style={delay(300)}>
        <span className="select-none">  </span>const shipping = 4.99;
      </div>
      <div className={`bg-destructive/10 ${reveal}`} style={delay(650)}>
        <span className="select-none text-destructive">- </span>return subtotal + shipping;
      </div>
      <div className={`bg-brand-muted font-ai ${reveal}`} style={delay(1050)}>
        <span className="select-none text-brand">+ </span>return subtotal + (subtotal &gt;= 50 ? 0 : shipping);
      </div>
      <div className={`mt-3 flex gap-2 font-sans whitespace-normal ${reveal}`} style={delay(1400)}>
        <span className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">Accept</span>
        <span className="rounded-md border px-2.5 py-1 text-xs font-medium">Reject</span>
      </div>
    </Frame>
  );
}

function ServicesVisual() {
  const rows = [
    { name: "PostgreSQL 18", detail: "postgres:5432", state: "Running" },
    { name: "Redis (Valkey 9)", detail: "redis:6379", state: "Running" },
    { name: "Dev server", detail: "npm run dev", state: "Running on port 5173" },
  ];
  return (
    <div className="overflow-hidden rounded-lg border bg-panel">
      {rows.map((row, i) => (
        <div key={row.name} className={`flex items-center gap-3 border-t px-4 py-2.5 first:border-t-0 ${reveal}`} style={delay(150 + i * 170)}>
          <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
          <span className="font-medium">{row.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{row.detail}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{row.state}</span>
        </div>
      ))}
      <div className={`border-t px-4 py-2.5 font-mono text-[12.5px] ${reveal}`} style={delay(700)}>
        <span className="text-muted-foreground">select</span> name, role <span className="text-muted-foreground">from</span> team;
        <span className="ml-3 text-xs text-muted-foreground">3 rows, 4 ms</span>
      </div>
    </div>
  );
}

function NetworkVisual() {
  const reach = [
    ["The internet", "blocked"],
    ["Other rooms, the host", "blocked"],
    ["npm, PyPI, crates.io", "open for 1 hour, allowed by Parth"],
  ];
  return (
    <div className="overflow-hidden rounded-lg border bg-panel">
      {reach.map(([what, how], i) => (
        <div key={what} className={`flex items-center gap-3 border-t px-4 py-2.5 first:border-t-0 ${revealDown}`} style={delay(150 + i * 170)}>
          <span className="font-medium">{what}</span>
          <span className={`ml-auto shrink-0 text-xs ${how === "blocked" ? "text-muted-foreground" : "text-foreground"}`}>{how}</span>
        </div>
      ))}
    </div>
  );
}

/** Showcase mode (lib/showcase.ts): the video, the code and how to run it, instead of signing in. */
function ShowcaseActions() {
  return (
    <>
      {DEMO_VIDEO_URL && (
        <Button size="lg" asChild>
          <a href={DEMO_VIDEO_URL}>
            <CirclePlay /> Watch the 2-minute demo
          </a>
        </Button>
      )}
      {REPO_URL && (
        <Button size="lg" variant={DEMO_VIDEO_URL ? "outline" : "default"} asChild>
          <a href={REPO_URL}>
            <Code2 /> See the code
          </a>
        </Button>
      )}
      {RUN_IT_URL && (
        <Button size="lg" variant="ghost" asChild>
          <a href={RUN_IT_URL}>
            <BookOpen /> Run it yourself
          </a>
        </Button>
      )}
    </>
  );
}
