// Signing out another device: what it had open stops at once, it can't get back, and the device you're on carries on.
// Two sessions of one person, with the room open on both, and one ended from the other. It never changes a password or
// turns anything on, so it's safe on the shared test account.
//   node test/sign-out-device.e2e.mjs        (from apps/web, with the dev stack running)
import { BASE, ROOM, check, finish, launch, sleep } from "./browser.mjs";

const { browser, signIn } = await launch();
const EMAIL = "test2@codechatter.local";
const here = await signIn(EMAIL);
const lost = await signIn(EMAIL);
const trace = (page) => {
  const sockets = [];
  page.on("websocket", (socket) => sockets.push(socket));
  return { sockets, open: () => sockets.filter((socket) => !socket.isClosed()).map((socket) => new URL(socket.url()).pathname).filter((path) => !path.includes("_next")) };
};
const lostSockets = trace(lost.page);
const hereSockets = trace(here.page);
const open = (page) => page.goto(`${BASE}/rooms/${ROOM}`);
const inTheRoom = (page) => page.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });

try {
  await Promise.all([open(here.page), open(lost.page)]);
  await Promise.all([inTheRoom(here.page), inTheRoom(lost.page)]);
  await sleep(3000);
  const before = lostSockets.open();
  check("theRoomIsOpenOnBoth", before.some((path) => path.includes("collab")) && before.some((path) => path.includes("socket.io")) && hereSockets.open().some((path) => path.includes("collab")), before.join(" "));
  const hereBefore = hereSockets.open().length;

  const token = await lost.page.evaluate(async () => (await (await fetch("/api/auth/get-session")).json()).session.token);
  const revoked = await here.page.request.post(`${BASE}/api/auth/revoke-session`, { data: { token }, headers: { origin: BASE } });
  check("itsSignedOutFromTheOtherDevice", revoked.status() === 200, revoked.status());

  await sleep(1500);
  check("itsApiAccessEndsAtOnce", (await lost.page.evaluate(async () => (await fetch("/api/me")).status)) === 401);
  check("itsChatIsClosed", !lostSockets.open().some((path) => path.includes("socket.io")), lostSockets.open().join(" "));
  check("andItsDebugger", !lostSockets.open().some((path) => path.includes("debug")), lostSockets.open().join(" "));
  check("thePageSaysSo", await lost.page.getByRole("heading", { name: "You no longer have access to this room" }).waitFor({ timeout: 15_000 }).then(() => true, () => false));
  await sleep(1000);
  check("itsDocumentIsClosed", !lostSockets.open().some((path) => path.includes("collab")), lostSockets.open().join(" "));

  await sleep(8000);
  check("andItDoesntGetBackIn", lostSockets.open().length === 0, lostSockets.open().join(" "));

  // The device they're on.
  check("theOtherDeviceStaysConnected", hereSockets.open().length === hereBefore, `${hereSockets.open().join(" ")} (was ${hereBefore})`);
  check("andStaysSignedIn", (await here.page.evaluate(async () => (await fetch("/api/me")).status)) === 200);
  check("andStaysInTheRoom", await here.page.getByRole("tree", { name: "Files" }).isVisible());
} catch (error) {
  check("noUnexpectedError", false, String(error).slice(0, 300));
} finally {
  await browser.close();
}
finish();
