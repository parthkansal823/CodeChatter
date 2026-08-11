from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

try:
  from ..core.settings import (
    ENVIRONMENT,
    SMTP_FROM,
    SMTP_HOST,
    SMTP_PASS,
    SMTP_PORT,
    SMTP_TIMEOUT_SECONDS,
    SMTP_USER,
  )
except ImportError:
  from core.settings import (
    ENVIRONMENT,
    SMTP_FROM,
    SMTP_HOST,
    SMTP_PASS,
    SMTP_PORT,
    SMTP_TIMEOUT_SECONDS,
    SMTP_USER,
  )

logger = logging.getLogger("codechatter.email")


def mask_email(email: str) -> str:
  parts = email.split("@")
  if len(parts) != 2:
    return email
  local, domain = parts
  if len(local) <= 2:
    masked = local[0] + "***"
  else:
    masked = local[0] + "***" + local[-1]
  return f"{masked}@{domain}"


ROLE_BLURBS = {
  "owner": "full control — they can manage members, approvals, and settings",
  "editor": "they can edit files and run code",
  "runner": "they can run code and use the terminal, but not edit files",
  "viewer": "they can read files and follow along",
}


def _send_html_email(to_email: str, subject: str, html_body: str, log_prefix: str) -> bool:
  """Deliver one HTML message. Returns whether it actually went out."""
  if not SMTP_HOST or not SMTP_USER:
    logger.warning("%s SMTP not configured — no email sent to %s", log_prefix, mask_email(to_email))
    return False

  msg = MIMEMultipart("alternative")
  msg["Subject"] = subject
  msg["From"] = SMTP_FROM
  msg["To"] = to_email
  msg.attach(MIMEText(html_body, "html"))

  try:
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS) as smtp:
      smtp.ehlo()
      smtp.starttls()
      smtp.login(SMTP_USER, SMTP_PASS)
      smtp.sendmail(SMTP_FROM, to_email, msg.as_string())
  except Exception as exc:
    logger.error("%s Failed to send to %s: %s", log_prefix, mask_email(to_email), exc)
    return False

  logger.info("%s Sent to %s", log_prefix, mask_email(to_email))
  return True


def send_room_share_email(
  to_email: str,
  inviter_name: str,
  room_name: str,
  room_url: str,
  access_role: str,
) -> bool:
  """Tell someone a workspace was shared with them, and with what role."""
  role_label = access_role.capitalize()
  role_blurb = ROLE_BLURBS.get(access_role, "")

  html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>A workspace was shared with you</title>
</head>
<body style="margin:0;padding:0;background-color:#07070f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07070f;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

          <tr>
            <td align="center" style="padding-bottom:28px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#0078d4;border-radius:14px;padding:10px 14px;vertical-align:middle;">
                    <span style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">&#60;/&#62;</span>
                  </td>
                  <td style="padding-left:10px;vertical-align:middle;">
                    <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">CodeChatter</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#0f0f1a;border-radius:20px;border:1px solid rgba(255,255,255,0.07);overflow:hidden;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="height:4px;background:#0078d4;"></td></tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 36px 28px;">
                <tr>
                  <td style="padding-bottom:8px;">
                    <p style="margin:0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.4px;line-height:1.35;">
                      {inviter_name} shared a workspace with you
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding-bottom:28px;">
                    <p style="margin:0;font-size:15px;color:#9ca3af;line-height:1.65;">
                      You now have access to <strong style="color:#e5e7eb;">{room_name}</strong> on CodeChatter.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding-bottom:28px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(0,120,212,0.10);border:1px solid rgba(0,120,212,0.28);border-radius:14px;">
                      <tr>
                        <td style="padding:18px 20px;">
                          <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#6cb0e6;letter-spacing:1.5px;text-transform:uppercase;">Your role</p>
                          <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">{role_label}</p>
                          <p style="margin:6px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;">{role_blurb}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding-bottom:28px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:#0078d4;border-radius:8px;">
                          <a href="{room_url}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                            Open workspace
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="border-top:1px solid rgba(255,255,255,0.05);padding-top:22px;">
                    <p style="margin:0;font-size:12px;color:#4b5563;line-height:1.6;">
                      If the button does not work, paste this link into your browser:<br/>
                      <span style="color:#6b7280;word-break:break-all;">{room_url}</span>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0 0 6px;font-size:12px;color:#374151;">Made with &#9829; for developers who build together.</p>
              <p style="margin:0;font-size:11px;color:#1f2937;">© 2026 CodeChatter &nbsp;·&nbsp; All rights reserved</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

  return _send_html_email(
    to_email,
    f"{inviter_name} shared “{room_name}” with you",
    html_body,
    "[Share]",
  )


def send_otp_email(to_email: str, otp: str, action: str = "login") -> None:
  if not SMTP_HOST or not SMTP_USER:
    # Without SMTP there is no way to deliver the code. Falling back to the
    # console keeps local development usable, but a one-time code in the log
    # is a full MFA bypass for anyone who can read logs — so never in production.
    if ENVIRONMENT == "production":
      logger.error(
        "[MFA] SMTP is not configured — cannot deliver the %s code to %s",
        action,
        mask_email(to_email),
      )
      return

    logger.warning("[MFA] SMTP not configured — dev-only OTP for %s (%s): %s", to_email, action, otp)
    return

  if action == "login":
    subject = "🔐 Your CodeChatter login code"
    headline = "Welcome back, coder."
    subline = "Your workspace is one step away. Enter your code and pick up right where you left off."
    cta_label = "Your session awaits"
  else:
    subject = "🚀 You're almost in — CodeChatter verification"
    headline = "Your coding journey starts now."
    subline = "You're seconds away from a real-time collaborative workspace. Let's get you in."
    cta_label = "Let's build something great"

  html_body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>CodeChatter Verification</title>
</head>
<body style="margin:0;padding:0;background-color:#07070f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07070f;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

          <!-- Logo row -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#7c3aed,#3b82f6);border-radius:14px;padding:10px 14px;vertical-align:middle;">
                    <span style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">&#60;/&#62;</span>
                  </td>
                  <td style="padding-left:10px;vertical-align:middle;">
                    <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">CodeChatter</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:#0f0f1a;border-radius:20px;border:1px solid rgba(255,255,255,0.07);overflow:hidden;">

              <!-- Purple gradient top bar -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="height:4px;background:linear-gradient(90deg,#7c3aed,#3b82f6,#06b6d4);"></td>
                </tr>
              </table>

              <!-- Card body -->
              <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 36px 28px;">

                <!-- Headline -->
                <tr>
                  <td style="padding-bottom:8px;">
                    <p style="margin:0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.4px;line-height:1.3;">{headline}</p>
                  </td>
                </tr>

                <!-- Subline -->
                <tr>
                  <td style="padding-bottom:32px;">
                    <p style="margin:0;font-size:15px;color:#9ca3af;line-height:1.65;">{subline}</p>
                  </td>
                </tr>

                <!-- OTP label -->
                <tr>
                  <td style="padding-bottom:10px;">
                    <p style="margin:0;font-size:11px;font-weight:600;color:#6d28d9;letter-spacing:1.5px;text-transform:uppercase;">Verification code</p>
                  </td>
                </tr>

                <!-- OTP code block -->
                <tr>
                  <td style="padding-bottom:32px;">
                    <table cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,rgba(124,58,237,0.12),rgba(59,130,246,0.08));border:1px solid rgba(124,58,237,0.25);border-radius:14px;width:100%;">
                      <tr>
                        <td align="center" style="padding:22px 16px;">
                          <span style="font-size:44px;font-weight:800;letter-spacing:18px;color:#ffffff;font-variant-numeric:tabular-nums;">{otp}</span>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="padding-bottom:16px;">
                          <span style="font-size:12px;color:#6b7280;">⏱&nbsp; Expires in <strong style="color:#9ca3af;">5 minutes</strong></span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Feature highlights (only for signup) -->
                {"" if action == "login" else '''
                <!-- What awaits you -->
                <tr>
                  <td style="padding-bottom:28px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:12px;padding:4px 0;">
                      <tr>
                        <td style="padding:12px 18px;border-bottom:1px solid rgba(255,255,255,0.04);">
                          <span style="font-size:13px;color:#c4b5fd;">&#9889;&nbsp;</span>
                          <span style="font-size:13px;color:#d1d5db;">Real-time collaborative code editor</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:12px 18px;border-bottom:1px solid rgba(255,255,255,0.04);">
                          <span style="font-size:13px;color:#93c5fd;">&#127760;&nbsp;</span>
                          <span style="font-size:13px;color:#d1d5db;">Live video calls &amp; screen sharing</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:12px 18px;">
                          <span style="font-size:13px;color:#6ee7b7;">&#129302;&nbsp;</span>
                          <span style="font-size:13px;color:#d1d5db;">AI assistant powered by Gemini</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                '''}

                <!-- CTA label -->
                <tr>
                  <td style="padding-bottom:28px;">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.2);border-radius:8px;padding:8px 14px;">
                          <span style="font-size:12px;color:#a78bfa;">&#10003;&nbsp; {cta_label}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Security notice -->
                <tr>
                  <td style="border-top:1px solid rgba(255,255,255,0.05);padding-top:22px;">
                    <p style="margin:0;font-size:12px;color:#4b5563;line-height:1.6;">
                      🔒 &nbsp;This code was requested for your CodeChatter account. If you didn't ask for it, no action is needed — your account is safe.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:28px;">
              <p style="margin:0 0 6px;font-size:12px;color:#374151;">Made with &#9829; for developers who build together.</p>
              <p style="margin:0;font-size:11px;color:#1f2937;">© 2026 CodeChatter &nbsp;·&nbsp; All rights reserved</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>"""

  msg = MIMEMultipart("alternative")
  msg["Subject"] = subject
  msg["From"] = SMTP_FROM
  msg["To"] = to_email
  msg.attach(MIMEText(html_body, "html"))

  try:
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS) as smtp:
      smtp.ehlo()
      smtp.starttls()
      smtp.login(SMTP_USER, SMTP_PASS)
      smtp.sendmail(SMTP_FROM, to_email, msg.as_string())
    logger.info(f"[MFA] OTP email sent successfully to {to_email}")
  except Exception as exc:
    logger.error(
      f"[MFA] Failed to send OTP email to {to_email} within {SMTP_TIMEOUT_SECONDS} seconds: {exc}"
    )
