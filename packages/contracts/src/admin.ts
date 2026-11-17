/** Safe instance-administration filters and DTOs expose operational metadata without credentials or room contents. */
import { z } from "zod";

export const AdminPageQuery = z.strictObject({
  search: z.string().trim().max(200).default(""),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminPageQuery = z.output<typeof AdminPageQuery>;
export const AdminBanInput = z.strictObject({ reason: z.string().trim().min(1).max(1000), expiresAt: z.iso.datetime({ offset: true }).nullable().optional() });
export type AdminBanInput = z.infer<typeof AdminBanInput>;
export const AdminRoleInput = z.strictObject({ role: z.enum(["admin", "user"]) });
export type AdminRoleInput = z.infer<typeof AdminRoleInput>;
export type AdminAccess = { userId: string; role: "admin" };
export type AdminUser = {
  id: string; name: string; email: string; image: string | null; createdAt: string;
  emailVerified: boolean; twoFactorEnabled: boolean; role: "admin" | "user";
  banned: boolean; banReason: string | null; banExpires: string | null;
  organizations: Array<{ id: string; name: string; role: string }>;
};
export type AdminRoom = {
  id: string; name: string; kind: "workspace" | "interview"; visibility: "private" | "public";
  organization: { id: string; name: string }; owners: Array<{ id: string; name: string }>;
  members: number; lastActiveAt: string; sandbox: "running" | "stopped" | "unknown";
};
export type AdminUsersPage = { items: AdminUser[]; total: number; page: number; pageSize: number };
export type AdminRoomsPage = { items: AdminRoom[]; total: number; page: number; pageSize: number };
export type AdminHealth = { checkedAt: string; checks: Array<{ id: string; label: string; status: "up" | "down" | "unknown"; checkedAt: string; detail: string | null; value: number | null }> };
