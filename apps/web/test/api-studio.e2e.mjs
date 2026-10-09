// API Studio, two people: a request to http://localhost:<port> reaches a server running in the
// room's sandbox; the other person sees the request live; a cURL import sends a POST with its body;
// private addresses (cloud metadata) are blocked.
//   node test/api-studio.e2e.mjs        (from apps/web, with the dev stack running)
import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const port = 4000 + Math.floor(Math.random() * 900);
const serverFile = `srv_${stamp}.js`;
const ok = (promise) => promise.then(() => true, () => false);

const { browser, errors, signIn } = await launch();
const a = (await signIn("test1@codechatter.local")).page;
const b = (await signIn("test2@codechatter.local")).page;

// A small JSON echo server, started with Run in the room's sandbox.
await a.getByRole("button", { name: "New file" }).click();
await a.getByPlaceholder("name.ext").fill(serverFile);
await a.getByPlaceholder("name.ext").press("Enter");
await a.getByRole("tab", { name: new RegExp(serverFile.replace(".", "\\.")) }).waitFor({ timeout: 15_000 });
await a.locator(".monaco-editor .view-lines").first().click();
await a.keyboard.type(
  `require("http").createServer((q,s)=>{let b="";q.on("data",c=>b+=c);q.on("end",()=>{s.setHeader("content-type","application/json");s.end(JSON.stringify({ok:true,method:q.method,url:q.url,body:b}))})}).listen(${port},()=>console.log("listening ${port}"))`,
);
await a.keyboard.press("Control+Enter");
check("serverStarts", await ok(a.locator(".xterm-rows").getByText(`listening ${port}`).first().waitFor({ timeout: 60_000 })));

// test1 makes a request to the sandbox server.
for (const page of [a, b]) await page.getByRole("button", { name: "API", exact: true }).click();
await a.getByRole("button", { name: "New request" }).first().click();
await a.getByRole("textbox", { name: "Request name" }).fill(`Ping ${stamp}`);
const url = a.getByRole("textbox", { name: "Request URL" });
await url.fill(`http://localhost:${port}/hello?x=${stamp}`);
await a.getByRole("button", { name: "Send", exact: true }).click();
const response = a.getByRole("region", { name: "Response", exact: true });
check("sandboxRequestAnswers", await ok(response.getByText("200 OK").waitFor({ timeout: 30_000 })));
check("responseBodyShown", await ok(response.getByText(`/hello?x=${stamp}`).first().waitFor({ timeout: 5_000 })));

// test2 sees the request appear in the shared collection.
check("requestSharedLive", await ok(b.getByText(`Ping ${stamp}`).first().waitFor({ timeout: 15_000 })));

// A POST imported from cURL keeps its method, header and body.
await a.getByRole("button", { name: "Import" }).first().click();
await a.getByRole("textbox", { name: "cURL command" }).fill(`curl -X POST http://localhost:${port}/echo -H 'content-type: application/json' -d '{"a":1}'`);
await a.getByRole("dialog").getByRole("button", { name: "Add to collection" }).click();
await a.getByRole("button", { name: "Send", exact: true }).click();
check("curlImportPosts", await ok(response.getByText('"method": "POST"').first().waitFor({ timeout: 30_000 })), ((await response.textContent()) ?? "").slice(0, 160));

// Private addresses never leave the server.
await url.fill("http://169.254.169.254/latest/meta-data/");
await a.getByRole("button", { name: "Send", exact: true }).click();
check("metadataBlocked", await ok(response.getByText("Blocked for safety").waitFor({ timeout: 15_000 })));

await a.screenshot({ path: process.env.SHOT ?? `${process.env.TEMP ?? "/tmp"}/api-studio.png` });
// Stop the server so the sandbox is quiet for the next test.
await a.getByRole("button", { name: /^Stop/ }).first().click().catch(() => {});
await browser.close();
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
