// The editor's Kubernetes schema (public/schemas/kubernetes.json), made from the OpenAPI spec of the Kubernetes
// version the sandbox's playground runs (as sandbox/image/k8s-schemas.py makes kubeconform's): one file, every
// definition in it, and each kind's applied only to a document whose apiVersion and kind name it, so YAML that
// isn't Kubernetes gets nothing from it but the two fields' suggestions. Strict, as kubeconform's: an object's
// unknown fields are errors (a misspelt "replicas"), but any field may be null, as Kubernetes allows.
//   node scripts/kubernetes-schema.mjs        (from apps/web; downloads the spec once, checks its SHA-256)
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The playground's version and the spec's SHA-256, as in sandbox/image/Dockerfile.
const VERSION = "v1.37.1";
const SHA256 = "465276aedf437726de5a6ed23a41b86d78bb0d347edf251a755ae26a93cdd8a6";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "schemas", "kubernetes.json");

const response = await fetch(`https://raw.githubusercontent.com/kubernetes/kubernetes/${VERSION}/api/openapi-spec/swagger.json`);
if (!response.ok) throw new Error(`The spec didn't download: ${response.status}`);
const raw = Buffer.from(await response.arrayBuffer());
const sum = createHash("sha256").update(raw).digest("hex");
if (sum !== SHA256) throw new Error(`The spec's SHA-256 is ${sum}, not the pinned ${SHA256}.`);
const { definitions } = JSON.parse(raw.toString("utf8"));

/** One schema, walked through the places schemas nest; property names are left alone. */
function schema(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  const out = { ...node };
  if (out.properties && typeof out.properties === "object") {
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([name, value]) => [name, schema(value)]));
  }
  if (out.items && typeof out.items === "object") out.items = schema(out.items);
  if (out.additionalProperties && typeof out.additionalProperties === "object") out.additionalProperties = schema(out.additionalProperties);
  for (const key of ["allOf", "anyOf", "oneOf"]) if (Array.isArray(out[key])) out[key] = out[key].map(schema);
  if (out.format === "int-or-string") {
    delete out.type;
    out.oneOf = [{ type: ["string", "null"] }, { type: ["integer", "null"] }];
  } else if (typeof out.type === "string") {
    out.type = [out.type, "null"];
  }
  if (out.properties && !("additionalProperties" in out) && !out["x-kubernetes-preserve-unknown-fields"]) out.additionalProperties = false;
  return out;
}

const kinds = [];
for (const [name, definition] of Object.entries(definitions)) {
  // The meta group's helpers (DeleteOptions, WatchEvent) carry every group's name: they aren't manifests.
  if (name.startsWith("io.k8s.apimachinery.pkg.apis.meta.")) continue;
  for (const { group = "", version, kind } of definition["x-kubernetes-group-version-kind"] ?? []) {
    kinds.push({ apiVersion: group ? `${group}/${version}` : version, kind, name });
  }
}
const unique = (values) => [...new Set(values)].sort();
const root = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: `Kubernetes ${VERSION.slice(1)}`,
  type: "object",
  properties: {
    // Suggestions, not a list to keep to: a custom resource's own apiVersion and kind are fine.
    apiVersion: { type: "string", description: "The API group and version of this object.", examples: unique(kinds.map((k) => k.apiVersion)) },
    kind: { type: "string", description: "What this object is.", examples: unique(kinds.map((k) => k.kind)) },
  },
  allOf: kinds.map(({ apiVersion, kind, name }) => ({
    if: { properties: { apiVersion: { const: apiVersion }, kind: { const: kind } }, required: ["apiVersion", "kind"] },
    then: { $ref: `#/definitions/${name}` },
  })),
  definitions: Object.fromEntries(Object.entries(definitions).map(([name, value]) => [name, schema(value)])),
};
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(root));
console.log(`${kinds.length} kinds, ${(JSON.stringify(root).length / 1024 / 1024).toFixed(1)} MB: ${OUT}`);
