import { TextDecoder } from "node:util";

/** Content types that are text whatever their bytes look like. */
const TEXT_TYPE = /^(text\/|application\/(json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|ya?ml|x-ya?ml|x-ndjson|x-sh)\b|[a-z]+\/[^;]*\+(json|xml)\b)/i;
/** Content types that are never shown as text. */
const BINARY_TYPE = /^(image|audio|video|font)\/|^application\/(octet-stream|pdf|zip|gzip|x-tar|wasm|x-protobuf|protobuf|vnd\.ms-|msword)/i;

function decoderFor(contentType: string): TextDecoder {
  const charset = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8");
  } catch {
    return new TextDecoder("utf-8");
  }
}

/**
 * The body as text when it is text (by content type, or because the bytes
 * are valid UTF-8 without NULs), otherwise base64 for the browser to show
 * as binary or render as an image.
 */
export function encodeBody(bytes: Buffer, contentType = ""): { body: string; bodyEncoding: "text" | "base64" } {
  if (bytes.length === 0) return { body: "", bodyEncoding: "text" };
  if (TEXT_TYPE.test(contentType)) return { body: decoderFor(contentType).decode(bytes), bodyEncoding: "text" };
  if (!BINARY_TYPE.test(contentType)) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!text.includes("\0")) return { body: text, bodyEncoding: "text" };
    } catch {
      // Not UTF-8: binary.
    }
  }
  return { body: bytes.toString("base64"), bodyEncoding: "base64" };
}
