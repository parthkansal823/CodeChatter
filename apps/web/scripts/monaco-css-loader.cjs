// The Monaco VS Code packages (@codingame/monaco-vscode-*) import their CSS as
// `import * as css from "./x.css"` and hand it to registerCss(), which wants the CSS as
// the module's default export (their README asks bundlers for that), then injects it
// itself. Next 16.4's Turbopack refuses a namespace import of a plain CSS file, so this
// loader (next.config.ts) turns each such file into a module that default-exports its
// text. Files the CSS points at (the codicon font, images) stay real assets: each url()
// becomes a `new URL(..., import.meta.url)`, which Turbopack emits and fills in.
module.exports = function monacoCssLoader(source) {
  const urls = [];
  const css = String(source).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote, url) => {
    // Already absolute, inline, or a fragment: left as it is.
    if (/^(?:data:|https?:|\/\/|\/|#)/i.test(url)) return match;
    urls.push(url);
    return `url("__CC_URL_${urls.length - 1}__")`;
  });
  const list = urls.map((url) => `new URL(${JSON.stringify(url)}, import.meta.url).href`).join(",\n  ");
  return `const urls = [\n  ${list}\n];\nexport default ${JSON.stringify(css)}.replace(/__CC_URL_(\\d+)__/g, (_, i) => urls[Number(i)]);\n`;
};
