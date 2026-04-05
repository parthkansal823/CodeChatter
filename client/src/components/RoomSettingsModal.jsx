import { useEffect, useMemo, useState } from "react";
import {
  Check, ChevronRight, Clock3, Copy, Crown, Eye, Loader2, Lock,
  PencilLine, Play, Settings2, Shield, Unlock, Users, X,
} from "lucide-react";
import { AnimatePresence, motion as Motion } from "framer-motion";
import toast from "react-hot-toast";

import { Button } from "./ui/Button";
import { useAuth } from "../hooks/useAuth";
import { API_ENDPOINTS } from "../config/security";
import { sanitizeInput, secureFetch } from "../utils/security";
import { getDefaultTerminalShell, getTerminalShellOptions } from "../utils/terminal";
import UserAvatar from "./UserAvatar";

const ACCESS_ROLE_OPTIONS = [
  {
    id: "viewer",
    label: "Viewer",
    shortLabel: "Read only",
    description: "Can browse files and follow along without changing code.",
    icon: Eye,
    classes: "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/60 dark:text-zinc-200",
    accent: "bg-zinc-500",
  },
  {
    id: "runner",
    label: "Runner",
    shortLabel: "Run only",
    description: "Can execute code and use the terminal, but cannot edit files.",
    icon: Play,
    classes: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-950/30 dark:text-amber-200",
    accent: "bg-amber-500",
  },
  {
    id: "editor",
    label: "Editor",
    shortLabel: "Edit and run",
    description: "Can work directly in the workspace and run files.",
    icon: PencilLine,
    classes: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-500/25 dark:bg-violet-950/30 dark:text-violet-200",
    accent: "bg-violet-500",
  },
  {
    id: "owner",
    label: "Owner",
    shortLabel: "Full control",
    description: "Can manage members, approvals, and workspace settings.",
    icon: Crown,
    classes: "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-500/25 dark:bg-yellow-950/30 dark:text-yellow-200",
    accent: "bg-yellow-500",
  },
];

const ROLE_LABELS = Object.fromEntries(ACCESS_ROLE_OPTIONS.map((role) => [role.id, role.label]));

const PERMISSION_ROWS = [
  { action: "Open and read files", owner: true, editor: true, runner: true, viewer: true },
  { action: "Edit workspace files", owner: true, editor: true, runner: false, viewer: false },
  { action: "Run code", owner: true, editor: true, runner: true, viewer: false },
  { action: "Use terminal", owner: true, editor: true, runner: true, viewer: false },
  { action: "Approve requests", owner: true, editor: false, runner: false, viewer: false },
  { action: "Change member roles", owner: true, editor: false, runner: false, viewer: false },
];

const NAV_ITEMS = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "access", label: "Access", icon: Shield },
  { id: "members", label: "Members", icon: Users },
  { id: "queue", label: "Requests", icon: Clock3 },
];

const inputClasses = "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:focus:border-violet-500";

function formatRequestedAt(value) {
  if (!value) return "Just now";

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Just now";
  }

  const diff = Date.now() - parsed.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return parsed.toLocaleDateString();
}

function Field({ label, hint, children }) {
  return (
    <div className="space-y-2">
      <div className="space-y-0.5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
          {label}
        </p>
        {hint ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function RoleBadge({ role }) {
  const option = ACCESS_ROLE_OPTIONS.find((item) => item.id === role) || ACCESS_ROLE_OPTIONS[0];

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${option.classes}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${option.accent}`} />
      {option.label}
    </span>
  );
}

function RoleOptionGrid({ selectedRole, onChange, allowOwner = false, dense = false }) {
  const options = allowOwner
    ? ACCESS_ROLE_OPTIONS
    : ACCESS_ROLE_OPTIONS.filter((item) => item.id !== "owner");

  return (
    <div className={`grid gap-2 ${dense ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"}`}>
      {options.map((option) => {
        const Icon = option.icon;
        const isSelected = selectedRole === option.id;

        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`rounded-2xl border p-3 text-left transition-all ${
              isSelected
                ? "border-violet-500 bg-violet-50 shadow-sm shadow-violet-500/10 dark:border-violet-500 dark:bg-violet-950/40"
                : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900/60 dark:hover:border-zinc-600"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl ${option.classes}`}>
                <Icon size={14} />
              </span>
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-white">{option.label}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{option.shortLabel}</p>
              </div>
            </div>
            {!dense ? (
              <p className="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{option.description}</p>
            ) : null}
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
  const [memberActionState, setMemberActionState] = useState({ memberId: null, accessRole: null });
  const [requestRoles, setRequestRoles] = useState({});

  const pendingJoinRequests = useMemo(() => room?.pendingJoinRequests || [], [room?.pendingJoinRequests]);
  const collaborators = useMemo(() => room?.collaborators || [], [room?.collaborators]);
  const ownerIds = useMemo(() => room?.ownerIds || (room?.ownerId ? [room.ownerId] : []), [room?.ownerIds, room?.ownerId]);
  const ownerCollaborators = useMemo(
    () => collaborators.filter((member) => ownerIds.includes(member.id)),
    [collaborators, ownerIds],
  );
  const memberCollaborators = useMemo(
    () => collaborators.filter((member) => !ownerIds.includes(member.id)),
    [collaborators, ownerIds],
  );
  const roomStateSnapshot = useMemo(() => ({
    name: room?.name || "",
    description: room?.description || "",
    shell: room?.terminalShell || defaultTerminalShell,
    requireJoinApproval: room?.requireJoinApproval ?? true,
    requestRoles: Object.fromEntries(
      (room?.pendingJoinRequests || []).map((request) => [request.id, request.accessRole || "editor"]),
    ),
  }), [
    defaultTerminalShell,
    room?.description,
    room?.name,
    room?.pendingJoinRequests,
    room?.requireJoinApproval,
    room?.terminalShell,
  ]);

  useEffect(() => {
    if (!isOpen) {
      setActiveSection("general");
      return;
    }

    setName(roomStateSnapshot.name);
    setDescription(roomStateSnapshot.description);
    setShell(roomStateSnapshot.shell);
    setRequireJoinApproval(roomStateSnapshot.requireJoinApproval);
    setRequestRoles(roomStateSnapshot.requestRoles);
  }, [
    isOpen,
    room?.id,
    room?.updatedAt,
    roomStateSnapshot,
  ]);

  const inviteLink = typeof window !== "undefined" && room?.inviteToken
    ? `${window.location.origin}/room/${room.id}?token=${room.inviteToken}`
    : "";

  const handleSave = async (event) => {
    event?.preventDefault();
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

      toast.success("Workspace settings updated");
      onUpdate?.(updatedRoom);
      onClose();
    } catch (error) {
      toast.error(error.message || "Failed to update workspace settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!inviteLink) return;

    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success("Invite link copied");
    } catch {
      toast.error("Could not copy invite link");
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
          body: JSON.stringify(action === "approve" ? { accessRole: requestRoles[requestId] || "editor" } : {}),
        },
        token,
      );

      onUpdate?.(updatedRoom);
      toast.success(action === "approve" ? "Request approved" : "Request denied");
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
        {
          method: "PUT",
          body: JSON.stringify({ accessRole }),
        },
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

  const renderGeneralSection = () => (
    <form onSubmit={handleSave} className="flex h-full flex-col gap-5">
      <div className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <Field label="Workspace name" hint="Keep it short and easy for your team to recognize.">
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Frontend review room"
            className={inputClasses}
          />
        </Field>

        <div className="mt-5">
          <Field label="Description" hint="A quick line about what happens in this workspace.">
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              placeholder="Pair programming, architecture reviews, and release fixes."
              className={`${inputClasses} resize-none`}
            />
          </Field>
        </div>
      </div>

      <div className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <Field label="Default terminal shell" hint="This applies to new terminal sessions in the room.">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {terminalShellOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setShell(option.id)}
                className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                  shell === option.id
                    ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-950/40 dark:text-violet-200"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                }`}
              >
                <p className="text-sm font-semibold">{option.label}</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{option.shortLabel}</p>
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="mt-auto flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" isLoading={isSaving} disabled={!name.trim()}>Save Changes</Button>
      </div>
    </form>
  );

  const renderAccessSection = () => (
    <div className="flex h-full flex-col gap-5">
      <div className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <Field label="Join mode" hint="Choose whether people enter directly or wait for approval.">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setRequireJoinApproval(true)}
              className={`rounded-2xl border p-4 text-left transition-all ${
                requireJoinApproval
                  ? "border-amber-400 bg-amber-50 shadow-sm shadow-amber-500/10 dark:border-amber-500 dark:bg-amber-950/40"
                  : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-200">
                  <Lock size={16} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white">Approval required</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">Owners review every request before access is granted.</p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setRequireJoinApproval(false)}
              className={`rounded-2xl border p-4 text-left transition-all ${
                !requireJoinApproval
                  ? "border-emerald-400 bg-emerald-50 shadow-sm shadow-emerald-500/10 dark:border-emerald-500 dark:bg-emerald-950/40"
                  : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                  <Unlock size={16} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white">Direct join</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">People joining with access can enter immediately.</p>
                </div>
              </div>
            </button>
          </div>
        </Field>
      </div>

      {inviteLink ? (
        <div className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <Field label="Invite link" hint="Share this when you want people to join this workspace quickly.">
            <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-950/60">
              <p className="break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">{inviteLink}</p>
              <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" onClick={handleCopyInviteLink}>
                  <Copy size={14} className="mr-2" />
                  Copy Link
                </Button>
              </div>
            </div>
          </Field>
        </div>
      ) : null}

      <div className="rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <Field label="Permission matrix" hint="A quick view of what each role can do inside the workspace.">
          <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900/70">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Action</th>
                  {["owner", "editor", "runner", "viewer"].map((role) => (
                    <th key={role} className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                      {ROLE_LABELS[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {PERMISSION_ROWS.map((row) => (
                  <tr key={row.action}>
                    <td className="px-3 py-3 text-sm text-zinc-700 dark:text-zinc-200">{row.action}</td>
                    {["owner", "editor", "runner", "viewer"].map((role) => (
                      <td key={role} className="px-2 py-3 text-center">
                        {row[role] ? (
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                            <Check size={14} />
                          </span>
                        ) : (
                          <span className="text-zinc-300 dark:text-zinc-600">-</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Field>
      </div>

      <div className="mt-auto flex justify-end">
        <Button onClick={handleSave} isLoading={isSaving}>Save Access</Button>
      </div>
    </div>
  );

  const renderMemberList = (members, title, isOwnerGroup = false) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {isOwnerGroup ? <Crown size={14} className="text-yellow-500" /> : <Users size={14} className="text-zinc-400" />}
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">{title}</p>
      </div>

      <div className="space-y-3">
        {members.map((member) => {
          const isBusy = memberActionState.memberId === member.id;
          const isLastOwner = isOwnerGroup && ownerCollaborators.length <= 1;

          return (
            <div
              key={member.id}
              className={`rounded-2xl border p-4 ${
                isOwnerGroup
                  ? "border-yellow-200 bg-yellow-50/70 dark:border-yellow-500/20 dark:bg-yellow-950/10"
                  : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <UserAvatar username={member.username} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{member.username}</p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{member.email || "No email available"}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <RoleBadge role={isOwnerGroup ? "owner" : member.accessRole || "editor"} />
                  {isBusy ? <Loader2 size={14} className="animate-spin text-zinc-400" /> : null}
                </div>
              </div>

              {isLastOwner ? (
                <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  This owner cannot be demoted until another owner exists.
                </p>
              ) : (
                <div className="mt-4">
                  <RoleOptionGrid
                    selectedRole={isOwnerGroup ? "owner" : member.accessRole || "editor"}
                    onChange={(nextRole) => handleMemberAccessUpdate(member.id, nextRole)}
                    allowOwner
                    dense
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderMembersSection = () => (
    <div className="flex h-full flex-col gap-5">
      {collaborators.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
          <Users size={24} className="text-zinc-400" />
          <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">No members yet</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Invite teammates to start collaborating here.</p>
        </div>
      ) : (
        <>
          {ownerCollaborators.length > 0 ? renderMemberList(ownerCollaborators, "Owners", true) : null}
          {memberCollaborators.length > 0 ? renderMemberList(memberCollaborators, "Members") : null}
        </>
      )}
    </div>
  );

  const renderQueueSection = () => (
    <div className="flex h-full flex-col gap-4">
      {pendingJoinRequests.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900/40">
          <Clock3 size={24} className="text-zinc-400" />
          <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">No pending requests</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Anyone waiting to join will appear here.</p>
        </div>
      ) : (
        pendingJoinRequests.map((request) => {
          const isBusy = requestActionState.requestId === request.id;
          const selectedRole = requestRoles[request.id] || "editor";

          return (
            <div key={request.id} className="rounded-3xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <UserAvatar username={request.username} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{request.username}</p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{request.email || "No email available"}</p>
                  </div>
                </div>
                <span className="text-xs text-zinc-400">{formatRequestedAt(request.requestedAt)}</span>
              </div>

              <div className="mt-4">
                <Field label="Approve with role">
                  <RoleOptionGrid
                    selectedRole={selectedRole}
                    onChange={(nextRole) => setRequestRoles((current) => ({ ...current, [request.id]: nextRole }))}
                    dense
                  />
                </Field>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  onClick={() => handleJoinRequestAction(request.id, "approve")}
                  isLoading={isBusy && requestActionState.action === "approve"}
                  disabled={isBusy}
                  className="sm:flex-1"
                >
                  Approve as {ROLE_LABELS[selectedRole]}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleJoinRequestAction(request.id, "reject")}
                  isLoading={isBusy && requestActionState.action === "reject"}
                  disabled={isBusy}
                  className="sm:flex-1"
                >
                  Deny Request
                </Button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  const renderSection = () => {
    switch (activeSection) {
      case "general":
        return renderGeneralSection();
      case "access":
        return renderAccessSection();
      case "members":
        return renderMembersSection();
      case "queue":
        return renderQueueSection();
      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
        >
          <Motion.div
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            onClick={(event) => event.stopPropagation()}
            className="flex h-[min(760px,92vh)] w-full max-w-6xl overflow-hidden rounded-[28px] border border-zinc-200 bg-zinc-50 shadow-2xl shadow-black/25 dark:border-zinc-800 dark:bg-zinc-950"
          >
            {!room || isLoading ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3">
                <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading workspace settings...</p>
              </div>
            ) : (
              <>
                <aside className="flex w-full max-w-[290px] shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                  <div className="border-b border-zinc-200 px-5 py-5 dark:border-zinc-800">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-600 dark:text-violet-400">
                          Workspace controls
                        </p>
                        <h2 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-white">{room.name || "Workspace"}</h2>
                        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                          Manage permissions, member access, and workspace defaults.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={onClose}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-2">
                      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950/60">
                        <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">Members</p>
                        <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">{collaborators.length}</p>
                      </div>
                      <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950/60">
                        <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">Pending</p>
                        <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-white">{pendingJoinRequests.length}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 p-3">
                    {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
                      const isActive = activeSection === id;
                      const badgeValue = id === "members"
                        ? collaborators.length
                        : id === "queue"
                          ? pendingJoinRequests.length
                          : 0;

                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setActiveSection(id)}
                          className={`mb-1.5 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all ${
                            isActive
                              ? "bg-violet-600 text-white shadow-sm shadow-violet-500/20"
                              : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                          }`}
                        >
                          <Icon size={16} />
                          <span className="flex-1 text-sm font-semibold">{label}</span>
                          {badgeValue > 0 ? (
                            <span className={`inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                              isActive
                                ? "bg-white/20 text-white"
                                : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                            }`}>
                              {badgeValue}
                            </span>
                          ) : null}
                          {isActive ? <ChevronRight size={14} /> : null}
                        </button>
                      );
                    })}
                  </div>
                </aside>

                <main className="min-w-0 flex-1 overflow-y-auto p-6">
                  <AnimatePresence mode="wait">
                    <Motion.div
                      key={activeSection}
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{ duration: 0.12 }}
                      className="h-full"
                    >
                      {renderSection()}
                    </Motion.div>
                  </AnimatePresence>
                </main>
              </>
            )}
          </Motion.div>
        </Motion.div>
      ) : null}
    </AnimatePresence>
  );
}
