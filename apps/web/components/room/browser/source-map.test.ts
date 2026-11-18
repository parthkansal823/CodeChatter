import assert from "node:assert/strict";
import { test } from "node:test";

import { codePlaceOf, findElementInFiles, normalSourcePath, roomFileOf, type InspectedElement } from "./source-map";

const files = [
  { id: "1", path: "web/src/App.tsx", text: 'export function App() {\n  return (\n    <main>\n      <h1 className="title big">Hello there</h1>\n      <button id="buy">Buy now</button>\n    </main>\n  );\n}\n' },
  { id: "2", path: "web/src/components/Card.vue", text: "<template>\n  <div class=\"card\">{{ name }}</div>\n</template>\n" },
  { id: "3", path: "site/index.html", text: "<!doctype html>\n<html>\n<body>\n  <p class=\"lead\">Welcome to the shop</p>\n</body>\n</html>\n" },
  { id: "4", path: "other/src/App.tsx", text: "" },
  { id: "5", path: "README.md", text: "Hello there" },
];

test("a page's paths are made comparable", () => {
  assert.equal(normalSourcePath("http://p5173-abc123.preview.localhost:8080/src/App.tsx?t=1712"), "/src/App.tsx");
  assert.equal(normalSourcePath("webpack-internal:///(app-pages-browser)/./app/page.tsx"), "app/page.tsx");
  assert.equal(normalSourcePath("/@fs/home/you/web/src/App.tsx"), "/home/you/web/src/App.tsx");
  assert.equal(normalSourcePath("./src/My%20Page.jsx"), "src/My Page.jsx");
  assert.equal(normalSourcePath("C:\\work\\web\\src\\App.tsx"), "C:/work/web/src/App.tsx");
});

test("a page's path is the room file it ends with, or that ends with it", () => {
  assert.equal(roomFileOf("/home/sandbox/workspace/web/src/App.tsx", files)?.id, "1");
  assert.equal(roomFileOf("src/components/Card.vue", files)?.id, "2");
  // A module's address from Vite: /src/App.tsx is in two places; the one whose whole path matches more wins, then the shorter.
  assert.equal(roomFileOf("http://p5173-abc123.preview.localhost:8080/web/src/App.tsx?t=1", files)?.id, "1");
  assert.equal(roomFileOf("/somewhere/else/Missing.tsx", files), null);
  assert.equal(roomFileOf("", files), null);
});

test("an element the page says nothing about is found by its text, its id, then a class", () => {
  assert.deepEqual(findElementInFiles({ id: null, classes: [], text: "Hello  there" }, files), { fileId: "1", path: "web/src/App.tsx", line: 4, column: 33, by: "text" });
  assert.deepEqual(findElementInFiles({ id: "buy", classes: [], text: "" }, files), { fileId: "1", path: "web/src/App.tsx", line: 5, column: 15, by: "id" });
  assert.equal(findElementInFiles({ id: null, classes: ["lead"], text: "" }, files)?.path, "site/index.html");
  assert.equal(findElementInFiles({ id: null, classes: ["card"], text: "x" }, files)?.path, "web/src/components/Card.vue");
  // README.md isn't markup, so its "Hello there" isn't the element.
  assert.equal(findElementInFiles({ id: null, classes: [], text: "Hello there" }, files.slice(4)), null);
  assert.equal(findElementInFiles({ id: null, classes: ["nowhere"], text: "No such words here" }, files), null);
});

test("the page's source comes first, then what the element shows", () => {
  const element = (source: InspectedElement["source"], text = "Buy now"): InspectedElement => ({ tag: "button", id: null, classes: [], text, selector: "button", size: { width: 10, height: 10 }, styles: {}, attributes: [], page: "/", source });
  assert.deepEqual(codePlaceOf(element({ framework: "react", file: "/workspace/web/src/App.tsx", line: 5, column: 7 }), files), { fileId: "1", path: "web/src/App.tsx", line: 5, column: 7, by: "source" });
  // Vue gives the file without a line.
  assert.deepEqual(codePlaceOf(element({ framework: "vue", file: "src/components/Card.vue" }), files), { fileId: "2", path: "web/src/components/Card.vue", line: 1, column: 1, by: "source" });
  // A source that isn't in the room: what it shows.
  assert.equal(codePlaceOf(element({ framework: "react", file: "/node_modules/lib/Button.js", line: 3 }), files)?.by, "text");
  assert.equal(codePlaceOf(element(null, "Nothing like it"), files), null);
});
