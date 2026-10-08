import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { exportSvg, frameHtml, shapeCss, type ExportContext } from "./export";
import { defaultsFor, type Shape, type ShapeProps } from "./shape";

const shape = (id: string, props: Partial<ShapeProps> & Pick<ShapeProps, "type">): Shape => ({
  ...defaultsFor(props.type, "design"),
  ...props,
  id,
});

function context(shapes: Shape[]): ExportContext {
  return {
    shapes: new Map(shapes.map((s) => [s.id, s])),
    // Stands in for reading the theme: tokens become a recognisable string.
    resolve: (color) => color.replace(/^var\(--([\w-]+)\)$/, "rgb($1)"),
    measure: (text, font) => text.length * font.size * 0.5,
    fonts: { sans: "Mona Sans, sans-serif", note: "Monaspace Radon, monospace" },
  };
}

describe("export", () => {
  const frame = shape("f", { type: "frame", x: 100, y: 100, w: 200, h: 100, name: "Login screen", fill: "var(--background)" });
  const rect = shape("r", { type: "rect", x: 120, y: 110, w: 50, h: 20, parentId: "f", z: "a0", fill: "var(--p-2)", radius: 4, name: "Button" });
  const label = shape("t", { type: "text", x: 130, y: 112, w: 40, h: 21, parentId: "f", z: "a1", text: "Sign <in>", name: "Label" });
  const ctx = context([frame, rect, label]);

  it("exports a frame as SVG cropped to it, children clipped inside", () => {
    const out = exportSvg(["f"], ctx)!;
    assert.equal(out.width, 200);
    assert.equal(out.height, 100);
    assert.match(out.svg, /viewBox="100 100 200 100"/);
    assert.match(out.svg, /<clipPath id="clip-0">/);
    assert.match(out.svg, /fill="rgb\(p-2\)"/);
    assert.match(out.svg, /Sign &lt;in&gt;/);
    // The rectangle is drawn before the text (stacking order).
    assert.ok(out.svg.indexOf("<rect x=\"120\"") < out.svg.indexOf("<text"));
  });

  it("returns null for nothing", () => {
    assert.equal(exportSvg([], ctx), null);
  });

  it("copies CSS with the token it came from", () => {
    const css = shapeCss(rect, ctx);
    assert.match(css, /width: 50px;/);
    assert.match(css, /background: rgb\(p-2\); \/\* --p-2 \*\//);
    assert.match(css, /border-radius: 4px;/);
  });

  it("copies a frame as positioned HTML and CSS", () => {
    const html = frameHtml("f", ctx)!;
    assert.match(html, /<div class="login-screen">/);
    assert.match(html, /\.button \{[^}]*left: 20px;[^}]*top: 10px;/);
    assert.match(html, /<p class="label">Sign &lt;in&gt;<\/p>/);
    assert.equal(frameHtml("r", ctx), null);
  });
});
