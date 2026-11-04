/** Shared audit filters and results keep the organisation's log, paging and CSV export consistent. */
import { z } from "zod";

const filters = {
  action: z.string().trim().min(1).max(64).optional(),
  actorId: z.string().trim().min(1).max(128).optional(),
  room: z.string().regex(/^[A-Z0-9]{6}$/, "Use a six-character room code with uppercase letters or digits.").optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
};

function datesInOrder(query: { from?: string; to?: string }): boolean {
  return !query.from || !query.to || Date.parse(query.from) <= Date.parse(query.to);
}

export const AuditQuery = z.strictObject({
  ...filters,
  before: z.uuid().optional(),
  limit: z.union([z.number(), z.string().regex(/^\d+$/)]).transform((value) => Number(value)).pipe(z.number().int().min(1).max(200)).default(50),
}).refine(datesInOrder, { path: ["to"], message: "To must be at or after From." });
export type AuditQuery = z.infer<typeof AuditQuery>;

/** Exports use the same filters, with no cursor or page size that could silently shorten the download. */
export const AuditExportQuery = z.strictObject(filters)
  .refine(datesInOrder, { path: ["to"], message: "To must be at or after From." });
export type AuditExportQuery = z.infer<typeof AuditExportQuery>;

const actor = z.object({ id: z.string(), name: z.string(), email: z.string() });

export const AuditEventItem = z.object({
  id: z.uuid(),
  at: z.iso.datetime({ offset: true }),
  actor: actor.nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  room: z.object({ id: z.string(), name: z.string() }).nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type AuditEventItem = z.infer<typeof AuditEventItem>;

export const AuditPage = z.object({ items: z.array(AuditEventItem), next: z.uuid().nullable() });
export type AuditPage = z.infer<typeof AuditPage>;

export const AuditActions = z.object({ actions: z.array(z.string()) });
export type AuditActions = z.infer<typeof AuditActions>;

/** All people seen in the organisation's log, independent of the current filters or loaded pages. */
export const AuditActors = z.object({ actors: z.array(actor) });
export type AuditActors = z.infer<typeof AuditActors>;
