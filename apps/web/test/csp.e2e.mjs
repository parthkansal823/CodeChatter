// The security policy (lib/csp.ts, proxy.ts): pages carry a nonce that changes per response, injected HTML can't run,
// the app itself still works, and the preview frame keeps a user's scripts away from the app. browser.mjs also makes
// every browser suite fail on anything the policy refuses; this one proves it refuses what it should.
//   node test/csp.e2e.mjs        (from apps/web, with the dev stack running)
import { BASE, check, finish, forgetRefused, launch, ROOM } from "./browser.mjs";

const { browser, errors, signIn } = await launch();

/** Stored XSS as the browser would meet it: markup in the server's own HTML, under the page's real policy. */
const INJECTED = '<script>window.__xssParsed = true</script><script src="https://example.com/evil.js"></script><img src="data:," onerror="window.__xssParsedHandler = true" onload="window.__xssParsedHandler = true">';
async function serveInjected(page, path) {
  await page.route(`${BASE}${path}`, async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    // route.fetch decodes the body, so it no longer matches what these say.
    delete headers["content-encoding"];
    delete headers["content-length"];
    await route.fulfill({ response, headers, body: (await response.text()).replace("</head>", `${INJECTED}</head>`) });
  });
}

/** What a script can't do once markup gets into the page after it has loaded. */
const attacks = (page) =>
  page.evaluate(async () => {
    const seen = [];
    const heard = (event) => seen.push(event.violatedDirective);
    document.addEventListener("securitypolicyviolation", heard);
    // An inline handler, as HTML injected through innerHTML would carry.
    const holder = document.createElement("div");
    holder.innerHTML = '<img src="data:," onerror="window.__xssHandler = true" onload="window.__xssHandler = true">';
    document.body.append(holder);
    // A javascript: link.
    const link = document.createElement("a");
    link.href = "javascript:window.__xssLink = true";
    document.body.append(link);
    link.click();
    // Pages that would load code from elsewhere inside an object.
    const object = document.createElement("object");
    object.data = "https://example.com/x.swf";
    document.body.append(object);
    await new Promise((resolve) => setTimeout(resolve, 800));
    document.removeEventListener("securitypolicyviolation", heard);
    holder.remove();
    link.remove();
    object.remove();
    return { handler: window.__xssHandler === true, link: window.__xssLink === true, directives: seen };
  });

try {
  // The landing page, signed out.
  const context = await browser.newContext();
  const visitor = await context.newPage();
  const first = await visitor.goto(`${BASE}/`);
  const policy = first.headers()["content-security-policy"] ?? "";
  check("the landing page has a policy", policy.includes("script-src") && policy.includes("object-src 'none'"), policy);
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  check("with a nonce", Boolean(nonce));
  const second = await visitor.goto(`${BASE}/`);
  check("that changes on every response", !second.headers()["content-security-policy"]?.includes(`'nonce-${nonce}'`));
  await visitor.getByRole("link", { name: /sign in/i }).first().waitFor({ timeout: 30_000 });
  check("the theme's script ran before paint", await visitor.evaluate(() => /\b(light|dark)\b/.test(document.documentElement.className)));
  await visitor.waitForFunction(() => document.querySelectorAll("script[src]").length > 0);
  check("Next.js's scripts carry it, and the browser hides it from the page", await visitor.evaluate(() => [...document.scripts].every((script) => script.getAttribute("nonce") === null || script.getAttribute("nonce") === "")));

  const marketing = await attacks(visitor);
  check("an injected handler doesn't run", !marketing.handler);
  check("a javascript: link doesn't run", !marketing.link);
  check("the browser reports the attempts", marketing.directives.some((directive) => directive.startsWith("script-src")), marketing.directives.join(", "));
  check("the landing page is framed by nobody else", policy.includes("frame-ancestors 'self'"));

  // Markup in the server's HTML.
  const stored = await context.newPage();
  await serveInjected(stored, "/");
  await stored.goto(`${BASE}/`);
  await stored.getByRole("link", { name: /sign in/i }).first().waitFor({ timeout: 30_000 });
  const parsed = await stored.evaluate(() => ({ script: window.__xssParsed === true, handler: window.__xssParsedHandler === true, loaded: [...document.scripts].some((script) => script.src.includes("example.com") && script.dataset.ran) }));
  check("a script in the page's HTML doesn't run", !parsed.script);
  check("nor a handler in its HTML", !parsed.handler);
  check("and the page still works around them", await stored.evaluate(() => /\b(light|dark)\b/.test(document.documentElement.className)));
  await context.close();

  // A candidate's public link and sign-in have one too.
  const open = await browser.newContext();
  const stranger = await open.newPage();
  const invite = await stranger.goto(`${BASE}/interview/${"x".repeat(32)}`);
  check("a public link has a policy", (invite.headers()["content-security-policy"] ?? "").includes("'nonce-"));
  const signInPage = await stranger.goto(`${BASE}/sign-in`);
  check("the sign-in page has a policy", (signInPage.headers()["content-security-policy"] ?? "").includes("'nonce-"));
  // The signed-out gate still works now the proxy runs everywhere.
  const gated = await stranger.goto(`${BASE}/dashboard`);
  check("a signed-out visitor still goes to sign-in", new URL(gated.url()).pathname === "/sign-in", gated.url());
  await open.close();

  // The app itself.
  const { page } = await signIn("test1@codechatter.local");
  await page.goto(`${BASE}/rooms/${ROOM}`);
  await page.getByRole("tree", { name: "Files" }).waitFor({ timeout: 60_000 });
  await page.locator(".monaco-editor").first().waitFor({ timeout: 60_000 });
  check("the editor loads under the policy", true);
  const room = await attacks(page);
  check("injected HTML can't run in a room either", !room.handler && !room.link);
  // Everything so far set the policy off on purpose. From here on, nothing should.
  forgetRefused();

  // The preview's frame.
  const frameContext = await browser.newContext();
  const direct = await frameContext.newPage();
  const framePage = await direct.goto(`${BASE}/frames/document`);
  const framePolicy = framePage.headers()["content-security-policy"] ?? "";
  check("the preview frame has its own sandboxed policy", framePolicy.includes("sandbox allow-scripts") && !framePolicy.includes("allow-same-origin"), framePolicy);
  check("opened directly, it has no origin of its own", (await direct.evaluate(() => self.origin)) === "null");
  await frameContext.close();

  // Run a page in the frame: its inline script and handler work, and it can't reach the app.
  const framed = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const page = `<!doctype html><button id="b" onclick="window.clicked = true">x</button><script>
          document.getElementById("b").click();
          let app = "reachable";
          try { app = String(parent.document.title); } catch (error) { app = "blocked"; }
          let storage = "reachable";
          try { localStorage.getItem("x"); } catch (error) { storage = "blocked"; }
          parent.postMessage({ test: true, inline: true, clicked: window.clicked === true, app, storage, origin: self.origin, evaluated: eval("1 + 1") }, "*");
        </script>`;
        const frame = document.createElement("iframe");
        frame.sandbox = "allow-scripts allow-forms allow-modals allow-popups";
        frame.src = "/frames/document";
        const heard = (event) => {
          if (event.source !== frame.contentWindow) return;
          if (event.data?.__ccFrameReady) frame.contentWindow.postMessage({ __ccDocument: true, html: page }, "*");
          else if (event.data?.test) {
            window.removeEventListener("message", heard);
            frame.remove();
            resolve(event.data);
          }
        };
        window.addEventListener("message", heard);
        document.body.append(frame);
        setTimeout(() => resolve({ timedOut: true }), 15_000);
      }),
  );
  check("a preview's inline script runs", framed.inline === true, JSON.stringify(framed));
  check("and its inline handler", framed.clicked === true);
  check("and eval, which a page may use", framed.evaluated === 2);
  check("but it can't read the app", framed.app === "blocked", framed.app);
  check("or the site's storage", framed.storage === "blocked", framed.storage);
  check("and has an opaque origin", framed.origin === "null", framed.origin);

  const stray = await page.evaluate(
    () =>
      new Promise((resolve) => {
        // Someone else's window can't hand the frame a document: only its parent can.
        const frame = document.createElement("iframe");
        frame.sandbox = "allow-scripts";
        frame.src = "/frames/document";
        const heard = (event) => {
          if (event.source === frame.contentWindow && event.data?.__ccFrameReady) {
            window.removeEventListener("message", heard);
            resolve(event.origin);
            frame.remove();
          }
        };
        window.addEventListener("message", heard);
        document.body.append(frame);
        setTimeout(() => resolve("timed out"), 15_000);
      }),
  );
  check("the frame's messages come from an opaque origin", stray === "null", stray);
} catch (error) {
  check("the flow completes", false, error instanceof Error ? error.message : String(error));
}

check("no page errors", errors.length === 0, errors.join("; "));
await browser.close();
finish();
