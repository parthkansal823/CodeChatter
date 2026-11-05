# Task for ChatGPT: teams in CodeChatter: make one, invite people, manage members

You are helping build **CodeChatter v2**, a real-time collaborative IDE (shared editor, a Docker sandbox per room, chat). Another AI works on other parts of the codebase at the same time, so **only create or change the files listed under "Files you may touch"**. The owner does all git himself: give files and diffs, never git commands.

Your job is the roadmap item "**Organisations:** roles, invitations". Three things are half-built and visibly broken:
- The sidebar's organisation switcher has a "new organisation" item that opens `/orgs/new`, but that page doesn't exist (404).
- Invitation emails are already sent with a link to `/invite/<id>`, but that page doesn't exist either.
- There's no page to see or manage an organisation's members.

Build those three, with Better Auth's organization plugin, which is already configured on both the server and the browser.

## What exists (read these files in the repository first)

- **Better Auth 1.7** with the `organization`, `twoFactor` and `admin` plugins:
  - server: `packages/auth/src/options.ts` (`organization({ allowUserToCreateOrganization: true, creatorRole: "owner", sendInvitationEmail })`) and `packages/auth/src/index.ts`;
  - browser: `apps/web/lib/auth-client.ts` exports `authClient`, with `organizationClient()`.

  Use the plugin's client methods rather than new API routes wherever they do the job: `authClient.organization.create`, `inviteMember`, `listMembers`, `updateMemberRole`, `removeMember`, `listInvitations`, `cancelInvitation`, `getInvitation`, `acceptInvitation`, `rejectInvitation`, `leave` and `setActive`. **Check each method's exact name and arguments in `node_modules/better-auth`'s type definitions for the installed version; don't trust this list.**
- **Personal organisations:** every user owns exactly one, made by `ensurePersonalOrg` in `packages/auth/src/index.ts`. Its slug is `u-<userId>`, its `metadata` is `{"personal":true}`, and `/api/me` returns `personalOrgId`.
  - A personal organisation can't have other members: no invitations, no members page beyond "this is your personal workspace".
  - Enforce this on the server too, with the organization plugin's hooks if Better Auth 1.7 has them (look for `organizationHooks` or `beforeCreateInvitation` in its types). Say what you found.
- **Roles:** `owner`, `admin` and `member` (the plugin's defaults). Owners and admins can invite and change roles. Only an owner can make someone an owner, and the last owner can't leave, be removed or be demoted.
- **Tables** (`packages/db/src/schema/auth.ts`): `organization`, `member` (`organizationId`, `userId`, `role`) and `invitation` already exist. **No schema change or migration is needed.**
- **What org membership means:** rooms belong to an organisation, but room access is per room (`RoomsService.require` in `apps/api/src/rooms/rooms.service.ts`, which checks the room's own members). Being in an organisation lets you make rooms in it (`isOrgMember`), and lets owners and admins open its audit log (`/settings/audit`) and webhooks (`/settings/webhooks`). Don't change room access in this task.
- **The app shell** (`apps/web/components/app/app-shell.tsx`):
  - `useMe()` returns `{ session: { activeOrganizationId }, organizations: [{ id, name, role }], personalOrgId, user }`;
  - `PageHeader({ title, description, actions? })` is the page title bar;
  - the organisation switcher is `apps/web/components/app/org-switcher.tsx`.
  - After creating, joining or leaving an organisation, refresh what `useMe()` shows. Find how it loads; it's a react-query query.
- **The settings page** (`apps/web/app/(app)/settings/page.tsx`) already has sections linking to the audit log and webhooks for owners and admins. Copy that pattern.
- **Sign-in pages** are in `apps/web/app/(auth)/`. Someone opening an invitation link while signed out must be sent to sign in or sign up and then come back: sign-in takes a `returnTo` parameter. Check how `sign-in/page.tsx` reads it.
- **UI:**
  - Next.js 16 and React 19 with the React Compiler on: don't memoise by hand without a reason.
  - shadcn/ui in `apps/web/components/ui` (`Button` sizes `xs`, `sm`, `icon-xs`, `icon-sm`; `Dialog`, `Select`, `Table`, `Field`…), `lucide-react` icons, `sonner` toasts.
  - Tailwind 4 **token classes only** (`bg-background`, `text-muted-foreground`, `border`, `text-destructive`…). A hook rejects hex and `rgb()` in TSX.
  - Dense: 13px UI, `text-xs` tables. Plain, short English copy.

## What to build

1. **`/orgs/new`** (`apps/web/app/(app)/orgs/new/page.tsx`): name a new organisation, with a slug made from the name (editable, checked as you type with the plugin's slug check if there is one). Create it, make it active, and go to the dashboard. Refuse an empty name or a taken slug with a plain message.
2. **The members page** (`apps/web/app/(app)/settings/members/page.tsx`, linked from Settings for every non-personal organisation):
   - **Members:** a table of name, email, role and joined date. Owners and admins get a role menu and Remove (with a confirm); members see the list read-only. Your own row says "you" and offers **Leave organisation**, except for the last owner.
   - **Invite people:** emails (one or several, separated by commas or new lines; at most 20 at once) and a role (member or admin; an owner can also invite owners). Invite each, and report which succeeded and which failed, and why: already a member, already invited, or not an email.
   - **Pending invitations:** email, role, who invited, expiry, and Cancel, plus **Copy link** (`<origin>/invite/<id>`) for when email isn't set up.
   - **Personal workspace:** one sentence saying it's just you, with a link to `/orgs/new`.
3. **`/invite/[id]`** (`apps/web/app/(app)/invite/[id]/page.tsx`, or under `(auth)` if that works better for signed-out visitors; say which and why):
   - Show the organisation, who invited you, and the role, with **Join** and **Decline**.
   - **Signed out:** sign in or sign up first, then come back here.
   - **Signed in as a different email than the one invited:** say so, offer to sign out and sign in as the right person, and don't accept.
   - **Expired, cancelled or already used:** a plain message and a link to the dashboard.
   - After joining, make the organisation active and go to the dashboard.
4. **Server checks** (wherever the plugin needs configuring, in `packages/auth/src/options.ts` or `index.ts`):
   - no invitations into personal organisations;
   - nobody can remove or demote the last owner;
   - only owners can grant the owner role.

   If the plugin already enforces one, say so instead of adding code.
5. **A browser test**, `apps/web/test/org-members.e2e.mjs`, modelled on `apps/web/test/public-rooms.e2e.mjs` or `notifications.e2e.mjs`. Helpers are in `apps/web/test/browser.mjs`: `launch()` gives `{ browser, errors, signIn }`, `signIn(email)` gives `{ context, page }`, and there are `check(name, ok, detail)` and `finish()`. Accounts: test1@codechatter.local and test2@codechatter.local, password `codechatter123`. The test:
   1. As test1, makes an organisation named `E2E team <stamp>`.
   2. Invites test2 as a member and copies the invitation link.
   3. As test2, opens the link and joins.
   4. Checks that test1 sees test2 in Members, then changes test2 to admin.
   5. Checks that test2 sees the role change after a reload.
   6. Has test2 leave.
   7. **Deletes the organisation at the end**, even on failure. Use the plugin's `organization.delete` if it exists; otherwise say how the owner cleans up.
   8. Checks there were no page errors.

## Files you may touch

- `apps/web/app/(app)/orgs/new/page.tsx`, `apps/web/app/(app)/settings/members/page.tsx`, `apps/web/app/(app)/invite/[id]/page.tsx` (or under `(auth)`): all new
- `apps/web/components/settings/members/*` (new)
- `apps/web/app/(app)/settings/page.tsx` (add the Members section)
- `apps/web/components/app/org-switcher.tsx` (only if the "new organisation" item needs a fix)
- `apps/web/app/(auth)/sign-in/page.tsx` and `sign-up/page.tsx` (only if `returnTo` doesn't already survive sign-up)
- `packages/auth/src/options.ts`, `packages/auth/src/index.ts` (the server checks only)
- `apps/web/test/org-members.e2e.mjs` (new)

## How to answer

1. Each new file in full, and each edit as a unified diff with enough context.
2. The owner's commands to check it:
   - `pnpm --filter @codechatter/auth build` (if you changed auth);
   - `pnpm --filter @codechatter/web exec eslint <files>` and `pnpm --filter @codechatter/web typecheck`;
   - from `apps/web`, with the dev stack running: `node test/org-members.e2e.mjs`.

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
