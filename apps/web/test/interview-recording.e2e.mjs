// Recording an assessment in a real browser, with the browser's fake camera and a fake whole screen. Consent before anything
// can start; the camera and screen checked before the clock runs; real clips recorded and played back; stopping the share
// holding the test back and going on the record; a window instead of the whole screen refused.
//   node test/interview-recording.e2e.mjs        (from apps/web, with the dev stack running)
import { BASE, check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const stamp = Date.now().toString(36);
const TAG = `v${stamp}`;
const SHOTS = process.env.SHOT_DIR ?? process.env.TEMP ?? "/tmp";
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/rec-${name}.png` }).catch(() => {});
const media = (surface) => ["--use-fake-ui-for-media-stream", `--use-fake-device-for-media-stream=display-media-type=${surface}`];

const { browser, errors, signIn } = await launch({ args: media("monitor") });
const one = await signIn("test1@codechatter.local");
const two = await signIn("test2@codechatter.local");
const a = one.page;
const b = two.page;
await two.context.grantPermissions(["camera"]);
// So the test can do what a person does by pressing the browser's "Stop sharing".
await two.context.addInitScript(() => {
  const real = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getDisplayMedia = async (...args) => {
    const stream = await real(...args);
    window.__screen = stream;
    return stream;
  };
});
const post = (page, path, data) => page.request.post(`${BASE}${path}`, { data, headers: { origin: BASE } });
const cleanup = { questions: [], batches: [] };
const starts = (page) => page.getByRole("button", { name: /Start the assessment/ });

try {
  for (let n = 1; n <= 2; n++) cleanup.questions.push((await (await post(a, "/api/interview-questions", { kind: "mcq", title: `Pick ${n} ${TAG}`, tags: [TAG], marks: 1, choices: [{ id: "y", text: `Right ${n}`, correct: true }, { id: "n", text: `Wrong ${n}`, correct: false }] })).json()).id);

  // The person scheduling is told what they're taking on.
  await a.goto(`${BASE}/interviews/new?mode=assessment`);
  await a.getByRole("heading", { name: "New assessment" }).waitFor({ timeout: 30_000 });
  await a.getByLabel("Name of the assessment").fill(`Recorded ${TAG}`);
  await a.getByLabel("Candidates, one a line").fill("Bo Rec\nCy Rec");
  await a.getByLabel("Tag", { exact: true }).fill(TAG);
  await a.getByLabel("How many").fill("2");
  await a.getByRole("checkbox", { name: "Record their webcam" }).click();
  await a.getByRole("checkbox", { name: "Record their whole screen" }).click();
  await a.getByRole("checkbox", { name: /Let the AI look at stills/ }).click();
  check("theSchedulerIsToldWhereStillsGo", await ok(a.getByRole("note").filter({ hasText: "whichever AI this server uses" }).waitFor({ timeout: 5000 })));
  check("theSchedulerIsToldTheRules", await ok(a.getByRole("note").filter({ hasText: "legal rules that differ by country" }).waitFor({ timeout: 5000 })));
  await shot(a, "form");
  await a.getByRole("button", { name: /^Schedule/ }).click();
  await a.getByRole("heading", { name: /2 links ready/ }).waitFor({ timeout: 30_000 });
  const links = await a.getByRole("list", { name: "Candidates' links" }).locator("code").allInnerTexts();
  await a.getByRole("link", { name: "See the results page" }).click();
  await a.waitForURL(/\/interviews\/batches\//, { timeout: 15_000 });
  const batchId = a.url().split("/").at(-1);
  cleanup.batches.push(batchId);
  check("theResultsSayItRecords", await ok(a.getByText(/Records camera and screen/).waitFor({ timeout: 15_000 })));

  // Consent, before anything.
  await b.goto(links[0]);
  await b.getByRole("button", { name: /Continue as/ }).click({ timeout: 30_000 });
  await starts(b).waitFor({ timeout: 15_000 });
  const consentText = await b.locator("main").innerText();
  check("theyAreToldWhatItRecords", /records your camera and your whole screen/i.test(consentText), consentText.slice(0, 160));
  check("whoCanWatch", /Only the people assessing you/i.test(consentText));
  check("andWhenItsDeleted", /deleted automatically after \d+ days/i.test(consentText));
  check("andThatThereIsAnotherWay", /another way to be assessed/i.test(consentText));
  check("andThatAnAiMayLook", /An AI may look at stills/i.test(consentText) && /doesn.t identify you or judge your face/i.test(consentText));
  check("nothingStartsWithoutAgreeing", await starts(b).isDisabled());
  check("nothingAsksForTheCameraYet", (await b.getByRole("button", { name: "Turn on my camera" }).count()) === 0);
  await shot(b, "consent");
  await b.getByRole("checkbox", { name: "I agree to being recorded" }).click();
  check("agreeingAloneIsntEnough", await starts(b).isDisabled());

  // Checked before the clock starts.
  await b.getByRole("button", { name: "Turn on my camera" }).click();
  check("theCameraComesOn", await ok(b.getByRole("status").filter({ hasText: "Camera is on" }).waitFor({ timeout: 15_000 })));
  await b.getByRole("button", { name: "Share my whole screen" }).click();
  check("theScreenComesOn", await ok(b.getByRole("status").filter({ hasText: "Screen is on" }).waitFor({ timeout: 15_000 })));
  await shot(b, "ready");
  check("theyCanSeeWhatsBeingRecorded", await b.getByLabel("Your camera").evaluate((video) => new Promise((resolve) => (video.videoWidth ? resolve(true) : video.addEventListener("loadeddata", () => resolve(video.videoWidth > 0), { once: true }), setTimeout(() => resolve(false), 8000)))));
  await starts(b).click();
  await b.waitForURL(/\/rooms\//, { timeout: 30_000 });
  const roomId = b.url().split("/").at(-1);

  // In the room: already recording, with nothing to ask again.
  check("itCarriesOnIntoTheRoom", await ok(b.getByRole("status").filter({ hasText: "Recording" }).first().waitFor({ timeout: 40_000 })));
  check("nothingHoldsTheTestBack", (await b.getByRole("dialog", { name: "Recording" }).count()) === 0);
  await shot(b, "in-room");

  // Stopping the share holds the test back, and goes on the record.
  await b.waitForTimeout(3000);
  await b.evaluate(() => window.__screen.getVideoTracks()[0].dispatchEvent(new Event("ended")));
  check("stoppingTheShareHoldsTheTestBack", await ok(b.getByRole("dialog", { name: "Recording" }).waitFor({ timeout: 10_000 })));
  await shot(b, "gate");
  await b.getByRole("button", { name: "Share my whole screen" }).click();
  check("sharingAgainLetsThemBackIn", await ok(b.getByRole("dialog", { name: "Recording" }).waitFor({ state: "detached", timeout: 15_000 })));

  // Answering and handing in sends what's left.
  await b.getByRole("region", { name: /^Question 1/ }).getByRole("radio", { name: /Right/ }).click({ timeout: 20_000 });
  await b.waitForTimeout(16_000); // a heartbeat carries the record
  await b.getByRole("button", { name: "Hand in" }).click();
  await b.getByRole("alertdialog").getByRole("button", { name: "Hand in" }).click();
  check("handingInEndsIt", await ok(b.getByText(/has finished/).first().waitFor({ timeout: 30_000 })));
  check("theCameraIsLetGoOf", await ok(b.getByRole("status").filter({ hasText: "Recording" }).waitFor({ state: "detached", timeout: 15_000 })));

  // Watching.
  await a.reload();
  await a.getByRole("row", { name: /Bo Rec/ }).getByRole("link", { name: "Bo Rec", exact: true }).click({ timeout: 30_000 });
  await a.waitForURL(/\/interviews\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const interviewId = a.url().split("/").at(-1);
  await a.getByRole("tab", { name: "The record" }).click({ timeout: 30_000 });
  check("stoppingIsOnTheRecord", await ok(a.getByText(/Stopped sharing their screen: 1/).waitFor({ timeout: 10_000 })));
  await a.getByRole("tab", { name: "Recordings" }).click();
  const screenPlayer = a.getByRole("region", { name: "Screen recording" });
  check("thereIsACameraRecording", await ok(a.getByRole("region", { name: "Camera recording" }).locator("video").waitFor({ timeout: 15_000 })));
  check("andAScreenRecording", await ok(screenPlayer.locator("video").waitFor({ timeout: 15_000 })));
  const played = (region) => a.getByRole("region", { name: region }).locator("video").evaluate((video) => new Promise((resolve) => {
    const done = () => resolve({ width: video.videoWidth, error: video.error?.message ?? null });
    if (video.readyState >= 2) done();
    else {
      video.addEventListener("loadeddata", done, { once: true });
      video.addEventListener("error", done, { once: true });
      setTimeout(done, 15_000);
    }
  }));
  const camera = await played("Camera recording");
  check("theCameraClipReallyPlays", camera.width > 0 && !camera.error, JSON.stringify(camera));
  const screen = await played("Screen recording");
  check("theScreenClipReallyPlays", screen.width > 0 && !screen.error, JSON.stringify(screen));
  check("itSaysTheyAgreed", await ok(a.getByText(/Bo Rec agreed to this at/).waitFor({ timeout: 5000 })));
  check("withANoteOfWhatsLogged", await ok(a.getByText(/each time goes in the audit log/).waitFor({ timeout: 5000 })));
  const watch = a.getByRole("button", { name: /^Watch Stopped sharing their screen/ });
  await watch.click({ timeout: 10_000 });
  check("theRecordJumpsToTheMoment", await ok(screenPlayer.locator("video").waitFor({ timeout: 10_000 })));
  await shot(a, "recordings");

  const clips = await (await a.request.get(`${BASE}/api/interviews/${interviewId}/recordings`)).json();
  const streams = new Set(clips.clips.map((clip) => clip.stream));
  check("bothStreamsSentRealVideo", streams.has("webcam") && streams.has("screen") && clips.clips.every((clip) => clip.bytes > 500), JSON.stringify(clips.clips.map((clip) => [clip.stream, clip.bytes])));
  check("theRoomSawNoRecordingMissing", (await (await a.request.get(`${BASE}/api/interviews/${interviewId}`)).json()).integrity.counts["recording-missing"] === undefined);

  // Asking the AI. The model is stood in for here (apps/api/test/interview-ai-review.e2e.mjs tests a whole round trip):
  // this is about the page, and the stills it makes from real clips.
  let asked = null;
  const reviewed = await (await a.request.get(`${BASE}/api/interviews/${interviewId}`)).json();
  const review = { at: new Date().toISOString(), model: "stand-in", summary: "ONE-THING-TO-CHECK", findings: [{ source: "activity", level: "look", title: "Code arrived all at once", detail: "4000 bytes in one edit.", at: null }, { source: "camera", level: "look", title: "A second person in view", detail: "", at: reviewed.startedAt }], questions: [{ question: "Why did you choose this approach?", about: "notes.md" }], looked: { camera: true, screen: true }, note: null };
  await a.route(`**/api/interviews/${interviewId}/ai-review`, async (route) => {
    asked = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...reviewed, aiReview: review }) });
  });
  await a.getByRole("tab", { name: "AI review" }).click();
  check("itSaysItCantTellIfAiWroteIt", await ok(a.getByText(/can.t tell whether code was written by an AI/).waitFor({ timeout: 5000 })));
  await a.getByRole("button", { name: "Ask the AI" }).click();
  check("itShowsWhatToCheck", await ok(a.getByRole("list", { name: "What to check" }).getByText("Code arrived all at once").waitFor({ timeout: 40_000 })));
  check("whatItSawInTheRecording", await ok(a.getByText("A second person in view").waitFor({ timeout: 5000 })));
  check("andWhatToAskThem", await ok(a.getByRole("list", { name: "Questions to ask them" }).getByText("Why did you choose this approach?").waitFor({ timeout: 5000 })));
  check("andThatItChangesNothing", await ok(a.getByText(/doesn.t change their marks or the record/).waitFor({ timeout: 5000 })));
  check("itMadeACameraSheetFromRealClips", asked?.webcam?.data?.startsWith("/9j/") && asked.webcam.times.length >= 1, JSON.stringify(asked?.webcam?.times ?? null));
  check("andAScreenSheet", asked?.screen?.data?.startsWith("/9j/") && asked.screen.times.length >= 1);
  check("andSentTheirFiles", Array.isArray(asked?.files) && asked.files.some((file) => file.path === "notes.md"));
  check("withoutTheirNameOrEmail", !JSON.stringify({ files: asked?.files, times: asked?.webcam?.times }).includes("Bo Rec"));
  await shot(a, "ai-review");
  await a.unroute(`**/api/interviews/${interviewId}/ai-review`);
  await a.getByRole("tab", { name: "Recordings" }).click();

  // Deleting.
  await a.getByRole("button", { name: "Delete the recordings" }).click({ timeout: 15_000 });
  await a.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  check("theyCanBeDeleted", await ok(a.getByRole("button", { name: "Delete the recordings" }).waitFor({ state: "detached", timeout: 15_000 })));

  // A window isn't the whole screen.
  const windowed = await launch({ args: media("window") });
  const three = await windowed.signIn("test2@codechatter.local");
  await three.context.grantPermissions(["camera"]);
  // A person chooses in the browser's picker, whatever the page prefers. Here, the fake device would follow the page's preference.
  await three.context.addInitScript(() => {
    const real = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = () => real({ video: true, audio: false });
  });
  await three.page.goto(links[1]);
  await three.page.getByRole("button", { name: /Continue as/ }).click({ timeout: 30_000 });
  await three.page.getByRole("checkbox", { name: "I agree to being recorded" }).click({ timeout: 15_000 });
  await three.page.getByRole("button", { name: "Share my whole screen" }).click();
  check("aWindowIsRefused", await ok(three.page.getByRole("alert").filter({ hasText: "whole screen, not a window" }).waitFor({ timeout: 15_000 })));
  check("andTheAssessmentCantStart", await starts(three.page).isDisabled());
  await shot(three.page, "window-refused");
  await windowed.browser.close();
  void roomId;
} catch (error) {
  check("noUnexpectedError", false, String(error?.message ?? error).replace(/\u001b\[[0-9;]*m/g, "").slice(0, 220));
  await shot(a, "failed-a");
  await shot(b, "failed-b");
} finally {
  const remove = (path) => a.request.delete(`${BASE}${path}`, { headers: { origin: BASE } }).catch(() => {});
  for (const id of cleanup.batches) await remove(`/api/interview-batches/${id}`);
  for (const id of cleanup.questions) await remove(`/api/interview-questions/${id}`);
}

await browser.close();
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
