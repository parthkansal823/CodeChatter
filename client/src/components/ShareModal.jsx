import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion as Motion } from "framer-motion";
import { Check, Globe, Link2, Loader2, Lock, Mail, X } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import UserAvatar from "./UserAvatar";
import { useAuth } from "../hooks/useAuth";
import { API_ENDPOINTS } from "../config/security";
import { secureFetch } from "../utils/security";
import { buildRoomInviteLink } from "../utils/room/invite";

/**
 * Share dialog for a room, modelled on Google Drive's.
 *
 * The room summary in the dashboard list has no collaborator array and no
 * invite token, so the dialog fetches the full room when it opens rather than
 * rendering a half-empty list from what the list endpoint happened to include.
 */
const ACCESS_OPTIONS = [
  {
    id: "restricted",
    requireJoinApproval: true,
    icon: Lock,
    label: "Restricted",
    description: "People with the link must be approved by an owner before they can join.",
  },
  {
    id: "link",
    requireJoinApproval: false,
    icon: Globe,
    label: "Anyone with the link",
    description: "Anyone who opens the link joins the workspace straight away.",
  },
];

const ASSIGNABLE_ROLES = [
  { id: "editor", label: "Editor" },
  { id: "runner", label: "Runner" },
  { id: "viewer", label: "Viewer" },
  { id: "owner", label: "Owner" },
];

// Deliberately loose. The address still has to belong to a CodeChatter account,
// which the server checks — this only catches obvious typos before the request.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function roleLabel(member, ownerIds) {
  if (ownerIds.includes(member.id)) return "Owner";

  const role = member.accessRole || "editor";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** Borderless until hovered, so a row of these reads as text, not as a form. */
function RoleSelect({ value, onChange, disabled = false, ariaLabel }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className="shrink-0 cursor-pointer rounded-md border border-transparent bg-transparent py-1 pl-1.5 pr-0.5 text-sm text-fg outline-none transition-colors hover:bg-hovered focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {ASSIGNABLE_ROLES.map((role) => (
        <option key={role.id} value={role.id}>
          {role.label}
        </option>
      ))}
    </select>
  );
}

export default function ShareModal({ room, isOpen, onClose, onUpdate }) {
  const { token, user } = useAuth();
  const [fullRoom, setFullRoom] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingAccess, setIsSavingAccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [savingMemberId, setSavingMemberId] = useState(null);

  const roomId = room?.id;

  useEffect(() => {
    if (!isOpen || !roomId) {
      setFullRoom(null);
      setCopied(false);
      setInviteEmail("");
      setInviteRole("editor");
      setInviteError("");
      return undefined;
    }

    let isCancelled = false;
    setIsLoading(true);

    (async () => {
      try {
        const data = await secureFetch(API_ENDPOINTS.GET_ROOM(roomId), {}, token);
        if (!isCancelled) setFullRoom(data);
      } catch (error) {
        if (!isCancelled) toast.error(error.message || "Could not load sharing details");
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, roomId, token]);

  const activeRoom = fullRoom || room;
  const ownerIds = activeRoom?.ownerIds || (activeRoom?.ownerId ? [activeRoom.ownerId] : []);
  const isOwner = ownerIds.includes(user?.id);
  const collaborators = activeRoom?.collaborators || [];
  const requireJoinApproval = activeRoom?.requireJoinApproval ?? true;
  const inviteLink = activeRoom
    ? buildRoomInviteLink({ roomId: activeRoom.id, inviteToken: activeRoom.inviteToken })
    : "";

  const handleCopy = useCallback(async () => {
    if (!inviteLink) return;

    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success("Link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy the link");
    }
  }, [inviteLink]);

  const handleInvite = async (event) => {
    event.preventDefault();

    const email = inviteEmail.trim().toLowerCase();

    if (!EMAIL_PATTERN.test(email)) {
      setInviteError("Enter a valid email address");
      return;
    }

    setInviteError("");
    setIsInviting(true);

    try {
      const result = await secureFetch(
        API_ENDPOINTS.ADD_ROOM_MEMBER(activeRoom.id),
        {
          method: "POST",
          body: JSON.stringify({ email, accessRole: inviteRole }),
        },
        token,
      );

      setFullRoom(result.room);
      onUpdate?.(result.room);
      setInviteEmail("");

      // Access is granted either way; only the notification can fail.
      toast.success(
        result.emailSent
          ? `${email} now has access — we emailed them`
          : `${email} now has access (email could not be sent)`,
      );
    } catch (error) {
      setInviteError(error.message || "Could not add that person");
    } finally {
      setIsInviting(false);
    }
  };

  const handleMemberRoleChange = async (memberId, accessRole) => {
    setSavingMemberId(memberId);

    try {
      const updated = await secureFetch(
        API_ENDPOINTS.UPDATE_MEMBER_ACCESS(activeRoom.id, memberId),
        { method: "PUT", body: JSON.stringify({ accessRole }) },
        token,
      );

      setFullRoom(updated);
      onUpdate?.(updated);
    } catch (error) {
      toast.error(error.message || "Could not change that role");
    } finally {
      setSavingMemberId(null);
    }
  };

  const handleAccessChange = async (nextRequireApproval) => {
    if (nextRequireApproval === requireJoinApproval || !isOwner) return;

    setIsSavingAccess(true);

    try {
      // Only the one field is sent. The backend skips keys it receives as null,
      // so this cannot blank out the room's name or description.
      const updated = await secureFetch(
        API_ENDPOINTS.UPDATE_ROOM_SETTINGS(activeRoom.id),
        {
          method: "PUT",
          body: JSON.stringify({ requireJoinApproval: nextRequireApproval }),
        },
        token,
      );

      setFullRoom(updated);
      onUpdate?.(updated);
    } catch (error) {
      toast.error(error.message || "Could not update access");
    } finally {
      setIsSavingAccess(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && activeRoom ? (
        <Motion.div
          key="share-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.14 } }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <Motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.14 } }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`Share ${activeRoom.name}`}
            className="w-full max-w-lg overflow-hidden rounded-lg border border-edge bg-overlay text-fg shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 px-5 pt-5">
              <h2 className="min-w-0 truncate text-lg font-semibold">
                Share &ldquo;{activeRoom.name}&rdquo;
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hovered hover:text-fg"
              >
                <X size={16} />
              </button>
            </div>

            {/* Add people by email */}
            {isOwner ? (
              <form onSubmit={handleInvite} className="px-5 pt-4">
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => {
                    setInviteEmail(event.target.value);
                    if (inviteError) setInviteError("");
                  }}
                  placeholder="Add people by email"
                  aria-label="Email address"
                  icon={Mail}
                  error={inviteError || undefined}
                  disabled={isInviting}
                />

                {/* Role and confirm only appear once there is something to add,
                    so the resting state stays a single clean field. */}
                {inviteEmail.trim() ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                      They need a CodeChatter account — we&apos;ll email them the link.
                    </p>
                    <RoleSelect
                      value={inviteRole}
                      onChange={setInviteRole}
                      disabled={isInviting}
                      ariaLabel="Role for the person you are adding"
                    />
                    <Button type="submit" isLoading={isInviting} className="shrink-0">
                      Add
                    </Button>
                  </div>
                ) : null}
              </form>
            ) : null}

            {/* People with access */}
            <div className="px-5 pt-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                People with access
              </p>

              {isLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-fg-muted">
                  <Loader2 size={14} className="animate-spin" />
                  Loading…
                </div>
              ) : collaborators.length === 0 ? (
                <p className="py-4 text-sm text-fg-muted">
                  Only you so far. Share the link below to bring people in.
                </p>
              ) : (
                <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto">
                  {collaborators.map((member) => (
                    <li key={member.id} className="flex items-center gap-3 rounded-md px-1 py-1.5">
                      <UserAvatar username={member.username} hue={member.avatarHue} size="base" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">
                          {member.username}
                          {member.id === user?.id ? (
                            <span className="font-normal text-fg-muted"> (you)</span>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-fg-muted">
                          {member.email || "No email available"}
                        </span>
                      </span>
                      {/* Owners are shown as static text: the backend refuses to
                          demote the last one, and a dropdown that mostly errors
                          is worse than no dropdown. */}
                      {!isOwner || ownerIds.includes(member.id) ? (
                        <span className="shrink-0 text-sm text-fg-muted">
                          {roleLabel(member, ownerIds)}
                        </span>
                      ) : (
                        <RoleSelect
                          value={member.accessRole || "editor"}
                          onChange={(role) => handleMemberRoleChange(member.id, role)}
                          disabled={savingMemberId === member.id}
                          ariaLabel={`Role for ${member.username}`}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* General access */}
            <div className="mt-5 border-t border-edge-subtle px-5 pt-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                General access
              </p>

              {(() => {
                const active =
                  ACCESS_OPTIONS.find(
                    (option) => option.requireJoinApproval === requireJoinApproval,
                  ) || ACCESS_OPTIONS[0];
                const Icon = active.icon;

                return (
                  <div className="mt-2 flex items-center gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        requireJoinApproval
                          ? "bg-hovered text-fg-muted"
                          : "bg-accent text-fg-accent"
                      }`}
                    >
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      {isOwner ? (
                        <select
                          value={active.id}
                          disabled={isSavingAccess}
                          onChange={(event) => {
                            const next = ACCESS_OPTIONS.find(
                              (option) => option.id === event.target.value,
                            );
                            if (next) handleAccessChange(next.requireJoinApproval);
                          }}
                          aria-label="General access"
                          className="-ml-1 max-w-full cursor-pointer rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-fg outline-none transition-colors hover:bg-hovered focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed"
                        >
                          {ACCESS_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-sm font-medium text-fg">{active.label}</p>
                      )}
                      <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
                        {active.description}
                      </p>
                    </div>
                  </div>
                );
              })()}

              {!isOwner ? (
                <p className="mt-2 text-xs text-fg-muted">
                  Only a workspace owner can change this.
                </p>
              ) : null}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3 border-t border-edge-subtle px-5 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleCopy}
                disabled={!inviteLink}
                leadingIcon={copied ? Check : Link2}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </div>
          </Motion.div>
        </Motion.div>
      ) : null}
    </AnimatePresence>
  );
}
