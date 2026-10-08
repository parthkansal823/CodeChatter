import { Body, Button, Container, Head, Hr, Html, Preview, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";

// Email clients ignore CSS variables and most modern CSS, so the palette is
// inlined here. It mirrors the app's neutral + single-accent tokens.
const colors = { bg: "#f6f7f9", card: "#ffffff", text: "#18181b", muted: "#71717a", border: "#e4e4e7", accent: "#2563eb" };

export function EmailLayout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: colors.bg, fontFamily: "Inter, -apple-system, Segoe UI, sans-serif", margin: 0 }}>
        <Container style={{ maxWidth: 480, margin: "40px auto", padding: 32, backgroundColor: colors.card, border: `1px solid ${colors.border}`, borderRadius: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: 600, color: colors.text, margin: "0 0 24px" }}>CodeChatter</Text>
          {children}
          <Hr style={{ borderColor: colors.border, margin: "32px 0 16px" }} />
          <Text style={{ fontSize: 12, color: colors.muted, margin: 0 }}>
            If you didn’t expect this email, you can safely ignore it.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 20, fontWeight: 600, color: colors.text, margin: "0 0 12px" }}>{children}</Text>;
}

export function Paragraph({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 14, lineHeight: "22px", color: colors.text, margin: "0 0 16px" }}>{children}</Text>;
}

export function Action({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ margin: "24px 0" }}>
      <Button href={href} style={{ backgroundColor: colors.accent, color: "#ffffff", fontSize: 14, fontWeight: 500, padding: "10px 16px", borderRadius: 6, textDecoration: "none" }}>
        {children}
      </Button>
    </Section>
  );
}

export function FallbackLink({ href }: { href: string }) {
  return (
    <Text style={{ fontSize: 12, color: colors.muted, wordBreak: "break-all", margin: 0 }}>
      Or paste this link into your browser: {href}
    </Text>
  );
}
