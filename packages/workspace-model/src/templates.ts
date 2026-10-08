/**
 * Starter files for each room template. Written for v2 (informed by v1's
 * templates in server/database.py), kept small: enough to run and to show
 * what the template is for, nothing to delete first.
 */
export type TemplateId = "blank" | "python" | "node" | "web" | "dsa" | "interview" | "tour";
/** A starter file; `tests` pre-fills the Tests tab for it (input and expected output). */
export type TemplateFile = { path: string; content: string; tests?: Array<{ input: string; expected: string }> };

const lines = (...rows: string[]) => rows.join("\n") + "\n";

export const TEMPLATE_FILES: Record<TemplateId, TemplateFile[]> = {
  blank: [
    {
      path: "README.md",
      content: lines("# New room", "", "Add files from the explorer, or ask the agent to scaffold something."),
    },
  ],

  python: [
    {
      path: "main.py",
      content: lines(
        "from dataclasses import dataclass",
        "",
        "",
        "@dataclass",
        "class Item:",
        "    name: str",
        "    price: float",
        "    qty: int = 1",
        "",
        "",
        "def total(items: list[Item]) -> float:",
        '    """Sum of price × quantity, rounded to cents."""',
        "    return round(sum(i.price * i.qty for i in items), 2)",
        "",
        "",
        'if __name__ == "__main__":',
        '    cart = [Item("Notebook", 4.5, 2), Item("Pen", 1.25, 4)]',
        '    print(f"Total: ${total(cart):.2f}")',
      ),
    },
    {
      path: "test_main.py",
      content: lines(
        "from main import Item, total",
        "",
        "",
        "def test_total_multiplies_quantity():",
        '    assert total([Item("A", 2.0, 3)]) == 6.0',
        "",
        "",
        "def test_empty_cart_is_zero():",
        "    assert total([]) == 0",
      ),
    },
    {
      path: "README.md",
      content: lines("# Python", "", "Press Run to execute `main.py`. Run the tests in the terminal with `pytest`."),
    },
  ],

  node: [
    {
      path: "src/server.js",
      content: lines(
        "// A small JSON API on Node's built-in http module: no install needed, so",
        "// it runs straight away in the room's sandbox (which has no internet).",
        'import { createServer } from "node:http";',
        "",
        "const notes = [];",
        "",
        "const send = (res, status, body) => {",
        '  res.writeHead(status, { "content-type": "application/json" });',
        "  res.end(JSON.stringify(body));",
        "};",
        "",
        "const server = createServer(async (req, res) => {",
        '  if (req.url === "/api/notes" && req.method === "GET") return send(res, 200, notes);',
        '  if (req.url === "/api/notes" && req.method === "POST") {',
        "    let raw = \"\";",
        "    for await (const chunk of req) raw += chunk;",
        '    const text = String(JSON.parse(raw || "{}").text ?? "").trim();',
        '    if (!text) return send(res, 400, { error: "text is required" });',
        "    const note = { id: notes.length + 1, text, createdAt: new Date().toISOString() };",
        "    notes.push(note);",
        "    return send(res, 201, note);",
        "  }",
        '  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });',
        '  res.end(`<h1>Notes API</h1><p>${notes.length} notes. Try <a href="/api/notes">/api/notes</a>.</p>`);',
        "});",
        "",
        "const port = Number(process.env.PORT ?? 3000);",
        "server.listen(port, () => console.log(`Listening on http://localhost:${port}`));",
      ),
    },
    {
      path: "package.json",
      content: lines(
        "{",
        '  "name": "notes-api",',
        '  "private": true,',
        '  "type": "module",',
        '  "scripts": { "start": "node src/server.js", "dev": "node --watch src/server.js" }',
        "}",
      ),
    },
    {
      path: "README.md",
      content: lines(
        "# Node.js API",
        "",
        "Open `src/server.js` and press **Run**. The server starts in the room's sandbox;",
        "open the **Ports** tab and choose **Open preview** on port 3000.",
        "",
        "Or in a terminal: `npm run dev` (restarts on every save), then:",
        "",
        "```",
        "curl -X POST localhost:3000/api/notes -H 'content-type: application/json' -d '{\"text\":\"first\"}'",
        "```",
      ),
    },
  ],

  web: [
    {
      path: "index.html",
      content: lines(
        "<!doctype html>",
        '<html lang="en">',
        "  <head>",
        '    <meta charset="utf-8" />',
        '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
        "    <title>Counter</title>",
        '    <link rel="stylesheet" href="styles.css" />',
        "  </head>",
        "  <body>",
        "    <main>",
        "      <h1>Counter</h1>",
        '      <output id="count">0</output>',
        '      <button id="add" type="button">Add one</button>',
        "    </main>",
        '    <script src="app.js"></script>',
        "  </body>",
        "</html>",
      ),
    },
    {
      path: "styles.css",
      content: lines(
        ":root { color-scheme: light dark; font-family: system-ui, sans-serif; }",
        "main { display: grid; gap: 1rem; place-items: center; min-height: 100vh; }",
        "output { font-size: 4rem; font-weight: 700; }",
        "button { font: inherit; padding: 0.6rem 1.2rem; border-radius: 0.5rem; cursor: pointer; }",
      ),
    },
    {
      path: "app.js",
      content: lines(
        'const output = document.getElementById("count");',
        "let count = 0;",
        "",
        'document.getElementById("add").addEventListener("click", () => {',
        "  count += 1;",
        "  output.textContent = String(count);",
        "});",
      ),
    },
  ],

  dsa: [
    {
      path: "problem.md",
      content: lines(
        "# Two Sum",
        "",
        "Given an array of integers `nums` and an integer `target`, return the indices of the two numbers that add up to `target`.",
        "",
        "Each input has exactly one solution, and you may not use the same element twice.",
        "",
        "```",
        "nums = [2, 7, 11, 15], target = 9  →  [0, 1]",
        "```",
      ),
    },
    {
      path: "solution.py",
      content: lines(
        "def two_sum(nums: list[int], target: int) -> list[int]:",
        "    seen: dict[int, int] = {}",
        "    for i, n in enumerate(nums):",
        "        if target - n in seen:",
        "            return [seen[target - n], i]",
        "        seen[n] = i",
        "    return []",
      ),
    },
    {
      path: "test_solution.py",
      content: lines(
        "from solution import two_sum",
        "",
        "",
        "def test_example():",
        "    assert two_sum([2, 7, 11, 15], 9) == [0, 1]",
        "",
        "",
        "def test_negatives():",
        "    assert two_sum([-3, 4, 3, 90], 0) == [0, 2]",
      ),
    },
  ],

  interview: [
    {
      path: "brief.md",
      content: lines(
        "# Interview",
        "",
        "Implement a rate limiter that allows `limit` requests per `window` seconds per user.",
        "",
        "Talk through your approach first. You can run your code at any time.",
      ),
    },
    {
      path: "solution.py",
      content: lines(
        "import time",
        "",
        "",
        "class RateLimiter:",
        "    def __init__(self, limit: int, window: float):",
        "        self.limit = limit",
        "        self.window = window",
        "",
        "    def allow(self, user_id: str, now: float | None = None) -> bool:",
        "        now = time.monotonic() if now is None else now",
        "        raise NotImplementedError",
      ),
    },
  ],

  // The guided tour: what "Try the demo" opens. Every file shows one feature.
  tour: [
    {
      path: "README.md",
      content: lines(
        "# Welcome to CodeChatter",
        "",
        "This room is yours to explore. Everything is live: press **Share** and invite someone, and you'll see each other type.",
        "",
        "**Try these, in order:**",
        "",
        "1. Open `hello.py` and press **Run** (or Ctrl+Enter). Type your name when it asks.",
        "2. Open `two_sum.py`, then the **Tests** tab under the editor, and press **Run tests**. Three cases, judged in a private sandbox.",
        "3. Do the same with `binary_search.cpp`: compiled once, then every test with a time limit.",
        "4. Open `web/index.html` and press **Preview**. Edit `web/style.css` and watch it change.",
        "5. Open a **terminal** (Ctrl+`) and try `python3 --version`, `node --version` or `g++ --version`.",
        "6. Open `server.js`, press **Run**, then the **Ports** tab and **Open preview**: a real server in your sandbox.",
        "7. Look at the tools in the left bar: AI, Docs, API, Design and Whiteboard.",
        "",
        "Nothing you run can reach the internet or anyone else's room. Guest rooms are deleted after a day.",
      ),
    },
    {
      path: "hello.py",
      content: lines(
        'name = input("What should I call you? ")',
        'print(f"Hi {name}, this ran in a private sandbox just for this room.")',
      ),
    },
    {
      path: "two_sum.py",
      content: lines(
        "# Two Sum: print the indices of the two numbers that add up to the target.",
        "# Input: n, then n numbers, then the target.",
        "",
        "def two_sum(nums: list[int], target: int) -> tuple[int, int]:",
        "    seen: dict[int, int] = {}",
        "    for i, x in enumerate(nums):",
        "        if target - x in seen:",
        "            return seen[target - x], i",
        "        seen[x] = i",
        "    return -1, -1",
        "",
        "",
        'if __name__ == "__main__":',
        "    n = int(input())",
        "    nums = list(map(int, input().split()))",
        "    target = int(input())",
        "    print(*two_sum(nums, target))",
      ),
      tests: [
        { input: "4\n2 7 11 15\n9\n", expected: "0 1\n" },
        { input: "3\n3 2 4\n6\n", expected: "1 2\n" },
        { input: "2\n3 3\n6\n", expected: "0 1\n" },
      ],
    },
    {
      path: "binary_search.cpp",
      content: lines(
        "// Binary search: print the index of x in a sorted array, or -1.",
        "#include <bits/stdc++.h>",
        "using namespace std;",
        "",
        "int main() {",
        "    ios::sync_with_stdio(false);",
        "    cin.tie(nullptr);",
        "    int n, x;",
        "    cin >> n;",
        "    vector<int> a(n);",
        "    for (auto &v : a) cin >> v;",
        "    cin >> x;",
        "    int lo = 0, hi = n - 1, answer = -1;",
        "    while (lo <= hi) {",
        "        int mid = lo + (hi - lo) / 2;",
        "        if (a[mid] == x) { answer = mid; break; }",
        "        if (a[mid] < x) lo = mid + 1; else hi = mid - 1;",
        "    }",
        "    cout << answer << endl;",
        "}",
      ),
      tests: [
        { input: "5\n1 3 5 7 9\n7\n", expected: "3\n" },
        { input: "5\n1 3 5 7 9\n4\n", expected: "-1\n" },
      ],
    },
    {
      path: "web/index.html",
      content: lines(
        "<!doctype html>",
        '<html lang="en">',
        "  <head>",
        '    <meta charset="utf-8" />',
        "    <title>Counter</title>",
        '    <link rel="stylesheet" href="style.css" />',
        "  </head>",
        "  <body>",
        "    <main>",
        "      <h1>Made together</h1>",
        '      <p>Clicks: <strong id="count">0</strong></p>',
        '      <button id="add">Add one</button>',
        "    </main>",
        '    <script src="app.js"></script>',
        "  </body>",
        "</html>",
      ),
    },
    {
      path: "web/style.css",
      content: lines(
        "body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: black; color: white; }",
        "main { text-align: center; }",
        "h1 { font-size: 2.5rem; margin: 0 0 1rem; }",
        "button { font: inherit; padding: 0.6rem 1.2rem; border: 0; border-radius: 8px; background: orangered; color: black; cursor: pointer; }",
      ),
    },
    {
      path: "web/app.js",
      content: lines(
        'const count = document.getElementById("count");',
        'document.getElementById("add").addEventListener("click", () => {',
        "  count.textContent = String(Number(count.textContent) + 1);",
        '  console.log("clicked", count.textContent);',
        "});",
      ),
    },
    {
      path: "server.js",
      content: lines(
        "// A tiny JSON API on Node's built-in http module (no install needed).",
        'import { createServer } from "node:http";',
        "",
        "let visits = 0;",
        "createServer((req, res) => {",
        "  visits += 1;",
        '  res.writeHead(200, { "content-type": "application/json" });',
        '  res.end(JSON.stringify({ message: "Hello from the sandbox", path: req.url, visits }));',
        '}).listen(3000, () => console.log("Listening on port 3000. Open the Ports tab."));',
      ),
    },
  ],
};

export function templateFiles(id: string | null | undefined): TemplateFile[] {
  return TEMPLATE_FILES[(id ?? "blank") as TemplateId] ?? TEMPLATE_FILES.blank;
}
