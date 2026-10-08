"use client";

import type { AiTokenCount, AiUsage, AiUsageTotals } from "@codechatter/contracts";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const formatCount = (n: number): string => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** "1.2k tokens", with "about" when the provider didn't report the count. */
export const formatTokens = (usage: AiTokenCount): string => `${usage.estimated ? "About " : ""}${formatCount(usage.inputTokens + usage.outputTokens)} tokens`;

const minutes = (seconds: number) => (seconds < 60 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`);

/** Your requests left in the rate limit, and your token usage, in a popover. */
export function UsageMeter() {
  const usage = useQuery({ queryKey: ["ai-usage"], queryFn: () => api<AiUsage>("/api/ai/usage"), staleTime: 10_000 });
  const limit = usage.data?.rateLimit;
  const out = limit?.remaining === 0;
  const low = limit ? limit.remaining <= Math.max(2, Math.floor(limit.limit * 0.1)) : false;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="xs" variant="ghost" aria-label="AI usage and limit" className={cn(low && "text-warning hover:text-warning")}>
          {limit ? (out ? "Limit reached" : `${limit.remaining} left`) : "Usage"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-72 gap-3 p-3 text-sm">
        {!usage.data ? (
          <p className="text-muted-foreground">{usage.isError ? "Couldn't load your usage." : "Loading…"}</p>
        ) : (
          <>
            <div>
              <p className="font-medium">Requests in the last {minutes(usage.data.rateLimit.windowSeconds)}</p>
              <div
                role="meter"
                aria-label="Requests used"
                aria-valuemin={0}
                aria-valuemax={usage.data.rateLimit.limit}
                aria-valuenow={usage.data.rateLimit.used}
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div className={cn("h-full", out || low ? "bg-warning" : "bg-foreground")} style={{ width: `${(usage.data.rateLimit.used / usage.data.rateLimit.limit) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {usage.data.rateLimit.used} of {usage.data.rateLimit.limit} used.{" "}
                {out ? `The next request fits in about ${minutes(usage.data.rateLimit.resetSeconds)}.` : `${usage.data.rateLimit.remaining} left.`}
              </p>
            </div>
            <Totals label="Today (UTC)" totals={usage.data.today} />
            <Totals label="Last 30 days" totals={usage.data.last30Days} />
            {(usage.data.today.estimated || usage.data.last30Days.estimated) && (
              <p className="text-2xs text-muted-foreground">Some providers do not report tokens, so those are estimated from text length.</p>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Totals({ label, totals }: { label: string; totals: AiUsageTotals }) {
  return (
    <div>
      <p className="font-medium">{label}</p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {totals.requests} {totals.requests === 1 ? "request" : "requests"}. {totals.estimated ? "About " : ""}
        {formatCount(totals.inputTokens)} tokens in, {formatCount(totals.outputTokens)} out.
      </p>
    </div>
  );
}
