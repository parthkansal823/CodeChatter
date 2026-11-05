# Task for ChatGPT: account security in CodeChatter: two-factor sign-in, active sessions, password

You are helping build **CodeChatter v2**, a real-time collaborative IDE. Another AI works on other parts of the codebase at the same time, so **only create or change the files listed under "Files you may touch"**. The owner does all git himself: give files and diffs, never git commands.

Your job is the roadmap item "**Settings pages:** profile; security: 2FA, active sessions". Right now:
- **Two-factor sign-in:** the step exists (`apps/web/app/(auth)/two-factor/page.tsx`, reached through the auth client's `onTwoFactorRedirect`), but nobody can turn 2FA on.
- **Sessions:** nobody can see where they're signed in or sign other devices out.
- **Profile:** the name and password can't be changed after sign-up.

## What exists (read these files in the repository first)

- **Better Auth 1.7**, configured in `packages/auth/src/options.ts`:
  - `twoFactor({ issuer: "CodeChatter" })`, `organization(…)` and `admin()`;
  - email and password sign-in;
  - sessions kept in Valkey (`secondaryStorage`) as well as Postgres.
- **The browser client** is `apps/web/lib/auth-client.ts`: `authClient` with `twoFactorClient({ onTwoFactorRedirect })`, plus `useSession`, `signIn`, `signOut`. Use the client's methods, not new API routes:
  - two-factor: `authClient.twoFactor.enable({ password })`, which returns a TOTP URI and backup codes, `verifyTotp`, `disable`, `generateBackupCodes`;
  - sessions: `authClient.listSessions`, `revokeSession`, `revokeOtherSessions`;
  - account: `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions })` and `updateUser({ name })`.

  **Check each name and its arguments in `node_modules/better-auth`'s type definitions for the installed version; don't trust this list.**
- **Tables** (`packages/db/src/schema/auth.ts`): `twoFactor` and `user.twoFactorEnabled` already exist, so **no migration is needed**.
- **The settings page** is `apps/web/app/(app)/settings/page.tsx`, which currently holds the GitHub token section (`components/app/github-token.tsx`) and links for org admins. Look at how `github-token.tsx` is built and match its look.
- **Accounts that signed up with GitHub or Google** have no password. Check with `authClient.listAccounts()` (or what the version offers):
  - they can't change a password they don't have, so offer "Set a password" through the forgot-password flow (`apps/web/app/(auth)/forgot-password/`) instead;
  - turning on 2FA needs a password with Better Auth, so tell them to set one first.
- **The test accounts** are test1@codechatter.local and test2@codechatter.local, password `codechatter123`. Other tests sign in as them constantly, so **a test must never leave 2FA on or change their password**. Use a throwaway account: sign up `sec-<stamp>@codechatter.local` through `/sign-up`. Check whether sign-up needs email verification in development (`.env` `REQUIRE_EMAIL_VERIFICATION` or the like, and `apps/web/app/(auth)/verify-email`). If it does, say how the test gets past it, for example with Mailpit's API at `http://localhost:8025/api/v1/messages`, which the dev stack runs.
- **QR codes:** no QR library is installed.
  - Show the TOTP secret as text (grouped in fours, with Copy) and the `otpauth://` link, which works for manual entry and on phones.
  - If you think a QR code is needed, use the small `uqr` package (`renderSVG`). Give the exact `pnpm --filter @codechatter/web add uqr@<version>` command, colour the SVG from tokens with `cssVar()` from `apps/web/lib/css-color.ts`, and make it optional: the page must work without it.
- **UI:**
  - Next.js 16 and React 19 (React Compiler on).
  - shadcn/ui in `apps/web/components/ui`, `lucide-react`, `sonner` toasts.
  - **Token classes only**: a hook rejects hex and `rgb()` in TSX.
  - 13px UI, plain English.

## What to build

On the settings page, three sections above the GitHub token. You can put them on their own `/settings/account` page if the page gets long; say which you chose.

1. **Profile:**
   - your name (editable, saved with `updateUser`);
   - your email (read-only for now);
   - how you sign in (password, GitHub or Google).
2. **Password:**
   - **Change password:** current password, new password, and new password again, with a minimum length of 8 (or what the server enforces), plus a "Sign out my other devices" checkbox, on by default.
   - **No password** (GitHub or Google accounts): explain, and offer "Email me a link to set one" through the existing forgot-password flow.
3. **Two-factor sign-in:**
   - **Off:** "Turn on" asks for your password, then shows the secret, the link and the optional QR code. You then type a code from your authenticator app to confirm; it's only on once a code checks out. Then show the **backup codes** once, with Copy and Download (`codechatter-backup-codes.txt`), and say each works once.
   - **On:** "Turn off" (asks for your password) and "New backup codes" (asks for your password; the old ones stop working).
   - Make sure the existing `/two-factor` sign-in page also accepts a **backup code**. If it doesn't, add a "Use a backup code" switch there.
4. **Where you're signed in** (active sessions):
   - Each session shows: browser and OS, worked out from the user agent with a small parser you write yourself, no package (e.g. "Edge on Windows"); the IP address; when it was last active; and when it started.
   - The current one is marked "This device".
   - Every other session gets **Sign out**, and there's **Sign out all other devices**.
5. **A browser test**, `apps/web/test/account-security.e2e.mjs`, using the helpers in `apps/web/test/browser.mjs`: `launch()`, `check(name, ok, detail)`, `finish()`. Sign-up isn't a helper, so drive `/sign-up` directly. The test:
   1. Signs up a throwaway account.
   2. Changes its name and checks the change shows after a reload.
   3. Changes its password and signs in again with the new one.
   4. Turns on 2FA: it computes the TOTP code itself from the secret on the page, with Node's `crypto` and a 20-line RFC 6238 function in the test, no package.
   5. Signs out, signs in, and passes the `/two-factor` step with a fresh code.
   6. Passes it once more with a backup code, and checks that the same backup code fails a second time.
   7. Opens a second browser context and checks that "Sign out" on that session signs the second context out.
   8. Deletes the throwaway account at the end, even on failure (`authClient.deleteUser` if enabled; otherwise say how the owner cleans up).
   9. Checks there were no page errors.

## Files you may touch

- `apps/web/app/(app)/settings/page.tsx`, or a new `apps/web/app/(app)/settings/account/page.tsx` plus a link
- `apps/web/components/settings/account/*` (new)
- `apps/web/app/(auth)/two-factor/page.tsx` (only for the backup-code option)
- `packages/auth/src/options.ts` (only if a setting must change, for example to allow deleting your account in tests; explain why)
- `apps/web/test/account-security.e2e.mjs` (new)

## How to answer

1. Each new file in full, and each edit as a unified diff with enough context.
2. The owner's commands to check it:
   - `pnpm --filter @codechatter/auth build` (if you changed auth);
   - `pnpm --filter @codechatter/web exec eslint <files>` and `pnpm --filter @codechatter/web typecheck`;
   - from `apps/web`, with the dev stack running: `node test/account-security.e2e.mjs`.

## Check your work before you answer

Review your own answer before sending it, and put this review at the end, under **Self-check**. The owner's other AI checks every answer against the repository before it's used. Problems you find and fix yourself save a round trip; a "Done" that isn't true costs one.

1. **The brief, point by point.** A table with one row for each requirement in "What to build":

   | Requirement | Done, Partly or Not done | Where (file and function) | How you know |
   |---|---|---|---|

   Only write Done when the code in your answer does it. If something is Partly or Not done, say what's missing and why.
2. **The rules.** Confirm each one, or say where you broke it and why:
   - you changed only the files under "Files you may touch";
   - no new packages, apart from any this brief allows (and then you gave the exact command);
   - in `apps/api`, `apps/collab`, `apps/runner` and `packages/*`, relative imports end in `.js`;
   - in web files, no hex, `rgb()` or `hsl()` colours, only token classes; copy is plain English;
   - every new file starts with a doc comment saying what it is and why;
   - nothing logs, prints or returns a secret.
3. **What you assumed about existing code.** List every name you used but didn't see in this brief or in the files you read: a function, column, route, prop, environment variable or test helper. For each, say whether you read it in the repository or guessed it. Guesses are the first thing the owner checks.
4. **Walk through the tests.** For each test or check you wrote, say which part of your code makes it pass. Then write down at least one way the feature could break that no test covers.
5. **Edge cases.** The failure cases you handled (bad input, no permission, a network error, two people at once, a retry, a restart) and the ones you didn't.
6. **Scope for improvement.** What you'd do next, and anything in the existing code you read that looks wrong or could be better. Keep it separate from this task: list it, don't build it.
