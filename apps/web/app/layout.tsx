import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { krypton, mona, neon, radon } from "./fonts";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "CodeChatter", template: "%s · CodeChatter" },
  description: "Write code together in the same file, run it in a private sandbox, and ship with your team.",
  applicationName: "CodeChatter",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // proxy.ts gives every page a nonce. Reading it here also means pages render per request, which a nonce needs.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // next-themes sets the theme class before paint, so no white flash (v1 had one).
    <html
      lang="en"
      suppressHydrationWarning
      className={`${mona.variable} ${neon.variable} ${krypton.variable} ${radon.variable}`}
    >
      <body>
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
