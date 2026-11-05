/** Check supported manifest formats, exact source locations and conservative version handling without network calls. */
import { describe, expect, it } from "vitest";

import { DependencyCheckInput, parseManifests } from "./dependencies.js";

const file = (path: string, content: string) => ({ path, content });

describe("npm dependency files", () => {
  it.each([2, 3])("reads package-lock v%i packages and their key lines", (version) => {
    const result = parseManifests([file("package-lock.json", [
      "{", `  "lockfileVersion": ${version},`, '  "packages": {',
      '    "": { "name": "our-app", "version": "1.0.0" },',
      '    "node_modules/lodash": {', '      "version": "4.17.20"', '    },',
      '    "node_modules/@scope/tool": { "version": "2.0.0" },',
      '    "node_modules/other/node_modules/lodash": { "version": "4.17.20" },',
      '    "apps/local": { "version": "1.0.0" },',
      '    "node_modules/local": { "link": true, "version": "1.0.0" }', "  }", "}",
    ].join("\n"))]);
    expect(result).toEqual([
      { ecosystem: "npm", name: "lodash", version: "4.17.20", path: "package-lock.json", line: 5 },
      { ecosystem: "npm", name: "@scope/tool", version: "2.0.0", path: "package-lock.json", line: 8 },
    ]);
  });

  it("uses the actual package name for an npm alias in a lock", () => {
    const result = parseManifests([file("package-lock.json", '{"packages":{"node_modules/alias":{"name":"real-package","version":"1.2.3"}}}')]);
    expect(result[0]).toMatchObject({ name: "real-package", version: "1.2.3", line: 1 });
  });

  it("does not mistake local folders whose names end with node_modules for installed packages", () => {
    const result = parseManifests([file("package-lock.json", '{"packages":{"src/not_node_modules/local":{"version":"1.2.3"}}}')]);
    expect(result).toEqual([]);
  });

  it("reads pnpm package keys, scoped names and peer suffixes without reading snapshots", () => {
    const result = parseManifests([file("pnpm-lock.yaml", [
      "lockfileVersion: '9.0'", "packages:", "  /lodash@4.17.20:", "    resolution: {integrity: test}",
      "  '@scope/tool@2.0.0(react@19.0.0)':", "    dependencies:", "      ignored@8.0.0:",
      "snapshots:", "  lodash@4.17.20:", "    dependencies: {}",
    ].join("\n"))]);
    expect(result).toEqual([
      { ecosystem: "npm", name: "lodash", version: "4.17.20", path: "pnpm-lock.yaml", line: 3 },
      { ecosystem: "npm", name: "@scope/tool", version: "2.0.0", path: "pnpm-lock.yaml", line: 5 },
    ]);
  });

  it("reads dependencies and devDependencies and only lowers plain exact/caret/tilde versions", () => {
    const result = parseManifests([file("package.json", [
      "{", '  "dependencies": {', '    "exact": "1.2.3",', '    "caret": "^2.3.4",',
      '    "tilde": "~3.4.5",', '    "range": ">=1.2.3",', '    "workspace": "workspace:*",',
      '    "alias": "npm:other@1.0.0",', '    "wildcard": "1.x",', '    "pre": "2.0.0-beta.1+build.1"',
      '  },', '  "devDependencies": { "test": "^4.5.6" }', "}",
    ].join("\n"))]);
    expect(result.map(({ name, version }) => [name, version])).toEqual([
      ["exact", "1.2.3"], ["caret", "2.3.4"], ["tilde", "3.4.5"], ["range", null],
      ["workspace", null], ["alias", null], ["wildcard", null], ["pre", "2.0.0-beta.1+build.1"], ["test", "4.5.6"],
    ]);
    expect(result[0]?.line).toBe(3);
    expect(result.at(-1)?.line).toBe(12);
  });

  it("prefers package-lock then pnpm then package.json only within the same folder", () => {
    const result = parseManifests([
      file("package.json", '{"dependencies":{"dep":"^0.0.1"}}'),
      file("pnpm-lock.yaml", "packages:\n  dep@1.0.0:\n    resolution: {}"),
      file("package-lock.json", '{"packages":{"node_modules/dep":{"version":"2.0.0"}}}'),
      file("apps/child/package.json", '{"dependencies":{"dep":"^3.0.0"}}'),
      file("apps/pnpm/package.json", '{"dependencies":{"pnpm":"^0.0.1"}}'),
      file("apps/pnpm/pnpm-lock.yaml", "packages:\n  pnpm@4.0.0:\n    resolution: {}"),
    ]);
    expect(result.map(({ name, version, path }) => [name, version, path])).toEqual([
      ["dep", "3.0.0", "apps/child/package.json"], ["pnpm", "4.0.0", "apps/pnpm/pnpm-lock.yaml"], ["dep", "2.0.0", "package-lock.json"],
    ]);
  });

  it("falls back after malformed or unsupported locks, but honors a valid empty lock", () => {
    const manifest = file("package.json", '{"dependencies":{"dep":"^1.0.0"}}');
    expect(parseManifests([file("package-lock.json", "{broken"), manifest])[0]?.name).toBe("dep");
    expect(parseManifests([file("package-lock.json", '{"lockfileVersion":1,"dependencies":{}}'), manifest])[0]?.name).toBe("dep");
    expect(parseManifests([file("package-lock.json", '{"packages":{}}'), manifest])).toEqual([]);
    expect(parseManifests([file("pnpm-lock.yaml", "packages: {}"), manifest])).toEqual([]);
  });

  it("keeps accurate JSON lines when a name repeats in different sections", () => {
    const result = parseManifests([file("package.json", '{\n"dependencies": {"same":"1.0.0"},\n"devDependencies": {"same":"2.0.0"}\n}')]);
    expect(result.map(({ version, line }) => [version, line])).toEqual([["1.0.0", 2], ["2.0.0", 3]]);
  });

  it("leaves malformed semver strings unchecked instead of querying a guessed version", () => {
    const result = parseManifests([file("package.json", '{"dependencies":{"zero":"01.2.3","empty":"1.2.3-alpha..1","pre":"1.2.3-01"}}')]);
    expect(result.map(({ version }) => version)).toEqual([null, null, null]);
  });
});

describe("Python dependency files", () => {
  it("reads pins, extras, environment markers and hashes; leaves other specifiers unchecked", () => {
    const result = parseManifests([file("requirements-dev.txt", [
      "# Environment", 'requests==2.31.0 ; python_version < "3.12"', "Django>=4.2", "urllib3[secure]==1.26.20 --hash=sha256:abc",
      "flask==2.*", "-r requirements-base.txt", "our-package @ https://example.com/package.whl", "bare-package", "", "  # comment",
    ].join("\n"))]);
    expect(result.map(({ name, version, line }) => [name, version, line])).toEqual([
      ["requests", "2.31.0", 2], ["Django", null, 3], ["urllib3", "1.26.20", 4], ["flask", null, 5],
      ["our-package", null, 7], ["bare-package", null, 8],
    ]);
  });

  it("reads Poetry package tables and prefers the lock over requirements in that folder", () => {
    const result = parseManifests([
      file("requirements.txt", "requests==1.0.0"),
      file("poetry.lock", ["[[package]]", 'name = "requests"', 'version = "2.31.0" # pinned', "[package.dependencies]", 'name = "not-a-package"',
        "[[package]]", "name = 'urllib3'", "version = '1.26.20'"].join("\n")),
      file("nested/requirements.txt", "requests==2.32.0"),
    ]);
    expect(result.map(({ name, version, line }) => [name, version, line])).toEqual([
      ["requests", "2.32.0", 1], ["requests", "2.31.0", 2], ["urllib3", "1.26.20", 7],
    ]);
  });

  it("treats an explicit empty Poetry package array as authoritative over requirements", () => {
    const requirement = file("requirements.txt", "requests==2.0.0");
    expect(parseManifests([
      requirement, file("poetry.lock", 'package = []\n\n[metadata]\nlock-version = "2.1"'),
    ])).toEqual([]);
    // A similarly named key in metadata is not the root package array.
    expect(parseManifests([
      requirement, file("poetry.lock", '[metadata]\npackage = []'),
    ])[0]).toMatchObject({ name: "requests", version: "2.0.0" });
  });

  it("deduplicates normalized Python names while preserving different versions", () => {
    const result = parseManifests([file("requirements.txt", "Foo_Bar==1.2.3\nfoo.bar==1.2.3\nfoo-bar==2.0.0")]);
    expect(result.map(({ name, version }) => [name, version])).toEqual([["Foo_Bar", "1.2.3"], ["foo-bar", "2.0.0"]]);
  });
});

describe("other supported ecosystems", () => {
  it("reads single and block Go require directives, including indirect and pseudo versions", () => {
    const result = parseManifests([file("go.mod", [
      "module example.com/app", "go 1.24", "require example.com/single v1.2.3", "require (", "  example.com/direct v2.0.0+incompatible",
      "  example.com/indirect v0.0.0-20240202123456-abcdef123456 // indirect", ")", "replace example.com/single => ../single",
    ].join("\n"))]);
    expect(result.map(({ ecosystem, name, version, line }) => [ecosystem, name, version, line])).toEqual([
      ["Go", "example.com/single", "v1.2.3", 3], ["Go", "example.com/direct", "v2.0.0+incompatible", 5],
      ["Go", "example.com/indirect", "v0.0.0-20240202123456-abcdef123456", 6],
    ]);
  });

  it("reads Cargo package names and versions without mistaking dependency strings for packages", () => {
    const result = parseManifests([file("Cargo.lock", [
      "version = 4", "[[package]]", 'name = "serde"', 'version = "1.0.200"', 'dependencies = ["serde_derive"]',
      "[[package]]", 'name = "serde_derive"', 'version = "1.0.200"',
    ].join("\n"))]);
    expect(result.map(({ ecosystem, name, version, line }) => [ecosystem, name, version, line])).toEqual([
      ["crates.io", "serde", "1.0.200", 3], ["crates.io", "serde_derive", "1.0.200", 7],
    ]);
  });

  it("reads Composer production and development packages and keeps dev branches unchecked", () => {
    const result = parseManifests([file("composer.lock", [
      "{", '  "packages": [', '    {"name":"vendor/pkg","version":"v1.2.3"}', "  ],",
      '  "packages-dev": [', '    {"name":"test/pkg","version":"dev-main"}', "  ]", "}",
    ].join("\n"))]);
    expect(result).toEqual([
      { ecosystem: "Packagist", name: "vendor/pkg", version: "v1.2.3", path: "composer.lock", line: 3 },
      { ecosystem: "Packagist", name: "test/pkg", version: null, path: "composer.lock", line: 6 },
    ]);
  });

  it("reads literal Maven dependency versions, ignores comments/exclusions and marks properties unchecked", () => {
    const result = parseManifests([file("pom.xml", [
      '<project xmlns="http://maven.apache.org/POM/4.0.0">',
      '<!-- <dependency><groupId>fake</groupId><artifactId>fake</artifactId><version>1</version></dependency> -->',
      "<dependencies>", "  <dependency>", "    <groupId>org.junit.jupiter</groupId>", "    <artifactId>junit-jupiter</artifactId>",
      "    <version>5.10.0</version>", "    <exclusions><exclusion><groupId>fake</groupId><artifactId>fake</artifactId></exclusion></exclusions>", "  </dependency>",
      '  <dependency><groupId>org.example</groupId><artifactId>property</artifactId><version>${lib.version}</version></dependency>',
      '  <dependency><artifactId>missing-group</artifactId><version>1.0</version><exclusions><exclusion><groupId>fake</groupId></exclusion></exclusions></dependency>',
      "</dependencies></project>",
    ].join("\n"))]);
    expect(result).toEqual([
      { ecosystem: "Maven", name: "org.junit.jupiter:junit-jupiter", version: "5.10.0", path: "pom.xml", line: 4 },
      { ecosystem: "Maven", name: "org.example:property", version: null, path: "pom.xml", line: 10 },
    ]);
  });

  it("accepts namespaced Maven tags", () => {
    expect(parseManifests([file("pom.xml", '<m:project><m:dependency><m:groupId>a.b</m:groupId><m:artifactId>c</m:artifactId><m:version>1.2.3</m:version></m:dependency></m:project>')])[0])
      .toMatchObject({ ecosystem: "Maven", name: "a.b:c", version: "1.2.3", line: 1 });
  });

  it("leaves Maven version ranges and floating release selectors unchecked", () => {
    const result = parseManifests([file("pom.xml", '<project><dependency><groupId>a</groupId><artifactId>b</artifactId><version>[1,2)</version></dependency><dependency><groupId>a</groupId><artifactId>c</artifactId><version>LATEST</version></dependency></project>')]);
    expect(result.map(({ version }) => version)).toEqual([null, null]);
  });
});

describe("manifest selection and validation", () => {
  it("skips ignored directories anywhere in a path and normalizes Windows separators", () => {
    const source = '{"dependencies":{"dep":"1.0.0"}}';
    const result = parseManifests([
      ...["node_modules", "vendor", ".venv", "target"].map((name) => file(`nested/${name}/package.json`, source)),
      file("apps\\valid\\package.json", source), file("./apps/also/package.json", source),
      file("../package.json", source),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.path).toBe("apps/also/package.json");
  });

  it("keeps duplicate names in distinct ecosystems and drops exact duplicate package versions", () => {
    const result = parseManifests([
      file("package.json", '{"dependencies":{"same":"1.2.3"},"devDependencies":{"same":"1.2.3"}}'),
      file("requirements.txt", "same==1.2.3"),
    ]);
    expect(result.map(({ ecosystem }) => ecosystem)).toEqual(["npm", "PyPI"]);
  });

  it("ignores malformed files without throwing or inventing packages", () => {
    expect(parseManifests([
      file("package.json", "{invalid"), file("composer.lock", "[]"), file("Cargo.lock", "name = no quotes"),
      file("pom.xml", "<project></project>"), file("README.md", "lodash 4.17.20"),
    ])).toEqual([]);
  });

  it("validates the shared package-only request and the 5,000-package cap", () => {
    const dependency = { ecosystem: "npm", name: "lodash", version: "4.17.20" };
    expect(DependencyCheckInput.parse({ packages: [dependency, { ...dependency, version: null }] }).packages).toHaveLength(2);
    expect(DependencyCheckInput.safeParse({ packages: [{ ...dependency, path: "package.json" }] }).success).toBe(false);
    expect(DependencyCheckInput.safeParse({ packages: [{ ...dependency, ecosystem: "unknown" }] }).success).toBe(false);
    expect(DependencyCheckInput.safeParse({ packages: [{ ...dependency, name: " " }] }).success).toBe(false);
    expect(DependencyCheckInput.safeParse({ packages: Array.from({ length: 5001 }, () => dependency) }).success).toBe(false);
  });
});
