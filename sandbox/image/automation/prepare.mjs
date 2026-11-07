// Run once when the image is built: puts each piece where Activepieces' engine looks for it, and writes what each piece can do to manifest.json, which is
// what the Automations tool's forms are made from. A piece that won't load fails the build rather than a room's run.
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";

const here = process.cwd();
const require = createRequire(join(here, "prepare.mjs"));
const scope = join(here, "node_modules", "@activepieces");
const out = {};

/** What the tool needs to know about a field, and nothing that isn't plain data. */
function field(property) {
  const shown = { type: property.type, label: property.displayName ?? "", description: property.description ?? "", required: property.required === true };
  if (property.defaultValue !== undefined && typeof property.defaultValue !== "function") shown.default = property.defaultValue;
  const options = property.options?.options;
  if (Array.isArray(options)) shown.options = options.map((option) => ({ label: String(option.label), value: option.value }));
  if (property.properties && typeof property.properties === "object") shown.fields = fields(property.properties);
  return shown;
}
function fields(properties) {
  return Object.fromEntries(Object.entries(properties ?? {}).map(([name, property]) => [name, field(property)]));
}
const steps = (list) =>
  Object.fromEntries(
    Object.entries(list ?? {}).map(([name, step]) => [
      name,
      { label: step.displayName ?? name, description: step.description ?? "", needsAuth: step.requireAuth !== false, fields: fields(step.props), ...(step.type ? { kind: step.type } : {}) },
    ]),
  );
function authOf(auth) {
  const one = Array.isArray(auth) ? auth[0] : auth;
  if (!one) return null;
  return { type: one.type, label: one.displayName ?? "", description: one.description ?? "", fields: fields(one.props) };
}

for (const folder of readdirSync(scope).filter((name) => name.startsWith("piece-")).sort()) {
  const name = `@activepieces/${folder}`;
  const { version } = JSON.parse(readFileSync(join(scope, folder, "package.json"), "utf8"));
  const home = join(here, "pieces", "@activepieces", `${folder}-${version}`, "node_modules", "@activepieces");
  mkdirSync(home, { recursive: true });
  // Relative, as this folder is somewhere else in the image.
  symlinkSync(relative(home, join(scope, folder)), join(home, folder));
  const module = require(name);
  const piece = Object.values(module).find((value) => typeof value?.metadata === "function");
  if (!piece) throw new Error(`${name} doesn't export a piece.`);
  const about = piece.metadata();
  out[name] = {
    label: about.displayName ?? folder,
    description: about.description ?? "",
    version,
    categories: about.categories ?? [],
    auth: authOf(about.auth),
    actions: steps(about.actions),
    triggers: steps(about.triggers),
  };
}
writeFileSync(join(here, "manifest.json"), JSON.stringify(out));
const actions = Object.values(out).reduce((total, piece) => total + Object.keys(piece.actions).length, 0);
console.log(`${Object.keys(out).length} pieces, ${actions} actions, manifest ${Math.round(JSON.stringify(out).length / 1024)} KB`);
