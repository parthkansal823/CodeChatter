/** Let an organisation's owners and admins read and export its audit trail without exposing another organisation's events. */
import type { AuthSession } from "@codechatter/auth";
import { AuditExportQuery, AuditQuery, type AuditActions, type AuditActors, type AuditEventItem, type AuditPage } from "@codechatter/contracts";
import { schema, type DbHandle } from "@codechatter/db";
import { BadRequestException, Controller, ForbiddenException, Get, Header, Inject, Logger, NotFoundException, Param, Query, Res } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, lt, lte, type SQL } from "drizzle-orm";
import type { Response } from "express";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { DB } from "../infra/tokens.js";
import { AUDIT_CSV_LIMIT, streamAuditCsv } from "./audit-csv.js";

const OrgId = z.string().trim().min(1).max(64);
const NoQuery = z.strictObject({});

@Controller("orgs/:orgId/audit")
export class AuditController {
  private readonly logger = new Logger(AuditController.name);
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  async list(
    @CurrentSession() session: AuthSession,
    @Param("orgId", new ZodPipe(OrgId)) orgId: string,
    @Query(new ZodPipe(AuditQuery)) query: AuditQuery,
  ): Promise<AuditPage> {
    await this.requireAdmin(orgId, session.user.id);
    const rows = await this.items(orgId, query, query.limit + 1, query.before);
    const more = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    return { items, next: more ? items.at(-1)?.id ?? null : null };
  }

  @Get("actions")
  @Header("Cache-Control", "private, no-store")
  async actions(
    @CurrentSession() session: AuthSession,
    @Param("orgId", new ZodPipe(OrgId)) orgId: string,
    @Query(new ZodPipe(NoQuery)) _query: z.infer<typeof NoQuery>,
  ): Promise<AuditActions> {
    await this.requireAdmin(orgId, session.user.id);
    const rows = await this.handle.db
      .selectDistinct({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.orgId, orgId))
      .orderBy(asc(schema.auditEvents.action));
    return { actions: rows.map((row) => row.action) };
  }

  @Get("actors")
  @Header("Cache-Control", "private, no-store")
  async actors(
    @CurrentSession() session: AuthSession,
    @Param("orgId", new ZodPipe(OrgId)) orgId: string,
    @Query(new ZodPipe(NoQuery)) _query: z.infer<typeof NoQuery>,
  ): Promise<AuditActors> {
    await this.requireAdmin(orgId, session.user.id);
    const actors = await this.handle.db
      .selectDistinct({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
      .from(schema.auditEvents)
      .innerJoin(schema.user, eq(schema.auditEvents.actorId, schema.user.id))
      .where(eq(schema.auditEvents.orgId, orgId))
      .orderBy(asc(schema.user.name), asc(schema.user.id));
    return { actors };
  }

  @Get("export.csv")
  async export(
    @CurrentSession() session: AuthSession,
    @Param("orgId", new ZodPipe(OrgId)) orgId: string,
    @Query(new ZodPipe(AuditExportQuery)) query: AuditExportQuery,
    @Res() response: Response,
  ) {
    const org = await this.requireAdmin(orgId, session.user.id);
    const { auditEvents } = schema;
    // Snapshot only capped IDs, not event bodies. A count followed by separate pages
    // could miss a late-committing older ID and silently mislabel a capped export.
    // This bounded metadata snapshot fixes the header before the first CSV byte,
    // without holding a database transaction open while the client downloads.
    const selected = await this.handle.db.select({ id: auditEvents.id }).from(auditEvents)
      .where(and(...this.filters(orgId, query))).orderBy(desc(auditEvents.id)).limit(AUDIT_CSV_LIMIT + 1);
    const truncated = selected.length > AUDIT_CSV_LIMIT;
    const ids = selected.slice(0, AUDIT_CSV_LIMIT).map((row) => row.id);
    let offset = 0;
    // Slugs are stored as text. Keep untrusted punctuation out of the response header.
    const slug = org.slug.replace(/[^a-z0-9_-]/gi, "-").slice(0, 80) || "organisation";
    const date = new Date().toISOString().slice(0, 10);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="audit-${slug}-${date}.csv"`);
    response.setHeader("Cache-Control", "private, no-store");
    if (truncated) response.setHeader("X-Audit-Truncated", "true");
    await streamAuditCsv(response, async (before, limit) => {
      const page: AuditEventItem[] = [];
      // Deleting an event after the snapshot must not hide later pages that still exist.
      while (page.length < limit && offset < ids.length && !response.destroyed) {
        const batch = ids.slice(offset, offset + limit - page.length);
        offset += batch.length;
        page.push(...await this.items(orgId, query, batch.length, before, batch));
      }
      return page;
    }, {
      truncated,
      onError: () => this.logger.error("Audit CSV export failed after streaming began."),
    });
  }

  private async requireAdmin(orgId: string, userId: string) {
    const [org] = await this.handle.db.select({ id: schema.organization.id, slug: schema.organization.slug })
      .from(schema.organization).where(eq(schema.organization.id, orgId)).limit(1);
    if (!org) throw new NotFoundException("That organisation doesn't exist.");
    const [membership] = await this.handle.db.select({ role: schema.member.role })
      .from(schema.member).where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId))).limit(1);
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      throw new ForbiddenException("Only the organisation's owners and admins can see its audit log.");
    }
    return org;
  }

  private filters(orgId: string, query: AuditExportQuery, before?: string): SQL[] {
    const { auditEvents } = schema;
    const filters: SQL[] = [eq(auditEvents.orgId, orgId)];
    if (query.action) filters.push(eq(auditEvents.action, query.action));
    if (query.actorId) filters.push(eq(auditEvents.actorId, query.actorId));
    if (query.room) filters.push(eq(auditEvents.targetType, "room"), eq(auditEvents.targetId, query.room));
    if (query.from) filters.push(gte(auditEvents.createdAt, this.date(query.from)));
    if (query.to) filters.push(lte(auditEvents.createdAt, this.date(query.to)));
    if (before) filters.push(lt(auditEvents.id, before));
    return filters;
  }

  private async items(orgId: string, query: AuditExportQuery, limit: number, before?: string, ids?: readonly string[]): Promise<AuditEventItem[]> {
    const { auditEvents, user, rooms } = schema;
    const rows = await this.handle.db.select({
      id: auditEvents.id,
      at: auditEvents.createdAt,
      actor: { id: user.id, name: user.name, email: user.email },
      action: auditEvents.action,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      room: { id: rooms.id, name: rooms.name },
      data: auditEvents.data,
      ip: auditEvents.ip,
      userAgent: auditEvents.userAgent,
    }).from(auditEvents)
      .leftJoin(user, eq(auditEvents.actorId, user.id))
      .leftJoin(rooms, and(eq(auditEvents.targetType, "room"), eq(auditEvents.targetId, rooms.id), eq(rooms.orgId, orgId)))
      .where(and(...this.filters(orgId, query, before), ids ? inArray(auditEvents.id, [...ids]) : undefined))
      .orderBy(desc(auditEvents.id))
      .limit(limit);
    return rows.map((row) => ({
      ...row,
      at: row.at.toISOString(),
      // Create/delete events retain the name even after the room itself has gone.
      room: row.room ?? (row.targetType === "room" && row.targetId && /^[A-Z0-9]{6}$/.test(row.targetId) && typeof row.data?.name === "string"
        ? { id: row.targetId, name: row.data.name }
        : null),
    }));
  }

  private date(value: string): Date {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1) {
      throw new BadRequestException("Choose a valid date from year 0001 or later.");
    }
    return date;
  }
}
