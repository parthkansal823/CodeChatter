import { useEffect, useState } from "react";
import { ArrowLeft, Clock3, Eye, PencilLine, Play, RefreshCw, ShieldAlert, Wifi } from "lucide-react";
import { motion as Motion, AnimatePresence } from "framer-motion";

import { Button } from "../ui/Button";

const ROLE_LABELS = {
  editor: { label: "Editor", icon: PencilLine, text: "You'll be able to edit and run code" },
  runner: { label: "Runner", icon: Play, text: "You'll be able to run code but not edit files" },
  viewer: { label: "Viewer", icon: Eye, text: "You'll be able to view files in read-only mode" },
};

function getStatusConfig(status) {
  if (status === "rejected") {
    return {
      eyebrow: "Request denied",
      title: "Access wasn't granted",
      description: "The room owner has declined this join request. You can ask them to send a fresh invite link.",
      accent: "rose",
      ringColor: "ring-rose-500/20",
      glowColor: "bg-rose-500/5",
    };
  }
  return {
    eyebrow: "Waiting for access",
    title: "You're in the lobby",
    description: "The room owner will review your request and let you in shortly. This page refreshes automatically.",
    accent: "violet",
    ringColor: "ring-violet-500/20",
    glowColor: "bg-violet-500/5",
  };
}

function PulsingDot() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-violet-500" />
    </span>
  );
}

export default function PendingRoomAccessScreen({
  roomId,
  roomName,
  status = "pending",
  message,
  requestedAt,
  accessRole = "editor",
  isRefreshing = false,
  onRefresh,
  onGoHome,
}) {
  const [tick, setTick] = useState(0);
  const statusConfig = getStatusConfig(status);
  const isPending = status !== "rejected";
  const roleInfo = ROLE_LABELS[accessRole] || ROLE_LABELS.editor;
  const RoleIcon = roleInfo.icon;

  // Auto-tick every second to show a live "waiting" feel
  useEffect(() => {
    if (!isPending) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isPending]);

  const requestedAtLabel = requestedAt
    ? (() => {
        const diff = Date.now() - new Date(requestedAt).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return "Just now";
        if (mins < 60) return `${mins}m ago`;
        return `${Math.floor(mins / 60)}h ago`;
      })()
    : "Just now";

  return (
    <div className="flex min-h-[calc(100vh-2.75rem)] items-center justify-center bg-[#08080a] px-4 py-10">
      {/* ambient glow */}
      <div
        className={`pointer-events-none fixed inset-0 ${statusConfig.glowColor}`}
        style={{ filter: "blur(120px)" }}
      />

      <Motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative w-full max-w-lg"
      >
        {/* Card */}
        <div className={`overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0f0f12] shadow-2xl ring-1 ${statusConfig.ringColor}`}>
          {/* Status bar */}
          {isPending && (
            <div className="flex items-center gap-3 border-b border-white/[0.06] bg-violet-950/30 px-5 py-3">
              <PulsingDot />
              <p className="text-xs font-medium text-violet-300">Waiting for owner approval…</p>
            </div>
          )}

          <div className="p-6 sm:p-8">
            {/* Eyebrow + Title */}
            <div className="mb-6">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
                {statusConfig.eyebrow}
              </p>
              <h1 className="text-2xl font-bold text-white sm:text-3xl">
                {statusConfig.title}
              </h1>
              <p className="mt-3 text-sm leading-7 text-zinc-400">
                {message || statusConfig.description}
              </p>
            </div>

            {/* Info grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="col-span-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 sm:col-span-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Workspace</p>
                <p className="mt-2 truncate text-sm font-semibold text-zinc-200">{roomName || "Workspace"}</p>
                <p className="mt-0.5 font-mono text-xs text-zinc-600">{roomId}</p>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Your Role</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <RoleIcon size={12} className="text-violet-400" />
                  <p className="text-sm font-semibold text-zinc-200">{roleInfo.label}</p>
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-600">{roleInfo.text}</p>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600">Requested</p>
                <p className="mt-2 text-sm font-semibold text-zinc-200">{requestedAtLabel}</p>
                <p className="mt-0.5 text-[11px] text-zinc-600">Join request sent</p>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="ghost"
                onClick={onGoHome}
                className="border border-white/[0.07] text-zinc-400 hover:text-zinc-200"
              >
                <ArrowLeft size={14} className="mr-2 shrink-0" />
                Back to dashboard
              </Button>
              {isPending && (
                <Button
                  type="button"
                  onClick={onRefresh}
                  isLoading={isRefreshing}
                  className="flex-1 bg-violet-600 hover:bg-violet-500"
                >
                  {!isRefreshing && <RefreshCw size={13} className="mr-2 shrink-0" />}
                  Check status
                </Button>
              )}
            </div>
          </div>

          {/* Rejected state footer */}
          {!isPending && (
            <div className="flex items-center gap-3 border-t border-white/[0.06] bg-rose-950/20 px-5 py-3">
              <ShieldAlert size={14} className="shrink-0 text-rose-400" />
              <p className="text-xs text-rose-400">Contact the room owner to request a new invite link.</p>
            </div>
          )}
        </div>

        {/* Bottom hint */}
        {isPending && (
          <Motion.p
            key={tick}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-4 text-center text-xs text-zinc-700"
          >
            This page automatically checks every 4 seconds
          </Motion.p>
        )}
      </Motion.div>
    </div>
  );
}
