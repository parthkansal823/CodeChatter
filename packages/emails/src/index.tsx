import { render } from "@react-email/render";

import { Action, EmailLayout, FallbackLink, Heading, Paragraph } from "./layout.js";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

async function build(subject: string, element: React.ReactElement): Promise<RenderedEmail> {
  // JSX escapes every interpolated value, so user-controlled strings (names,
  // org and room names) can't inject markup — v1's f-string templates could.
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}

export function verifyEmail(input: { name: string; url: string }) {
  return build(
    "Verify your email for CodeChatter",
    <EmailLayout preview="Confirm your email address to finish signing up">
      <Heading>Confirm your email</Heading>
      <Paragraph>Hi {input.name || "there"}, confirm this address to finish creating your CodeChatter account.</Paragraph>
      <Action href={input.url}>Verify email</Action>
      <FallbackLink href={input.url} />
    </EmailLayout>,
  );
}

export function resetPasswordEmail(input: { name: string; url: string }) {
  return build(
    "Reset your CodeChatter password",
    <EmailLayout preview="A link to choose a new password">
      <Heading>Reset your password</Heading>
      <Paragraph>Someone asked to reset the password for this account. The link expires in one hour.</Paragraph>
      <Action href={input.url}>Choose a new password</Action>
      <FallbackLink href={input.url} />
    </EmailLayout>,
  );
}

export function orgInvitationEmail(input: { inviterName: string; orgName: string; url: string }) {
  return build(
    `${input.inviterName} invited you to ${input.orgName} on CodeChatter`,
    <EmailLayout preview={`Join ${input.orgName} on CodeChatter`}>
      <Heading>You’re invited</Heading>
      <Paragraph>
        {input.inviterName} invited you to join <strong>{input.orgName}</strong> on CodeChatter.
      </Paragraph>
      <Action href={input.url}>Accept invitation</Action>
      <FallbackLink href={input.url} />
    </EmailLayout>,
  );
}

export function interviewInvitationEmail(input: { candidateName: string; interviewerName: string; minutes: number; when: string | null; url: string; mode?: "interview" | "assessment"; title?: string }) {
  if (input.mode === "assessment") {
    return build(
      `Your assessment on CodeChatter: ${input.title ?? "Assessment"}`,
      <EmailLayout preview={`A ${input.minutes} minute assessment from ${input.interviewerName}`}>
        <Heading>{input.title ?? "Your assessment"}</Heading>
        <Paragraph>
          Hi {input.candidateName}, {input.interviewerName} invited you to a {input.minutes} minute assessment on CodeChatter. You start it yourself{input.when ? `, ${input.when}` : ""}, and the time runs from when you do.
        </Paragraph>
        <Paragraph>This link is only for you and works for one person. You don’t need an account.</Paragraph>
        <Action href={input.url}>Open your assessment</Action>
        <FallbackLink href={input.url} />
      </EmailLayout>,
    );
  }
  return build(
    `Your interview with ${input.interviewerName} on CodeChatter`,
    <EmailLayout preview={`A ${input.minutes} minute coding interview with ${input.interviewerName}`}>
      <Heading>Your coding interview</Heading>
      <Paragraph>
        Hi {input.candidateName}, {input.interviewerName} invited you to a {input.minutes} minute coding interview on CodeChatter
        {input.when ? ` on ${input.when}` : ""}.
      </Paragraph>
      <Paragraph>This link is only for you and works for one person. You don’t need an account.</Paragraph>
      <Action href={input.url}>Open your interview</Action>
      <FallbackLink href={input.url} />
    </EmailLayout>,
  );
}

/** Remind without replacing a link the candidate may already have open on another device. */
export function assessmentReminderEmail(input: { candidateName: string; title: string; minutes: number; closesAt: Date; now: Date }) {
  const minutesLeft = Math.max(1, Math.floor((input.closesAt.getTime() - input.now.getTime()) / 60_000));
  const amount = minutesLeft >= 60 ? Math.floor(minutesLeft / 60) : minutesLeft;
  const unit = minutesLeft >= 60 ? "hour" : "minute";
  const remaining = `${amount} ${unit}${amount === 1 ? "" : "s"}`;
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(input.closesAt);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(input.closesAt);
  return build(
    `Assessment reminder: ${input.title}`,
    <EmailLayout preview={`${input.title} closes in ${remaining}`}>
      <Heading>{input.title}</Heading>
      <Paragraph>Hi {input.candidateName}, your assessment closes in {remaining}, on {date} at {time} UTC.</Paragraph>
      <Paragraph>You have {input.minutes} minutes to complete it once you start.</Paragraph>
      <Paragraph>Use the link in your original invitation to open your assessment. If you cannot find it, ask your interviewer for help.</Paragraph>
    </EmailLayout>,
  );
}

export function roomShareEmail(input: { inviterName: string; roomName: string; role: string; url: string }) {
  return build(
    `${input.inviterName} shared “${input.roomName}” with you`,
    <EmailLayout preview={`You can now open ${input.roomName}`}>
      <Heading>{input.roomName}</Heading>
      <Paragraph>
        {input.inviterName} gave you {input.role} access to this workspace.
      </Paragraph>
      <Action href={input.url}>Open workspace</Action>
      <FallbackLink href={input.url} />
    </EmailLayout>,
  );
}

/** Unread notifications, at most once a day (api: notifications/digest). */
export function notificationDigestEmail(input: { name: string; items: Array<{ text: string; url: string }>; more: number; inboxUrl: string }) {
  const count = input.items.length + input.more;
  return build(
    count === 1 ? "1 thing you missed on CodeChatter" : `${count} things you missed on CodeChatter`,
    <EmailLayout preview={input.items[0]?.text ?? "Your unread notifications"}>
      <Heading>While you were away</Heading>
      <Paragraph>Hi {input.name || "there"}, here’s what happened in your rooms.</Paragraph>
      {input.items.map((item) => (
        <Paragraph key={item.url + item.text}>
          <a href={item.url}>{item.text}</a>
        </Paragraph>
      ))}
      {input.more > 0 && <Paragraph>And {input.more} more.</Paragraph>}
      <Action href={input.inboxUrl}>Open CodeChatter</Action>
      <Paragraph>You get this when notifications stay unread for an hour. Turn it off from the bell in any room.</Paragraph>
    </EmailLayout>,
  );
}
