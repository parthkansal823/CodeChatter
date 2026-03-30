from __future__ import annotations

import logging
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

logger = logging.getLogger("codechatter.email")

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM = os.getenv("SMTP_FROM", "") or SMTP_USER


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


def send_otp_email(to_email: str, otp: str, action: str = "login") -> None:
  action_label = "sign in" if action == "login" else "create your account"

  logger.info(f"[MFA] OTP for {to_email} ({action}): {otp}")

  if not SMTP_HOST or not SMTP_USER:
    logger.warning("[MFA] SMTP not configured — OTP printed to console only")
    return

  subject = "Your CodeChatter verification code"
  html_body = f"""
  <html>
  <body style="font-family:sans-serif;background:#0d0d16;color:#e0e0e0;padding:32px;margin:0;">
    <div style="max-width:480px;margin:0 auto;background:#13131f;border-radius:12px;padding:32px;border:1px solid rgba(255,255,255,0.08);">
      <h2 style="color:#a78bfa;margin-top:0;font-size:22px;">CodeChatter</h2>
      <p style="margin:0 0 20px;line-height:1.6;">
        Use the code below to {action_label}. It expires in <strong>5 minutes</strong>.
      </p>
      <div style="text-align:center;margin:28px 0;">
        <span style="font-size:38px;font-weight:700;letter-spacing:14px;color:#ffffff;background:rgba(124,58,237,0.15);padding:16px 28px;border-radius:10px;border:1px solid rgba(124,58,237,0.3);display:inline-block;">
          {otp}
        </span>
      </div>
      <p style="color:#6b7280;font-size:13px;margin:0;">
        If you didn't request this code, you can safely ignore this email.
      </p>
    </div>
  </body>
  </html>
  """

  msg = MIMEMultipart("alternative")
  msg["Subject"] = subject
  msg["From"] = SMTP_FROM
  msg["To"] = to_email
  msg.attach(MIMEText(html_body, "html"))

  try:
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as smtp:
      smtp.ehlo()
      smtp.starttls()
      smtp.login(SMTP_USER, SMTP_PASS)
      smtp.sendmail(SMTP_FROM, to_email, msg.as_string())
    logger.info(f"[MFA] OTP email sent successfully to {to_email}")
  except Exception as exc:
    logger.error(f"[MFA] Failed to send OTP email to {to_email}: {exc}")
