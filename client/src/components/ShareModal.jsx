import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion as Motion } from "framer-motion";
import { Check, Globe, Link2, Loader2, Lock, X } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "./ui/Button";
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

function roleLabel(member, ownerIds) {
  if (ownerIds.includes(member.id)) return "Owner";

  const role = member.accessRole || "editor";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function ShareModal({ room, isOpen, onClose, onUpdate }) {
  const { token, user } = useAuth();
  const [fullRoom, setFullRoom] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingAccess, setIsSavingAccess] = useState(false);
  const [copied, setCopied] = useState(false);

  const roomId = room?.id;

  useEffect(() => {
    if (!isOpen || !roomId) {
      setFullRoom(null);
      setCopied(false);
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
                      <UserAvatar username={member.username} size="base" />
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
                      <span className="shrink-0 text-xs text-fg-muted">
                        {roleLabel(member, ownerIds)}
                      </span>
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

              <div className="mt-2 space-y-1.5">
                {ACCESS_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const isSelected = option.requireJoinApproval === requireJoinApproval;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={!isOwner || isSavingAccess}
                      onClick={() => handleAccessChange(option.requireJoinApproval)}
                      aria-pressed={isSelected}
                      className={`flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed ${
                        isSelected
                          ? "border-accent bg-accent-subtle"
                          : "border-edge-subtle bg-field enabled:hover:border-edge-strong"
                      } ${!isOwner && !isSelected ? "opacity-50" : ""}`}
                    >
                      <span
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                          isSelected ? "bg-accent text-fg-accent" : "bg-hovered text-fg-muted"
                        }`}
                      >
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-fg">{option.label}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">
                          {option.description}
                        </span>
                      </span>
                      {isSelected ? (
                        <Check size={16} className="mt-1 shrink-0 text-accent" />
                      ) : null}
                    </button>
                  );
                })}
              </div>

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
