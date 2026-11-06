import assert from "node:assert/strict";
import { test } from "node:test";

import { appCsp, newNonce, PREVIEW_FRAME_CSP } from "./csp";
import { pageGate } from "./page-gate";

const directive = (policy: string, name: string) => policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

test("scripts need this response's nonce, with no way around it in production", () => {
  const script = directive(appCsp({ nonce: "abc", dev: false }), "script-src");
  assert.match(script, /'nonce-abc'/);
  assert.match(script, /'strict-dynamic'/);
  assert.doesNotMatch(script, /'unsafe-inline'/);
  assert.doesNotMatch(script, /'unsafe-eval'/);
  assert.doesNotMatch(script, /https?:|\*/);
});

test("only the dev server gets eval", () => {
  assert.match(directive(appCsp({ nonce: "abc", dev: true }), "script-src"), /'unsafe-eval'/);
});

test("closes plugins, base tags, foreign forms and framing", () => {
  const policy = appCsp({ nonce: "abc", dev: false });
  assert.equal(directive(policy, "object-src"), "object-src 'none'");
  assert.equal(directive(policy, "base-uri"), "base-uri 'none'");
  assert.equal(directive(policy, "form-action"), "form-action 'self'");
  assert.equal(directive(policy, "frame-ancestors"), "frame-ancestors 'self'");
  assert.equal(directive(policy, "default-src"), "default-src 'self'");
});

test("frames this site, and draw.io by its origin", () => {
  assert.equal(directive(appCsp({ nonce: "a", dev: false }), "frame-src"), "frame-src 'self'");
  assert.equal(directive(appCsp({ nonce: "a", dev: false, drawioOrigin: "https://embed.diagrams.net/some/path?x=1" }), "frame-src"), "frame-src 'self' https://embed.diagrams.net");
  assert.equal(directive(appCsp({ nonce: "a", dev: false, drawioOrigin: "not a url" }), "frame-src"), "frame-src 'self'");
});

test("connects to this site, and to LiveKit when it lives elsewhere", () => {
  assert.equal(directive(appCsp({ nonce: "a", dev: false }), "connect-src"), "connect-src 'self' blob: data:");
  const cloud = directive(appCsp({ nonce: "a", dev: false, livekitUrl: "wss://team.livekit.cloud" }), "connect-src");
  assert.match(cloud, /wss:\/\/team\.livekit\.cloud/);
  assert.match(cloud, /https:\/\/team\.livekit\.cloud/);
  const plain = directive(appCsp({ nonce: "a", dev: false, livekitUrl: "ws://calls.lan:7880" }), "connect-src");
  assert.match(plain, /ws:\/\/calls\.lan:7880/);
  assert.match(plain, /http:\/\/calls\.lan:7880/);
  assert.equal(directive(appCsp({ nonce: "a", dev: false, livekitUrl: "nonsense" }), "connect-src"), "connect-src 'self' blob: data:");
});

test("a preview frame can run its own scripts, but only ever in a sandbox", () => {
  assert.match(PREVIEW_FRAME_CSP, /'unsafe-inline'/);
  assert.match(PREVIEW_FRAME_CSP, /sandbox allow-scripts/);
  assert.doesNotMatch(PREVIEW_FRAME_CSP, /allow-same-origin/);
  assert.doesNotMatch(PREVIEW_FRAME_CSP, /allow-top-navigation/);
  assert.match(PREVIEW_FRAME_CSP, /frame-ancestors 'self'/);
});

test("nonces are long and different every time", () => {
  const nonces = new Set(Array.from({ length: 50 }, newNonce));
  assert.equal(nonces.size, 50);
  for (const nonce of nonces) assert.ok(atob(nonce).length === 16);
});

test("guards the same pages as before, and not the ones that must stay open", () => {
  for (const path of ["/dashboard", "/rooms/ABC234", "/interviews", "/interviews/questions/new", "/settings/audit", "/new", "/orgs/new"]) assert.equal(pageGate(path), "app", path);
  for (const path of ["/sign-in", "/sign-up", "/two-factor", "/verify-email"]) assert.equal(pageGate(path), "auth", path);
  // A candidate's link is /interview/..., which must not count as /interviews.
  for (const path of ["/", "/interview/some-token", "/invite/abc", "/roomsy", "/newsletter"]) assert.equal(pageGate(path), "open", path);
});
