// Ask the codebase for real, in E2ETST: a small project is cut into passages and embedded with the real model through the gateway.
// A question finds the right file by its words, and another by its meaning with no word in common. Secrets and .env never appear,
// only changed files are read again, a removed file goes, and without an embedding model it says so and still searches by words.
// Needs the current sandbox images and an embedding model pulled. The files are removed.
//   node --env-file=../../.env test/rag.e2e.mjs        (from apps/runner, with the dev stack running)
import { randomBytes } from "node:crypto";

import { signServiceToken } from "@codechatter/auth/service-token";
import { createFileAtPath, filesDocName, findByPath, setText, textOf, trash } from "@codechatter/workspace-model";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const COLLAB = process.env.COLLAB_INTERNAL_URL ?? "ws://127.0.0.1:4100";
const SECRET = process.env.SERVICE_SECRET;
const MODEL = process.env.AI_EMBEDDING_MODEL || "nomic-embed-text";
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 500)}` : ""}`);
};
const token = () => `Bearer ${signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" })}`;
const ask = async (question, model = MODEL, limit = 5) => {
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/rag`, { method: "POST", headers: { authorization: token(), "content-type": "application/json" }, body: JSON.stringify({ question, limit, model }), signal: AbortSignal.timeout(290_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${body.error}`);
  return body;
};

const MIXED = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const random = (length) => Array.from(randomBytes(length), (byte) => MIXED[byte % MIXED.length]).join("");
const GITHUB_TOKEN = `ghp_${random(36)}`;
const WEAK_PASSWORD = random(14);
const IN_ENV = random(30);
const dir = `rag-${Date.now().toString(36)}`;

const FILES = {
  "billing.py": `def compute_invoice_total(items, tax_rate):
    """Adds up the line items of an invoice and applies tax."""
    subtotal = sum(item.price * item.quantity for item in items)
    return round(subtotal * (1 + tax_rate), 2)


def apply_discount_code(total, code):
    """Takes a percentage off when a promotional code is valid."""
    if code == "WELCOME10":
        return total * 0.9
    return total
`,
  "retry.ts": `export async function fetchWithBackoff(url: string, attempts = 5) {
  let delay = 200;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url).catch(() => null);
    if (response?.ok) return response;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay *= 2;
  }
  throw new Error("gave up");
}
`,
  "auth.py": `import hashlib

GITHUB_TOKEN = "${GITHUB_TOKEN}"
DB_PASSWORD = "${WEAK_PASSWORD}"


def check_login(user, password):
    """Compares a password with the stored hash."""
    return hashlib.sha256(password.encode()).hexdigest() == user.password_hash
`,
  "notes.md": `# Deploying

We ship on Fridays, from the main branch, after the staging checks pass.
`,
  ".env": `API_SECRET=${IN_ENV}\n`,
  "node_modules/dep/index.js": `export const zebraInDependencies = 1;\n`,
};

const doc = new Y.Doc();
const socket = new HocuspocusProviderWebsocket({ url: COLLAB, WebSocketPolyfill: WebSocket, maxAttempts: 3 });
const provider = new HocuspocusProvider({ websocketProvider: socket, name: filesDocName(ROOM), document: doc, token: () => signServiceToken(SECRET, { aud: "collab", sub: filesDocName(ROOM) }) });
provider.attach();
await new Promise((resolve, reject) => {
  provider.on("synced", resolve);
  setTimeout(() => reject(new Error("collab sync timed out")), 15000);
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const inDir = (hit) => hit.path.startsWith(`${dir}/`);
const named = (hits, file) => hits.passages.filter(inDir).find((hit) => hit.path === `${dir}/${file}`);

try {
  for (const [name, content] of Object.entries(FILES)) createFileAtPath(doc, `${dir}/${name}`, content, null);
  await wait(3000);

  // The first search reads and embeds everything.
  const started = Date.now();
  const first = await ask("compute_invoice_total");
  console.log(`      first search ${Math.round((Date.now() - started) / 1000)} s: ${JSON.stringify(first.index)}${first.note ? ` note: ${first.note}` : ""}`);
  check("itEmbedsWithTheModel", first.index.embedded > 0 && first.index.waiting === 0 && first.index.model === MODEL, JSON.stringify(first.index));
  check("noNote", first.note === null, first.note);

  // By its words.
  const top = first.passages[0];
  check("anIdentifierIsFoundFirst", top?.path === `${dir}/billing.py` && top.text.includes("compute_invoice_total"), JSON.stringify(first.passages.map((hit) => hit.path)));
  check("aWholeFunctionIsOnePassage", top?.start === 1 && top.text.trimEnd().endsWith("2)") && top.name.includes("compute_invoice_total"), JSON.stringify(top));
  check("itKnowsItFoundItByWords", top?.found === "both" || top?.found === "words", top?.found);

  // By its meaning: no word of this is in that file.
  const meaning = await ask("how do we keep trying when a request does not work, waiting longer each time?");
  console.log(`      by meaning: ${meaning.passages.slice(0, 3).map((hit) => `${hit.path.replace(`${dir}/`, "")}:${hit.start} (${hit.found})`).join(", ")}`);
  check("aMeaningIsFoundWithNoWordsInCommon", meaning.passages.slice(0, 2).some((hit) => hit.path === `${dir}/retry.ts`), JSON.stringify(meaning.passages.map((hit) => hit.path)));
  const camel = await ask("fetch with backoff");
  check("wordsInsideAnIdentifierCount", camel.passages[0]?.path === `${dir}/retry.ts`, JSON.stringify(camel.passages.map((hit) => hit.path)));
  const prose = await ask("when do we ship and from which branch?");
  check("documentsAreSearchedToo", prose.passages.slice(0, 2).some((hit) => hit.path === `${dir}/notes.md`), JSON.stringify(prose.passages.map((hit) => hit.path)));

  // Secrets.
  const secrets = await ask("GitHub token and database password in auth", MODEL, 12);
  const everything = JSON.stringify([first, meaning, camel, prose, secrets]);
  check("theAuthFileIsSearched", Boolean(named(secrets, "auth.py")), JSON.stringify(secrets.passages.map((hit) => hit.path)));
  check("aTokenNeverComesBack", !everything.includes(GITHUB_TOKEN));
  check("norAWeakPassword", !everything.includes(WEAK_PASSWORD));
  check("itSaysWhereOneWas", named(secrets, "auth.py")?.text.includes("[removed"), named(secrets, "auth.py")?.text);
  check("theFunctionBesideItIsStillThere", (await ask("compare a password with the stored hash")).passages.some((hit) => hit.path === `${dir}/auth.py` && hit.text.includes("check_login")));
  const fromEnv = await ask("API_SECRET");
  check("dotEnvIsNotRead", !JSON.stringify(fromEnv).includes(IN_ENV) && !fromEnv.passages.some((hit) => hit.path.endsWith(".env")), JSON.stringify(fromEnv.passages.map((hit) => hit.path)));
  const fromDependency = await ask("zebraInDependencies");
  check("installedPackagesAreNotRead", !fromDependency.passages.some((hit) => hit.path.includes("node_modules")), JSON.stringify(fromDependency.passages.map((hit) => hit.path)));

  // Keeping up.
  const again = await ask("compute_invoice_total");
  check("nothingIsReadAgainWhenNothingChanged", again.index.changed === 0 && again.index.embedded === 0, JSON.stringify(again.index));
  const billing = findByPath(doc, `${dir}/billing.py`);
  setText(textOf(doc, billing.id), `${FILES["billing.py"]}\n\ndef refund_customer_order(order):\n    """Gives the money back for a cancelled order."""\n    return order.total * -1\n`);
  await wait(2500);
  const changed = await ask("refund_customer_order");
  check("aChangedFileIsReadAgain", changed.index.changed === 1 && changed.passages[0]?.path === `${dir}/billing.py` && changed.passages[0].text.includes("refund_customer_order"), JSON.stringify(changed.index));
  check("onlyItsPassagesAreEmbedded", changed.index.embedded > 0 && changed.index.embedded <= 4, JSON.stringify(changed.index));
  trash(doc, findByPath(doc, `${dir}/retry.ts`).id);
  await wait(2500);
  const removed = await ask("fetchWithBackoff");
  check("aRemovedFileGoes", !removed.passages.some((hit) => hit.path === `${dir}/retry.ts`), JSON.stringify(removed.passages.map((hit) => hit.path)));

  // Without a model, or with a wrong one, it still searches, and says what's missing.
  const noModel = await ask("compute_invoice_total", null);
  check("withNoModelItUsesWords", noModel.passages[0]?.path === `${dir}/billing.py` && /by words only/.test(noModel.note ?? ""), JSON.stringify(noModel).slice(0, 300));
  const wrong = await ask("compute_invoice_total", "no-such-model");
  check("aWrongModelIsSaid", /by words only/.test(wrong.note ?? "") && wrong.passages[0]?.path === `${dir}/billing.py`, JSON.stringify(wrong).slice(0, 300));
  const back = await ask("how do we give money back?");
  check("itRecoversWithTheRightModel", back.index.model === MODEL && back.note === null && back.index.waiting === 0, JSON.stringify(back.index) + back.note);

  // Two at once share one index, in turn.
  const both = await Promise.all([ask("compute_invoice_total"), ask("apply_discount_code")]);
  check("twoSearchesTakeTurns", both.every((hit) => hit.passages.length > 0));
} catch (error) {
  check("noUnexpectedError", false, error instanceof Error ? error.stack : String(error));
} finally {
  const folder = findByPath(doc, dir);
  if (folder) trash(doc, folder.id);
  await wait(800);
  provider.destroy();
  socket.destroy();
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
