/** Sign raw webhook bytes and verify them without timing leaks or accepting old requests. */
import { createHmac, timingSafeEqual } from "node:crypto";

export function sign(secret: string, timestamp: number | string, body: string | Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex")}`;
}

export function verify(
  secret: string, timestamp: number | string, body: string | Buffer, signature: string,
  toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const text = String(timestamp);
  const at = Number(text);
  if (!/^(0|[1-9]\d*)$/.test(text) || !Number.isSafeInteger(at) ||
      !Number.isFinite(toleranceSeconds) || toleranceSeconds < 0 ||
      !Number.isFinite(nowSeconds) || Math.abs(nowSeconds - at) > toleranceSeconds) return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signature);
  if (!match) return false;
  const expected = Buffer.from(sign(secret, text, body).slice(7), "hex");
  const actual = Buffer.from(match[1]!, "hex");
  return timingSafeEqual(expected, actual);
}
