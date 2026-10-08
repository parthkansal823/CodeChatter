import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // next-themes sets the theme class before paint, so no white flash (v1 had one).
    <html
      lang="en"
      suppressHydrationWarning
      className={`${mona.variable} ${neon.variable} ${krypton.variable} ${radon.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
