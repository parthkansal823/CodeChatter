import type { AuthMail } from "@codechatter/auth";
import { orgInvitationEmail, resetPasswordEmail, verifyEmail, type RenderedEmail } from "@codechatter/emails";
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";

import type { Env } from "../config/env.js";
import { ENV } from "../infra/tokens.js";

@Injectable()
export class MailService implements AuthMail, OnApplicationBootstrap {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      ...(env.SMTP_USER && { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }),
    });
  }

  /**
   * Check the SMTP login at startup, without blocking it. A wrong password
   * shows up here as one clear warning instead of as silently missing
   * verification emails later.
   */
  onApplicationBootstrap() {
    this.transport.verify().then(
      () => this.logger.log(`mail ready via ${this.env.SMTP_HOST}:${this.env.SMTP_PORT}`),
      (error: { responseCode?: number; message: string }) =>
        this.logger.warn(
          `mail NOT ready via ${this.env.SMTP_HOST}:${this.env.SMTP_PORT}: ${error.message}` +
            (error.responseCode === 535 ? " (for Gmail, use an App Password)" : ""),
        ),
    );
  }

  async send(to: string, email: RenderedEmail): Promise<void> {
    await this.transport.sendMail({ from: this.env.MAIL_FROM, to, ...email });
    this.logger.log(`sent "${email.subject}"`);
  }

  async sendVerificationEmail(to: { email: string; name: string }, url: string) {
    await this.send(to.email, await verifyEmail({ name: to.name, url }));
  }

  async sendPasswordResetEmail(to: { email: string; name: string }, url: string) {
    await this.send(to.email, await resetPasswordEmail({ name: to.name, url }));
  }

  async sendOrgInvitationEmail(input: { email: string; inviterName: string; orgName: string; url: string }) {
    await this.send(input.email, await orgInvitationEmail(input));
  }
}
