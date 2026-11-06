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

export function interviewInvitationEmail(input: { candidateName: string; interviewerName: string; minutes: number; when: string | null; url: string }) {
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
