import { motion as Motion } from "framer-motion";
import { GitBranch, Lock, Terminal, Users } from "lucide-react";

import BrandLogo from "./BrandLogo";

/**
 * Split layout for the auth screens.
 *
 * The previous version ran three infinitely-animating blob orbs (620px, 540px
 * and 320px circles looping every 11-20s) over a hardcoded near-black page.
 * That composited continuously for as long as the login screen was open, and
 * ignored the theme entirely. This version is a static two-pane layout built
 * from theme tokens.
 */
const FEATURES = [
  {
    icon: Users,
    label: "Real-time collaboration",
    desc: "Live cursors, selections, and presence on the same file.",
  },
  {
    icon: Terminal,
    label: "Run it in the room",
    desc: "A shell per workspace, plus one-click run for 20+ languages.",
  },
  {
    icon: Lock,
    label: "Access you control",
    desc: "Invite links, owner approval, and viewer/runner/editor roles.",
  },
  {
    icon: GitBranch,
    label: "GitHub built in",
    desc: "Import a repo, push changes, and keep a folder in sync.",
  },
];

export default function AuthFormLayout({ children }) {
  return (
    <div className="flex min-h-screen bg-canvas text-fg">
      {/* ── Brand panel ─────────────────────────────────────────────────── */}
      <aside className="hidden w-[400px] shrink-0 flex-col justify-between border-r border-edge-subtle bg-panel px-9 py-10 lg:flex xl:w-[440px]">
        <BrandLogo size="md" />

        <div>
          <h2 className="text-2xl font-semibold leading-snug tracking-tight text-fg">
            A shared workspace for
            <br />
            people who write code together.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            Rooms, an editor, a terminal, and the people you work with — in one
            browser tab.
          </p>

          <ul className="mt-8 space-y-5">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <li key={label} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-subtle text-accent">
                  <Icon size={14} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg">{label}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-fg-muted">
                    {desc}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-fg-subtle">
          Sign-in is protected with a one-time code sent to your email.
        </p>
      </aside>

      {/* ── Form pane ───────────────────────────────────────────────────── */}
      <main className="flex min-w-0 flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <Motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="w-full max-w-[380px]"
        >
          {children}
        </Motion.div>
      </main>
    </div>
  );
}
