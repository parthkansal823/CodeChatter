import { useEffect, useMemo, useState } from "react";
import {
  Check, ChevronRight, Clock3, Crown, Eye, Loader2, PencilLine, Play,
  Settings2, Shield, Users, X, Lock, Unlock,
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
  { id: "owner",  label: "Owner",  sublabel: "Full access",  icon: Crown,      color: "yellow" },
  { id: "editor", label: "Editor", sublabel: "Edit + run",   icon: PencilLine, color: "violet" },
  { id: "runner", label: "Runner", sublabel: "Execute only", icon: Play,       color: "amber"  },
  { id: "viewer", label: "Viewer", sublabel: "Read-only",    icon: Eye,        color: "zinc"   },
];

const ROLE_COLORS = {
  owner:  { pill: "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-300 dark:border-yellow-500/20", dot: "bg-yellow-400" },
  editor: { pill: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/20", dot: "bg-violet-400" },
  runner: { pill: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20",       dot: "bg-amber-400"  },
  viewer: { pill: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-400 dark:border-zinc-500/20",            dot: "bg-zinc-400"   },
};

function RoleBadge({ role }) {
  const colors = ROLE_COLORS[role] || ROLE_COLORS.viewer;
  const labels = { owner: "Owner", editor: "Editor", runner: "Runner", viewer: "Viewer" };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${colors.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
      {labels[role] || role}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{label}</label>
      {children}
    </div>
  );
}

function RoleSelector({ selectedRole, onChange }) {
  const colorMap = {
    yellow: { on: "border-yellow-400 bg-yellow-50 text-yellow-700 dark:border-yellow-500/50 dark:bg-yellow-900/20 dark:text-yellow-300", off: "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400" },
    violet: { on: "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-500/50 dark:bg-violet-900/20 dark:text-violet-300", off: "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400" },
    amber:  { on: "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500/50 dark:bg-amber-900/20 dark:text-amber-300",       off: "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400" },
    zinc:   { on: "border-zinc-400 bg-zinc-100 text-zinc-700 dark:border-zinc-500/50 dark:bg-zinc-800 dark:text-zinc-300",               off: "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400" },
  };
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {ACCESS_ROLE_OPTIONS.map((option) => {
        const Icon = option.icon;
        const isSelected = selectedRole === option.id;
        const cls = colorMap[option.color];
        return (
          <button key={option.id} type="button" onClick={() => onChange(option.id)}
            className={`rounded-lg border px-2 py-2 text-left transition-all ${isSelected ? cls.on : cls.off}`}>
            <div className="flex items-center gap-1.5"><Icon size={11} /><p className="text-[11px] font-semibold">{option.label}</p></div>
            <p className="mt-0.5 text-[10px] opacity-60">{option.sublabel}</p>
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

  const [activeSection, setActiveSection] = useState("general");
  const [name, setName] = useState(room?.name || "");
  const [description, setDescription] = useState(room?.description || "");
  const [shell, setShell] = useState(room?.terminalShell || defaultTerminalShell);
  const [requireJoinApproval, setRequireJoinApproval] = useState(room?.requireJoinApproval ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [requestActionState, setRequestActionState] = useState({ requestId: null, action: null });
  const [requestRoles, setRequestRoles] = useState({});
  const [memberActionState, setMemberActionState] = useState({ memberId: null, accessRole: null });

  const pendingJoinRequests = useMemo(() => room?.pendingJoinRequests || [], [room?.pendingJoinRequests]);
  const collaborators = useMemo(() => room?.collaborators || [], [room?.collaborators]);
  const ownerIds = useMemo(() => room?.ownerIds || (room?.ownerId ? [room.ownerId] : []), [room?.ownerIds, room?.ownerId]);
  const ownerCollaborators = useMemo(() => collaborators.filter((c) => ownerIds.includes(c.id)), [collaborators, ownerIds]);
  const memberCollaborators = useMemo(() => collaborators.filter((c) => !ownerIds.includes(c.id)), [collaborators, ownerIds]);

  useEffect(() => {
    if (!isOpen) { setActiveSection("general"); return; }
    setName(room?.name || "");
    setDescription(room?.description || "");
    setShell(room?.terminalShell || defaultTerminalShell);
    setRequireJoinApproval(room?.requireJoinApproval ?? true);
    setRequestRoles(Object.fromEntries(pendingJoinRequests.map((req) => [req.id, req.accessRole || "editor"])));
  }, [defaultTerminalShell, isOpen, pendingJoinRequests, room?.description, room?.isPublic, room?.name, room?.requireJoinApproval, room?.terminalShell]);

  const handleSave = async (event) => {
    event?.preventDefault();
    setIsSaving(true);
    try {
      const updatedRoom = await secureFetch(
        API_ENDPOINTS.UPDATE_ROOM_SETTINGS(room.id),
        { method: "PUT", body: JSON.stringify({ name: sanitizeInput(name) || null, description: sanitizeInput(description) || null, terminalShell: shell, requireJoinApproval }) },
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
        action === "approve" ? API_ENDPOINTS.APPROVE_JOIN_REQUEST(room.id, requestId) : API_ENDPOINTS.REJECT_JOIN_REQUEST(room.id, requestId),
        { method: "POST", body: JSON.stringify(action === "approve" ? { accessRole: requestRoles[requestId] || "editor" } : {}) },
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

  const NAV = [
    { id: "general", label: "General", icon: Settings2 },
    { id: "access",  label: "Access",  icon: Shield    },
    { id: "members", label: "Members", icon: Users,  badge: collaborators.length },
    ...(pendingJoinRequests.length > 0 ? [{ id: "queue", label: "Queue", icon: Clock3, badge: pendingJoinRequests.length }] : []),
  ];

  const inputCls = "w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500 dark:focus:border-violet-500";

  const renderSection = () => {
    switch (activeSection) {
      case "general":
        return (
          <form onSubmit={handleSave} className="flex h-full flex-col gap-4">
            <Field label="Room Name">
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="My Workspace" className={inputCls} />
            </Field>
            <Field label="Description">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What are you building?" rows={2} className={`${inputCls} resize-none`} />
            </Field>
            <Field label="Terminal Shell">
              <div className="grid grid-cols-3 gap-1.5">
                {terminalShellOptions.map((option) => (
                  <button key={option.id} type="button" onClick={() => setShell(option.id)}
                    className={`rounded-lg border px-3 py-2 text-left transition-all ${shell === option.id ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-500/50 dark:bg-violet-900/20 dark:text-violet-300" : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400"}`}>
                    <p className="text-xs font-semibold">{option.label}</p>
                    <p className="text-[10px] opacity-60">{option.shortLabel}</p>
                  </button>
                ))}
              </div>
            </Field>
            <div className="mt-auto flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSaving || !name.trim()} isLoading={isSaving}>Save</Button>
            </div>
          </form>
        );

      case "access":
        return (
          <div className="flex h-full flex-col gap-4">
            <Field label="Join Mode">
              <div className="flex gap-2">
                <button type="button" onClick={() => setRequireJoinApproval(true)}
                  className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${requireJoinApproval ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200" : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400"}`}>
                  <Lock size={12} /><span className="text-sm font-medium">Require approval</span>
                </button>
                <button type="button" onClick={() => setRequireJoinApproval(false)}
                  className={`flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${!requireJoinApproval ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400"}`}>
                  <Unlock size={12} /><span className="text-sm font-medium">Direct join</span>
                </button>
              </div>
            </Field>

            {room?.inviteToken && (
              <Field label="Invite Link">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800/60">
                  <p className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {`${window.location.origin}/room/${room.id}?token=${room.inviteToken}`}
                  </p>
                </div>
              </Field>
            )}

            <Field label="Permission Matrix">
              <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                <table className="w-full text-xs">
                  <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50">
                    <tr>
                      <th className="px-3 py-1.5 text-left font-medium text-zinc-500">Action</th>
                      {["Owner","Editor","Runner","Viewer"].map((r) => (
                        <th key={r} className="px-2 py-1.5 text-center font-semibold text-zinc-600 dark:text-zinc-300">{r}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {[
                      { label: "View files",   owner: true,  editor: true,  runner: true,  viewer: true  },
                      { label: "Edit files",   owner: true,  editor: true,  runner: false, viewer: false },
                      { label: "Run code",     owner: true,  editor: true,  runner: true,  viewer: false },
                      { label: "Terminal",     owner: true,  editor: true,  runner: true,  viewer: false },
                      { label: "Manage room",  owner: true,  editor: false, runner: false, viewer: false },
                      { label: "Assign roles", owner: true,  editor: false, runner: false, viewer: false },
                    ].map((row) => (
                      <tr key={row.label}>
                        <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400">{row.label}</td>
                        {["owner","editor","runner","viewer"].map((role) => (
                          <td key={role} className="px-2 py-1.5 text-center">
                            {row[role] ? <span className="font-bold text-emerald-600 dark:text-emerald-400">✓</span> : <span className="text-zinc-300 dark:text-zinc-600">–</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Field>

            <div className="mt-auto flex justify-end">
              <Button onClick={handleSave} disabled={isSaving} isLoading={isSaving}>Save Access</Button>
            </div>
          </div>
        );

      case "members":
        return (
          <div className="flex h-full flex-col gap-3">
            {collaborators.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/30">
                <Users size={20} className="text-zinc-400" />
                <p className="text-sm text-zinc-500">No members yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {ownerCollaborators.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      <Crown size={10} className="text-yellow-500" /> Owners
                    </p>
                    <div className="space-y-1.5">
                      {ownerCollaborators.map((member) => {
                        const isBusy = memberActionState.memberId === member.id;
                        const isLastOwner = ownerCollaborators.length === 1;
                        return (
                          <div key={member.id} className="flex items-center gap-2.5 rounded-lg border border-yellow-200 bg-yellow-50/50 p-2.5 dark:border-yellow-500/20 dark:bg-yellow-950/10">
                            <UserAvatar username={member.username} size="xs" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-zinc-900 dark:text-white">{member.username}</p>
                              <p className="truncate text-[11px] text-zinc-500">{member.email}</p>
                            </div>
                            {isLastOwner ? <RoleBadge role="owner" /> : (
                              <div className="flex items-center gap-1.5">
                                {isBusy && <Loader2 size={12} className="animate-spin text-zinc-400" />}
                                <select value="owner" disabled={isBusy} onChange={(e) => handleMemberAccessUpdate(member.id, e.target.value)}
                                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 disabled:opacity-50">
                                  <option value="owner">Owner</option>
                                  <option value="editor">→ Editor</option>
                                  <option value="runner">→ Runner</option>
                                  <option value="viewer">→ Viewer</option>
                                </select>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {memberCollaborators.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      <Users size={10} /> Members
                    </p>
                    <div className="space-y-1.5">
                      {memberCollaborators.map((member) => {
                        const isBusy = memberActionState.memberId === member.id;
                        return (
                          <div key={member.id} className="flex items-center gap-2.5 rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-700 dark:bg-zinc-800/40">
                            <UserAvatar username={member.username} size="xs" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-zinc-900 dark:text-white">{member.username}</p>
                              <p className="truncate text-[11px] text-zinc-500">{member.email}</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {isBusy && <Loader2 size={12} className="animate-spin text-zinc-400" />}
                              <select value={member.accessRole || "editor"} disabled={isBusy} onChange={(e) => handleMemberAccessUpdate(member.id, e.target.value)}
                                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 disabled:opacity-50">
                                <option value="owner">→ Owner</option>
                                <option value="editor">Editor</option>
                                <option value="runner">Runner</option>
                                <option value="viewer">Viewer</option>
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case "queue":
        return (
          <div className="flex h-full flex-col gap-3">
            {pendingJoinRequests.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/30">
                <Clock3 size={20} className="text-zinc-400" />
                <p className="text-sm text-zinc-500">No one waiting to join.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {pendingJoinRequests.map((request) => {
                  const isBusy = requestActionState.requestId === request.id;
                  const selectedRole = requestRoles[request.id] || "editor";
                  return (
                    <div key={request.id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/40">
                      <div className="flex items-center gap-2.5 px-3 py-2.5">
                        <UserAvatar username={request.username} size="xs" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{request.username}</p>
                          <p className="truncate text-[11px] text-zinc-500">{request.email}</p>
                        </div>
                        <span className="shrink-0 text-[11px] text-zinc-400">{formatRequestedAt(request.requestedAt)}</span>
                      </div>
                      <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-700">
                        <RoleSelector selectedRole={selectedRole} onChange={(role) => setRequestRoles((prev) => ({ ...prev, [request.id]: role }))} />
                      </div>
                      <div className="flex gap-2 border-t border-zinc-100 px-3 py-2 dark:border-zinc-700">
                        <button type="button" disabled={isBusy} onClick={() => handleJoinRequestAction(request.id, "approve")}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-50">
                          {isBusy && requestActionState.action === "approve" ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                          Approve as {selectedRole}
                        </button>
                        <button type="button" disabled={isBusy} onClick={() => handleJoinRequestAction(request.id, "reject")}
                          className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-red-500/40 dark:hover:text-red-400">
                          {isBusy && requestActionState.action === "reject" ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                          Deny
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        >
          <Motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="flex h-[500px] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 shadow-2xl shadow-black/20 dark:border-zinc-800 dark:bg-zinc-950"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-5 py-3.5 dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400">Room Settings</p>
                <h2 className="text-base font-bold text-zinc-900 dark:text-white">{room?.name || "Workspace"}</h2>
              </div>
              <button type="button" onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
                <X size={15} />
              </button>
            </div>

            {!room || isLoading ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
                <p className="text-sm text-zinc-500">Loading…</p>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1">
                {/* Sidebar */}
                <aside className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                  {NAV.map(({ id, label, icon: Icon, badge }) => (
                    <button key={id} type="button" onClick={() => setActiveSection(id)}
                      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-all ${activeSection === id ? "bg-violet-600 text-white shadow-sm" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"}`}>
                      <Icon size={14} />
                      {label}
                      {badge > 0 && (
                        <span className={`ml-auto flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold ${activeSection === id ? "bg-white/25 text-white" : "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"}`}>
                          {badge}
                        </span>
                      )}
                      {activeSection === id && <ChevronRight size={11} className="ml-auto" />}
                    </button>
                  ))}
                </aside>

                {/* Content */}
                <main className="min-w-0 flex-1 overflow-y-auto p-5">
                  <AnimatePresence mode="wait">
                    <Motion.div
                      key={activeSection}
                      initial={{ opacity: 0, x: 6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -6 }}
                      transition={{ duration: 0.12 }}
                      className="h-full"
                    >
                      {renderSection()}
                    </Motion.div>
                  </AnimatePresence>
                </main>
              </div>
            )}
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
  );
}
