import { describe, expect, it } from "vitest";

import { isImportableUrl, parseAtCoder, parseCodeforces, parseCses, preText } from "./samples.js";

describe("sample import", () => {
  it("only fetches known problem sites over https", () => {
    expect(isImportableUrl("https://codeforces.com/contest/1/problem/A")?.hostname).toBe("codeforces.com");
    expect(isImportableUrl("http://codeforces.com/contest/1/problem/A")).toBeNull();
    expect(isImportableUrl("https://codeforces.com.evil.example/x")).toBeNull();
    expect(isImportableUrl("https://169.254.169.254/latest")).toBeNull();
    expect(isImportableUrl("not a url")).toBeNull();
  });

  it("turns <pre> markup into plain text lines", () => {
    expect(preText("3<br />1 2 &amp; 3<br/>")).toBe("3\n1 2 & 3\n");
    expect(preText('<div class="test-example-line">6 4</div><div class="test-example-line">1 2</div>')).toBe("6 4\n1 2\n");
  });

  it("reads Codeforces samples, including line-by-line markup", () => {
    const html = `<title>Problem - 4A - Codeforces</title>
      <div class="sample-test">
        <div class="input"><div class="title">Input</div><pre><div class="test-example-line">8</div></pre></div>
        <div class="output"><div class="title">Output</div><pre>YES</pre></div>
        <div class="input"><div class="title">Input</div><pre>5<br/></pre></div>
        <div class="output"><div class="title">Output</div><pre>NO<br/></pre></div>
      </div>`;
    const problem = parseCodeforces(html);
    expect(problem.title).toBe("Problem - 4A - Codeforces");
    expect(problem.samples).toEqual([
      { input: "8\n", output: "YES\n" },
      { input: "5\n", output: "NO\n" },
    ]);
  });

  it("reads AtCoder's English samples", () => {
    const html = `<span class="lang-ja"><h3>入力例 1</h3><pre>1 2</pre></span>
      <span class="lang-en"><h3>Sample Input 1</h3><pre>1 2
</pre><h3>Sample Output 1</h3><pre>3
</pre></span></div></div>`;
    expect(parseAtCoder(html).samples).toEqual([{ input: "1 2\n", output: "3\n" }]);
  });

  it("reads CSES examples", () => {
    const html = `<p>Input:</p><pre>3
1 2 3</pre><p>Output:</p><pre>6</pre>`;
    expect(parseCses(html).samples).toEqual([{ input: "3\n1 2 3\n", output: "6\n" }]);
  });
});
