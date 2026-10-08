import type { BetterAuthOptions } from "better-auth";
import { admin, organization, twoFactor } from "better-auth/plugins";

/**
 * The parts of the Better Auth configuration that decide which tables and
 * columns exist. Kept free of any database import so `pnpm generate-schema`
 * can load it before packages/db has an auth schema to import.
 */
export const APP_NAME = "CodeChatter";

type OrganizationOptions = NonNullable<Parameters<typeof organization>[0]>;

export interface PluginCallbacks {
  sendInvitationEmail?: OrganizationOptions["sendInvitationEmail"];
}

export function schemaShapingOptions(callbacks: PluginCallbacks = {}) {
  return {
    appName: APP_NAME,
    basePath: "/api/auth",
    emailAndPassword: { enabled: true },
    user: {
      additionalFields: {
        // Hue (0-359) for the generated avatar when no image is set (v1 parity).
        avatarHue: { type: "number", required: false, input: true },
      },
    },
    plugins: [
      twoFactor({ issuer: APP_NAME }),
      organization({
        allowUserToCreateOrganization: true,
        creatorRole: "owner",
        ...(callbacks.sendInvitationEmail && { sendInvitationEmail: callbacks.sendInvitationEmail }),
      }),
      admin(),
    ],
  } satisfies Partial<BetterAuthOptions>;
}
