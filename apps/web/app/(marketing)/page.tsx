import { Bot, GitBranch, ShieldCheck, TerminalSquare, Workflow } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

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
            <Button size="lg" asChild>
              <Link href="/sign-up">Start a room</Link>
            </Button>
            <TryDemoButton />
            <JoinWithCode />
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
          body="Ask for a change and the agent plans it, edits the files, runs the tests and shows each step as a diff you can keep or undo. Its code is set in its own typeface, so you always know who wrote what."
          visual={<AgentVisual />}
        />
        <Feature
          id="automations"
          icon={<Workflow className="size-4" />}
          title="Automate the busywork"
          body="Build flows visually: run tests when a file is saved, post to Slack when a room changes, snapshot every night. Connect GitHub, webhooks and anything that speaks HTTP."
          visual={<FlowVisual />}
        />
        <Feature
          id="security"
          icon={<ShieldCheck className="size-4" />}
          title="Safe to use at work"
          body="Organisations, roles and an audit log. Two-factor sign-in, sessions you can revoke, and every room's history kept so you can go back to any moment."
          visual={<AuditVisual />}
          last
        />
      </section>

      <InView className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-20 sm:flex-row sm:items-center">
          <h2 className={`font-wide text-2xl font-semibold tracking-[-0.02em] ${reveal}`}>Open a room and send the link.</h2>
          <Button size="lg" asChild className={`sm:ml-auto ${reveal}`} style={delay(120)}>
            <Link href="/sign-up">Start a room</Link>
          </Button>
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
        <span className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">Keep</span>
        <span className="rounded-md border px-2.5 py-1 text-xs font-medium">Undo</span>
      </div>
    </Frame>
  );
}

function FlowVisual() {
  const nodes = [
    { label: "File saved", sub: "src/**/*.ts" },
    { label: "Run tests", sub: "npm test" },
    { label: "If tests fail", sub: "exit code ≠ 0" },
    { label: "Post to chat", sub: "#checkout" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-y-2 rounded-lg border bg-panel p-4">
      {nodes.map((node, i) => (
        <div key={node.label} className="flex items-center">
          {i > 0 && <span className={`h-px w-6 bg-foreground/40 ${growX}`} style={delay(i * 300 - 60)} />}
          <div className={`rounded-md border bg-background px-3 py-2 ${reveal}`} style={delay(i * 300 + 80)}>
            <div className="text-sm font-medium">{node.label}</div>
            <div className="font-mono text-xs text-muted-foreground">{node.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditVisual() {
  const events = [
    ["Ananya", "changed Parth's role to editor", "2m"],
    ["Parth", "turned on network access for 1 hour", "18m"],
    ["Ananya", "restored checkout-service to 10:42", "1h"],
  ];
  return (
    <div className="overflow-hidden rounded-lg border bg-panel">
      {events.map(([who, what, when], i) => (
        // Newest first, arriving from the top like a live feed.
        <div key={what} className={`flex items-center gap-3 border-t px-4 py-2.5 first:border-t-0 ${revealDown}`} style={delay(150 + i * 170)}>
          <span className="font-medium">{who}</span>
          <span className="truncate text-muted-foreground">{what}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">{when}</span>
        </div>
      ))}
    </div>
  );
}
