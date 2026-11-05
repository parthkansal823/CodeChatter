/** Shared outgoing-webhook validation and public results keep secrets out of lists and delivery logs. */
import { z } from "zod";

export const WEBHOOK_EVENTS = [
  "*", "room.create", "room.delete", "room.update", "repo.commit",
  "repo.publish", "repo.pull-request", "sandbox.image", "checkpoint.delete",
] as const;

const url = z.string().trim().min(1).max(2048).pipe(z.url()).refine((raw) => {
  const parsed = new URL(raw);
  return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.hash;
}, "Use an http or https URL without credentials or a fragment.");

const fields = {
  url,
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(50)
    .refine((events) => new Set(events).size === events.length, "Choose each event once.")
    .refine((events) => !events.includes("*") || events.length === 1, "Everything already includes every event."),
  description: z.string().trim().max(500),
  active: z.boolean(),
};

export const WebhookInput = z.strictObject({
  ...fields,
  description: fields.description.default(""),
  active: fields.active.default(true),
});
export type WebhookInput = z.infer<typeof WebhookInput>;

// Zod 4 also applies defaults inside optional fields. Patch fields must have
// none, otherwise pausing an endpoint would silently clear its description.
export const WebhookPatch = z.strictObject(fields).partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), "Include a field to update.");
export type WebhookPatch = z.infer<typeof WebhookPatch>;

export type WebhookPayload = {
  /** Stable event ID, shared by subscriptions and preserved across retries. */
  id: string;
  event: string;
  createdAt: string;
  org: { id: string };
  actor: { id: string; name: string } | null;
  target: { type: string; id: string } | null;
  data: Record<string, unknown>;
};

export type WebhookAttempt = {
  attempt: number;
  at: string;
  statusCode: number | null;
  error: string | null;
  response: string | null;
  durationMs: number;
};

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed";

export type WebhookItem = {
  id: string;
  orgId: string;
  url: string;
  events: string[];
  active: boolean;
  description: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastDelivery: { status: WebhookDeliveryStatus; lastStatusCode: number | null; createdAt: string } | null;
};

export type WebhookDelivery = {
  id: string;
  webhookId: string;
  event: string;
  payload: WebhookPayload;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  lastResponse: string | null;
  attemptLog: WebhookAttempt[];
  createdAt: string;
  deliveredAt: string | null;
};

export type WebhookDeliveryPage = { items: WebhookDelivery[]; next: string | null };
