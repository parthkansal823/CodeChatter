// Teams' rules, tried directly against the auth API, because the pages only hide what the server has to refuse: personal
// workspaces, outsiders, other people's invitations, members and admins reaching above their role, the last owner, two owners
// racing to demote each other, and what's left in a session after someone is removed or a team is deleted.
// It starts its own API on :4016 (from the dev watcher's dist) with mail going to Mailpit, because it invites plenty of
// addresses that don't exist, and .env may point at a real mail account.
//   node test/org-rules.e2e.mjs        (from apps/web, with the dev stack running)
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { check, finish } from "./browser.mjs";

const ORIGIN = process.env.APP_URL ?? "http://localhost:8080";
const BASE = "http://127.0.0.1:4016";
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";
const stamp = Date.now().toString(36);
const child = spawn(process.execPath, ["--enable-source-maps", "--env-file-if-exists=../../.env", "dist/main.js"], {
  cwd: resolve(dirname(fileURLToPath(import.meta.url)), "../../api"),
  env: { ...process.env, API_PORT: "4016", LOG_LEVEL: "warn", NODE_ENV: "test", APP_URL: ORIGIN, SMTP_HOST: "localhost", SMTP_PORT: "1025", SMTP_USER: "", SMTP_PASS: "" },
  stdio: ["ignore", "ignore", "ignore"],
});
for (let tries = 0; ; tries++) {
  if (await fetch(`${BASE}/api/healthz`, { signal: AbortSignal.timeout(1000) }).then((res) => res.ok, () => false)) break;
  if (tries > 40) {
    child.kill();
    throw new Error("The test API didn't start: is the API built, and :4016 free?");
  }
  await sleep(750);
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ email, password: "codechatter123" }) });
  if (!res.ok) throw new Error(`sign-in ${res.status}`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
async function call(cookie, path, body, method = body === undefined ? "GET" : "POST") {
  const res = await fetch(`${BASE}/api/auth/organization/${path}`, { method, headers: { origin: ORIGIN, ...(cookie && { cookie }), ...(body !== undefined && { "content-type": "application/json" }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const me = async (cookie) => (await fetch(`${BASE}/api/me`, { headers: { origin: ORIGIN, cookie } })).json();
const refused = (r) => r.status >= 400 && r.status < 500;

const A = "test1@codechatter.local";
const B = "test2@codechatter.local";
const a = await signIn(A);
const b = await signIn(B);
const meA = await me(a);
const meB = await me(b);
const orgs = [];

const newOrg = async (cookie, tag) => {
  const r = await call(cookie, "create", { name: `Attack ${tag} ${stamp}`, slug: `attack-${tag}-${stamp}` });
  if (r.status !== 200) throw new Error(`create ${r.text.slice(0, 200)}`);
  orgs.push({ id: r.json.id, cookie });
  return r.json.id;
};
const join = async (organizationId, role = "member") => {
  const inv = await call(a, "invite-member", { email: B, role, organizationId });
  if (inv.status !== 200) throw new Error(`invite ${inv.text.slice(0, 200)}`);
  const acc = await call(b, "accept-invitation", { invitationId: inv.json.id });
  if (acc.status !== 200) throw new Error(`accept ${acc.text.slice(0, 200)}`);
  return acc.json.member;
};
const members = async (cookie, organizationId) => (await call(cookie, `list-members?organizationId=${organizationId}&limit=100`)).json?.members ?? [];
const roleOf = async (cookie, organizationId, userId) => (await members(cookie, organizationId)).find((m) => m.userId === userId)?.role;

try {
  // Personal workspaces.
  const personal = meA.personalOrgId;
  check("noInviteIntoAPersonalWorkspace", refused(await call(a, "invite-member", { email: B, role: "member", organizationId: personal })));
  const unflag = await call(a, "update", { organizationId: personal, data: { metadata: { personal: false } } });
  check("cantUnflagAPersonalWorkspace", refused(unflag), unflag.text);
  const reslug = await call(a, "update", { organizationId: personal, data: { slug: `x-${stamp}` } });
  check("cantRenameItsSlug", refused(reslug), reslug.text);
  const del = await call(a, "delete", { organizationId: personal });
  check("cantDeleteIt", refused(del), del.text);
  const leavePersonal = await call(a, "leave", { organizationId: personal });
  check("cantLeaveIt", refused(leavePersonal), leavePersonal.text);
  check("itIsStillThere", (await me(a)).organizations.some((o) => o.id === personal));
  const fakeSlug = await call(a, "create", { name: "Fake", slug: `u-${stamp}` });
  if (fakeSlug.status === 200) orgs.push({ id: fakeSlug.json.id, cookie: a });
  check("cantClaimAPersonalSlug", refused(fakeSlug), fakeSlug.text);
  const upperSlug = await call(a, "create", { name: "Fake", slug: `U-${stamp}` });
  if (upperSlug.status === 200) orgs.push({ id: upperSlug.json.id, cookie: a });
  check("norInCapitals", refused(upperSlug), upperSlug.text);
  const fakeMeta = await call(a, "create", { name: "Fake", slug: `fake-${stamp}`, metadata: { personal: true } });
  if (fakeMeta.status === 200) orgs.push({ id: fakeMeta.json.id, cookie: a });
  check("cantClaimPersonalMetadata", refused(fakeMeta), fakeMeta.text);
  const other = await call(b, "invite-member", { email: A, role: "member", organizationId: personal });
  check("aStrangerCantInviteToSomeonesWorkspace", refused(other), other.text);

  // Someone outside the team.
  const org1 = await newOrg(a, "one");
  check("anOutsiderCantListMembers", refused(await call(b, `list-members?organizationId=${org1}`)));
  check("norInvitations", refused(await call(b, `list-invitations?organizationId=${org1}`)));
  check("norInvite", refused(await call(b, "invite-member", { email: "x@example.com", role: "member", organizationId: org1 })));
  check("norMakeItActive", refused(await call(b, "set-active", { organizationId: org1 })));
  check("norDeleteIt", refused(await call(b, "delete", { organizationId: org1 })));

  // An invitation meant for someone else.
  const forC = await call(a, "invite-member", { email: `someone.${stamp}@example.com`, role: "admin", organizationId: org1 });
  check("anInvitationIsMade", forC.status === 200, forC.text);
  // The email, in Mailpit: mail is sent while the request runs, but give it a moment.
  const address = `someone.${stamp}@example.com`;
  let arrived = null;
  for (let tries = 0; tries < 20 && !arrived; tries++) {
    const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=1`)).json();
    if (found.messages?.length) arrived = await (await fetch(`${MAILPIT}/api/v1/message/${found.messages[0].ID}`)).json();
    else await sleep(250);
  }
  check("theInvitationEmailArrives", arrived !== null);
  check("linkingToTheInvitation", arrived?.Text?.includes(`/invite/${forC.json.id}`) || arrived?.HTML?.includes(`/invite/${forC.json.id}`));
  check("theWrongPersonCantRead", refused(await call(b, `get-invitation?id=${forC.json.id}`)));
  check("norAccept", refused(await call(b, "accept-invitation", { invitationId: forC.json.id })));
  check("norDecline", refused(await call(b, "reject-invitation", { invitationId: forC.json.id })));
  check("norCancelIt", refused(await call(b, "cancel-invitation", { invitationId: forC.json.id })));
  check("signedOutCantRead", (await call(null, `get-invitation?id=${forC.json.id}`)).status === 401);
  const twice = await call(a, "invite-member", { email: `SOMEONE.${stamp}@EXAMPLE.COM`, role: "member", organizationId: org1 });
  check("inviteTwiceInOtherCaseIsRefused", refused(twice), twice.text);

  // A member.
  const asMember = await join(org1);
  check("aMemberCantInvite", refused(await call(b, "invite-member", { email: "y@example.com", role: "member", organizationId: org1 })));
  check("norPromoteThemselves", refused(await call(b, "update-member-role", { memberId: asMember.id, role: "owner", organizationId: org1 })));
  const aMember = (await members(a, org1)).find((m) => m.userId === meA.user.id);
  check("norDemoteTheOwner", refused(await call(b, "update-member-role", { memberId: aMember.id, role: "member", organizationId: org1 })));
  check("norRemoveTheOwner", refused(await call(b, "remove-member", { memberIdOrEmail: aMember.id, organizationId: org1 })));
  check("norListInvitations", refused(await call(b, `list-invitations?organizationId=${org1}`)));
  check("norDelete", refused(await call(b, "delete", { organizationId: org1 })));

  // An admin.
  const promoted = await call(a, "update-member-role", { memberId: asMember.id, role: "admin", organizationId: org1 });
  check("anOwnerCanMakeAnAdmin", promoted.status === 200, promoted.text);
  const invOwner = await call(b, "invite-member", { email: `o.${stamp}@example.com`, role: "owner", organizationId: org1 });
  check("anAdminCantInviteAnOwner", refused(invOwner), invOwner.text);
  const self = await call(b, "update-member-role", { memberId: asMember.id, role: "owner", organizationId: org1 });
  check("anAdminCantMakeThemselvesOwner", refused(self), self.text);
  check("orWithAListOfRoles", refused(await call(b, "update-member-role", { memberId: asMember.id, role: ["admin", "owner"], organizationId: org1 })));
  check("theirRoleStaysAdmin", (await roleOf(a, org1, meB.user.id)) === "admin");
  const demote = await call(b, "update-member-role", { memberId: aMember.id, role: "member", organizationId: org1 });
  check("anAdminCantDemoteAnOwner", refused(demote), demote.text);
  const remove = await call(b, "remove-member", { memberIdOrEmail: aMember.id, organizationId: org1 });
  check("anAdminCantRemoveAnOwner", refused(remove), remove.text);
  const removeByEmail = await call(b, "remove-member", { memberIdOrEmail: A, organizationId: org1 });
  check("norByEmail", refused(removeByEmail), removeByEmail.text);
  const invAdmin = await call(b, "invite-member", { email: `ad.${stamp}@example.com`, role: "admin", organizationId: org1 });
  check("anAdminCanInviteAnAdmin", invAdmin.status === 200, invAdmin.text);
  check("anAdminCantDeleteTheOrganisation", refused(await call(b, "delete", { organizationId: org1 })));

  // The last owner.
  check("theLastOwnerCantLeave", refused(await call(a, "leave", { organizationId: org1 })));
  const selfDemote = await call(a, "update-member-role", { memberId: aMember.id, role: "admin", organizationId: org1 });
  check("norDemoteThemselves", refused(selfDemote), selfDemote.text);
  const selfRemove = await call(a, "remove-member", { memberIdOrEmail: aMember.id, organizationId: org1 });
  check("norRemoveThemselves", refused(selfRemove), selfRemove.text);
  check("theyAreStillOwner", (await roleOf(a, org1, meA.user.id)) === "owner");

  // An owner invitation whose inviter has since been demoted.
  const org2 = await newOrg(a, "two");
  const b2 = await join(org2);
  await call(a, "update-member-role", { memberId: b2.id, role: "owner", organizationId: org2 });
  const c2 = `stale.${stamp}@example.com`;
  const stale = await call(b, "invite-member", { email: c2, role: "owner", organizationId: org2 });
  check("aSecondOwnerCanInviteAnOwner", stale.status === 200, stale.text);
  await call(a, "update-member-role", { memberId: b2.id, role: "member", organizationId: org2 });
  check("demotedToMemberTheyCantInvite", refused(await call(b, "invite-member", { email: `z.${stamp}@example.com`, role: "member", organizationId: org2 })));

  // Two owners racing to demote each other, and to leave: one must remain, every time.
  for (let round = 0; round < 6; round++) {
    const org = await newOrg(a, `race${round}`);
    const other = await join(org);
    await call(a, "update-member-role", { memberId: other.id, role: "owner", organizationId: org });
    const mineRow = (await members(a, org)).find((m) => m.userId === meA.user.id);
    const moves = round % 2 === 0
      ? [call(a, "update-member-role", { memberId: other.id, role: "member", organizationId: org }), call(b, "update-member-role", { memberId: mineRow.id, role: "member", organizationId: org })]
      : [call(a, "leave", { organizationId: org }), call(b, "leave", { organizationId: org })];
    await Promise.all(moves);
    // Whoever's left reads it.
    const seen = (await members(a, org)).length ? await members(a, org) : await members(b, org);
    const owners = seen.filter((m) => m.role.split(",").includes("owner")).length;
    check(`raceRound${round}LeavesAnOwner`, owners === 1, JSON.stringify(seen.map((m) => m.role)));
    if (seen.some((m) => m.userId === meB.user.id && m.role === "owner") && !seen.some((m) => m.userId === meA.user.id)) orgs[orgs.length - 1].cookie = b;
  }

  // The owner role by list, and joined roles.
  const org3 = await newOrg(a, "three");
  const b3 = await join(org3, "admin");
  await call(a, "update-member-role", { memberId: b3.id, role: ["admin", "owner"], organizationId: org3 });
  const mine3 = (await members(a, org3)).find((m) => m.userId === meA.user.id);
  const left = await call(a, "update-member-role", { memberId: mine3.id, role: "member", organizationId: org3 });
  check("anOwnerWithTwoRolesCountsAsAnOwner", left.status === 200, left.text);
  await call(a, "update-member-role", { memberId: mine3.id, role: "owner", organizationId: org3 }).catch(() => {});
  // A session still naming a team they're no longer in.
  const org4 = await newOrg(a, "four");
  const b4 = await join(org4);
  // As a browser would: the session is cached in a cookie for a minute, and this is the cookie it would hold.
  const activate = async (cookie, organizationId) => {
    const res = await fetch(`${BASE}/api/auth/organization/set-active`, { method: "POST", headers: { origin: ORIGIN, cookie, "content-type": "application/json" }, body: JSON.stringify({ organizationId }) });
    const jar = new Map(cookie.split("; ").map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]));
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(";")[0];
      jar.set(pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
    }
    return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  };
  const bActive = await activate(b, org4);
  check("theTeamIsActive", (await me(bActive)).session.activeOrganizationId === org4);
  await call(a, "remove-member", { memberIdOrEmail: b4.id, organizationId: org4 });
  const rest = async (cookie, path, body) => fetch(`${BASE}/api${path}`, { method: body ? "POST" : "GET", headers: { origin: ORIGIN, cookie, ...(body && { "content-type": "application/json" }) }, ...(body && { body: JSON.stringify(body) }) });
  const movesToPersonal = async (cookie, personalId, who) => {
    check(`${who}SeesTheirPersonalWorkspace`, (await me(cookie)).session.activeOrganizationId === personalId);
    const room = await rest(cookie, "/rooms", { name: `Stale ${stamp}` });
    check(`${who}CanStillMakeARoom`, room.status === 201, room.status);
    if (room.status === 201) {
      const made = await room.json();
      const listed = await (await rest(cookie, `/rooms/${made.id}`)).json().catch(() => ({}));
      check(`${who}sRoomIsInTheirPersonalWorkspace`, listed.orgId === undefined || listed.orgId === personalId, listed.orgId);
      await fetch(`${BASE}/api/rooms/${made.id}`, { method: "DELETE", headers: { origin: ORIGIN, cookie } });
    }
    check(`${who}CanOpenInterviews`, (await rest(cookie, "/interview-questions")).status === 200);
  };
  await movesToPersonal(bActive, meB.personalOrgId, "someoneRemoved");
  const aActive = await activate(a, org4);
  check("theOwnersTeamIsActive", (await me(aActive)).session.activeOrganizationId === org4);
  check("theTeamIsDeleted", (await call(a, "delete", { organizationId: org4 })).status === 200);
  orgs.pop();
  await movesToPersonal(aActive, meA.personalOrgId, "ownerOfADeletedTeam");
} catch (error) {
  check("noUnexpectedError", false, error.stack ?? error);
} finally {
  for (const { id, cookie } of orgs) {
    let r = await call(cookie, "delete", { organizationId: id });
    if (r.status !== 200) r = await call(cookie === a ? b : a, "delete", { organizationId: id });
    check(`cleansUp ${id}`, r.status === 200, r.text.slice(0, 120));
  }
  await call(a, "set-active", { organizationId: meA.personalOrgId });
  await call(b, "set-active", { organizationId: meB.personalOrgId });
  child.kill();
}
finish();
