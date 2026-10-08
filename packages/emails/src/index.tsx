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
