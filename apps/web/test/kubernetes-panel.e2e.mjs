// The Kubernetes panel (roadmap §14 F), as a person uses it, on the playground in the E2ETST room's sandbox (full
// image): open Kubernetes from the Apps, check the open manifest against the schemas (no cluster needed), start the
// playground if it's down, apply the open manifest in one click,
// then find its Deployment (2/2 ready) in its namespace, read its YAML and description, see its pods, its Service
// and its events, and delete it. The test's manifest file and namespace are removed, and a playground that was
// down is stopped again.
//   node test/kubernetes-panel.e2e.mjs        (from apps/web, with the dev stack running and SANDBOX_IMAGE=…:full)
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, finish, launch } from "./browser.mjs";

const ok = (promise) =>
  promise.then(
    () => true,
    () => false,
  );

const stamp = Date.now().toString(36);
const ns = `cc-ui-${stamp}`;
const file = `k8s_${stamp}.json`;
const manifest = JSON.stringify({
  apiVersion: "v1",
  kind: "List",
  items: [
    { apiVersion: "v1", kind: "Namespace", metadata: { name: ns } },
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "web", namespace: ns },
      spec: { replicas: 2, selector: { matchLabels: { app: "web" } }, template: { metadata: { labels: { app: "web" } }, spec: { containers: [{ name: "web", image: "nginx:1.27" }] } } },
    },
    { apiVersion: "v1", kind: "Service", metadata: { name: "web", namespace: ns }, spec: { selector: { app: "web" }, ports: [{ port: 80 }] } },
  ],
});

const { browser, errors, signIn } = await launch();
const { page: a } = await signIn("test1@codechatter.local");
const kube = (body) =>
  a.evaluate(
    ([path, payload]) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).then((r) => r.json()),
    [`/api/rooms/E2ETST/kube`, body],
  );
let created = false;
let wasRunning = true;

try {
  wasRunning = (await kube({ op: "status" })).running === true;
  await a.getByRole("button", { name: "New file" }).click();
  await a.getByPlaceholder("name.ext").fill(file);
  await a.getByPlaceholder("name.ext").press("Enter");
  await a.getByRole("tab", { name: new RegExp(file.replace(".", "\\.")) }).waitFor({ timeout: 15_000 });
  created = true;
  await a.locator(".monaco-editor .view-lines").first().click();
  await a.keyboard.insertText(manifest);

  await a.getByRole("group", { name: "Apps" }).getByRole("button", { name: "Kubernetes" }).click();
  const tool = a.locator("h2", { hasText: "Kubernetes" });
  check("toolOpens", await ok(tool.waitFor({ timeout: 15_000 })));

  // Check needs no cluster: the manifest matches the schemas of the playground's Kubernetes.
  await a.getByRole("button", { name: "Check", exact: true }).click();
  const results = a.getByRole("region", { name: "Check results" });
  const matched = await ok(results.getByText(/all 3 match the schemas/).waitFor({ timeout: 30_000 }));
  check("checksTheManifest", matched, matched ? "" : await results.innerText().catch(() => "(no results)"));
  await results.getByRole("button", { name: "Close the check" }).click();

  if (!wasRunning) await a.getByRole("button", { name: "Start" }).click();
  check("running", await ok(a.getByText("Playground running").waitFor({ timeout: 120_000 })));

  await a.getByRole("button", { name: `Apply ${file}` }).click();
  check("applied", await ok(a.getByText(/deployment\.apps\/web created/).waitFor({ timeout: 30_000 })));

  await a.getByRole("combobox", { name: "Namespace" }).click();
  await a.getByRole("option", { name: ns }).click();
  const deployments = a.getByRole("table", { name: "Deployments" });
  check("deploymentReady", await ok(deployments.getByRole("row").filter({ hasText: "2/2 ready" }).filter({ hasText: "nginx:1.27" }).waitFor({ timeout: 30_000 })));

  await deployments.getByRole("button", { name: "web" }).click();
  const details = a.getByRole("region", { name: `Details of deployment ${ns}/web` });
  check("yaml", await ok(details.getByLabel("YAML").filter({ hasText: "kind: Deployment" }).waitFor({ timeout: 15_000 })));
  await details.getByRole("tab", { name: "Describe" }).click();
  check("describe", await ok(details.getByLabel("Description").filter({ hasText: /Replicas:\s+2 desired/ }).waitFor({ timeout: 15_000 })));
  await a.screenshot({ path: join(process.env.SHOT_DIR ?? tmpdir(), "kubernetes-panel.png") });

  const kinds = a.getByRole("navigation", { name: "Kinds" });
  await kinds.getByRole("button", { name: /^Pods/ }).click();
  check("pods", (await a.getByRole("table", { name: "Pods" }).getByRole("row").filter({ hasText: "Running" }).count()) === 2);
  await kinds.getByRole("button", { name: /^Services/ }).click();
  check("service", await ok(a.getByRole("table", { name: "Services" }).getByRole("row").filter({ hasText: "80/TCP" }).waitFor({ timeout: 5_000 })));
  await kinds.getByRole("button", { name: /^Events/ }).click();
  check("events", await ok(a.getByRole("table", { name: "Events" }).getByRole("row").filter({ hasText: "ScalingReplicaSet" }).first().waitFor({ timeout: 5_000 })));

  await kinds.getByRole("button", { name: /^Deployments/ }).click();
  await a.getByRole("table", { name: "Deployments" }).getByRole("button", { name: "web" }).click();
  await a.getByRole("button", { name: `Delete deployment ${ns}/web` }).click();
  await a.getByRole("button", { name: "Delete web" }).click();
  check("deleted", await ok(a.getByText(/deployment\.apps "web" deleted/).waitFor({ timeout: 15_000 })));
  check("goneFromTable", await ok(a.getByText(/^No Deployments here/).waitFor({ timeout: 20_000 })));
} catch (error) {
  const shot = join(tmpdir(), "kubernetes-panel-failed.png");
  await a.screenshot({ path: shot }).catch(() => {});
  check("flowCompletes", false, `${error instanceof Error ? error.message.split("\n")[0] : String(error)} (screenshot: ${shot})`);
} finally {
  await kube({ op: "delete", ref: { kind: "namespace", namespace: null, name: ns } }).catch(() => {});
  if (!wasRunning) await kube({ op: "down" }).catch(() => {});
  if (created) {
    try {
      await a.getByRole("button", { name: "Close" }).first().click().catch(() => {});
      const row = a.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: new RegExp(`^${file.replace(".", "\\.")}`) });
      await row.focus();
      await row.press("Delete");
      await row.waitFor({ state: "detached", timeout: 10_000 });
      check("testFileDeleted", true);
    } catch (error) {
      check("testFileDeleted", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
    }
  }
  await browser.close();
}
check("noPageErrors", errors.length === 0, errors.join(" | "));
finish();
