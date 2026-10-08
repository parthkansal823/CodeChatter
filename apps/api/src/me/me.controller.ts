import { ensurePersonalOrg, type AuthSession } from "@codechatter/auth";
import { schema, type DbHandle } from "@codechatter/db";
import { Controller, Get, Inject } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { DB } from "../infra/tokens.js";

@Controller("me")
export class MeController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  @Get()
  async me(@CurrentSession() session: AuthSession) {
    const { db } = this.handle;
    // Normally created by the sign-up hook; this covers users from before it
    // existed and any hook failure, so every user always has an org.
    const personalOrgId = await ensurePersonalOrg(db, session.user);
    const organizations = await db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        role: schema.member.role,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
      .where(eq(schema.member.userId, session.user.id));

    return {
      user: session.user,
      session: {
        id: session.session.id,
        expiresAt: session.session.expiresAt,
        activeOrganizationId: session.session.activeOrganizationId ?? personalOrgId,
      },
      personalOrgId,
      organizations,
    };
  }
}
