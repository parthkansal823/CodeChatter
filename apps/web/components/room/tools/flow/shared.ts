/** Small things the Flow tool's parts share. */
import type { FlowInput } from "@codechatter/contracts";

import { ApiError } from "@/lib/api";

export type Ask = <T>(input: FlowInput) => Promise<T>;

// What's built changes outside this tool too, from a terminal or someone else's button, so it looks again each time.
export const FRESH = { staleTime: 0, refetchOnMount: "always", retry: false } as const;
export const failure = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach the server. Try again.");
export const when = (at: number | null | undefined) => (at ? new Date(at).toLocaleString([], { dateStyle: "short", timeStyle: "medium" }) : "–");
/** A plain select, dense enough for these forms. */
export const field = "h-7 min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
