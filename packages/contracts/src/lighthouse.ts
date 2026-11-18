/**
 * Lighthouse in the room's browser (apps/runner/src/lighthouse.ts, sandbox/image/lighthouse.py): Google's own, run in the room's sandbox against one
 * of its servers, as a phone (throttled) or a desktop. Scores for performance, accessibility, best practices and SEO, the Core Web Vitals, what failed,
 * and Lighthouse's whole HTML report.
 */
import { z } from "zod";

export const LIGHTHOUSE_CATEGORIES = ["performance", "accessibility", "best-practices", "seo"] as const;

export const LighthouseInput = z.object({
  port: z.number().int().min(1).max(65535),
  path: z.string().max(2000).regex(/^\/\S*$/, "That isn't a path on the server.").default("/"),
  device: z.enum(["mobile", "desktop"]).default("mobile"),
  categories: z.array(z.enum(LIGHTHOUSE_CATEGORIES)).min(1).max(4).optional(),
});
export type LighthouseInput = z.infer<typeof LighthouseInput>;

export type LighthouseAudit = { id: string; title: string; description: string; displayValue?: string | null; score: number | null; weight?: number; group?: string | null };
export type LighthouseReport = {
  url: string;
  device: "mobile" | "desktop";
  fetchedAt: string;
  lighthouseVersion: string;
  categories: Array<{ id: (typeof LIGHTHOUSE_CATEGORIES)[number]; title: string; score: number | null; failing: LighthouseAudit[] }>;
  metrics: LighthouseAudit[];
  warnings: string[];
  /** Lighthouse's own report, to open whole. */
  html: string | null;
};
