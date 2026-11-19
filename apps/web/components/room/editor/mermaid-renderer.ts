/** Share one strict, themed Mermaid renderer across standalone files and Markdown blocks. */
import { cssVar } from "@/lib/css-color";

import { assertNoMermaidHtml } from "./mermaid-problem";

export type Drawing = { svg: string; type: string };

let renderId = 0;
let renderQueue: Promise<void> = Promise.resolve();

export async function renderDiagram(text: string, dark: boolean, current: () => boolean) {
  if (text.length > 50_000) throw new Error("Maximum diagram size exceeded.");
  assertNoMermaidHtml(text);
  const { default: mermaid } = await import("mermaid");
  // Mermaid's configuration is shared. Keep initialization and rendering together across open panes.
  const result = renderQueue.then(async () => {
    if (!current()) return null;
    const background = cssVar("--background");
    const foreground = cssVar("--foreground");
    const card = cssVar("--card");
    const muted = cssVar("--muted");
    const border = cssVar("--border");
    const brand = cssVar("--brand");
    const brandForeground = cssVar("--brand-foreground");
    // Several diagram types have their own palettes, including inverse colours that would turn orange cyan.
    const palette = [card, muted, brand];
    const chartColors: Record<string, string> = {};
    for (let index = 0; index < 12; index++) {
      const fill = palette[index % palette.length] ?? card;
      const ink = index % palette.length === 2 ? brandForeground : foreground;
      Object.assign(chartColors, {
        [`pie${index + 1}`]: fill, [`fillType${index}`]: fill,
        [`cScale${index}`]: fill, [`cScaleInv${index}`]: fill,
        [`cScalePeer${index}`]: fill, [`cScaleLabel${index}`]: ink,
      });
      if (index < 8) Object.assign(chartColors, { [`git${index}`]: fill, [`gitInv${index}`]: fill, [`gitBranchLabel${index}`]: ink });
    }
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      maxEdges: 500,
      theme: "base",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      // Source directives cannot turn HTML labels or the safety limits back on or off.
      secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering", "htmlLabels", "flowchart"],
      themeVariables: {
        darkMode: dark, background, textColor: foreground, lineColor: foreground,
        primaryColor: card, primaryTextColor: foreground, primaryBorderColor: border,
        secondaryColor: muted, secondaryTextColor: foreground, secondaryBorderColor: border,
        tertiaryColor: brand, tertiaryTextColor: brandForeground, tertiaryBorderColor: brand,
        mainBkg: card, nodeBorder: border, nodeTextColor: foreground,
        clusterBkg: muted, clusterBorder: border, edgeLabelBackground: background,
        actorBkg: card, actorBorder: border, actorTextColor: foreground, actorLineColor: foreground,
        signalColor: foreground, signalTextColor: foreground,
        labelBoxBkgColor: muted, labelBoxBorderColor: border, labelTextColor: foreground,
        noteBkgColor: muted, noteBorderColor: border, noteTextColor: foreground,
        activationBkgColor: brand, activationBorderColor: brand, fontSize: "13px",
        critBkgColor: muted, critBorderColor: brand, todayLineColor: brand,
        vertLineColor: border, taskTextClickableColor: foreground,
        altSectionBkgColor: muted, excludeBkgColor: muted, gridColor: border,
        doneTaskBkgColor: muted, doneTaskBorderColor: border,
        taskBkgColor: card, taskBorderColor: border, titleColor: foreground,
        taskTextColor: foreground, taskTextDarkColor: foreground, taskTextOutsideColor: foreground,
        pieStrokeColor: border, pieOuterStrokeColor: border, branchLabelColor: foreground,
        attributeBackgroundColorOdd: card, attributeBackgroundColorEven: muted,
        archEdgeColor: foreground, archEdgeArrowColor: foreground, archGroupBorderColor: border,
        wardleyEvolutionColor: foreground,
        emProcessorFill: card, emProcessorStroke: border, emReadModelFill: muted, emReadModelStroke: border,
        emCommandFill: card, emCommandStroke: border, emEventFill: brand, emEventStroke: brand,
        cynefin: { cliffColor: border, complexBg: muted, complicatedBg: card, chaoticBg: muted, clearBg: card, confusionBg: brand },
        xyChart: { plotColorPalette: palette.join(",") },
        ...chartColors,
      },
    });
    // Layout needs a connected, measurable element. Remove it even when Mermaid rejects the source.
    const container = document.createElement("div");
    Object.assign(container.style, { position: "fixed", left: "-100000px", top: "0", visibility: "hidden" });
    container.setAttribute("aria-hidden", "true");
    document.body.appendChild(container);
    try {
      return await mermaid.render(`room-mermaid-${++renderId}`, text, container);
    } finally {
      container.remove();
    }
  });
  renderQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function imageSizedSvg(svg: string): string {
  // Mermaid often writes width="100%". Give the image intrinsic dimensions for Actual size.
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const dimensions = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = dimensions?.[2];
  const height = dimensions?.[3];
  if (width && height && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    root.setAttribute("width", String(width));
    root.setAttribute("height", String(height));
  }
  return new XMLSerializer().serializeToString(root);
}

