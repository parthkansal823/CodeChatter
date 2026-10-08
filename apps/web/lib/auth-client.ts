// Browser-side Better Auth client. Same origin (via Caddy), so the session is
// a first-party httpOnly cookie and no base URL is needed.
import { adminClient, organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        // Runs outside React (inside the auth client); a full navigation also
        // guarantees no half-signed-in state survives in memory.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = "/two-factor";
      },
    }),
    organizationClient(),
    adminClient(),
  ],
});

export const { useSession, signIn, signUp, signOut } = authClient;
