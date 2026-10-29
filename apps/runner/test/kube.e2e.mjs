// The Kubernetes panel's runner side (POST /rooms/:id/kube, kube.ts) against the playground in a real sandbox:
// status, up, a manifest applied from text (a Deployment and a Service in a namespace of the test's own), the
// objects summed up (replicas ready, ports, simulated pods and nodes), events, YAML and describe, refusals in
// kubectl's words, and deleting. The test's namespace is deleted, and a playground that was down is put down again.
// Needs the full image (SANDBOX_IMAGE=codechatter-sandbox:full).
//   node --env-file=../../.env test/kube.e2e.mjs        (from apps/runner, with the dev stack running)
import { signServiceToken } from "@codechatter/auth/service-token";

const ROOM = process.env.E2E_ROOM ?? "E2ETST"; // seeded for tests; never a room people use
const RUNNER = process.env.RUNNER_URL ?? "http://127.0.0.1:4200";
const SECRET = process.env.SERVICE_SECRET;
if (!SECRET) throw new Error("SERVICE_SECRET missing (run with --env-file=../../.env)");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${String(detail).replace(/\s+/g, " ").slice(0, 220)}` : ""}`);
};
const kube = async (body) => {
  const token = signServiceToken(SECRET, { aud: "runner", sub: ROOM, uid: "e2e-user", name: "E2E" });
  const response = await fetch(`${RUNNER}/rooms/${ROOM}/kube`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ns = `cc-e2e-${Date.now().toString(36)}`;
const manifest = `apiVersion: v1
kind: Namespace
metadata:
  name: ${ns}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: ${ns}
spec:
  replicas: 2
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: web
          image: nginx:1.27
---
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: ${ns}
spec:
  selector: { app: web }
  ports:
    - port: 80
`;

let wasRunning = true;
try {
  const status = await kube({ op: "status" });
  check("available", status.status === 200 && status.json?.available === true, JSON.stringify(status.json));

  // Checks need no cluster: a good manifest, misspelt and mistyped fields, a custom resource, and text that isn't YAML.
  const good = await kube({
    op: "check",
    text: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 2\n  selector:\n    matchLabels: {app: web}\n  template:\n    metadata:\n      labels: {app: web}\n    spec:\n      containers:\n        - name: web\n          image: nginx:1.27\n          resources:\n            limits: {cpu: 500m, memory: 128Mi}\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: web\nspec:\n  ports:\n    - port: 80\n      targetPort: http\n",
  });
  check("checkGood", good.status === 200 && good.json?.objects?.length === 2 && good.json.objects.every((o) => o.status === "valid"), JSON.stringify(good.json));
  const typo = await kube({
    op: "check",
    text: "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replica: 2\n  selector:\n    matchLabels: {app: web}\n  template:\n    spec:\n      containers:\n        - name: web\n          image: nginx\n          ports:\n            - containerPort: eighty\n",
  });
  const bad = typo.json?.objects?.[0];
  check("checkFindsMistakes", bad?.status === "invalid" && bad.errors.some((e) => e.path === "/spec" && /replica/.test(e.message)) && bad.errors.some((e) => e.path.endsWith("/containerPort")), JSON.stringify(bad));
  const custom = await kube({ op: "check", text: "apiVersion: example.com/v1\nkind: Widget\nmetadata:\n  name: w\n" });
  check("checkSkipsCustomResources", custom.json?.objects?.[0]?.status === "skipped", JSON.stringify(custom.json));
  const garbage = await kube({ op: "check", text: "this: [is not\n" });
  check("checkSaysNotYaml", garbage.json?.objects?.[0]?.status === "error", JSON.stringify(garbage.json));
  wasRunning = Boolean(status.json?.running);
  const up = await kube({ op: "up" });
  check("up", up.status === 200 && /Up\.|already up/.test(up.json?.output ?? ""), up.json?.output ?? up.json?.error);
  check("runningNow", (await kube({ op: "status" })).json?.running === true);

  const applied = await kube({ op: "apply", text: manifest });
  check("applied", applied.status === 200 && /deployment\.apps\/web created/.test(applied.json?.output ?? "") && /service\/web created/.test(applied.json?.output ?? ""), applied.json?.output ?? applied.json?.error);

  let items = [];
  let events = [];
  for (let i = 0; i < 30; i++) {
    const resources = await kube({ op: "resources" });
    items = resources.json?.items ?? [];
    events = resources.json?.events ?? [];
    if (items.find((item) => item.kind === "deployment" && item.namespace === ns)?.healthy) break;
    await sleep(1000);
  }
  const mine = items.filter((item) => item.namespace === ns);
  const deployment = mine.find((item) => item.kind === "deployment");
  check("deploymentReady", deployment?.status === "2/2 ready" && deployment.healthy === true && deployment.detail === "nginx:1.27", JSON.stringify(deployment));
  check("service", mine.find((item) => item.kind === "service")?.detail.endsWith("80/TCP"), JSON.stringify(mine.find((item) => item.kind === "service")));
  check("pods", mine.filter((item) => item.kind === "pod" && item.status === "Running").length === 2, JSON.stringify(mine.filter((item) => item.kind === "pod")));
  check("namespaceListed", items.some((item) => item.kind === "namespace" && item.name === ns && item.namespace === null));
  check("nodes", items.filter((item) => item.kind === "node" && item.status === "Ready").length >= 1);
  check("noSecretsListed", !items.some((item) => item.kind === "secret"));
  check("events", events.some((event) => event.namespace === ns && event.reason === "ScalingReplicaSet"), JSON.stringify(events.slice(0, 2)));

  const ref = { kind: "deployment", namespace: ns, name: "web" };
  const yaml = await kube({ op: "object", ref, view: "yaml" });
  check("yaml", yaml.status === 200 && /kind: Deployment/.test(yaml.json?.output ?? "") && /replicas: 2/.test(yaml.json?.output ?? ""));
  const described = await kube({ op: "object", ref, view: "describe" });
  check("describe", described.status === 200 && /Replicas:\s+2 desired/.test(described.json?.output ?? ""), described.json?.output?.slice(0, 120));

  const broken = await kube({ op: "apply", text: "apiVersion: v1\nkind: Nonsense\nmetadata:\n  name: x\n" });
  check("badManifestExplained", broken.status === 409 && /Nonsense/.test(broken.json?.error ?? ""), broken.json?.error);
  const missing = await kube({ op: "object", ref: { ...ref, name: "nowhere" }, view: "yaml" });
  check("missingExplained", missing.status === 409 && /not found/.test(missing.json?.error ?? ""), missing.json?.error);
  const secret = await kube({ op: "object", ref: { kind: "secret", namespace: ns, name: "x" }, view: "yaml" });
  check("secretsRefused", secret.status === 400, JSON.stringify(secret.json));
  const unsafe = await kube({ op: "delete", ref: { kind: "pod", namespace: ns, name: "--all" } });
  check("flagNameRefused", unsafe.status === 400, JSON.stringify(unsafe.json));

  const deleted = await kube({ op: "delete", ref });
  check("deleted", deleted.status === 200 && /deployment\.apps "web" deleted/.test(deleted.json?.output ?? ""), deleted.json?.output ?? deleted.json?.error);
} catch (error) {
  check("flowCompletes", false, error instanceof Error ? error.stack : String(error));
} finally {
  await kube({ op: "delete", ref: { kind: "namespace", namespace: null, name: ns } }).catch(() => {});
  if (!wasRunning) await kube({ op: "down" }).catch(() => {});
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
