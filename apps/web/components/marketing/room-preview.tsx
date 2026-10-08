"use client";

import { ChevronRight, FileCode2, Folder, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { LogoMark } from "@/components/brand/logo";
import { RunButton, RunPanel, useDemoRun } from "@/components/marketing/run-output";
import { Caret, PresenceAvatar, Threads, type PresenceSlot } from "@/components/presence/presence";

type Row = { name: string; depth: number; folder?: boolean; active?: boolean; threads?: PresenceSlot[] };

const TREE: Row[] = [
  { name: "src", depth: 0, folder: true },
  { name: "orders.ts", depth: 1, active: true, threads: [1, 2] },
  { name: "coupons.ts", depth: 1 },
  { name: "services.ts", depth: 1 },
  { name: "orders.test.ts", depth: 1 },
  { name: "package.json", depth: 0 },
];

// A frame of a room, drawn with the real tokens and fonts — not a screenshot —
// so it stays sharp and follows the theme. Run works: it plays the output of
// placeOrder() in an output panel, as a real room would.
export function RoomPreview() {
  const { state, visible, run, close } = useDemoRun();
  return (
    <div className="overflow-hidden rounded-xl border bg-background text-[12.5px] leading-5 shadow-[0_1px_0_var(--border),0_24px_48px_-24px_color-mix(in_oklch,var(--foreground)_22%,transparent)]">
      {/* Title bar */}
      <div className="flex h-10 items-center gap-3 border-b bg-chrome px-3">
        <LogoMark className="size-4" />
        <span className="hidden text-muted-foreground sm:inline">acme</span>
        <ChevronRight className="hidden size-3.5 text-muted-foreground sm:block" />
        <span className="truncate font-medium">checkout-service</span>
        <span className="ml-2 hidden items-center gap-1.5 text-2xs text-muted-foreground sm:flex">
          <span className="size-1.5 rounded-full bg-success" /> Saved
        </span>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden items-center gap-1.5 sm:flex">
            <PresenceAvatar name="Parth" slot={1} size={22} />
            <PresenceAvatar name="Ananya" slot={2} size={22} />
          </div>
          <RunButton state={state} onRun={run} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr]">
        {/* File tree */}
        <div className="hidden border-r bg-panel py-2 sm:block">
          {TREE.map((row) => (
            <div
              key={row.name}
              className={`flex h-row items-center gap-1.5 pr-2 ${row.active ? "bg-accent text-foreground" : "text-muted-foreground"}`}
              style={{ paddingLeft: 10 + row.depth * 14 }}
            >
              {row.folder ? <Folder className="size-3.5" /> : <FileCode2 className="size-3.5" />}
              <span className="truncate">{row.name}</span>
              <Threads slots={row.threads ?? []} className="ml-auto h-3.5" />
            </div>
          ))}
        </div>

        {/* Editor */}
        <div className="min-w-0">
          <div className="flex h-8 items-end gap-px border-b bg-chrome px-2">
            <span className="relative rounded-t-md border-x border-t bg-background px-3 py-1.5 text-foreground">
              <span className="absolute inset-x-0 -top-px h-[2px] rounded-full bg-brand" />
              orders.ts
            </span>
            <span className="px-3 py-1.5 text-muted-foreground">coupons.ts</span>
          </div>
          <pre className="overflow-x-auto px-0 pt-7 pb-3 font-mono text-[12.5px] leading-[22px]">
            <Line n={1}>
              <K>import</K> {"{ z }"} <K>from</K> <S>{'"zod"'}</S>;
              <Caret slot={1} name="Parth" blink className="ml-px" />
            </Line>
            <Line n={2}>
              <K>import</K> {"{ catalog, coupons, payments }"} <K>from</K> <S>{'"./services"'}</S>;
            </Line>
            <Line n={3}> </Line>
            <Line n={4}>
              <K>const</K> <T>Order</T> = z.<F>object</F>({"{"}
            </Line>
            <Line n={5}>
              {"  items: z."}
              <F>array</F>
              {"(z."}
              <F>object</F>
              {"({ sku: z."}
              <F>string</F>
              {"(), qty: z."}
              <F>number</F>
              {"()."}
              <F>int</F>
              {"()."}
              <F>positive</F>
              {"() })),"}
            </Line>
            <Line n={6}>
              {"  coupon: z."}
              <F>string</F>
              {"()."}
              <F>optional</F>
              {"(),"}
            </Line>
            <Line n={7}>{"});"}</Line>
            <Line n={8}> </Line>
            <Line n={9}>
              <K>export async function</K> <F>placeOrder</F>(input: <T>unknown</T>) {"{"}
            </Line>
            <Line n={10}>
              {"  "}
              <K>const</K> order = <T>Order</T>.<F>parse</F>(input);
            </Line>
            <Line n={11}>
              {"  "}
              <K>const</K> prices = <K>await</K> catalog.<F>priceFor</F>(order.items.<F>map</F>((i) =&gt; i.sku));
            </Line>
            <Line n={12}>
              {"  "}
              <K>const</K> subtotal = order.items.<F>reduce</F>((sum, i) =&gt; sum + prices[i.sku] * i.qty, <N>0</N>);
              <Caret slot={2} name="Ananya" className="ml-px" />
            </Line>
            <Line n={13}>
              {"  "}
              <K>const</K> discount = <K>await</K> coupons.<F>redeem</F>(order.coupon, subtotal);
            </Line>
            <Line n={14} ai>
              {"  "}
              <K>return</K> payments.<F>charge</F>(<F>roundCents</F>(subtotal - discount), {"{ idempotencyKey: order.id }"});
            </Line>
            <Line n={15}>{"}"}</Line>
          </pre>
          <RunPanel state={state} visible={visible} onClose={close} />
          <div className="flex items-center gap-2 border-t px-3 py-2 text-2xs text-muted-foreground">
            <Sparkles className="size-3.5" />
            <span className="font-ai">
              {state === "running"
                ? "Running placeOrder() in the sandbox…"
                : state === "done"
                  ? "Order placed. Agent wrote line 14, and all 12 tests pass."
                  : "Agent wrote line 14. All 12 tests pass. Press Run to try it."}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Line({ n, ai, children }: { n: number; ai?: boolean; children: ReactNode }) {
  return (
    <div className={`flex ${ai ? "bg-brand-muted font-ai" : ""}`}>
      <span className="w-10 shrink-0 pr-3 text-right text-muted-foreground/60 select-none">{n}</span>
      <span className="whitespace-pre">{children}</span>
    </div>
  );
}
const K = ({ children }: { children: ReactNode }) => <span className="text-muted-foreground">{children}</span>;
const F = ({ children }: { children: ReactNode }) => <span className="font-medium">{children}</span>;
const T = ({ children }: { children: ReactNode }) => <span className="italic">{children}</span>;
const S = ({ children }: { children: ReactNode }) => <span className="text-foreground/65">{children}</span>;
const N = ({ children }: { children: ReactNode }) => <span className="text-brand">{children}</span>;
