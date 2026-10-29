// The Kubernetes-aware editor (monaco-yaml, with the schemas of the playground's Kubernetes): in a manifest, a
// misspelt field is a problem and Ctrl+Space under spec suggests the Deployment's own fields; YAML that isn't
// Kubernetes gets no problems from the schema. The test's files have a stamp in their names and are deleted.
//   node test/kubernetes-yaml.e2e.mjs        (from apps/web, with the dev stack running)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const stamp = Date.now().toString(36);
const manifest = `k8y_${stamp}.yaml`;
const plain = `cfg_${stamp}.yaml`;
const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const { browser, errors, signIn } = await launch();
const { context, page: a } = await signIn("test1@codechatter.local");
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const created = [];
const panel = a.getByRole("region", { name: "Output and terminals" });
const list = panel.getByRole("list", { name: "Problems" });

async function newFile(name, text) {
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(name);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(escape(name)) }).waitFor({ timeout: 15_000 });
  created.push(name);
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.evaluate((value) => navigator.clipboard.writeText(value), text);
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+v");
}

try {
  await newFile(
    manifest,
    ["apiVersion: apps/v1", "kind: Deployment", "metadata:", "  name: web", "spec:", "  replica: 2", "  selector:", "    matchLabels:", "      app: web", "  template:", "    metadata:", "      labels:", "        app: web", "    spec:", "      containers:", "        - name: web", "          image: nginx", ""].join("\n"),
  );
  await a.getByRole("button", { name: /^Problems: / }).click();
  const misspelt = list.getByRole("button", { name: /replica/ });
  check("misspeltFieldIsAProblem", await ok(misspelt.first().waitFor({ timeout: 30_000 })), await list.innerText().catch(() => "(no problems)"));

  // Ctrl+Space on a new line under spec (after "replica: 2", line 6): the Deployment's fields.
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.press("Control+Home");
  for (let i = 0; i < 5; i++) await a.keyboard.press("ArrowDown");
  await a.keyboard.press("End");
  await a.keyboard.press("Enter");
  await a.keyboard.press("Control+Space");
  const suggestions = a.locator(".suggest-widget");
  check("suggestsDeploymentFields", await ok(suggestions.getByText("revisionHistoryLimit", { exact: true }).waitFor({ timeout: 15_000 })), await suggestions.innerText().catch(() => "(none)"));
  await a.keyboard.press("Escape");
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "kubernetes-yaml.png") });

  // YAML that isn't Kubernetes: nothing from the schema.
  await newFile(plain, ["name: my app", "port: 8080", "features:", "  - search", ""].join("\n"));
  await a.waitForTimeout(3_000);
  check("otherYamlLeftAlone", (await list.getByRole("button", { name: new RegExp(escape(plain)) }).count()) === 0, await list.innerText().catch(() => ""));
} catch (error) {
  const shot = join(tmpdir(), "kubernetes-yaml-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  try {
    const tree = a.getByRole("tree", { name: "Files" });
    for (const name of created) {
      const row = tree.getByRole("treeitem", { name: new RegExp(`^${escape(name)}`) });
      await row.focus();
      await row.press("Delete");
      await row.waitFor({ state: "detached", timeout: 10_000 });
    }
    check("testFilesDeleted", true, created.join(", "));
  } catch (error) {
    check("testFilesDeleted", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
