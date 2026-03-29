import { useEffect, useMemo, useState } from "react";
import {
  Check, Clock3, Eye, Loader2, PencilLine, Play, Settings2,
  Shield, ShieldCheck, Users, X, RefreshCw, Lock, Unlock,
  ChevronDown, AlertTriangle,
} from "lucide-react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";

import { Button } from "./ui/Button";
import { useAuth } from "../hooks/useAuth";
import { API_ENDPOINTS } from "../config/security";
import { secureFetch, sanitizeInput } from "../utils/security";
import { getDefaultTerminalShell, getTerminalShellOptions } from "../utils/terminal";
import UserAvatar from "./UserAvatar";

const formatRequestedAt = (value) => {
  if (!value) return "Just now";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Just now";
  const diff = Date.now() - parsed.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return parsed.toLocaleDateString();
};

const ACCESS_ROLE_OPTIONS = [
  {
    id: "editor",
    label: "Editor",
    sublabel: "Can edit & run code",
    description: "Full workspace access — edit files, run code, use the terminal.",
    icon: PencilLine,
    color: "violet",
  },
  {
    id: "runner",
    label: "Runner",
    sublabel: "Can only run code",
    description: "Can execute code and use the terminal, but cannot edit files.",
    icon: Play,
    color: "amber",
  },
  {
    id: "viewer",
    label: "Viewer",
    sublabel: "Read-only access",
    description: "See files and follow collaboration in real time without editing.",
    icon: Eye,
    color: "slate",
  },
];

const ROLE_COLORS = {
  owner: { pill: "bg-violet-500/15 text-violet-300 border-violet-500/30", dot: "bg-violet-400" },
  editor: { pill: "bg-violet-500/10 text-violet-300 border-violet-500/20", dot: "bg-violet-400" },
  runner: { pill: "bg-amber-500/10 text-amber-300 border-amber-500/20", dot: "bg-amber-400" },
  viewer: { pill: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20", dot: "bg-zinc-500" },
};

function RoleBadge({ role }) {
  const colors = ROLE_COLORS[role] || ROLE_COLORS.viewer;
  const labels = { owner: "Owner", editor: "Editor", runner: "Runner", viewer: "Viewer" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${colors.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
      {labels[role] || role}
    </span>
  );
}

function RoleSelector({ selectedRole, onChange, compact = false }) {
  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3"}`}>
      {ACCESS_ROLE_OPTIONS.map((option) => {
        const Icon = option.icon;
        const isSelected = selectedRole === option.id;
        const colorMap = {
          violet: isSelected
            ? "border-violet-500 bg-violet-950/60 text-violet-100 shadow-violet-500/10 shadow-lg"
            : "border-zinc-700/60 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300",
          amber: isSelected
            ? "border-amber-500 bg-amber-950/60 text-amber-100 shadow-amber-500/10 shadow-lg"
            : "border-zinc-700/60 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300",
          slate: isSelected
            ? "border-zinc-500 bg-zinc-800/80 text-zinc-200 shadow-zinc-500/10 shadow-lg"
            : "border-zinc-700/60 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300",
        };
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`group rounded-xl border px-3 py-3 text-left transition-all duration-200 ${colorMap[option.color]}`}
          >
            <div className="flex items-center gap-2">
              <Icon size={13} />
              <p className="text-xs font-semibold">{option.label}</p>
            </div>
            {!compact && (
              <p className="mt-1.5 text-[11px] leading-4 opacity-70">{option.sublabel}</p>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Tab navigation bar ───────────────────────────────────────────────────────
function TabBar({ tabs, active, onChange, badgeCounts = {} }) {
  return (
    <div className="flex gap-1 border-b border-white/[0.06] px-6">
      {tabs.map((tab) => {
        const count = badgeCounts[tab.id];
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`relative flex items-center gap-2 px-3 py-3.5 text-sm font-medium transition-colors ${
              active === tab.id
                ? "text-white"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.label}
            {count > 0 && (
              <span className="flex h-4.5 min-w-[18px] items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold text-white leading-none">
                {count}
              </span>
            )}
            {active === tab.id && (
              <Motion.span
                layoutId="settings-tab-indicator"
                className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-violet-500"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function RoomSettingsModal({ room, isOpen, isLoading = false, onClose, onUpdate }) {
  const { token } = useAuth();
  const terminalShellOptions = getTerminalShellOptions();
  const defaultTerminalShell = getDefaultTerminalShell();

  const [activeTab, setActiveTab] = useState("general");
  const [name, setName] = useState(room?.name || "");
  const [description, setDescription] = useState(room?.description || "");
  const [shell, setShell] = useState(room?.terminalShell || defaultTerminalShell);
  const [requireJoinApproval, setRequireJoinApproval] = useState(
    room?.requireJoinApproval ?? !room?.isPublic,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [requestActionState, setRequestActionState] = useState({ requestId: null, action: null });
  const [requestRoles, setRequestRoles] = useState({});
  const [memberActionState, setMemberActionState] = useState({ memberId: null, accessRole: null });

  const pendingJoinRequests = useMemo(() => room?.pendingJoinRequests || [], [room?.pendingJoinRequests]);
  const collaborators = useMemo(() => room?.collaborators || [], [room?.collaborators]);
  const memberCollaborators = useMemo(
    () => collaborators.filter((c) => c.id !== room?.ownerId),
    [collaborators, room?.ownerId],
  );
  const activeShell = useMemo(
    () => terminalShellOptions.find((option) => option.id === shell),
    [shell, terminalShellOptions],
  );

  useEffect(() => {
    if (!isOpen) {
      setActiveTab("general");
      return;
    }
    setName(room?.name || "");
    setDescription(room?.description || "");
    setShell(room?.terminalShell || defaultTerminalShell);
    setRequireJoinApproval(room?.requireJoinApproval ?? !room?.isPublic);
    setRequestRoles(
      Object.fromEntries(
        pendingJoinRequests.map((req) => [req.id, req.accessRole || "editor"]),
      ),
    );
  }, [defaultTerminalShell, isOpen, pendingJoinRequests, room?.description, room?.isPublic, room?.name, room?.requireJoinApproval, room?.terminalShell]);

  const handleSave = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      const updatedRoom = await secureFetch(
        API_ENDPOINTS.UPDATE_ROOM_SETTINGS(room.id),
        {
          method: "PUT",
          body: JSON.stringify({
            name: sanitizeInput(name) || null,
            description: sanitizeInput(description) || null,
            terminalShell: shell,
            requireJoinApproval,
          }),
        },
        token,
      );
      toast.success("Settings saved");
      onUpdate?.(updatedRoom);
      onClose();
    } catch (error) {
      toast.error(error.message || "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleJoinRequestAction = async (requestId, action) => {
    setRequestActionState({ requestId, action });
    try {
      const updatedRoom = await secureFetch(
        action === "approve"
          ? API_ENDPOINTS.APPROVE_JOIN_REQUEST(room.id, requestId)
          : API_ENDPOINTS.REJECT_JOIN_REQUEST(room.id, requestId),
        {
          method: "POST",
          body: JSON.stringify(
            action === "approve" ? { accessRole: requestRoles[requestId] || "editor" } : {},
          ),
        },
        token,
      );
      onUpdate?.(updatedRoom);
      toast.success(action === "approve" ? "Request approved" : "Request rejected");
    } catch (error) {
      toast.error(error.message || `Failed to ${action} request`);
    } finally {
      setRequestActionState({ requestId: null, action: null });
    }
  };

  const handleMemberAccessUpdate = async (memberId, accessRole) => {
    setMemberActionState({ memberId, accessRole });
    try {
      const updatedRoom = await secureFetch(
        API_ENDPOINTS.UPDATE_MEMBER_ACCESS(room.id, memberId),
        { method: "PUT", body: JSON.stringify({ accessRole }) },
        token,
      );
      onUpdate?.(updatedRoom);
      toast.success("Member access updated");
    } catch (error) {
      toast.error(error.message || "Failed to update member access");
    } finally {
      setMemberActionState({ memberId: null, accessRole: null });
    }
  };

  const tabs = [
    { id: "general", label: "General" },
    { id: "access", label: "Access" },
    { id: "members", label: "Members" },
    ...(pendingJoinRequests.length > 0 ? [{ id: "queue", label: "Queue" }] : []),
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-4 backdrop-blur-md"
        >
          <Motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-2xl items-center"
          >
            <div className="w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0f0f11] shadow-2xl shadow-black/60">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600/20 text-violet-400">
                    <Settings2 size={16} />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-white">Room Settings</h2>
                    <p className="text-xs text-zinc-500">{room?.name || "Workspace"} · {room?.id}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.06] hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              {!room || isLoading ? (
                <div className="flex min-h-[300px] flex-col items-center justify-center gap-3 py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
                  <p className="text-sm text-zinc-500">Loading settings…</p>
                </div>
              ) : (
                <>
                  <TabBar
                    tabs={tabs}
                    active={activeTab}
                    onChange={setActiveTab}
                    badgeCounts={{ queue: pendingJoinRequests.length }}
                  />

                  <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
                    {/* ── GENERAL TAB ─────────────────────────────── */}
                    <AnimatePresence mode="wait">
                      {activeTab === "general" && (
                        <Motion.form
                          key="general"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.15 }}
                          onSubmit={handleSave}
                        >
                          <div className="space-y-5 px-6 py-6">
                            {/* Room name */}
                            <div>
                              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-zinc-500">
                                Room Name
                              </label>
                              <input
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="My Workspace"
                                className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
                              />
                            </div>

                            {/* Description */}
                            <div>
                              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-zinc-500">
                                Description
                              </label>
                              <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="What are you building here?"
                                rows={3}
                                className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white placeholder-zinc-600 outline-none transition focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20"
                              />
                            </div>

                            {/* Terminal Shell */}
                            <div>
                              <label className="mb-3 block text-xs font-semibold uppercase tracking-widest text-zinc-500">
                                Terminal Shell
                              </label>
                              <div className="grid grid-cols-3 gap-2">
                                {terminalShellOptions.map((option) => (
                                  <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => setShell(option.id)}
                                    className={`rounded-xl border px-3 py-3 text-left transition-all ${
                                      shell === option.id
                                        ? "border-violet-500/60 bg-violet-950/50 text-violet-200"
                                        : "border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:border-white/[0.12] hover:text-zinc-300"
                                    }`}
                                  >
                                    <p className="text-xs font-semibold">{option.label}</p>
                                    <p className="mt-0.5 text-[11px] opacity-60">{option.shortLabel}</p>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] px-6 py-4">
                            <Button type="button" variant="ghost" onClick={onClose} className="text-zinc-400">
                              Cancel
                            </Button>
                            <Button
                              type="submit"
                              disabled={isSaving || !name.trim()}
                              isLoading={isSaving}
                              className="bg-violet-600 hover:bg-violet-500"
                            >
                              Save Changes
                            </Button>
                          </div>
                        </Motion.form>
                      )}

                      {/* ── ACCESS TAB ─────────────────────────────── */}
                      {activeTab === "access" && (
                        <Motion.div
                          key="access"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.15 }}
                          className="space-y-4 px-6 py-6"
                        >
                          {/* Invite link */}
                          {room?.inviteToken && (
                            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Invite Link</p>
                              <p className="mt-1 break-all font-mono text-xs text-zinc-400">
                                {`${window.location.origin}/room/${room.id}?token=${room.inviteToken}`}
                              </p>
                            </div>
                          )}

                          {/* Join mode */}
                          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-white">Join Approval</p>
                                <p className="mt-1 text-xs text-zinc-500">
                                  Control whether new participants join instantly or wait in a lobby.
                                </p>
                              </div>
                              <span className={`mt-0.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                requireJoinApproval
                                  ? "bg-amber-500/10 text-amber-300"
                                  : "bg-emerald-500/10 text-emerald-300"
                              }`}>
                                {requireJoinApproval ? "Approval required" : "Direct join"}
                              </span>
                            </div>

                            <div className="mt-4 flex gap-2">
                              <button
                                type="button"
                                onClick={() => setRequireJoinApproval(true)}
                                className={`flex flex-1 items-center gap-2 rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                                  requireJoinApproval
                                    ? "border-amber-500/40 bg-amber-950/40 text-amber-200"
                                    : "border-white/[0.06] bg-white/[0.02] text-zinc-500 hover:border-white/[0.12] hover:text-zinc-300"
                                }`}
                              >
                                <Lock size={14} />
                                <span className="font-medium">Require approval</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setRequireJoinApproval(false)}
                                className={`flex flex-1 items-center gap-2 rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                                  !requireJoinApproval
                                    ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-200"
                                    : "border-white/[0.06] bg-white/[0.02] text-zinc-500 hover:border-white/[0.12] hover:text-zinc-300"
                                }`}
                              >
                                <Unlock size={14} />
                                <span className="font-medium">Allow direct join</span>
                              </button>
                            </div>
                          </div>

                          <div className="flex justify-end border-t border-white/[0.06] pt-4">
                            <Button
                              type="button"
                              onClick={handleSave}
                              disabled={isSaving}
                              isLoading={isSaving}
                              className="bg-violet-600 hover:bg-violet-500"
                            >
                              Save Access Settings
                            </Button>
                          </div>
                        </Motion.div>
                      )}

                      {/* ── MEMBERS TAB ─────────────────────────────── */}
                      {activeTab === "members" && (
                        <Motion.div
                          key="members"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.15 }}
                          className="px-6 py-6"
                        >
                          {collaborators.length === 0 ? (
                            <div className="flex flex-col items-center gap-3 py-10 text-center">
                              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-zinc-600">
                                <Users size={20} />
                              </div>
                              <p className="text-sm text-zinc-500">No members yet. Share the invite link to bring people in.</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {collaborators.map((member) => {
                                const isOwner = member.id === room?.ownerId;
                                const isBusy = memberActionState.memberId === member.id;

                                return (
                                  <div
                                    key={member.id}
                                    className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
                                  >
                                    <UserAvatar username={member.username} size="base" />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium text-white">{member.username}</p>
                                      <p className="truncate text-xs text-zinc-500">{member.email}</p>
                                    </div>

                                    {isOwner ? (
                                      <RoleBadge role="owner" />
                                    ) : (
                                      <div className="flex items-center gap-2">
                                        {isBusy ? (
                                          <Loader2 size={14} className="animate-spin text-zinc-500" />
                                        ) : null}
                                        <select
                                          value={member.accessRole || "editor"}
                                          disabled={isBusy}
                                          onChange={(e) => handleMemberAccessUpdate(member.id, e.target.value)}
                                          className="rounded-lg border border-white/[0.08] bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 outline-none transition hover:border-white/[0.16] focus:border-violet-500/50 disabled:opacity-50"
                                        >
                                          <option value="editor">Editor</option>
                                          <option value="runner">Runner</option>
                                          <option value="viewer">Viewer</option>
                                        </select>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </Motion.div>
                      )}

                      {/* ── JOIN QUEUE TAB ─────────────────────────── */}
                      {activeTab === "queue" && (
                        <Motion.div
                          key="queue"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.15 }}
                          className="px-6 py-6"
                        >
                          {pendingJoinRequests.length === 0 ? (
                            <div className="flex flex-col items-center gap-3 py-10 text-center">
                              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.04] text-zinc-600">
                                <Clock3 size={20} />
                              </div>
                              <p className="text-sm text-zinc-500">No one is waiting to join right now.</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {pendingJoinRequests.map((request) => {
                                const isBusy = requestActionState.requestId === request.id;
                                const selectedRole = requestRoles[request.id] || "editor";

                                return (
                                  <div
                                    key={request.id}
                                    className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]"
                                  >
                                    {/* Request header */}
                                    <div className="flex items-center gap-3 p-4">
                                      <UserAvatar username={request.username} size="md" />
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-semibold text-white">{request.username}</p>
                                        <p className="truncate text-xs text-zinc-500">{request.email}</p>
                                      </div>
                                      <div className="shrink-0 text-right">
                                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
                                          <Clock3 size={10} />
                                          Waiting
                                        </span>
                                        <p className="mt-1 text-[11px] text-zinc-600">{formatRequestedAt(request.requestedAt)}</p>
                                      </div>
                                    </div>

                                    {/* Role picker */}
                                    <div className="border-t border-white/[0.06] px-4 py-3">
                                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-600">
                                        Grant access as
                                      </p>
                                      <RoleSelector
                                        selectedRole={selectedRole}
                                        onChange={(role) =>
                                          setRequestRoles((prev) => ({ ...prev, [request.id]: role }))
                                        }
                                        compact
                                      />
                                    </div>

                                    {/* Action buttons */}
                                    <div className="flex gap-2 border-t border-white/[0.06] px-4 py-3">
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => handleJoinRequestAction(request.id, "approve")}
                                        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50"
                                      >
                                        {isBusy && requestActionState.action === "approve" ? (
                                          <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                          <Check size={14} />
                                        )}
                                        Let them in as {selectedRole}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() => handleJoinRequestAction(request.id, "reject")}
                                        className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.06] px-4 py-2.5 text-sm font-medium text-zinc-400 transition hover:border-rose-500/40 hover:bg-rose-950/30 hover:text-rose-300 disabled:opacity-50"
                                      >
                                        {isBusy && requestActionState.action === "reject" ? (
                                          <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                          <X size={14} />
                                        )}
                                        Deny
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </Motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              )}
            </div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
