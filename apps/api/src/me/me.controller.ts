import { ensurePersonalOrg, type AuthSession } from "@codechatter/auth";
import { schema, type DbHandle } from "@codechatter/db";
import { Body, Controller, Get, HttpCode, Inject, PayloadTooLargeException, Put } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { CurrentSession } from "../auth/current-session.decorator.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { DB } from "../infra/tokens.js";

/** The editor's settings (web: editor/settings.ts) and imported themes; the browser checks their shape. */
const SettingsInput = z.object({
  editor: z.record(z.string(), z.unknown()),
  themes: z.array(z.object({ id: z.string().max(64), name: z.string().max(80), data: z.record(z.string(), z.unknown()) })).max(20),
});
/** Twenty themes of the usual size fit with room to spare; the API's JSON limit is 1 MB. */
const MAX_SETTINGS_BYTES = 900 * 1024;

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

  /** Your editor settings and imported themes, as you last saved them from any browser (null before the first save). */
  @Get("settings")
  async settings(@CurrentSession() session: AuthSession) {
    const [row] = await this.handle.db.select().from(schema.userSettings).where(eq(schema.userSettings.userId, session.user.id));
    return { settings: row ? { editor: row.editor, themes: row.themes, updatedAt: row.updatedAt } : null };
  }

  @Put("settings")
  @HttpCode(200)
  async saveSettings(@CurrentSession() session: AuthSession, @Body(new ZodPipe(SettingsInput)) input: z.infer<typeof SettingsInput>) {
    if (JSON.stringify(input).length > MAX_SETTINGS_BYTES) throw new PayloadTooLargeException("Too many or too large themes to save. Remove one and try again.");
    const values = { userId: session.user.id, editor: input.editor, themes: input.themes, updatedAt: new Date() };
    await this.handle.db.insert(schema.userSettings).values(values).onConflictDoUpdate({ target: schema.userSettings.userId, set: values });
    return { updatedAt: values.updatedAt };
  }
}
