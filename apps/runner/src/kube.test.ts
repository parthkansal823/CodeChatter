import { describe, expect, it } from "vitest";

import { errorsOf, summarize, summarizeEvent, type K8sObject } from "./kube.js";

const object = (kind: string, rest: Partial<K8sObject> = {}): K8sObject => ({ kind, metadata: { name: "web", namespace: "demo", creationTimestamp: "2026-10-21T10:00:00Z" }, ...rest });

describe("summarize", () => {
  it("counts ready replicas against the wanted ones, with the images", () => {
    const deployment = object("Deployment", { spec: { replicas: 3, template: { spec: { containers: [{ image: "nginx:1.27" }, { image: "redis:7" }] } } }, status: { readyReplicas: 2 } });
    expect(summarize(deployment)).toEqual({ kind: "deployment", namespace: "demo", name: "web", status: "2/3 ready", healthy: false, detail: "nginx:1.27, redis:7", createdAt: "2026-10-21T10:00:00Z" });
    expect(summarize(object("StatefulSet", { spec: {}, status: { readyReplicas: 1 } }))).toMatchObject({ status: "1/1 ready", healthy: true });
  });

  it("tells pods, jobs and nodes in words", () => {
    expect(summarize(object("Pod", { spec: { nodeName: "kwok-node-0" }, status: { phase: "Running", containerStatuses: [{ ready: true, restartCount: 2 }] } }))).toMatchObject({ status: "Running, 2 restarts", healthy: true, detail: "kwok-node-0" });
    expect(summarize(object("Pod", { status: { phase: "Pending" } }))).toMatchObject({ status: "Pending", healthy: null });
    expect(summarize(object("Job", { spec: { completions: 2 }, status: { succeeded: 2 } }))).toMatchObject({ status: "Complete", healthy: true, detail: "2/2 done" });
    expect(summarize(object("Job", { spec: {}, status: { failed: 1 } }))).toMatchObject({ status: "Failed (1)", healthy: false });
    expect(summarize({ kind: "Node", metadata: { name: "kwok-node-0" }, status: { conditions: [{ type: "Ready", status: "True" }], nodeInfo: { kubeletVersion: "fake" } } })).toMatchObject({ namespace: null, status: "Ready", healthy: true, detail: "fake" });
  });

  it("describes services, config maps and cron jobs, which are neither healthy nor not", () => {
    expect(summarize(object("Service", { spec: { type: "NodePort", clusterIP: "10.0.0.7", ports: [{ port: 80 }, { port: 53, protocol: "UDP" }] } }))).toMatchObject({ status: "NodePort", healthy: null, detail: "10.0.0.7 · 80/TCP, 53/UDP" });
    expect(summarize(object("ConfigMap", { data: { a: "1" } }))).toMatchObject({ status: "1 key", healthy: null });
    expect(summarize(object("CronJob", { spec: { schedule: "*/5 * * * *", suspend: true } }))).toMatchObject({ status: "Suspended", detail: "*/5 * * * *" });
  });

  it("leaves out kinds the panel doesn't list", () => {
    expect(summarize(object("Secret", { data: { password: "x" } }))).toBeNull();
    expect(summarize(object("ReplicaSet"))).toBeNull();
  });
});

describe("summarizeEvent", () => {
  it("names the object, and takes the last time it was seen", () => {
    expect(
      summarizeEvent({ metadata: { namespace: "demo" }, type: "Warning", reason: "BackOff", message: "Back-off restarting", count: 3, lastTimestamp: "2026-10-21T10:05:00Z", involvedObject: { kind: "Pod", name: "web-1" } }),
    ).toEqual({ namespace: "demo", type: "Warning", reason: "BackOff", message: "Back-off restarting", object: "pod/web-1", count: 3, lastSeen: "2026-10-21T10:05:00Z" });
    expect(summarizeEvent({ metadata: { creationTimestamp: "t0" }, eventTime: null, lastTimestamp: null }).lastSeen).toBe("t0");
  });
});

describe("errorsOf", () => {
  it("takes kubeconform's list when it names the mistakes", () => {
    expect(errorsOf({ validationErrors: [{ path: "/spec", msg: "additional properties 'replica' not allowed" }] })).toEqual([
      { path: "/spec", message: "additional properties 'replica' not allowed" },
    ]);
  });

  it("reads every mistake from the message when the list has only the top of the tree", () => {
    const msg =
      "problem validating schema. Check JSON formatting: jsonschema validation failed with 'file:///s/deployment-apps-v1.json#' - at '/spec': validation failed   - at '/spec/template/spec/containers/0/ports/0/containerPort': got string, want null or integer   - at '/spec': additional properties 'replica' not allowed";
    expect(errorsOf({ msg, validationErrors: [{ path: "", msg: "validation failed" }] })).toEqual([
      { path: "/spec/template/spec/containers/0/ports/0/containerPort", message: "got string, want null or integer" },
      { path: "/spec", message: "additional properties 'replica' not allowed" },
    ]);
  });
});
