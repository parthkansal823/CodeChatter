import type { BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
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
  organizationHooks?: OrganizationOptions["organizationHooks"];
}

export function schemaShapingOptions(callbacks: PluginCallbacks = {}) {
  // Only an isolated, local security test opts into account deletion. The shared
  // stack and production keep their existing disabled setting.
  const securityTestDeletion = process.env.NODE_ENV !== "production" && process.env.CODECHATTER_SECURITY_E2E === "1";
  return {
    appName: APP_NAME,
    basePath: "/api/auth",
    emailAndPassword: { enabled: true },
    user: {
      deleteUser: {
        enabled: securityTestDeletion,
        beforeDelete: async (user) => {
          if (!securityTestDeletion || !/^sec-[a-z0-9-]+@codechatter\.local$/i.test(user.email)) {
            throw new APIError("FORBIDDEN", { message: "Only disposable local security-test accounts can be deleted here." });
          }
        },
      },
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
        ...(callbacks.organizationHooks && { organizationHooks: callbacks.organizationHooks }),
      }),
      admin(),
    ],
  } satisfies Partial<BetterAuthOptions>;
}
