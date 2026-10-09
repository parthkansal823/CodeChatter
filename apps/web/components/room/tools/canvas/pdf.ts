/**
 * PDF export: one picture per page, each JPEG drawn to fill its page. A file
 * like this is a handful of objects and an index of where they start, so no
 * library is needed.
 */
export type PdfPage = {
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  /** Page size in points (1 CSS px = 0.75 pt). */
  width: number;
  height: number;
  /** Where the picture goes, in points from the bottom left; the whole page when left out. */
  box?: { x: number; y: number; w: number; h: number };
};

const num = (n: number) => String(Math.round(n * 100) / 100);

export function imagesToPdf(pages: PdfPage[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, ...parts: Array<string | Uint8Array>) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    parts.forEach(push);
    push("\nendobj\n");
  };

  // 1 is the catalog and 2 the page tree; each page then takes three: page, image, drawing.
  const pageId = (index: number) => 3 + index * 3;
  push("%PDF-1.4\n%âãÏÓ\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  pages.forEach((page, index) => {
    const id = pageId(index);
    const [w, h] = [num(page.width), num(page.height)];
    const box = page.box ?? { x: 0, y: 0, w: page.width, h: page.height };
    const draw = `q ${num(box.w)} 0 0 ${num(box.h)} ${num(box.x)} ${num(box.y)} cm /Im0 Do Q`;
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`);
    object(
      id + 1,
      `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      page.jpeg,
      "\nendstream",
    );
    object(id + 2, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  });

  const count = 3 + pages.length * 3;
  const xref = length;
  // Each index entry is exactly 20 bytes: a 10-digit offset, a 5-digit generation, "n", and " \n".
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
