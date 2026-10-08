/**
 * Sends one real email through the configured SMTP server, so a new mail
 * setup can be checked in seconds:
 *
 *   pnpm --filter @codechatter/api mail:test you@example.com
 */
import { verifyEmail } from "@codechatter/emails";
import nodemailer from "nodemailer";

import { loadEnv } from "../config/env.js";

const to = process.argv[2];
if (!to) {
  console.error("Usage: pnpm --filter @codechatter/api mail:test you@example.com");
  process.exit(1);
}

const env = loadEnv();
const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_PORT === 465,
  ...(env.SMTP_USER && { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }),
});

try {
  await transport.verify();
  console.log(`connected to ${env.SMTP_HOST}:${env.SMTP_PORT}${env.SMTP_USER ? ` as ${env.SMTP_USER}` : ""}`);
  const email = await verifyEmail({ name: "there", url: `${env.APP_URL}/dashboard` });
  const info = await transport.sendMail({ from: env.MAIL_FROM, to, ...email, subject: "CodeChatter test email" });
  console.log(`sent to ${to} (message id ${info.messageId})`);
} catch (error) {
  const e = error as { code?: string; responseCode?: number; message: string };
  console.error(`mail failed: ${e.code ?? ""} ${e.responseCode ?? ""} ${e.message}`);
  if (e.responseCode === 535) console.error("The server rejected the username or password. For Gmail, use an App Password, not your normal password.");
  process.exit(1);
}
