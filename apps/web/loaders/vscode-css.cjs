/** Give VS Code's shadow-root styles CSS text, with their fonts and images kept inside the module. */
const { readFileSync } = require("node:fs");
const { dirname, extname, resolve } = require("node:path");

const MIME = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

module.exports = function vscodeCss(source) {
  const css = String(source).replace(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi,
    (original, doubleQuoted, singleQuoted, bare) => {
      const request = doubleQuoted ?? singleQuoted ?? bare;
      if (!request || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(request)) return original;
      const file = request.split(/[?#]/, 1)[0];
      const asset = resolve(dirname(this.resourcePath), decodeURIComponent(file));
      const mime = MIME[extname(asset).toLowerCase()];
      if (!mime) throw new Error("Unsupported VS Code CSS asset: " + request);
      this.addDependency(asset);
      const fragmentAt = request.indexOf("#");
      const fragment = fragmentAt === -1 ? "" : request.slice(fragmentAt);
      return 'url("data:' + mime + ";base64," + readFileSync(asset).toString("base64") + fragment + '")';
    },
  );
  return "export default " + JSON.stringify(css) + ";\n";
};
